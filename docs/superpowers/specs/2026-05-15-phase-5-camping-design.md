# Design — Phase 5: Free-camping search + Reservation-release tracking

**Date:** 2026-05-15
**Status:** approved (pending spec review)
**Author:** Tom + Claude (brainstorming)

---

## Goal

Two related outcomes shipped as one phase:

**5a — Free-camping search.** Outdoor agent answers "where can I camp free near [X]?" using Recreation.gov (federal dispersed sites) + iOverlander (community-sourced boondock spots). Returns campsite candidates with name / distance / land manager / restrictions / amenities / source URL, layered with weather + inventory context.

**5b — Reservation-release tracking.** Bot maintains a Railway-side index of all Recreation.gov **tent-eligible** facilities in Colorado (designed to extend to other states). Sends Telegram nudges:
- **Season opener** — 3 months before each facility's annual booking calendar first opens.
- **Trip-date** — 7 days before a `/plan-trip`-registered visit's booking window opens.
- **Release moment** — at the exact second a planned-trip's booking opens, fires a Telegram message with a one-tap deep-link to the booking page. (Flavor A "alert + deep link" — no automated booking; no credentials stored.)

Bulk mute via a writable `Muted` column on a new "Camping Index" sheet tab.

**Out of scope (v1):** automated booking checkout, walk-up alerts, non-CO states (architecture supports them; seed is CO-only).

## Decisions locked in brainstorming

| Question | Answer |
|---|---|
| Ship 5a + 5b together or split? | **Together** — unified data model, sequential build. |
| How is the watchlist populated? | **Index ALL CO tent-eligible Rec.gov facilities** automatically. |
| Where does the catalog live? | **Railway volume** (JSON) as the local cache, mirrored to a "Camping Index" sheet tab. |
| Sheet is source of truth for what? | **Muted column + Notes column.** Everything else is read-only mirror, refreshed by cron. |
| Region scheme | **Both** auto parent-unit grouping (from Rec.gov metadata) + curated named regions (Front Range, Western Slope, San Juans, Sangres, Northern Mountains). |
| Nudge timing | **Season opener** (3 months before season's first bookable day, once per year) + **trip-date** (7 days before user-registered visit's booking opens). Plus the **release-moment** deep-link alert for trip-dates. |
| Trip registration | Via Telegram `/plan-trip <facility> <date>`. |
| Auto-booking | **Flavor A** — Telegram alert + deep-link only. No headless browser, no credentials, no ToS risk. |
| Site-type filter | **Tent-eligible only:** Campground sites typed STANDARD / TENT ONLY / WALK TO / GROUP TENT ONLY; wilderness permits; picnic areas. Excludes RV-only sites, cabins, yurts, day-use ticket facilities, boat launches. |
| Picnic areas | **Included** with `useType='day-use'`; campgrounds + permits are `useType='overnight'`. |
| Amenities / bathrooms | Pulled from Rec.gov amenity list + iOverlander CSV. Stored as full array plus a `hasRestrooms` convenience flag. |
| iOverlander cache | Weekly CSV snapshot to Railway volume. Not mirrored to sheet. |
| Search radius default | 50 mi; agent re-prompts user for range if not given. |

## Architecture

```
lib/
  reccgov/
    client.ts                ← REST client; rate-limited (200ms min between calls), retried (429 backoff)
    types.ts                 ← Facility, AvailabilityWindow, Reservation
    deep-link.ts             ← buildBookingUrl(facilityId, date) — Rec.gov deep link with dates pre-selected
    regions.ts               ← curated region → parent-unit mapping (CO seed)
  iOverlander/
    cache.ts                 ← weekly CSV snapshot loader; tent-eligible type filter
  campingState.ts            ← read/write camping-index.json + camping-trips.json with file locking
domains/outdoor/
  integrations/
    freecamping.ts           ← unified search facade over Rec.gov index + iOverlander snapshot
  tools.ts                   ← + find_free_campsites tool schema + handler
apps/cron/
  camping/
    index-refresh.ts         ← weekly (Sunday 4am MT): refresh CO facility list
    metadata-refresh.ts      ← monthly (1st, 4am MT): re-pull per-facility metadata + tent-eligibility + amenities
    nudge-tick.ts            ← daily (7am MT): emit season-opener + trip-date nudges
    release-tick.ts          ← every minute: fires deep-link alert at exact release second (no-op when no trip releasing)
apps/bot/commands/
  camping.ts                 ← /watch, /unwatch, /watchlist, /regions, /plan-trip, /trips, /cancel-trip, /campsites
scripts/
  seed-camping-index.ts      ← one-time bootstrap; runs index-refresh + metadata-refresh against an empty index
```

**Module boundaries:**

- `lib/reccgov/` knows nothing about cron, bot, or sheets — just REST + types. Pure client, testable with mocked fetch.
- `lib/iOverlander/` same: pure data loader.
- `domains/outdoor/integrations/freecamping.ts` is the unified search facade: caller asks "find spots near (lat, lng, radius)", gets a merged result from both sources, sorted by distance.
- `apps/cron/camping/*` is the scheduling layer; each tick is narrowly focused, no cross-imports between ticks.
- `apps/bot/commands/camping.ts` is the user-input surface. Reads/writes Railway state + sheet tab; never touches Rec.gov directly (delegates to `lib/reccgov`).

## Data model

### `camping-index.json` (Railway) — facility catalog

```ts
type Facility = {
  facilityId: string;                      // Rec.gov stable ID
  name: string;                            // "Maroon Bells Amphitheater Campground"
  state: string;                           // "CO"
  parentUnit: string;                      // "White River National Forest"
  region: string | null;                   // curated label: "Front Range" / etc., or null
  lat: number;
  lng: number;
  agency: 'USFS' | 'BLM' | 'NPS' | 'USACE' | 'FWS' | 'other';

  useType: 'overnight' | 'day-use';        // day-use = picnic areas

  leadTimeDays: number;                    // rolling-release window, e.g. 180
  specialReleaseDate: string | null;       // ISO date for one-off releases; null for rolling
  seasonStart: string | null;              // "MM-DD" — when season opens each year
  seasonEnd: string | null;
  feeUSD: number;                          // 0 = free; positive = paid
  reservationType:
    | 'reservation'
    | 'lottery'
    | 'walk-up'
    | 'permit';

  tentEligibleSites: string[];             // campsite IDs you can pitch a tent at
  totalSites: number;
  restrictions: string[];                  // "no fires", "tents only", "max-stay 14d"
  amenities: string[];                     // ["Vault Toilets", "Drinking Water", "Picnic Tables"]
  hasRestrooms: boolean;                   // derived: /toilet|restroom|bathroom/i match in amenities

  reservationUrl: string;                  // canonical Rec.gov page URL
  lastMetadataRefresh: string;             // ISO timestamp
  active: boolean;                         // false if Rec.gov removed it or 0 tent-eligible sites
};
type CampingIndex = { facilities: Facility[] };
```

### "Camping Index" sheet tab — mirror with two writable columns

| Facility ID | Name | Agency | Parent Unit | Region | Lat | Lng | Lead Days | Special Release | Season Start | Season End | Fee | Reservation Type | Use Type | Restrictions | Has Restrooms | Amenities | Tent-Eligible Sites | Active | **Muted** | **Notes** |

- Columns through `Active`: read-only mirror written by `index-refresh.ts` and `metadata-refresh.ts`. Edits get overwritten on next refresh.
- **`Muted`** (checkbox): authoritative source of truth for mute state. Bulk-mute via Sheets UI multi-select.
- **`Notes`** (free text): personal annotations preserved across refreshes.
- Refresh semantics: cron updates rows by Facility ID using `buildHeaderMap` (existing pattern in `lib/sheets.ts`). Never clobbers Muted or Notes.

### `camping-trips.json` (Railway) — planned visits

```ts
type PlannedTrip = {
  id: string;                  // uuid
  facilityId: string;
  visitDate: string;           // ISO date — "2026-07-04"
  plannedAt: string;           // ISO timestamp
  nudges: { kind: '7-day' | 'release-moment'; firedAt: string | null }[];
  cancelledAt: string | null;
};
type CampingTrips = { trips: PlannedTrip[] };
```

(No sheet tab for v1 — Tom deferred. Could be added later by mirroring the file.)

### `iOverlander.json` (Railway) — community boondock snapshot

```ts
type BoondockSpot = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description: string;
  amenities: string[];
  hasRestrooms: boolean;       // derived same way as Facility
  lastVerified: string | null;
  sourceUrl: string;
  type: 'wild_camping' | 'informal_campsite' | 'established_campground';
};
type IOverlanderSnapshot = {
  refreshedAt: string;
  spots: BoondockSpot[];
};
```

### Curated regions — hardcoded constant

`lib/reccgov/regions.ts`:

```ts
const CURATED_REGIONS: Record<string, string[]> = {
  'Front Range': [
    'Roosevelt National Forest',
    'Arapaho National Forest',
    'Pike National Forest',
    'Rocky Mountain National Park',
  ],
  'Western Slope': [
    'White River National Forest',
    'Grand Mesa, Uncompahgre and Gunnison National Forests',
    'Black Canyon of the Gunnison National Park',
    'Colorado National Monument',
  ],
  'San Juans': [
    'San Juan National Forest',
    'Rio Grande National Forest',
    'Mesa Verde National Park',
  ],
  'Sangres': [
    'San Isabel National Forest',
    'Great Sand Dunes National Park',
  ],
  'Northern Mountains': [
    'Routt National Forest',
    'Medicine Bow-Routt National Forest',
  ],
};
```

Seeded by hand for v1 — these mappings cover the parent units the implementer will actually encounter against Rec.gov's CO results. Adding regions/states later = appending entries. If `index-refresh.ts` sees a parentUnit not in any region, it logs the unrecognized name so future refreshes can pick it up.

## Cron lifecycle

### Weekly `index-refresh.ts` — Sunday 4am MT

```
1. Fetch Rec.gov facility-search API (state=CO, paginated).
2. For each facility:
   - Lookup by facilityId in camping-index.json.
   - If new: insert with active=true; leadTimeDays/seasonStart/etc. null (filled by metadata-refresh).
   - If existing: refresh name/parentUnit/region/lat/lng only.
3. Facilities in index but NOT in API response → mark active=false (preserves trip history; never delete).
4. Recompute curated `region` field for each facility from its parentUnit.
5. Write camping-index.json atomically.
6. Mirror to "Camping Index" sheet tab: update existing rows by Facility ID using buildHeaderMap; preserve Muted + Notes.
7. Log: "added N, deactivated M, total active K".
```

### Monthly `metadata-refresh.ts` — 1st of month, 4am MT

```
1. Read camping-index.json.
2. For each active facility:
   - Fetch /api/facility/{id} → leadTimeDays, seasonStart/End, fee, reservationType, restrictions, specialReleaseDate, amenities.
   - Fetch /api/facility/{id}/campsites → filter to tent-eligible types (STANDARD, TENT ONLY, WALK TO, GROUP TENT ONLY); populate tentEligibleSites[].
   - For picnic areas (useType='day-use'): skip campsite fetch.
   - If tentEligibleSites.length === 0 AND reservationType !== 'permit' AND useType !== 'day-use': mark active=false.
   - Sleep 200ms between facilities (rate-limit politeness).
3. Atomically rewrite camping-index.json.
4. Mirror metadata changes to the sheet (skip Muted + Notes columns).
5. Log: "refreshed N facilities, deactivated M (RV-only), failures: ...".
```

### Daily `nudge-tick.ts` — 7am MT

```
1. Read camping-index.json, camping-trips.json, current date.
2. Read "Camping Index" sheet → build mutedFacilityIds set from Muted=TRUE rows.
3. Build muted-set = union(mutedFacilityIds, facilities whose parentUnit appears in any muted region's parent-unit list,
                          facilities whose explicit region matches a muted region label).
4. For each NON-MUTED active facility (season opener path):
   a. Compute next-season-open-date:
        if specialReleaseDate set → use it directly
        else if seasonStart set    → next MM-DD occurrence minus leadTimeDays = "calendar opens" date
   b. If that date is exactly 90 days from today → emit season-opener nudge.
   (Bot batches all season-opener nudges that fire same-day into a single Telegram message.)
5. For each PlannedTrip (not cancelled, '7-day' not yet fired):
   a. releaseDate = visitDate - leadTimeDays
   b. If releaseDate - today === 7 days → emit "7-day trip-date" nudge, set firedAt.
6. For each PlannedTrip whose releaseDate === today:
   - Insert into release-tick's working set so it fires at the right minute.
7. Log nudge events.
```

### Per-minute `release-tick.ts` — `* * * * *` UTC

```
1. Read camping-trips.json. For each trip with releaseDate=today and 'release-moment' not yet fired:
   - Look up facility.specialReleaseDate vs. rolling: special-release = morning release at 7am MT;
     rolling = midnight Eastern (10pm MT prev day OR varies by facility; check facility metadata).
   - Compute releaseMinuteUTC.
2. now = current UTC minute. For each scheduled trip:
   - If now is within ±1 minute of trip.releaseMinuteUTC: fire deep-link alert, mark fired.
3. Backstop: at T+5 minutes after any scheduled release, if 'release-moment' still not fired → fire a "this just opened" alert with deep link. Worst-case detection lag = 5 minutes.
4. Cheap to run every minute — most invocations find an empty working set and exit immediately.
```

## On-demand search flow (5a)

Agent calls `find_free_campsites({ location: string, radius_km?: number, include_day_use?: boolean })`:

```
1. If radius_km undefined → tool returns ok=false with hint "ask user for range".
   Agent re-prompts user via Telegram.
2. Geocode `location` via existing Phase 3 Nominatim client → (lat, lng).
3. Read camping-index.json:
   - Filter to active=true.
   - Filter to (useType='overnight' AND tentEligibleSites.length > 0) OR (useType='day-use' AND include_day_use)
     OR (reservationType='permit').
   - Filter to feeUSD === 0 (this tool is the *free*-camping search; paid sites excluded here).
   - Filter by haversine distance ≤ radius_km.
4. Read iOverlander.json:
   - Filter to type ∈ {wild_camping, informal_campsite, established_campground}.
   - Filter by distance.
5. Merge, sort by distance, cap at 10 results.
6. Return Campsite[] with: name, distance_km, agency or "iOverlander community",
   coords, restrictions, useType, reservationType, sourceUrl, amenities, hasRestrooms.
```

Agent composes the final answer with Phase 3 forecast tool called in parallel for the location.

## Telegram command surface

```
/watchlist                          → list every active facility you're being nudged about,
                                       grouped by parent unit, with active trips marked
/regions                            → list curated regions + parent units; show which are muted
/watch <name | facilityId>          → un-mute (in case you'd muted by region and want this one back)
/unwatch <name | facilityId | region | parent>
                                    → mute. Fuzzy match on name; region/parent matched against catalog.
                                       Writes to the Muted column on the sheet.
/plan-trip <facility> <date>        → register a planned visit. Bot computes 7-day-out nudge + release-moment alert.
/trips                              → list active planned trips with releaseDate + status (7-day fired? release fired?)
/cancel-trip <trip-id | facility>   → stop nudges for a trip. Re-add via /plan-trip.
/campsites <location> [radius]      → on-demand search; mirrors the agent tool for quick lookups.
```

All commands plumbed through `apps/bot/commands/camping.ts` and added to `/help`.

Fuzzy match (facility names are long and quirky): reuse `fuzzyMatchExisting` from `lib/dedup.ts` over facility.name + parent. Ambiguity → bot replies with top 3 matches and asks to pick.

## Error handling

**Rec.gov API**
- Rate limiting: client respects 200ms minimum between calls; retries 429s with exponential backoff (pattern from `lib/anthropic-retry.ts`).
- 5xx errors during refresh: facility skipped, error logged, retried on next cron tick. Partial-completeness is tolerated.
- Schema drift: client parses defensively. Unknown fields ignored; missing required fields → facility skipped with a warning. We don't crash the cron.

**Sheet**
- Camping Index tab missing on first run: auto-created by `index-refresh.ts` (existing Cron Log auto-create pattern in `lib/sheets.ts`).
- Sheet read failure during nudge-tick: fall back to last-known-good mute set from a small in-memory cache; log a warning. Over-nudging is safer than silent skip.
- Column shape drift (user accidentally deleted a header): refresh aborts with a Telegram alert ("Camping Index header was modified; bot can't write. Sheet link: …").

**iOverlander snapshot**
- Download fails: keep last snapshot, log staleness in next digest. Search degrades to Rec.gov-only.

**Release-moment alerts**
- Per-minute cron may miss a tick (rare). Backstop: T+5 min post-check fires "this just opened" alert if release-moment-fired is still false.

**Deep-link generation**
- `lib/reccgov/deep-link.ts` builds the URL deterministically. Tested with a fixture set. Returns null if facility data is incomplete → bot sends a fallback: "Booking just opened — go to <Rec.gov facility page>." User clicks one more time.

**Concurrency**
- Hourly cron, per-minute release-tick, and bot may read/write `camping-trips.json` simultaneously. v1 mitigation: read-modify-write with file locking via `proper-lockfile` (lightweight Node lib). All writes serialized.

## Testing

**Unit**
- `lib/reccgov/client.ts` — happy path, rate-limit retry, 5xx tolerance, 429 backoff, schema-drift defensive parsing.
- `lib/reccgov/deep-link.ts` — fixture facility+date pairs → expected URLs; null when data incomplete.
- `lib/iOverlander/cache.ts` — CSV parse, type filter, derived `hasRestrooms`.
- `domains/outdoor/integrations/freecamping.ts` — search merge, distance sort, filters (free-only, tent-eligible, include_day_use, permit), edge case "no results in range."
- `apps/cron/camping/*` — each tick tested with mocked client + storage; assert correct facilities updated, nudges emitted, no-ops on already-fired flags.
- `apps/bot/commands/camping.ts` — each command exercised with mocked storage.

**Integration**
- `npm run smoke-camping` — real Rec.gov + Nominatim hits, like the weather smoke script. Confirms live API still matches our schema.

**Manual acceptance (ship gate)**
1. **Search:** "Where can I camp free near Estes Park within 40 mi?" → ≥3 distinct facilities with restrictions + restrooms visible in the response.
2. **Day-use mix:** "Picnic spots near Boulder?" → returns picnic areas with useType=day-use.
3. **Watchlist edit:** Tick Muted on 5 facilities in Sheets → next-day nudge-tick skips them; `/watchlist` reflects the change.
4. **Season-opener nudge:** With clock advanced 90 days before a known facility's season-open date in a smoke run → nudge fires.
5. **Trip-date alert:** `/plan-trip <site> <date>` → 7-day nudge fires on schedule + release-moment alert lands within 5 min of midnight booking open.
6. **Deep link works:** Tap the alert link on phone → land on the Rec.gov booking page with dates pre-selected.

## Risks / trade-offs

- **Sheet column drift** can break the refresh. Mitigated by abort-and-alert; user fixes by restoring the header.
- **Curated regions** start with hand-picked CO mappings. Will need updates as Rec.gov adds new parent units. Mitigation: cron logs unrecognized parentUnits each refresh; review monthly.
- **Tent-eligibility filter** is heuristic — Rec.gov's `CampsiteType` strings are inconsistent. Initial coverage might miss some valid tent sites (false negatives). Mitigation: log facilities marked active=false and review.
- **Release-moment alerts** depend on Railway cron firing exactly at minute boundaries. ~99% reliable; 5-minute backstop covers the rest.
- **Auto-booking deferred** — if Flavor A turns out to be insufficient (e.g., Tom keeps missing high-demand sites because the 30-second-to-tap window isn't enough), revisit Flavor B/C in v1.5.

## Out of scope (deferred to v1.5+)

- Camping Trips sheet tab (mirror of `camping-trips.json`).
- Auto-booking (Flavor B or C).
- Non-CO state seeds.
- Walk-up cancellation alerts ("a site just opened up at X").
- USFS Motor Vehicle Use Maps for legal-dispersed boundaries.
- Reservation-history view ("show me everywhere I've booked through Rec.gov").

## Open questions

None — all design questions resolved in brainstorming.
