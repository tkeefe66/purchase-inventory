# Phase 5 Deploy Checklist

> Step-by-step to take Phase 5 from "shipped on `main`" to "running in production." Follow in order. Most of this is manual ops outside Claude's reach.

**Code state at write-time:** all on `main`, tests 441 passing / 1 skipped, typecheck clean.

---

## Pre-flight

- [ ] **Verify branch is clean and pushed.**
  ```bash
  git status        # working tree clean
  git log --oneline -1   # should be 3b9a7b0 docs: Phase 5 camping shipped — DECISIONS, CLAUDE, PLAN
  git push origin main   # if not already pushed
  ```

- [ ] **Confirm tests + typecheck pass locally.**
  ```bash
  npx tsc --noEmit
  npx vitest run 2>&1 | tail -5
  ```

---

## 1. Get a Recreation.gov API key

The cron + seed both need `RECGOV_API_KEY` to call the RIDB API.

- [ ] Go to **https://ridb.recreation.gov/** and sign in (free, no business validation).
- [ ] Click "Get an API Key" → email-confirm → key is generated immediately.
- [ ] Copy the key — you'll paste it in `.env` (local) and Railway env vars (prod).

---

## 2. Local `.env` setup

Already added during foundation work (T1-T6). Verify your local `.env` has these:

- [ ] `RECGOV_API_KEY=<your new key>`
- [ ] `CAMPING_INDEX_PATH=./local-data/camping-index.json` (or any writable local path)
- [ ] `CAMPING_TRIPS_PATH=./local-data/camping-trips.json`
- [ ] `IOVERLANDER_CACHE_PATH=./local-data/iOverlander.json`

```bash
mkdir -p local-data    # so the file-locked writes work
```

---

## 3. Bootstrap the "Camping Index" sheet tab

The `bootstrap-sheet` script is idempotent and will create the tab + write the 21-column header row if missing.

- [ ] Run locally against the production sheet:
  ```bash
  npm run bootstrap-sheet
  ```
  Expected output includes a line like:
  > Plan: create "Camping Index" tab with 21 headers

  (If you see `(already exists — skip)`, you're done.)

- [ ] Open the sheet in your browser and confirm the **Camping Index** tab exists with these column headers in row 1:
  Facility ID, Name, Agency, Parent Unit, Region, Lat, Lng, Lead Days, Special Release, Season Start, Season End, Fee, Reservation Type, Use Type, Restrictions, Has Restrooms, Amenities, Tent-Eligible Sites, Active, Muted, Notes

---

## 4. Smoke the Rec.gov key locally

Make sure the API key actually works before seeding 200+ facilities.

- [ ] `npm run smoke-camping`

  Expected: 5 facility IDs/names printed, then a JSON dump of the first facility's metadata + campsite-type breakdown.
  If you see `401`, the key isn't propagated. Re-check `.env` and confirm the variable name is exactly `RECGOV_API_KEY`.

---

## 5. Seed locally (dry-run-of-production)

Verify the seed runs end-to-end against your local volume.

- [ ] `npm run seed-camping`

  Expect ~5-10 minutes wall time. Output:
  ```
  Phase 1: index-refresh (fetching CO facility list)...
    +XYZ new, XYZ total active
  Phase 2: metadata-refresh (per-facility metadata + tent filter)...
    XYZ refreshed, XYZ deactivated, XYZ failures
  Seed complete.
  ```

- [ ] Open the production sheet — the **Camping Index** tab should now have hundreds of rows mirrored from `camping-index.json`.

- [ ] Verify `./local-data/camping-index.json` exists and contains the same facilities.

---

## 6. Provision Railway

Two things need to land in the existing Railway project:

### 6a. Railway volume for shared state

Both the bot and the new camping-cron service need read/write to `/data/camping-index.json` and `/data/camping-trips.json`.

- [ ] In the Railway dashboard, create a **Volume** mounted at `/data` (1 GB is plenty).
- [ ] Attach to the **bot** service so `/plan-trip`, `/trips`, `/watch`, etc. can read+write.
- [ ] Attach to the (yet-to-exist) **camping-cron** service when you create it in 6b.

### 6b. camping-cron service

- [ ] In Railway, click "+ New" → "Empty Service" (or "Service from repo" pointing to this same repo).
- [ ] Name: `camping-cron`.
- [ ] Use the existing repo, but tell Railway to use `railway.camping.json` as its config file (or copy the contents of that file into the service settings panel).
- [ ] Attach the `/data` volume from 6a.
- [ ] Set these env vars (copy from the bot service where they exist):
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REFRESH_TOKEN`
  - `GOOGLE_SHEET_ID`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
  - `RECGOV_API_KEY` (the one from step 1)
- [ ] The cron schedule is already `* * * * *` (every minute) in `railway.camping.json`. Confirm Railway picks that up.

---

## 7. Copy `RECGOV_API_KEY` into the BOT service too

The bot's `find_free_campsites` agent tool reads from the volume but doesn't call Rec.gov directly. The cron is what populates the volume. Still:

- [ ] Confirm the bot service has the same env vars it had before (no new ones strictly needed for Phase 5, since the bot only reads from `/data` files and the sheet).

---

## 8. Initial production seed

The cron's weekly `index-refresh` only fires Sunday 4am MT. Don't wait — seed manually.

Option A — preferred: run the seed locally one more time but pointing at `/data` via remote write:

- This is **not** possible without SSH'ing into Railway. Skip.

Option B (what to actually do):

- [ ] **Push the seed script as a one-time Railway job.** Either:
  - Temporarily change `railway.camping.json`'s `startCommand` to `node dist/scripts/seed-camping-index.js`, redeploy, watch logs, then revert.
  - Or, easier: SSH/exec into the camping-cron container and run `npm run seed-camping`.

The first-tick gotcha: the per-minute cron's `release-tick` runs immediately on first boot and reads `/data/camping-index.json` and `/data/camping-trips.json`. Both files don't exist yet, but `lib/campingState.ts`'s `readCampingIndex` / `readCampingTrips` return `{ facilities: [] }` / `{ trips: [] }` on missing files (verified in T15 code-review). So no crash. The first 1-7 days will just be noisy "0 fired" ticks until the seed runs.

---

## 9. Post-deploy smoke

Once seed + camping-cron are both running:

- [ ] Open Telegram → message the bot `/watchlist`. Expect a grouped list of facilities (Front Range / Western Slope / San Juans / ...).
- [ ] Message `/regions`. Expect the 5 curated region names with parent units under each.
- [ ] Message `/plan-trip Maroon Bells 2026-12-15`. Expect "Planned ... Booking opens 2026-06-18; I'll nudge you 7 days out and at the release moment."
- [ ] Message `/trips`. Expect the trip you just planned.
- [ ] Open the sheet's **Camping Index** tab. Flip the `Muted` checkbox on a row. Next nudge-tick (7am MT next morning) should skip that facility.
- [ ] In the camping-cron service logs, look for `[camping-cron] tick @ ...` every minute. Once an hour you should see `release-tick` runs even when nothing fires.

---

## 10. Verify Phase 5 acceptance

Per the original spec, two outcomes had to land:

- [ ] **Search:** Tom asks the outdoor agent "Where can I camp free near Crested Butte within 30 mi?" — the agent invokes `find_free_campsites`, returns ≥1 hit with name, distance, source URL.
- [ ] **Tracking:**
  - [ ] Season-opener nudge: a curated CO facility's "calendar-opens" date is exactly 90 days from today → bot sends an audible Telegram message on the next 7am MT tick.
  - [ ] 7-day nudge: a planned trip's release date is exactly 7 days out → bot sends a heads-up.
  - [ ] Release-moment nudge: a planned trip's release date arrives → bot sends a deep-link Telegram message within ±5 minutes.

When all three of those have fired at least once in production, **Phase 5 is in daily use** and the Golden Rule says we can start thinking about Phase 6 or a new domain.

---

## Things that might bite

- **OAuth refresh-token expiry.** Google's OAuth consent screen must be **published**, not Testing — otherwise the refresh token rotates every 7 days. (Locked in DECISIONS.md.) Verify before deploy.
- **Rec.gov rate limit.** RIDB's keyed limit is 5000/hour. The seed makes ~N+1 calls (CO returns ~1074 facilities total). Phase 1 search pages through them in batches of 50 (~22 calls). Phase 2 metadata-refresh hits 2 endpoints per active facility — for ~1074 facilities that's ~2148 calls, taking ~7 minutes wall time with the 200ms inter-request floor. Well within hourly quota.
- **Sheet write quota.** `setMutedInCampingIndex` writes one cell per affected row in a loop. A region-mute touching 30 facilities = 30 writes. Google Sheets allows 60 writes/min/user — within budget but tight if used aggressively. (Noted in T13 review as a future-batched-update candidate.)
- **iOverlander cache.** The weekly CSV download isn't gated by a cron in v1. iOverlander has no real-time API, so the snapshot is statically built into the cache file. Refresh manually if it becomes stale.
- **DST drift on `releaseAt` for special-release facilities.** The 14:00 UTC anchor is 7am MST / 8am MDT — special releases in summer fire ~1 hour late. Noted in T11 review; low-impact (rare path, alert is still actionable).
- **RIDB doesn't expose structured camping metadata.** Season window, lead-time-days, fee amount, amenities — none are first-class fields on the Rec.gov RIDB v1 facility schema. T9 metadata-refresh falls back to defaults: `leadTimeDays ?? 180`, `seasonStart` stays null, `feeUSD ?? 0`, `amenities = []`. **Net effect:**
  - 7-day + release-moment nudges fire correctly (use leadTimeDays default).
  - **Season-opener nudges don't fire** for any facility (require non-null `seasonStart`).
  - `/campsites` agent tool sees all `feeUSD=0` facilities as "free" — which matches reality for most USFS overnight sites but not all.
  - To get accurate season windows, you'd need to either (a) parse `FacilityUseFeeDescription` free-text, or (b) maintain a hand-curated seasons.json. Out of scope for v1.
- **RIDB facility parent units are verbose** ("Medicine Bow-Routt NFs & Thunder Basin NG"). `CURATED_REGIONS` in `lib/reccgov/regions.ts` uses clean names ("Medicine Bow-Routt National Forest"). Many facilities will have `region: null` after the seed. `/watchlist` falls back to grouping by `parentUnit` (which IS populated post-fix), so it still works — just with RIDB-flavored group headers. `/regions` still lists the 5 curated regions but only matches some facilities. Fix path: add string-normalization or aliases to `regionForParentUnit`.
- **`state=CO` filter is loose.** RIDB filters by the facility's primary address; some facilities have empty/wrong addresses and slip through. The first 5 results in the smoke test included one Utah facility ("Huntington Canyon Recreation Area" in Manti-La Sal NF). The index will be a small superset of strict CO. Not harmful; just means `find_free_campsites` near Grand Junction might surface a UT result that's actually closer than expected.

---

## Rollback

If Phase 5 starts paging Tom incorrectly:

1. **Stop the camping-cron service** in Railway (don't delete it — pause).
2. The bot keeps working without it (the camping commands just won't show any data updates).
3. If JSON state is corrupted: `rm /data/camping-index.json /data/camping-trips.json` and re-run the seed.
4. If the sheet's Camping Index tab is wrong: delete the tab from the sheet, re-run `npm run bootstrap-sheet`, re-run `npm run seed-camping`.

The whole system is idempotent — re-running the seed is safe.
