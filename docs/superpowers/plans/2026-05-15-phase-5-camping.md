# Phase 5 — Free-camping search + Reservation-release tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two outcomes as one phase — (a) `find_free_campsites` agent tool that answers "where can I camp free near X?", and (b) a Railway-side index of all CO tent-eligible Rec.gov facilities with proactive Telegram nudges (season opener + trip-date + release-moment deep-link alert).

**Architecture:** A new `lib/reccgov/` REST client + `lib/iOverlander/` CSV loader feed a unified search facade in `domains/outdoor/integrations/freecamping.ts`. A new Railway cron service (`railway.camping.json`) runs every minute and gates four ticks by their own cadence (weekly index-refresh, monthly metadata-refresh, daily nudge-tick, per-minute release-tick). The "Camping Index" sheet tab is the authoritative source for the user-editable `Muted` column.

**Tech Stack:** Node.js 20 + TypeScript 5, vitest, googleapis, Anthropic SDK (for agent tool), `proper-lockfile` (new dep) for file locking, date-fns-tz, Railway cron.

**Spec:** `docs/superpowers/specs/2026-05-15-phase-5-camping-design.md`

**Build order:** Foundation (Tasks 1-6) → Reservation tracking 5b (Tasks 7-15) → Free-camping search 5a (Tasks 16-18) → Operational/docs (Tasks 19-22). Tasks 1-15 produce a working tracking system before search is layered on.

---

## Task 1: Rec.gov types + regions constant

**Files:**
- Create: `lib/reccgov/types.ts`
- Create: `lib/reccgov/regions.ts`
- Create: `tests/lib/reccgov/regions.test.ts`

- [ ] **Step 1: Create `lib/reccgov/types.ts`**

```ts
export type Agency = 'USFS' | 'BLM' | 'NPS' | 'USACE' | 'FWS' | 'other';
export type UseType = 'overnight' | 'day-use';
export type ReservationType = 'reservation' | 'lottery' | 'walk-up' | 'permit';

export interface Facility {
  facilityId: string;
  name: string;
  state: string;
  parentUnit: string;
  region: string | null;
  lat: number;
  lng: number;
  agency: Agency;
  useType: UseType;
  leadTimeDays: number;
  specialReleaseDate: string | null;
  seasonStart: string | null;   // "MM-DD"
  seasonEnd: string | null;     // "MM-DD"
  feeUSD: number;
  reservationType: ReservationType;
  tentEligibleSites: string[];
  totalSites: number;
  restrictions: string[];
  amenities: string[];
  hasRestrooms: boolean;
  reservationUrl: string;
  lastMetadataRefresh: string;  // ISO timestamp
  active: boolean;
}

export interface CampingIndex {
  facilities: Facility[];
}

export interface PlannedTrip {
  id: string;
  facilityId: string;
  visitDate: string;            // ISO date
  plannedAt: string;            // ISO timestamp
  nudges: { kind: '7-day' | 'release-moment'; firedAt: string | null }[];
  cancelledAt: string | null;
}

export interface CampingTrips {
  trips: PlannedTrip[];
}

export interface RecGovError extends Error {
  code: 'rate_limited' | 'not_found' | 'api_error' | 'schema_error';
  status?: number;
}
```

- [ ] **Step 2: Create `lib/reccgov/regions.ts`**

```ts
export const CURATED_REGIONS: Record<string, string[]> = {
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

/**
 * Look up the curated region label for a given Rec.gov parent unit name.
 * Returns null if the parent unit isn't mapped — index-refresh logs these for follow-up curation.
 */
export function regionForParentUnit(parentUnit: string): string | null {
  for (const [region, parents] of Object.entries(CURATED_REGIONS)) {
    if (parents.includes(parentUnit)) return region;
  }
  return null;
}
```

- [ ] **Step 3: Write the failing test**

Create `tests/lib/reccgov/regions.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { regionForParentUnit, CURATED_REGIONS } from '../../../lib/reccgov/regions.js';

describe('regionForParentUnit', () => {
  test('maps a known parent unit to its curated region', () => {
    expect(regionForParentUnit('Rocky Mountain National Park')).toBe('Front Range');
    expect(regionForParentUnit('San Juan National Forest')).toBe('San Juans');
  });
  test('returns null for an unmapped parent', () => {
    expect(regionForParentUnit('Tongass National Forest')).toBeNull();
  });
  test('every CURATED_REGIONS entry has at least one parent', () => {
    for (const [region, parents] of Object.entries(CURATED_REGIONS)) {
      expect(parents.length, `${region} has no parents`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lib/reccgov/regions.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/reccgov/types.ts lib/reccgov/regions.ts tests/lib/reccgov/regions.test.ts
git commit -m "feat(reccgov): types + curated CO region mappings"
```

---

## Task 2: Rec.gov REST client with rate limiting

**Files:**
- Create: `lib/reccgov/client.ts`
- Create: `tests/lib/reccgov/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/reccgov/client.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRecGovClient } from '../../../lib/reccgov/client.js';

const SEARCH_RESPONSE = {
  RECDATA: [
    {
      FacilityID: '231959',
      FacilityName: 'Maroon Bells Amphitheater',
      ParentRECAREAName: 'White River National Forest',
      FacilityLatitude: 39.097,
      FacilityLongitude: -106.948,
      FacilityTypeDescription: 'Campground',
      AddressStateCode: 'CO',
    },
  ],
};

describe('RecGovClient.searchFacilities', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('returns parsed facilities from a happy-path response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEARCH_RESPONSE), { status: 200 }),
    );
    const client = createRecGovClient({ apiKey: 'TEST' });
    const out = await client.searchFacilities({ state: 'CO' });
    expect(out).toHaveLength(1);
    expect(out[0]!.facilityId).toBe('231959');
    expect(out[0]!.name).toBe('Maroon Bells Amphitheater');
    expect(out[0]!.parentUnit).toBe('White River National Forest');
  });

  test('retries on 429 with backoff', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(SEARCH_RESPONSE), { status: 200 }));
    const client = createRecGovClient({ apiKey: 'TEST', retryDelayMs: 1 });
    const out = await client.searchFacilities({ state: 'CO' });
    expect(out).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('throws RecGovError after max retries on 429', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
    const client = createRecGovClient({ apiKey: 'TEST', retryDelayMs: 1, maxRetries: 2 });
    await expect(client.searchFacilities({ state: 'CO' })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  test('throws schema_error on malformed response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ unexpected: 'shape' }), { status: 200 }),
    );
    const client = createRecGovClient({ apiKey: 'TEST' });
    await expect(client.searchFacilities({ state: 'CO' })).rejects.toMatchObject({ code: 'schema_error' });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/lib/reccgov/client.test.ts`
Expected: FAIL "Cannot find module '../../../lib/reccgov/client.js'".

- [ ] **Step 3: Implement `lib/reccgov/client.ts`**

```ts
import type { Facility, RecGovError } from './types.js';

const BASE_URL = 'https://ridb.recreation.gov/api/v1';

export interface RecGovClientOpts {
  apiKey: string;
  retryDelayMs?: number;
  maxRetries?: number;
  minIntervalMs?: number;
}

export interface FacilitySearchOpts {
  state?: string;
  limit?: number;
  offset?: number;
}

export interface RecGovClient {
  searchFacilities(opts: FacilitySearchOpts): Promise<Partial<Facility>[]>;
  getFacility(facilityId: string): Promise<Partial<Facility>>;
  getFacilityCampsites(facilityId: string): Promise<Array<{ campsiteId: string; campsiteType: string }>>;
}

function makeError(code: RecGovError['code'], message: string, status?: number): RecGovError {
  const e = new Error(message) as RecGovError;
  e.code = code;
  if (status !== undefined) e.status = status;
  return e;
}

export function createRecGovClient(opts: RecGovClientOpts): RecGovClient {
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  const maxRetries = opts.maxRetries ?? 3;
  const minIntervalMs = opts.minIntervalMs ?? 200;
  let lastCallAt = 0;

  async function pace(): Promise<void> {
    const now = Date.now();
    const wait = lastCallAt + minIntervalMs - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  }

  async function call<T>(path: string, query: Record<string, string | number>): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await pace();
      const resp = await fetch(url.toString(), {
        headers: { apikey: opts.apiKey, Accept: 'application/json' },
      });
      if (resp.status === 429) {
        if (attempt === maxRetries) throw makeError('rate_limited', `Rec.gov 429 after ${maxRetries} retries`, 429);
        await new Promise((r) => setTimeout(r, retryDelayMs * Math.pow(2, attempt)));
        continue;
      }
      if (resp.status === 404) throw makeError('not_found', `Rec.gov 404 for ${path}`, 404);
      if (!resp.ok) throw makeError('api_error', `Rec.gov ${resp.status} for ${path}`, resp.status);
      return await resp.json() as T;
    }
    throw makeError('api_error', 'unreachable');
  }

  function mapSearchRow(r: Record<string, unknown>): Partial<Facility> {
    return {
      facilityId: String(r.FacilityID ?? ''),
      name: String(r.FacilityName ?? ''),
      parentUnit: String(r.ParentRECAREAName ?? ''),
      lat: Number(r.FacilityLatitude ?? 0),
      lng: Number(r.FacilityLongitude ?? 0),
      state: String(r.AddressStateCode ?? ''),
      useType: r.FacilityTypeDescription === 'Picnic Area' ? 'day-use' : 'overnight',
    };
  }

  return {
    async searchFacilities(searchOpts) {
      const data = await call<{ RECDATA?: unknown }>(`/facilities`, {
        state: searchOpts.state ?? 'CO',
        limit: searchOpts.limit ?? 50,
        offset: searchOpts.offset ?? 0,
      });
      if (!Array.isArray(data.RECDATA)) throw makeError('schema_error', 'RECDATA missing from /facilities response');
      return (data.RECDATA as Array<Record<string, unknown>>).map(mapSearchRow);
    },
    async getFacility(facilityId) {
      const data = await call<{ RECDATA?: unknown }>(`/facilities/${facilityId}`, {});
      if (typeof data.RECDATA !== 'object' || data.RECDATA === null) {
        throw makeError('schema_error', `RECDATA missing from /facilities/${facilityId}`);
      }
      return mapSearchRow(data.RECDATA as Record<string, unknown>);
    },
    async getFacilityCampsites(facilityId) {
      const data = await call<{ RECDATA?: unknown }>(`/facilities/${facilityId}/campsites`, {});
      if (!Array.isArray(data.RECDATA)) return [];
      return (data.RECDATA as Array<Record<string, unknown>>).map((r) => ({
        campsiteId: String(r.CampsiteID ?? ''),
        campsiteType: String(r.CampsiteType ?? ''),
      }));
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lib/reccgov/client.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/reccgov/client.ts tests/lib/reccgov/client.test.ts
git commit -m "feat(reccgov): REST client with rate-limit + 429 backoff"
```

---

## Task 3: Deep-link URL builder

**Files:**
- Create: `lib/reccgov/deep-link.ts`
- Create: `tests/lib/reccgov/deep-link.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/reccgov/deep-link.test.ts
import { describe, test, expect } from 'vitest';
import { buildBookingUrl } from '../../../lib/reccgov/deep-link.js';

describe('buildBookingUrl', () => {
  test('builds a Rec.gov URL with date pre-selected', () => {
    expect(buildBookingUrl('231959', '2026-07-04')).toBe(
      'https://www.recreation.gov/camping/campgrounds/231959?startDate=2026-07-04',
    );
  });
  test('returns null when facilityId is empty', () => {
    expect(buildBookingUrl('', '2026-07-04')).toBeNull();
  });
  test('returns null when date is malformed', () => {
    expect(buildBookingUrl('231959', 'not-a-date')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/reccgov/deep-link.ts
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function buildBookingUrl(facilityId: string, visitDate: string): string | null {
  if (!facilityId || !ISO_DATE.test(visitDate)) return null;
  return `https://www.recreation.gov/camping/campgrounds/${facilityId}?startDate=${visitDate}`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/lib/reccgov/deep-link.test.ts
git add lib/reccgov/deep-link.ts tests/lib/reccgov/deep-link.test.ts
git commit -m "feat(reccgov): buildBookingUrl deep-link helper"
```

---

## Task 4: `campingState` — Railway JSON state with file locking

**Files:**
- Create: `lib/campingState.ts`
- Create: `tests/lib/campingState.test.ts`
- Modify: `package.json` (add `proper-lockfile` dep)

- [ ] **Step 1: Install dep**

```bash
npm install proper-lockfile
npm install --save-dev @types/proper-lockfile
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/lib/campingState.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCampingIndex, writeCampingIndex, readCampingTrips, writeCampingTrips } from '../../lib/campingState.js';
import type { CampingIndex, CampingTrips } from '../../lib/reccgov/types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'camping-')); });

describe('campingState', () => {
  test('readCampingIndex returns empty when file missing', async () => {
    const out = await readCampingIndex(join(dir, 'index.json'));
    expect(out).toEqual({ facilities: [] });
  });

  test('write then read round-trips', async () => {
    const idx: CampingIndex = {
      facilities: [{
        facilityId: '1', name: 'Test', state: 'CO', parentUnit: 'Test NF', region: null,
        lat: 39, lng: -106, agency: 'USFS', useType: 'overnight',
        leadTimeDays: 180, specialReleaseDate: null, seasonStart: null, seasonEnd: null,
        feeUSD: 0, reservationType: 'reservation',
        tentEligibleSites: [], totalSites: 0, restrictions: [],
        amenities: [], hasRestrooms: false,
        reservationUrl: '', lastMetadataRefresh: '', active: true,
      }],
    };
    await writeCampingIndex(join(dir, 'index.json'), idx);
    const out = await readCampingIndex(join(dir, 'index.json'));
    expect(out.facilities).toHaveLength(1);
    expect(out.facilities[0]!.facilityId).toBe('1');
  });

  test('campingTrips round-trip', async () => {
    const trips: CampingTrips = {
      trips: [{
        id: 'abc', facilityId: '1', visitDate: '2026-07-04',
        plannedAt: '2026-05-15T00:00:00Z', nudges: [], cancelledAt: null,
      }],
    };
    await writeCampingTrips(join(dir, 'trips.json'), trips);
    const out = await readCampingTrips(join(dir, 'trips.json'));
    expect(out.trips).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Implement**

```ts
// lib/campingState.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';
import type { CampingIndex, CampingTrips } from './reccgov/types.js';

async function readJsonOr<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  const raw = await readFile(path, 'utf-8');
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

async function writeJsonWithLock(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Ensure file exists before locking.
  if (!existsSync(path)) await writeFile(path, '{}', 'utf-8');
  const release = await lockfile.lock(path, { retries: { retries: 3, minTimeout: 50 } });
  try {
    await writeFile(path, JSON.stringify(value, null, 2), 'utf-8');
  } finally {
    await release();
  }
}

export async function readCampingIndex(path: string): Promise<CampingIndex> {
  return readJsonOr<CampingIndex>(path, { facilities: [] });
}
export async function writeCampingIndex(path: string, value: CampingIndex): Promise<void> {
  return writeJsonWithLock(path, value);
}
export async function readCampingTrips(path: string): Promise<CampingTrips> {
  return readJsonOr<CampingTrips>(path, { trips: [] });
}
export async function writeCampingTrips(path: string, value: CampingTrips): Promise<void> {
  return writeJsonWithLock(path, value);
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run tests/lib/campingState.test.ts
git add lib/campingState.ts tests/lib/campingState.test.ts package.json package-lock.json
git commit -m "feat(camping): file-locked JSON state for index + trips"
```

---

## Task 5: iOverlander CSV cache

**Files:**
- Create: `lib/iOverlander/cache.ts`
- Create: `tests/lib/iOverlander/cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/iOverlander/cache.test.ts
import { describe, test, expect, vi } from 'vitest';
import { parseIOverlanderCsv, downloadAndCacheIOverlander } from '../../../lib/iOverlander/cache.js';

const SAMPLE_CSV = `id,name,latitude,longitude,description,amenities,type,last_verified,source_url
abc,Wild Spot 1,39.5,-107.0,Free dispersed,"toilets,water",wild_camping,2025-10-01,https://example.com/1
xyz,Gas Station,40.0,-108.0,Just gas,"","gas_station",2025-09-01,https://example.com/2
def,Boondock 2,38.0,-105.5,Quiet spot,"fire_pit",informal_campsite,,https://example.com/3
`;

describe('parseIOverlanderCsv', () => {
  test('keeps only camping-eligible types', () => {
    const out = parseIOverlanderCsv(SAMPLE_CSV);
    expect(out.spots).toHaveLength(2);
    expect(out.spots.map((s) => s.id).sort()).toEqual(['abc', 'def']);
  });
  test('derives hasRestrooms from amenities', () => {
    const out = parseIOverlanderCsv(SAMPLE_CSV);
    const spot = out.spots.find((s) => s.id === 'abc')!;
    expect(spot.hasRestrooms).toBe(true);
    const spot2 = out.spots.find((s) => s.id === 'def')!;
    expect(spot2.hasRestrooms).toBe(false);
  });
  test('refreshedAt is set', () => {
    const out = parseIOverlanderCsv(SAMPLE_CSV);
    expect(out.refreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('downloadAndCacheIOverlander', () => {
  test('writes a snapshot file', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(SAMPLE_CSV, { status: 200 }));
    const writes: { path: string; content: string }[] = [];
    const writer = async (path: string, content: string) => { writes.push({ path, content }); };
    await downloadAndCacheIOverlander({
      url: 'https://example.com/io.csv',
      cachePath: '/tmp/io.json',
      writeFile: writer,
    });
    expect(writes).toHaveLength(1);
    const snap = JSON.parse(writes[0]!.content);
    expect(snap.spots.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/iOverlander/cache.ts
import { writeFile as fsWriteFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type IOverlanderType = 'wild_camping' | 'informal_campsite' | 'established_campground';

export interface BoondockSpot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description: string;
  amenities: string[];
  hasRestrooms: boolean;
  lastVerified: string | null;
  sourceUrl: string;
  type: IOverlanderType;
}

export interface IOverlanderSnapshot {
  refreshedAt: string;
  spots: BoondockSpot[];
}

const KEEP_TYPES = new Set<IOverlanderType>(['wild_camping', 'informal_campsite', 'established_campground']);
const RESTROOM_RE = /toilet|restroom|bathroom/i;

export function parseIOverlanderCsv(csv: string): IOverlanderSnapshot {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0] ?? '');
  const idx = (n: string): number => header.indexOf(n);
  const spots: BoondockSpot[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]!);
    const type = String(row[idx('type')] ?? '') as IOverlanderType;
    if (!KEEP_TYPES.has(type)) continue;
    const amenities = (row[idx('amenities')] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    spots.push({
      id: row[idx('id')] ?? '',
      name: row[idx('name')] ?? '',
      lat: Number(row[idx('latitude')] ?? 0),
      lng: Number(row[idx('longitude')] ?? 0),
      description: row[idx('description')] ?? '',
      amenities,
      hasRestrooms: amenities.some((a) => RESTROOM_RE.test(a)),
      lastVerified: row[idx('last_verified')] || null,
      sourceUrl: row[idx('source_url')] ?? '',
      type,
    });
  }
  return { refreshedAt: new Date().toISOString(), spots };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') inQuotes = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export interface DownloadOpts {
  url: string;
  cachePath: string;
  writeFile?: (path: string, content: string) => Promise<void>;
  fetcher?: typeof fetch;
}

export async function downloadAndCacheIOverlander(opts: DownloadOpts): Promise<IOverlanderSnapshot> {
  const fetcher = opts.fetcher ?? fetch;
  const writer = opts.writeFile ?? (async (p, c) => {
    await mkdir(dirname(p), { recursive: true });
    await fsWriteFile(p, c, 'utf-8');
  });
  const resp = await fetcher(opts.url);
  if (!resp.ok) throw new Error(`iOverlander download failed: ${resp.status}`);
  const csv = await resp.text();
  const snap = parseIOverlanderCsv(csv);
  await writer(opts.cachePath, JSON.stringify(snap, null, 2));
  return snap;
}

export async function readIOverlanderSnapshot(path: string): Promise<IOverlanderSnapshot | null> {
  if (!existsSync(path)) return null;
  try { return JSON.parse(await readFile(path, 'utf-8')) as IOverlanderSnapshot; }
  catch { return null; }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/lib/iOverlander/cache.test.ts
git add lib/iOverlander/cache.ts tests/lib/iOverlander/cache.test.ts
git commit -m "feat(iOverlander): CSV download + parse + tent-eligible filter"
```

---

## Task 6: Camping Index sheet tab helpers

**Files:**
- Modify: `lib/sheets.ts` (append at end, after the Cron Log helpers)
- Create: `tests/lib/sheets-camping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/sheets-camping.test.ts
import { describe, test, expect, vi } from 'vitest';
import { mirrorCampingIndex, readMutedFacilityIds } from '../../lib/sheets.js';
import type { Facility } from '../../lib/reccgov/types.js';

const HEADER = [
  'Facility ID', 'Name', 'Agency', 'Parent Unit', 'Region', 'Lat', 'Lng',
  'Lead Days', 'Special Release', 'Season Start', 'Season End', 'Fee',
  'Reservation Type', 'Use Type', 'Restrictions', 'Has Restrooms',
  'Amenities', 'Tent-Eligible Sites', 'Active', 'Muted', 'Notes',
];

function mockSheets(opts: { existingTabs: string[]; existingRows?: (string | number | boolean)[][] }) {
  const updated: { range: string; values: unknown[][] }[] = [];
  const appended: unknown[][] = [];
  const created: string[] = [];
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({ data: { sheets: opts.existingTabs.map((t) => ({ properties: { title: t } })) } }),
      batchUpdate: vi.fn(async (req: { requestBody: { requests: { addSheet: { properties: { title: string } } }[] } }) => {
        for (const r of req.requestBody.requests) created.push(r.addSheet.properties.title);
        return { data: {} };
      }),
      values: {
        get: vi.fn().mockResolvedValue({
          data: { values: opts.existingRows ? [HEADER, ...opts.existingRows] : [HEADER] },
        }),
        update: vi.fn(async (req: { range: string; requestBody: { values: unknown[][] } }) => {
          updated.push({ range: req.range, values: req.requestBody.values });
          return { data: {} };
        }),
        append: vi.fn(async (req: { requestBody: { values: unknown[][] } }) => {
          appended.push(...req.requestBody.values);
          return { data: {} };
        }),
      },
    },
  };
  return { sheets, updated, appended, created };
}

const sampleFacility: Facility = {
  facilityId: 'F1', name: 'Test CG', state: 'CO', parentUnit: 'Test NF', region: 'Front Range',
  lat: 39, lng: -106, agency: 'USFS', useType: 'overnight',
  leadTimeDays: 180, specialReleaseDate: null, seasonStart: '05-15', seasonEnd: '10-15',
  feeUSD: 0, reservationType: 'reservation',
  tentEligibleSites: ['S1', 'S2'], totalSites: 5,
  restrictions: ['no fires'], amenities: ['Vault Toilets'], hasRestrooms: true,
  reservationUrl: 'https://example.com', lastMetadataRefresh: '2026-05-15T00:00:00Z', active: true,
};

describe('mirrorCampingIndex', () => {
  test('creates Camping Index tab when missing and writes header', async () => {
    const { sheets, created } = mockSheets({ existingTabs: ['All Purchases'] });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(created).toContain('Camping Index');
  });

  test('appends new facilities when tab is empty', async () => {
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(appended).toHaveLength(1);
    expect(appended[0]![0]).toBe('F1');
  });

  test('updates existing rows by Facility ID without touching Muted or Notes', async () => {
    const { sheets, updated } = mockSheets({
      existingTabs: ['All Purchases', 'Camping Index'],
      existingRows: [['F1', 'Old Name', 'USFS', '', '', 0, 0, 0, '', '', '', 0, '', '', '', false, '', '', false, true, 'my notes']],
    });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(updated.length).toBeGreaterThan(0);
    // Find the row update; Muted column index = 19, Notes = 20
    const updatedRow = updated.find((u) => u.range.includes('A2'))!.values[0]!;
    expect(updatedRow[1]).toBe('Test CG');         // Name updated
    expect(updatedRow[19]).toBe(true);              // Muted preserved
    expect(updatedRow[20]).toBe('my notes');        // Notes preserved
  });
});

describe('readMutedFacilityIds', () => {
  test('returns Facility IDs where Muted=TRUE', async () => {
    const { sheets } = mockSheets({
      existingTabs: ['All Purchases', 'Camping Index'],
      existingRows: [
        ['F1', 'A', 'USFS', '', '', 0, 0, 0, '', '', '', 0, '', '', '', false, '', '', true, true, ''],
        ['F2', 'B', 'USFS', '', '', 0, 0, 0, '', '', '', 0, '', '', '', false, '', '', true, false, ''],
        ['F3', 'C', 'USFS', '', '', 0, 0, 0, '', '', '', 0, '', '', '', false, '', '', true, 'TRUE', ''],
      ],
    });
    const out = await readMutedFacilityIds(sheets as never, 'sid');
    expect(out.sort()).toEqual(['F1', 'F3']);
  });
});
```

- [ ] **Step 2: Implement (append to `lib/sheets.ts`)**

Append this block at the bottom of `lib/sheets.ts`:

```ts
import type { Facility } from './reccgov/types.js';

const CAMPING_INDEX_TAB = 'Camping Index';
const CAMPING_INDEX_HEADER = [
  'Facility ID', 'Name', 'Agency', 'Parent Unit', 'Region', 'Lat', 'Lng',
  'Lead Days', 'Special Release', 'Season Start', 'Season End', 'Fee',
  'Reservation Type', 'Use Type', 'Restrictions', 'Has Restrooms',
  'Amenities', 'Tent-Eligible Sites', 'Active', 'Muted', 'Notes',
] as const;

async function ensureCampingIndexTab(sheets: SheetsClient, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === CAMPING_INDEX_TAB);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: CAMPING_INDEX_TAB } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${CAMPING_INDEX_TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [Array.from(CAMPING_INDEX_HEADER)] },
  });
}

function facilityRow(f: Facility): (string | number | boolean)[] {
  return [
    f.facilityId, f.name, f.agency, f.parentUnit, f.region ?? '',
    f.lat, f.lng, f.leadTimeDays, f.specialReleaseDate ?? '',
    f.seasonStart ?? '', f.seasonEnd ?? '', f.feeUSD,
    f.reservationType, f.useType,
    f.restrictions.join('; '), f.hasRestrooms,
    f.amenities.join('; '), f.tentEligibleSites.length, f.active,
  ];
}

export async function mirrorCampingIndex(
  sheets: SheetsClient,
  spreadsheetId: string,
  facilities: readonly Facility[],
): Promise<void> {
  await ensureCampingIndexTab(sheets, spreadsheetId);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CAMPING_INDEX_TAB}'!A:U`,
  });
  const rows = (resp.data.values ?? []) as (string | number | boolean)[][];
  const header = rows[0] ?? Array.from(CAMPING_INDEX_HEADER);
  const idIdx = header.indexOf('Facility ID');
  const mutedIdx = header.indexOf('Muted');
  const notesIdx = header.indexOf('Notes');

  const existingById = new Map<string, { gridRow: number; muted: unknown; notes: unknown }>();
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i]![idIdx] ?? '');
    if (!id) continue;
    existingById.set(id, {
      gridRow: i + 1,
      muted: rows[i]![mutedIdx],
      notes: rows[i]![notesIdx],
    });
  }

  const toAppend: unknown[][] = [];
  for (const f of facilities) {
    const row = facilityRow(f);
    const existing = existingById.get(f.facilityId);
    if (existing) {
      row.push(existing.muted ?? false);
      row.push(existing.notes ?? '');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${CAMPING_INDEX_TAB}'!A${existing.gridRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [row] },
      });
    } else {
      row.push(false);
      row.push('');
      toAppend.push(row);
    }
  }
  if (toAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${CAMPING_INDEX_TAB}'!A:U`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: toAppend },
    });
  }
}

export async function readMutedFacilityIds(
  sheets: SheetsClient,
  spreadsheetId: string,
): Promise<string[]> {
  let raw: (string | number | boolean)[][];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${CAMPING_INDEX_TAB}'!A:T`,
    });
    raw = (resp.data.values ?? []) as (string | number | boolean)[][];
  } catch { return []; }
  if (raw.length < 2) return [];
  const header = raw[0]!;
  const idIdx = header.indexOf('Facility ID');
  const mutedIdx = header.indexOf('Muted');
  if (idIdx < 0 || mutedIdx < 0) return [];
  const out: string[] = [];
  for (let i = 1; i < raw.length; i++) {
    const id = String(raw[i]![idIdx] ?? '');
    const muted = raw[i]![mutedIdx];
    if (id && (muted === true || muted === 'TRUE' || muted === 'true')) out.push(id);
  }
  return out;
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/lib/sheets-camping.test.ts
git add lib/sheets.ts tests/lib/sheets-camping.test.ts
git commit -m "feat(sheets): Camping Index tab mirror + Muted column reader"
```

---

## Task 7: Schedule gates (pure functions)

**Files:**
- Create: `apps/cron/camping/schedule.ts`
- Create: `tests/cron/camping/schedule.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cron/camping/schedule.test.ts
import { describe, test, expect } from 'vitest';
import {
  shouldRunIndexRefresh,
  shouldRunMetadataRefresh,
  shouldRunNudgeTick,
  shouldCheckReleaseTick,
} from '../../../apps/cron/camping/schedule.js';

describe('shouldRunIndexRefresh — Sunday 4am MT', () => {
  test('Sunday 10:00 UTC during MDT (4:00 MT) → true', () => {
    expect(shouldRunIndexRefresh(new Date('2026-05-17T10:00:00Z'))).toBe(true);
  });
  test('Sunday 11:00 UTC during MST (4:00 MT) → true', () => {
    expect(shouldRunIndexRefresh(new Date('2026-01-18T11:00:00Z'))).toBe(true);
  });
  test('Saturday 4am MT → false', () => {
    expect(shouldRunIndexRefresh(new Date('2026-05-16T10:00:00Z'))).toBe(false);
  });
  test('Sunday 3am MT → false', () => {
    expect(shouldRunIndexRefresh(new Date('2026-05-17T09:00:00Z'))).toBe(false);
  });
});

describe('shouldRunMetadataRefresh — 1st of month 4am MT', () => {
  test('May 1 4am MT (10:00 UTC during DST) → true', () => {
    expect(shouldRunMetadataRefresh(new Date('2026-05-01T10:00:00Z'))).toBe(true);
  });
  test('May 2 4am MT → false', () => {
    expect(shouldRunMetadataRefresh(new Date('2026-05-02T10:00:00Z'))).toBe(false);
  });
});

describe('shouldRunNudgeTick — daily 7am MT', () => {
  test('any day at 13:00 UTC during DST (= 7am MT) → true', () => {
    expect(shouldRunNudgeTick(new Date('2026-05-15T13:00:00Z'))).toBe(true);
  });
  test('6am MT → false', () => {
    expect(shouldRunNudgeTick(new Date('2026-05-15T12:00:00Z'))).toBe(false);
  });
});

describe('shouldCheckReleaseTick', () => {
  test('always true — release-tick runs every minute and self-gates', () => {
    expect(shouldCheckReleaseTick(new Date('2026-05-15T13:42:00Z'))).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// apps/cron/camping/schedule.ts
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/Denver';

function mt(now: Date, fmt: string): string {
  return formatInTimeZone(now, TZ, fmt);
}

export function shouldRunIndexRefresh(now: Date): boolean {
  return mt(now, 'EEEE') === 'Sunday' && mt(now, 'H') === '4' && mt(now, 'm') === '0';
}

export function shouldRunMetadataRefresh(now: Date): boolean {
  return mt(now, 'd') === '1' && mt(now, 'H') === '4' && mt(now, 'm') === '0';
}

export function shouldRunNudgeTick(now: Date): boolean {
  return mt(now, 'H') === '7' && mt(now, 'm') === '0';
}

export function shouldCheckReleaseTick(_now: Date): boolean {
  return true;  // gated internally by checking camping-trips.json
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/cron/camping/schedule.test.ts
git add apps/cron/camping/schedule.ts tests/cron/camping/schedule.test.ts
git commit -m "feat(camping/cron): hour-gate helpers for each tick (DST-aware)"
```

---

## Task 8: `index-refresh.ts` — weekly facility list

**Files:**
- Create: `apps/cron/camping/index-refresh.ts`
- Create: `tests/cron/camping/index-refresh.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cron/camping/index-refresh.test.ts
import { describe, test, expect, vi } from 'vitest';
import { runIndexRefresh } from '../../../apps/cron/camping/index-refresh.js';
import type { Facility, CampingIndex } from '../../../lib/reccgov/types.js';

function makeFacility(partial: Partial<Facility>): Facility {
  return {
    facilityId: '', name: '', state: 'CO', parentUnit: '', region: null,
    lat: 0, lng: 0, agency: 'USFS', useType: 'overnight',
    leadTimeDays: 0, specialReleaseDate: null, seasonStart: null, seasonEnd: null,
    feeUSD: 0, reservationType: 'reservation',
    tentEligibleSites: [], totalSites: 0, restrictions: [],
    amenities: [], hasRestrooms: false,
    reservationUrl: '', lastMetadataRefresh: '', active: true,
    ...partial,
  };
}

describe('runIndexRefresh', () => {
  test('adds new facilities, deactivates vanished ones, preserves trip-relevant data', async () => {
    const existingIndex: CampingIndex = {
      facilities: [
        makeFacility({ facilityId: 'OLD', name: 'Old CG', parentUnit: 'Old NF', active: true }),
        makeFacility({ facilityId: 'KEEP', name: 'Old name', parentUnit: 'Roosevelt National Forest', active: true }),
      ],
    };
    const searchResults = [
      { facilityId: 'KEEP', name: 'New name', parentUnit: 'Roosevelt National Forest', lat: 40, lng: -105, state: 'CO', useType: 'overnight' as const },
      { facilityId: 'NEW', name: 'New CG', parentUnit: 'San Juan National Forest', lat: 37, lng: -108, state: 'CO', useType: 'overnight' as const },
    ];
    const client = { searchFacilities: vi.fn().mockResolvedValue(searchResults) };
    const mirror = vi.fn().mockResolvedValue(undefined);

    const result = await runIndexRefresh({
      existingIndex,
      client: client as never,
      mirror: mirror as never,
      sheetSpreadsheetId: 'sid',
      sheets: {} as never,
    });

    expect(result.added).toBe(1);
    expect(result.deactivated).toBe(1);
    const byId = new Map(result.index.facilities.map((f) => [f.facilityId, f]));
    expect(byId.get('OLD')!.active).toBe(false);
    expect(byId.get('KEEP')!.name).toBe('New name');
    expect(byId.get('KEEP')!.region).toBe('Front Range');
    expect(byId.get('NEW')!.region).toBe('San Juans');
    expect(mirror).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// apps/cron/camping/index-refresh.ts
import type { CampingIndex, Facility } from '../../../lib/reccgov/types.js';
import type { RecGovClient } from '../../../lib/reccgov/client.js';
import { regionForParentUnit } from '../../../lib/reccgov/regions.js';
import type { SheetsClient } from '../../../lib/sheets.js';
import { mirrorCampingIndex } from '../../../lib/sheets.js';

export interface RunIndexRefreshOpts {
  existingIndex: CampingIndex;
  client: RecGovClient;
  mirror?: typeof mirrorCampingIndex;
  sheets: SheetsClient;
  sheetSpreadsheetId: string;
}

export interface IndexRefreshResult {
  index: CampingIndex;
  added: number;
  deactivated: number;
  totalActive: number;
}

export async function runIndexRefresh(opts: RunIndexRefreshOpts): Promise<IndexRefreshResult> {
  const mirror = opts.mirror ?? mirrorCampingIndex;
  // Page through Rec.gov until exhausted.
  const all: Partial<Facility>[] = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const page = await opts.client.searchFacilities({ state: 'CO', limit, offset });
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }

  const byId = new Map(opts.existingIndex.facilities.map((f) => [f.facilityId, { ...f }]));
  const seen = new Set<string>();
  let added = 0;

  for (const fresh of all) {
    if (!fresh.facilityId) continue;
    seen.add(fresh.facilityId);
    const existing = byId.get(fresh.facilityId);
    const region = regionForParentUnit(fresh.parentUnit ?? '');
    if (existing) {
      existing.name = fresh.name ?? existing.name;
      existing.parentUnit = fresh.parentUnit ?? existing.parentUnit;
      existing.region = region;
      existing.lat = fresh.lat ?? existing.lat;
      existing.lng = fresh.lng ?? existing.lng;
      existing.useType = fresh.useType ?? existing.useType;
      existing.active = true;
    } else {
      added++;
      byId.set(fresh.facilityId, {
        facilityId: fresh.facilityId, name: fresh.name ?? '', state: 'CO',
        parentUnit: fresh.parentUnit ?? '', region,
        lat: fresh.lat ?? 0, lng: fresh.lng ?? 0,
        agency: 'USFS', useType: fresh.useType ?? 'overnight',
        leadTimeDays: 0, specialReleaseDate: null,
        seasonStart: null, seasonEnd: null,
        feeUSD: 0, reservationType: 'reservation',
        tentEligibleSites: [], totalSites: 0,
        restrictions: [], amenities: [], hasRestrooms: false,
        reservationUrl: '', lastMetadataRefresh: '',
        active: true,
      });
    }
  }

  let deactivated = 0;
  for (const f of byId.values()) {
    if (!seen.has(f.facilityId) && f.active) {
      f.active = false;
      deactivated++;
    }
  }

  const index: CampingIndex = { facilities: Array.from(byId.values()) };
  await mirror(opts.sheets, opts.sheetSpreadsheetId, index.facilities);

  return {
    index,
    added,
    deactivated,
    totalActive: index.facilities.filter((f) => f.active).length,
  };
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/cron/camping/index-refresh.test.ts
git add apps/cron/camping/index-refresh.ts tests/cron/camping/index-refresh.test.ts
git commit -m "feat(camping/cron): weekly index-refresh from Rec.gov + sheet mirror"
```

---

## Task 9: `metadata-refresh.ts` — monthly per-facility metadata

**Files:**
- Create: `apps/cron/camping/metadata-refresh.ts`
- Create: `tests/cron/camping/metadata-refresh.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cron/camping/metadata-refresh.test.ts
import { describe, test, expect, vi } from 'vitest';
import { runMetadataRefresh } from '../../../apps/cron/camping/metadata-refresh.js';
import type { CampingIndex } from '../../../lib/reccgov/types.js';

describe('runMetadataRefresh', () => {
  test('fills in metadata + tent-eligible filter; deactivates RV-only facilities', async () => {
    const existing: CampingIndex = {
      facilities: [
        { facilityId: 'TENT', name: 'A', state: 'CO', parentUnit: 'X', region: null, lat: 0, lng: 0,
          agency: 'USFS', useType: 'overnight', leadTimeDays: 0, specialReleaseDate: null,
          seasonStart: null, seasonEnd: null, feeUSD: 0, reservationType: 'reservation',
          tentEligibleSites: [], totalSites: 0, restrictions: [], amenities: [], hasRestrooms: false,
          reservationUrl: '', lastMetadataRefresh: '', active: true },
        { facilityId: 'RV', name: 'B', state: 'CO', parentUnit: 'X', region: null, lat: 0, lng: 0,
          agency: 'USFS', useType: 'overnight', leadTimeDays: 0, specialReleaseDate: null,
          seasonStart: null, seasonEnd: null, feeUSD: 0, reservationType: 'reservation',
          tentEligibleSites: [], totalSites: 0, restrictions: [], amenities: [], hasRestrooms: false,
          reservationUrl: '', lastMetadataRefresh: '', active: true },
      ],
    };
    const client = {
      getFacility: vi.fn(async (id: string) => ({
        leadTimeDays: 180, seasonStart: '05-15', seasonEnd: '10-15',
        feeUSD: id === 'TENT' ? 0 : 25, reservationType: 'reservation' as const,
        amenities: id === 'TENT' ? ['Vault Toilets', 'Picnic Tables'] : ['Dump Station'],
        restrictions: [], reservationUrl: `https://recreation.gov/${id}`,
      })),
      getFacilityCampsites: vi.fn(async (id: string) =>
        id === 'TENT'
          ? [{ campsiteId: 'S1', campsiteType: 'TENT ONLY NONELECTRIC' }, { campsiteId: 'S2', campsiteType: 'STANDARD NONELECTRIC' }]
          : [{ campsiteId: 'R1', campsiteType: 'RV ELECTRIC' }],
      ),
    };

    const result = await runMetadataRefresh({ existingIndex: existing, client: client as never });

    const tent = result.index.facilities.find((f) => f.facilityId === 'TENT')!;
    const rv = result.index.facilities.find((f) => f.facilityId === 'RV')!;
    expect(tent.tentEligibleSites).toEqual(['S1', 'S2']);
    expect(tent.active).toBe(true);
    expect(tent.hasRestrooms).toBe(true);
    expect(rv.tentEligibleSites).toEqual([]);
    expect(rv.active).toBe(false);
    expect(result.deactivated).toBe(1);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// apps/cron/camping/metadata-refresh.ts
import type { CampingIndex, Facility } from '../../../lib/reccgov/types.js';
import type { RecGovClient } from '../../../lib/reccgov/client.js';

const TENT_TYPES = new Set([
  'TENT ONLY NONELECTRIC', 'TENT ONLY ELECTRIC',
  'STANDARD NONELECTRIC', 'STANDARD ELECTRIC',
  'WALK TO', 'WALK-IN', 'GROUP TENT ONLY',
]);
const RESTROOM_RE = /toilet|restroom|bathroom/i;

export interface RunMetadataRefreshOpts {
  existingIndex: CampingIndex;
  client: RecGovClient;
}
export interface MetadataRefreshResult {
  index: CampingIndex;
  refreshed: number;
  deactivated: number;
  failures: number;
}

function deriveTentEligible(campsites: Array<{ campsiteId: string; campsiteType: string }>): string[] {
  return campsites.filter((c) => TENT_TYPES.has(c.campsiteType.toUpperCase())).map((c) => c.campsiteId);
}

export async function runMetadataRefresh(opts: RunMetadataRefreshOpts): Promise<MetadataRefreshResult> {
  let refreshed = 0;
  let deactivated = 0;
  let failures = 0;
  const out: Facility[] = [];
  const nowIso = new Date().toISOString();
  for (const f of opts.existingIndex.facilities) {
    if (!f.active) { out.push(f); continue; }
    try {
      const meta = await opts.client.getFacility(f.facilityId) as Partial<Facility>;
      const tentSites: string[] = f.useType === 'day-use'
        ? []
        : deriveTentEligible(await opts.client.getFacilityCampsites(f.facilityId));
      const totalSites = f.useType === 'day-use' ? 0 : tentSites.length;
      const amenities = (meta.amenities as string[] | undefined) ?? [];
      const updated: Facility = {
        ...f,
        leadTimeDays: meta.leadTimeDays ?? f.leadTimeDays ?? 180,
        specialReleaseDate: meta.specialReleaseDate ?? f.specialReleaseDate,
        seasonStart: meta.seasonStart ?? f.seasonStart,
        seasonEnd: meta.seasonEnd ?? f.seasonEnd,
        feeUSD: meta.feeUSD ?? f.feeUSD ?? 0,
        reservationType: meta.reservationType ?? f.reservationType ?? 'reservation',
        restrictions: (meta.restrictions as string[] | undefined) ?? f.restrictions,
        amenities,
        hasRestrooms: amenities.some((a) => RESTROOM_RE.test(a)),
        reservationUrl: meta.reservationUrl ?? f.reservationUrl ?? '',
        tentEligibleSites: tentSites,
        totalSites,
        lastMetadataRefresh: nowIso,
      };
      if (f.useType === 'overnight' && updated.tentEligibleSites.length === 0 && updated.reservationType !== 'permit') {
        updated.active = false;
        deactivated++;
      }
      refreshed++;
      out.push(updated);
    } catch (err) {
      console.warn(`[metadata-refresh] ${f.facilityId} failed:`, err instanceof Error ? err.message : err);
      failures++;
      out.push(f);
    }
  }
  return { index: { facilities: out }, refreshed, deactivated, failures };
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/cron/camping/metadata-refresh.test.ts
git add apps/cron/camping/metadata-refresh.ts tests/cron/camping/metadata-refresh.test.ts
git commit -m "feat(camping/cron): monthly metadata-refresh + tent-eligible filter"
```

---

## Task 10: `nudge-tick.ts` — daily season-opener + trip-date nudges

**Files:**
- Create: `apps/cron/camping/nudge-tick.ts`
- Create: `tests/cron/camping/nudge-tick.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cron/camping/nudge-tick.test.ts
import { describe, test, expect, vi } from 'vitest';
import { runNudgeTick } from '../../../apps/cron/camping/nudge-tick.js';
import type { CampingIndex, CampingTrips, Facility } from '../../../lib/reccgov/types.js';

function f(partial: Partial<Facility>): Facility {
  return {
    facilityId: 'F', name: 'Site', state: 'CO', parentUnit: 'X', region: null,
    lat: 0, lng: 0, agency: 'USFS', useType: 'overnight',
    leadTimeDays: 180, specialReleaseDate: null, seasonStart: '05-15', seasonEnd: '10-15',
    feeUSD: 0, reservationType: 'reservation',
    tentEligibleSites: ['s1'], totalSites: 1,
    restrictions: [], amenities: [], hasRestrooms: false,
    reservationUrl: '', lastMetadataRefresh: '', active: true,
    ...partial,
  };
}

describe('runNudgeTick', () => {
  test('emits season-opener nudge when today === season-open-date - 90 days', async () => {
    // seasonStart 05-15, leadTimeDays 180 → calendar opens around 11-16. Nudge fires 3 months before.
    // For 2027 season: calendar opens 2026-11-16; nudge fires 2026-08-18.
    const today = new Date('2026-08-18T13:00:00Z');
    const index: CampingIndex = { facilities: [f({ facilityId: 'SEASON' })] };
    const trips: CampingTrips = { trips: [] };
    const messages: string[] = [];
    const res = await runNudgeTick({
      now: today, index, trips, mutedFacilityIds: [],
      sendTelegram: async (text: string) => { messages.push(text); },
    });
    expect(res.seasonOpenerFired).toBe(1);
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  test('emits 7-day trip-date nudge', async () => {
    // visitDate 2026-08-22, leadTimeDays 180 → releaseDate 2026-02-23. 7 days before = 2026-02-16.
    const today = new Date('2026-02-16T14:00:00Z');
    const index: CampingIndex = { facilities: [f({ facilityId: 'F1' })] };
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '2026-02-01T00:00:00Z',
      nudges: [{ kind: 'release-moment', firedAt: null }, { kind: '7-day', firedAt: null }],
      cancelledAt: null,
    }] };
    const messages: string[] = [];
    const res = await runNudgeTick({
      now: today, index, trips, mutedFacilityIds: [],
      sendTelegram: async (text: string) => { messages.push(text); },
    });
    expect(res.sevenDayFired).toBe(1);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const nudge = res.trips.trips[0]!.nudges.find((n) => n.kind === '7-day')!;
    expect(nudge.firedAt).not.toBeNull();
  });

  test('skips muted facilities', async () => {
    const today = new Date('2026-08-18T13:00:00Z');
    const index: CampingIndex = { facilities: [f({ facilityId: 'M1' })] };
    const res = await runNudgeTick({
      now: today, index, trips: { trips: [] }, mutedFacilityIds: ['M1'],
      sendTelegram: async () => {},
    });
    expect(res.seasonOpenerFired).toBe(0);
  });

  test('does not re-fire a 7-day nudge already fired', async () => {
    const today = new Date('2026-02-16T14:00:00Z');
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: '7-day', firedAt: '2026-02-16T14:00:00Z' }], cancelledAt: null,
    }] };
    const res = await runNudgeTick({
      now: today, index: { facilities: [f({ facilityId: 'F1' })] }, trips, mutedFacilityIds: [],
      sendTelegram: async () => {},
    });
    expect(res.sevenDayFired).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// apps/cron/camping/nudge-tick.ts
import type { CampingIndex, CampingTrips, Facility } from '../../../lib/reccgov/types.js';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/Denver';

export interface RunNudgeTickOpts {
  now: Date;
  index: CampingIndex;
  trips: CampingTrips;
  mutedFacilityIds: string[];
  sendTelegram: (text: string) => Promise<void>;
}

export interface NudgeTickResult {
  seasonOpenerFired: number;
  sevenDayFired: number;
  trips: CampingTrips;
}

function todayMtDateString(now: Date): string {
  return formatInTimeZone(now, TZ, 'yyyy-MM-dd');
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * For a facility with rolling release, compute the next "season open" date — the
 * first day each year that any season-date becomes bookable. Equals (nextSeasonStart - leadTimeDays).
 * For special-release facilities, returns the specialReleaseDate directly.
 */
function nextSeasonOpenDate(f: Facility, todayMt: string): string | null {
  if (f.specialReleaseDate) {
    return f.specialReleaseDate >= todayMt ? f.specialReleaseDate : null;
  }
  if (!f.seasonStart) return null;
  const [yyyy] = todayMt.split('-');
  let year = Number(yyyy);
  for (let i = 0; i < 2; i++) {
    const seasonStart = `${year}-${f.seasonStart}`;
    const openDate = addDays(seasonStart, -f.leadTimeDays);
    if (openDate >= todayMt) return openDate;
    year++;
  }
  return null;
}

export async function runNudgeTick(opts: RunNudgeTickOpts): Promise<NudgeTickResult> {
  const todayMt = todayMtDateString(opts.now);
  const muted = new Set(opts.mutedFacilityIds);
  const facilitiesById = new Map(opts.index.facilities.map((f) => [f.facilityId, f]));

  let seasonOpenerFired = 0;
  const seasonHits: string[] = [];
  for (const f of opts.index.facilities) {
    if (!f.active || muted.has(f.facilityId)) continue;
    const seasonOpen = nextSeasonOpenDate(f, todayMt);
    if (!seasonOpen) continue;
    const ninetyOut = addDays(todayMt, 90);
    if (seasonOpen === ninetyOut) {
      seasonHits.push(`• ${f.name} (${f.parentUnit}) — booking opens ${seasonOpen}`);
      seasonOpenerFired++;
    }
  }
  if (seasonHits.length > 0) {
    const msg = [`🗓️ Camping season opens in 90 days for ${seasonHits.length} site(s):`, ...seasonHits].join('\n');
    await opts.sendTelegram(msg);
  }

  let sevenDayFired = 0;
  const updatedTrips: CampingTrips = { trips: opts.trips.trips.map((t) => ({ ...t, nudges: [...t.nudges] })) };
  for (const trip of updatedTrips.trips) {
    if (trip.cancelledAt) continue;
    const f = facilitiesById.get(trip.facilityId);
    if (!f) continue;
    const releaseDate = addDays(trip.visitDate, -f.leadTimeDays);
    const sevenOut = addDays(todayMt, 7);
    if (releaseDate === sevenOut) {
      const existing = trip.nudges.find((n) => n.kind === '7-day');
      if (!existing || existing.firedAt === null) {
        await opts.sendTelegram(
          `⏰ 7-day heads up: ${f.name} booking for ${trip.visitDate} opens in 7 days (${releaseDate}).`,
        );
        const nudge = existing ?? { kind: '7-day' as const, firedAt: null };
        nudge.firedAt = opts.now.toISOString();
        if (!existing) trip.nudges.push(nudge);
        sevenDayFired++;
      }
    }
  }

  return { seasonOpenerFired, sevenDayFired, trips: updatedTrips };
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/cron/camping/nudge-tick.test.ts
git add apps/cron/camping/nudge-tick.ts tests/cron/camping/nudge-tick.test.ts
git commit -m "feat(camping/cron): daily nudge-tick (season opener + 7-day trip-date)"
```

---

## Task 11: `release-tick.ts` — per-minute deep-link alert

**Files:**
- Create: `apps/cron/camping/release-tick.ts`
- Create: `tests/cron/camping/release-tick.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cron/camping/release-tick.test.ts
import { describe, test, expect } from 'vitest';
import { runReleaseTick } from '../../../apps/cron/camping/release-tick.js';
import type { CampingIndex, CampingTrips, Facility } from '../../../lib/reccgov/types.js';

const f = (partial: Partial<Facility> = {}): Facility => ({
  facilityId: 'F1', name: 'Site', state: 'CO', parentUnit: 'X', region: null,
  lat: 0, lng: 0, agency: 'USFS', useType: 'overnight',
  leadTimeDays: 180, specialReleaseDate: null, seasonStart: null, seasonEnd: null,
  feeUSD: 0, reservationType: 'reservation',
  tentEligibleSites: ['s1'], totalSites: 1,
  restrictions: [], amenities: [], hasRestrooms: false,
  reservationUrl: '', lastMetadataRefresh: '', active: true,
  ...partial,
});

describe('runReleaseTick', () => {
  test('fires alert when now is within 1 minute of release time (10pm MT prev day for rolling-release)', async () => {
    const now = new Date('2026-02-23T05:00:00Z'); // 10pm MT prev day in MST
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: null }], cancelledAt: null,
    }] };
    const messages: string[] = [];
    const res = await runReleaseTick({
      now, index: { facilities: [f()] }, trips,
      sendTelegram: async (text: string) => { messages.push(text); },
    });
    expect(res.fired).toBe(1);
    expect(messages[0]).toContain('https://www.recreation.gov/camping/campgrounds/F1');
  });

  test('does not re-fire when already fired', async () => {
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: '2026-02-23T05:00:00Z' }], cancelledAt: null,
    }] };
    const res = await runReleaseTick({
      now: new Date('2026-02-23T05:00:00Z'),
      index: { facilities: [f()] }, trips,
      sendTelegram: async () => {},
    });
    expect(res.fired).toBe(0);
  });

  test('T+5 minute backstop still fires if missed', async () => {
    // releaseAt: 2026-02-23T05:00:00Z. Now is T+4 min.
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: null }], cancelledAt: null,
    }] };
    const res = await runReleaseTick({
      now: new Date('2026-02-23T05:04:00Z'),
      index: { facilities: [f()] }, trips,
      sendTelegram: async () => {},
    });
    expect(res.fired).toBe(1);
  });

  test('does NOT fire when more than 5 minutes after release window', async () => {
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: null }], cancelledAt: null,
    }] };
    const res = await runReleaseTick({
      now: new Date('2026-02-23T05:30:00Z'),
      index: { facilities: [f()] }, trips,
      sendTelegram: async () => {},
    });
    expect(res.fired).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// apps/cron/camping/release-tick.ts
import type { CampingIndex, CampingTrips, Facility } from '../../../lib/reccgov/types.js';
import { buildBookingUrl } from '../../../lib/reccgov/deep-link.js';

export interface RunReleaseTickOpts {
  now: Date;
  index: CampingIndex;
  trips: CampingTrips;
  sendTelegram: (text: string) => Promise<void>;
}

export interface ReleaseTickResult {
  fired: number;
  trips: CampingTrips;
}

/**
 * Compute the release moment (UTC Date) for a trip on a given facility.
 * Rolling-release: 10pm MT the day before the release date (== midnight Eastern == 04:00 UTC during MDT, 05:00 UTC during MST).
 * Special release: 7am MT on specialReleaseDate.
 * We approximate: rolling = (visitDate - leadTimeDays) at 05:00 UTC; backstop window is ±5 min.
 */
function releaseAt(f: Facility, trip: { visitDate: string }): Date {
  if (f.specialReleaseDate) {
    // 7am MT on special release date — use 14:00 UTC (works for both DST and STD with 5-min tolerance).
    return new Date(`${f.specialReleaseDate}T14:00:00Z`);
  }
  // Rolling: midnight Eastern the day before booking-open.
  const releaseDate = new Date(`${trip.visitDate}T00:00:00Z`);
  releaseDate.setUTCDate(releaseDate.getUTCDate() - f.leadTimeDays);
  releaseDate.setUTCHours(5, 0, 0, 0); // 10pm MT prev day in MST window
  return releaseDate;
}

export async function runReleaseTick(opts: RunReleaseTickOpts): Promise<ReleaseTickResult> {
  const byId = new Map(opts.index.facilities.map((f) => [f.facilityId, f]));
  const nowMs = opts.now.getTime();
  let fired = 0;
  const updated: CampingTrips = { trips: opts.trips.trips.map((t) => ({ ...t, nudges: [...t.nudges] })) };
  for (const trip of updated.trips) {
    if (trip.cancelledAt) continue;
    const f = byId.get(trip.facilityId);
    if (!f) continue;
    const releaseNudge = trip.nudges.find((n) => n.kind === 'release-moment');
    if (!releaseNudge || releaseNudge.firedAt) continue;
    const releaseTime = releaseAt(f, trip).getTime();
    const diffMin = (nowMs - releaseTime) / 60000;
    // Fire if within [-1 min, +5 min] of release.
    if (diffMin >= -1 && diffMin <= 5) {
      const url = buildBookingUrl(f.facilityId, trip.visitDate);
      const link = url ?? f.reservationUrl ?? `https://www.recreation.gov/camping/campgrounds/${f.facilityId}`;
      await opts.sendTelegram(
        `🔔 ${f.name} booking JUST OPENED for ${trip.visitDate}. Tap to grab: ${link}`,
      );
      releaseNudge.firedAt = opts.now.toISOString();
      fired++;
    }
  }
  return { fired, trips: updated };
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/cron/camping/release-tick.test.ts
git add apps/cron/camping/release-tick.ts tests/cron/camping/release-tick.test.ts
git commit -m "feat(camping/cron): per-minute release-tick deep-link alert"
```

---

## Task 12: Camping cron entrypoint + Railway config

**Files:**
- Create: `apps/cron/camping/index.ts`
- Create: `railway.camping.json`
- Modify: `package.json` (add `npm run camping` script)

- [ ] **Step 1: Implement entrypoint**

Create `apps/cron/camping/index.ts`:

```ts
import 'dotenv/config';
import { formatInTimeZone } from 'date-fns-tz';
import {
  shouldRunIndexRefresh,
  shouldRunMetadataRefresh,
  shouldRunNudgeTick,
} from './schedule.js';
import { createRecGovClient } from '../../../lib/reccgov/client.js';
import { createSheetsClient } from '../../../lib/sheets.js';
import { readMutedFacilityIds } from '../../../lib/sheets.js';
import { readCampingIndex, writeCampingIndex, readCampingTrips, writeCampingTrips } from '../../../lib/campingState.js';
import { runIndexRefresh } from './index-refresh.js';
import { runMetadataRefresh } from './metadata-refresh.js';
import { runNudgeTick } from './nudge-tick.js';
import { runReleaseTick } from './release-tick.js';
import { sendMessage } from '../../../lib/telegram.js';

const INDEX_PATH = process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json';
const TRIPS_PATH = process.env.CAMPING_TRIPS_PATH ?? '/data/camping-trips.json';

async function main(): Promise<void> {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
                    'GOOGLE_SHEET_ID', 'RECGOV_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  for (const k of required) {
    if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1); }
  }
  const now = new Date();
  console.log(`[camping-cron] tick @ ${formatInTimeZone(now, 'America/Denver', 'yyyy-MM-dd HH:mm zzz')}`);

  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const recgov = createRecGovClient({ apiKey: process.env.RECGOV_API_KEY! });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const sendTelegram = async (text: string) => {
    await sendMessage(
      { botToken: process.env.TELEGRAM_BOT_TOKEN! },
      { chat_id: process.env.TELEGRAM_CHAT_ID!, text, disable_notification: false },
    );
  };

  if (shouldRunIndexRefresh(now)) {
    console.log('[camping-cron] running index-refresh');
    const idx = await readCampingIndex(INDEX_PATH);
    const res = await runIndexRefresh({ existingIndex: idx, client: recgov, sheets, sheetSpreadsheetId: spreadsheetId });
    await writeCampingIndex(INDEX_PATH, res.index);
    console.log(`[camping-cron] index-refresh: +${res.added} new, -${res.deactivated} inactive, ${res.totalActive} active`);
  }

  if (shouldRunMetadataRefresh(now)) {
    console.log('[camping-cron] running metadata-refresh');
    const idx = await readCampingIndex(INDEX_PATH);
    const res = await runMetadataRefresh({ existingIndex: idx, client: recgov });
    await writeCampingIndex(INDEX_PATH, res.index);
    console.log(`[camping-cron] metadata-refresh: ${res.refreshed} updated, ${res.deactivated} deactivated, ${res.failures} failures`);
  }

  if (shouldRunNudgeTick(now)) {
    console.log('[camping-cron] running nudge-tick');
    const idx = await readCampingIndex(INDEX_PATH);
    const trips = await readCampingTrips(TRIPS_PATH);
    const muted = await readMutedFacilityIds(sheets, spreadsheetId);
    const res = await runNudgeTick({ now, index: idx, trips, mutedFacilityIds: muted, sendTelegram });
    await writeCampingTrips(TRIPS_PATH, res.trips);
    console.log(`[camping-cron] nudge-tick: ${res.seasonOpenerFired} season-opener, ${res.sevenDayFired} 7-day`);
  }

  // release-tick always runs; it self-gates.
  const idx = await readCampingIndex(INDEX_PATH);
  const trips = await readCampingTrips(TRIPS_PATH);
  const res = await runReleaseTick({ now, index: idx, trips, sendTelegram });
  if (res.fired > 0) {
    await writeCampingTrips(TRIPS_PATH, res.trips);
    console.log(`[camping-cron] release-tick: fired ${res.fired} alerts`);
  }

  console.log('[camping-cron] tick complete');
}

main().catch((err: unknown) => {
  console.error('[camping-cron] failed:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add Railway service config**

Create `railway.camping.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "node dist/apps/cron/camping/index.js",
    "restartPolicyType": "NEVER",
    "cronSchedule": "* * * * *"
  }
}
```

- [ ] **Step 3: Add npm script**

In `package.json`, add to `scripts`:

```json
"camping-cron": "tsx apps/cron/camping/index.ts",
"camping-cron:dry": "tsx apps/cron/camping/index.ts --dry-run"
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add apps/cron/camping/index.ts railway.camping.json package.json
git commit -m "feat(camping/cron): per-minute Railway entrypoint wiring all 4 ticks"
```

---

## Task 13: Telegram commands — `/watch`, `/unwatch`, `/watchlist`, `/regions`, `/plan-trip`, `/trips`, `/cancel-trip`, `/campsites`

**Files:**
- Create: `apps/bot/commands/camping.ts`
- Modify: `apps/bot/commands/parse.ts` (add command names)
- Modify: `apps/bot/handlers.ts` (dispatch)
- Modify: `apps/bot/index.ts` (wire deps)
- Create: `tests/apps/bot/commands/camping.test.ts`

- [ ] **Step 1: Add command names to parse.ts**

In `apps/bot/commands/parse.ts`, update both the `CommandName` union and the `KNOWN` array:

```ts
export type CommandName =
  | 'log' | 'addgear' | 'lost' | 'sold' | 'donated' | 'retired' | 'broken'
  | 'confirm' | 'cancel' | 'stats' | 'refresh' | 'scan' | 'help'
  | 'watch' | 'unwatch' | 'watchlist' | 'regions'
  | 'plan-trip' | 'trips' | 'cancel-trip' | 'campsites';

const KNOWN: readonly CommandName[] = [
  'log', 'addgear', 'lost', 'sold', 'donated', 'retired', 'broken',
  'confirm', 'cancel', 'stats', 'refresh', 'scan', 'help',
  'watch', 'unwatch', 'watchlist', 'regions',
  'plan-trip', 'trips', 'cancel-trip', 'campsites',
];
```

- [ ] **Step 2: Write failing test**

```ts
// tests/apps/bot/commands/camping.test.ts
import { describe, test, expect, vi } from 'vitest';
import { handleCampingCommand } from '../../../../apps/bot/commands/camping.js';
import type { Facility } from '../../../../lib/reccgov/types.js';

const f: Facility = {
  facilityId: 'F1', name: 'Maroon Bells Amphitheater', state: 'CO',
  parentUnit: 'White River National Forest', region: 'Western Slope',
  lat: 39, lng: -106, agency: 'USFS', useType: 'overnight',
  leadTimeDays: 180, specialReleaseDate: null, seasonStart: '05-15', seasonEnd: '10-15',
  feeUSD: 0, reservationType: 'reservation',
  tentEligibleSites: ['s1'], totalSites: 1, restrictions: [],
  amenities: [], hasRestrooms: false, reservationUrl: '', lastMetadataRefresh: '', active: true,
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    readIndex: vi.fn(async () => ({ facilities: [f] })),
    readTrips: vi.fn(async () => ({ trips: [] })),
    writeTrips: vi.fn(async () => undefined),
    readMutedIds: vi.fn(async () => [] as string[]),
    setMuted: vi.fn(async () => undefined),
    ...overrides,
  } as never;
}

describe('handleCampingCommand', () => {
  test('/watchlist lists active facilities grouped by parent', async () => {
    const out = await handleCampingCommand({ name: 'watchlist', args: '' }, makeDeps());
    expect(out).toContain('Maroon Bells');
    expect(out).toContain('White River');
  });

  test('/unwatch by facility name calls setMuted with the matching ID', async () => {
    const setMuted = vi.fn(async () => undefined);
    const out = await handleCampingCommand(
      { name: 'unwatch', args: 'maroon bells' },
      makeDeps({ setMuted }),
    );
    expect(setMuted).toHaveBeenCalledWith(['F1'], true);
    expect(out).toMatch(/Muted/i);
  });

  test('/plan-trip records the trip and computes the release date', async () => {
    const writeTrips = vi.fn(async () => undefined);
    const out = await handleCampingCommand(
      { name: 'plan-trip', args: 'maroon bells 2026-08-22' },
      makeDeps({ writeTrips }),
    );
    expect(writeTrips).toHaveBeenCalled();
    expect(out).toMatch(/Planned/i);
    expect(out).toMatch(/2026-02-23/);  // visit - 180 days
  });

  test('ambiguous facility name returns top matches', async () => {
    const out = await handleCampingCommand(
      { name: 'unwatch', args: 'national forest' },
      makeDeps({ readIndex: vi.fn(async () => ({ facilities: [f, { ...f, facilityId: 'F2', name: 'Some Other Site' }] })) }),
    );
    expect(out).toMatch(/multiple matches/i);
  });
});
```

- [ ] **Step 3: Implement command handler**

```ts
// apps/bot/commands/camping.ts
import { randomUUID } from 'node:crypto';
import type { CampingIndex, CampingTrips, Facility, PlannedTrip } from '../../../lib/reccgov/types.js';
import { CURATED_REGIONS } from '../../../lib/reccgov/regions.js';

export interface CampingDeps {
  readIndex: () => Promise<CampingIndex>;
  readTrips: () => Promise<CampingTrips>;
  writeTrips: (t: CampingTrips) => Promise<void>;
  readMutedIds: () => Promise<string[]>;
  setMuted: (facilityIds: string[], muted: boolean) => Promise<void>;
}

export interface ParsedCommand { name: string; args: string }

function fuzzyFindFacility(query: string, facilities: readonly Facility[]): Facility[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Exact-id wins.
  const byId = facilities.find((f) => f.facilityId.toLowerCase() === q);
  if (byId) return [byId];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const scored = facilities
    .filter((f) => f.active)
    .map((f) => {
      const haystack = `${f.name} ${f.parentUnit}`.toLowerCase();
      const matched = tokens.filter((t) => haystack.includes(t)).length;
      return { f, score: matched };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((s) => s.f);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function handleCampingCommand(cmd: ParsedCommand, deps: CampingDeps): Promise<string> {
  const idx = await deps.readIndex();
  const mutedIds = new Set(await deps.readMutedIds());

  if (cmd.name === 'watchlist') {
    const active = idx.facilities.filter((f) => f.active && !mutedIds.has(f.facilityId));
    if (active.length === 0) return 'No active facilities (everything is muted or index is empty).';
    const byParent = new Map<string, Facility[]>();
    for (const f of active) {
      if (!byParent.has(f.parentUnit)) byParent.set(f.parentUnit, []);
      byParent.get(f.parentUnit)!.push(f);
    }
    const lines = [`Active watchlist (${active.length} sites):`];
    for (const [parent, sites] of byParent) {
      lines.push(`\n*${parent}* (${sites.length})`);
      for (const s of sites.slice(0, 5)) lines.push(`  • ${s.name}`);
      if (sites.length > 5) lines.push(`  …and ${sites.length - 5} more`);
    }
    return lines.join('\n');
  }

  if (cmd.name === 'regions') {
    const lines: string[] = ['Curated regions and their parent units:'];
    for (const [region, parents] of Object.entries(CURATED_REGIONS)) {
      lines.push(`\n*${region}*`);
      for (const p of parents) lines.push(`  • ${p}`);
    }
    return lines.join('\n');
  }

  if (cmd.name === 'watch' || cmd.name === 'unwatch') {
    if (!cmd.args.trim()) return `Usage: /${cmd.name} <facility-name | facility-id | region | parent-unit>`;
    // Region match: if args matches a curated region exactly, mute every facility in any of those parent units.
    const regionKey = Object.keys(CURATED_REGIONS).find((r) => r.toLowerCase() === cmd.args.toLowerCase());
    if (regionKey) {
      const parents = new Set(CURATED_REGIONS[regionKey]);
      const affected = idx.facilities.filter((f) => parents.has(f.parentUnit)).map((f) => f.facilityId);
      await deps.setMuted(affected, cmd.name === 'unwatch');
      return `${cmd.name === 'unwatch' ? 'Muted' : 'Un-muted'} ${affected.length} sites in ${regionKey}.`;
    }
    // Parent-unit match (substring against any parent).
    const parentMatch = idx.facilities.find((f) => f.parentUnit.toLowerCase() === cmd.args.toLowerCase());
    if (parentMatch) {
      const affected = idx.facilities.filter((f) => f.parentUnit === parentMatch.parentUnit).map((f) => f.facilityId);
      await deps.setMuted(affected, cmd.name === 'unwatch');
      return `${cmd.name === 'unwatch' ? 'Muted' : 'Un-muted'} ${affected.length} sites in ${parentMatch.parentUnit}.`;
    }
    // Fuzzy facility name.
    const matches = fuzzyFindFacility(cmd.args, idx.facilities);
    if (matches.length === 0) return `No match for "${cmd.args}". Try /watchlist to browse.`;
    if (matches.length > 1) {
      const list = matches.map((m, i) => `  ${i + 1}. ${m.name} (${m.parentUnit})`).join('\n');
      return `Multiple matches for "${cmd.args}":\n${list}\nReply with a more specific name or facility-id.`;
    }
    await deps.setMuted([matches[0]!.facilityId], cmd.name === 'unwatch');
    return `${cmd.name === 'unwatch' ? 'Muted' : 'Un-muted'} ${matches[0]!.name}.`;
  }

  if (cmd.name === 'plan-trip') {
    const m = cmd.args.match(/^(.+?)\s+(\d{4}-\d{2}-\d{2})$/);
    if (!m) return 'Usage: /plan-trip <facility-name> <YYYY-MM-DD>';
    const [, query, visitDate] = m;
    const matches = fuzzyFindFacility(query!, idx.facilities);
    if (matches.length === 0) return `No facility match for "${query}".`;
    if (matches.length > 1) {
      const list = matches.map((m2, i) => `  ${i + 1}. ${m2.name} (${m2.parentUnit})`).join('\n');
      return `Multiple matches:\n${list}\nReply with a more specific name.`;
    }
    const f = matches[0]!;
    const releaseDate = addDays(visitDate!, -f.leadTimeDays);
    const trips = await deps.readTrips();
    const trip: PlannedTrip = {
      id: randomUUID(), facilityId: f.facilityId, visitDate: visitDate!,
      plannedAt: new Date().toISOString(),
      nudges: [
        { kind: '7-day', firedAt: null },
        { kind: 'release-moment', firedAt: null },
      ],
      cancelledAt: null,
    };
    await deps.writeTrips({ trips: [...trips.trips, trip] });
    return `Planned ${f.name} for ${visitDate}. Booking opens ${releaseDate}; I'll nudge you 7 days out and at the release moment.`;
  }

  if (cmd.name === 'trips') {
    const trips = await deps.readTrips();
    const active = trips.trips.filter((t) => !t.cancelledAt);
    if (active.length === 0) return 'No active planned trips. Use /plan-trip <site> <date> to add one.';
    const byId = new Map(idx.facilities.map((x) => [x.facilityId, x]));
    const lines = [`Active trips (${active.length}):`];
    for (const t of active) {
      const f = byId.get(t.facilityId);
      const name = f?.name ?? `(unknown facility ${t.facilityId})`;
      const releaseDate = f ? addDays(t.visitDate, -f.leadTimeDays) : '(unknown)';
      const sevenFired = t.nudges.find((n) => n.kind === '7-day')?.firedAt ? '✅' : '⏳';
      const releaseFired = t.nudges.find((n) => n.kind === 'release-moment')?.firedAt ? '✅' : '⏳';
      lines.push(`• ${name} on ${t.visitDate} — opens ${releaseDate} — 7d ${sevenFired} release ${releaseFired}`);
    }
    return lines.join('\n');
  }

  if (cmd.name === 'cancel-trip') {
    if (!cmd.args.trim()) return 'Usage: /cancel-trip <trip-id | facility-name>';
    const trips = await deps.readTrips();
    const matchByExactId = trips.trips.find((t) => t.id === cmd.args.trim() && !t.cancelledAt);
    let target = matchByExactId;
    if (!target) {
      const fmatches = fuzzyFindFacility(cmd.args, idx.facilities);
      if (fmatches.length === 1) {
        target = trips.trips.find((t) => t.facilityId === fmatches[0]!.facilityId && !t.cancelledAt);
      }
    }
    if (!target) return `No active trip matches "${cmd.args}".`;
    const updated: CampingTrips = {
      trips: trips.trips.map((t) => t.id === target!.id ? { ...t, cancelledAt: new Date().toISOString() } : t),
    };
    await deps.writeTrips(updated);
    return `Cancelled trip ${target.id} — no more nudges for it.`;
  }

  if (cmd.name === 'campsites') {
    return 'Use the agent: ask "Where can I camp free near X within Y mi?" — that\'ll run find_free_campsites with weather context.';
  }

  return `Unrecognized camping command: ${cmd.name}`;
}
```

- [ ] **Step 4: Dispatch in handlers.ts**

In `apps/bot/handlers.ts`, find the existing command-name switch and add:

```ts
// add at top:
import { handleCampingCommand } from './commands/camping.js';
import { readCampingIndex, readCampingTrips, writeCampingTrips } from '../../lib/campingState.js';
import { readMutedFacilityIds, setMutedInCampingIndex } from '../../lib/sheets.js';

// where commands dispatch (after `name === 'scan'`):
if (
  name === 'watch' || name === 'unwatch' || name === 'watchlist' || name === 'regions'
  || name === 'plan-trip' || name === 'trips' || name === 'cancel-trip' || name === 'campsites'
) {
  return handleCampingCommand({ name, args }, deps.camping);
}
```

Add `camping: CampingDeps` to the `HandlerDeps` interface; wire it in `apps/bot/index.ts`:

```ts
// apps/bot/index.ts — inside handlerDeps:
camping: {
  readIndex: () => readCampingIndex(process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json'),
  readTrips: () => readCampingTrips(process.env.CAMPING_TRIPS_PATH ?? '/data/camping-trips.json'),
  writeTrips: (t) => writeCampingTrips(process.env.CAMPING_TRIPS_PATH ?? '/data/camping-trips.json', t),
  readMutedIds: () => readMutedFacilityIds(sheets, env.spreadsheetId),
  setMuted: (ids, muted) => setMutedInCampingIndex(sheets, env.spreadsheetId, ids, muted),
},
```

- [ ] **Step 5: Add `setMutedInCampingIndex` to `lib/sheets.ts`**

Append to the Camping Index section in `lib/sheets.ts`:

```ts
export async function setMutedInCampingIndex(
  sheets: SheetsClient,
  spreadsheetId: string,
  facilityIds: string[],
  muted: boolean,
): Promise<void> {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CAMPING_INDEX_TAB}'!A:U`,
  });
  const rows = (resp.data.values ?? []) as (string | number | boolean)[][];
  if (rows.length < 2) return;
  const header = rows[0]!;
  const idIdx = header.indexOf('Facility ID');
  const mutedColIdx = header.indexOf('Muted');
  if (idIdx < 0 || mutedColIdx < 0) return;
  const targetSet = new Set(facilityIds);
  const colLetter = (i: number): string => String.fromCharCode(65 + i);
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i]![idIdx] ?? '');
    if (!targetSet.has(id)) continue;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${CAMPING_INDEX_TAB}'!${colLetter(mutedColIdx)}${i + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[muted]] },
    });
  }
}
```

- [ ] **Step 6: Verify + commit**

```bash
npx vitest run tests/apps/bot/commands/camping.test.ts
npx tsc --noEmit
npx vitest run
git add apps/bot/commands/camping.ts apps/bot/commands/parse.ts apps/bot/handlers.ts apps/bot/index.ts \
  lib/sheets.ts tests/apps/bot/commands/camping.test.ts
git commit -m "feat(bot): /watch /unwatch /watchlist /regions /plan-trip /trips /cancel-trip /campsites"
```

---

## Task 14: Update `/help` text

**Files:**
- Modify: `apps/bot/handlers.ts` (`handleHelp` function)

- [ ] **Step 1: Add camping commands block to /help**

In `apps/bot/handlers.ts`, find `handleHelp` and add a new section before the "Sheet:" line:

```ts
`*Camping*`,
`/watchlist — see facilities you're being nudged about`,
`/regions — list curated regions`,
`/watch <name|region|parent> — un-mute facilities`,
`/unwatch <name|region|parent> — mute facilities (bulk)`,
`/plan-trip <facility> <YYYY-MM-DD> — register a trip; bot fires 7-day + release-moment alerts`,
`/trips — list planned trips`,
`/cancel-trip <id|facility> — stop nudges for a trip`,
``,
```

- [ ] **Step 2: Commit**

```bash
git add apps/bot/handlers.ts
git commit -m "feat(help): list camping commands"
```

---

## Task 15: One-time seed script + bootstrap-sheet tab

**Files:**
- Create: `scripts/seed-camping-index.ts`
- Modify: `scripts/bootstrap-sheet.ts` (add Camping Index tab)

- [ ] **Step 1: Create the seed script**

```ts
// scripts/seed-camping-index.ts
import 'dotenv/config';
import { createRecGovClient } from '../lib/reccgov/client.js';
import { createSheetsClient } from '../lib/sheets.js';
import { readCampingIndex, writeCampingIndex } from '../lib/campingState.js';
import { runIndexRefresh } from '../apps/cron/camping/index-refresh.js';
import { runMetadataRefresh } from '../apps/cron/camping/metadata-refresh.js';

async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const recgov = createRecGovClient({ apiKey: process.env.RECGOV_API_KEY! });
  const indexPath = process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json';
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  console.log('Phase 1: index-refresh (fetching CO facility list)...');
  let idx = await readCampingIndex(indexPath);
  const r1 = await runIndexRefresh({ existingIndex: idx, client: recgov, sheets, sheetSpreadsheetId: spreadsheetId });
  await writeCampingIndex(indexPath, r1.index);
  console.log(`  +${r1.added} new, ${r1.totalActive} total active`);

  console.log('Phase 2: metadata-refresh (per-facility metadata + tent filter)...');
  idx = await readCampingIndex(indexPath);
  const r2 = await runMetadataRefresh({ existingIndex: idx, client: recgov });
  await writeCampingIndex(indexPath, r2.index);
  console.log(`  ${r2.refreshed} refreshed, ${r2.deactivated} deactivated, ${r2.failures} failures`);

  console.log('Seed complete.');
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Update bootstrap-sheet.ts**

In `scripts/bootstrap-sheet.ts`, find the section that creates the "Needs Review" and "Cron Log" tabs. Add the same pattern for "Camping Index":

```ts
const CAMPING_INDEX_HEADERS = [
  'Facility ID', 'Name', 'Agency', 'Parent Unit', 'Region', 'Lat', 'Lng',
  'Lead Days', 'Special Release', 'Season Start', 'Season End', 'Fee',
  'Reservation Type', 'Use Type', 'Restrictions', 'Has Restrooms',
  'Amenities', 'Tent-Eligible Sites', 'Active', 'Muted', 'Notes',
];

// In main(), after other tab creations:
const campingIndexExists = allTabs.some((s) => s.properties?.title === 'Camping Index');
if (campingIndexExists) {
  console.log('Plan: "Camping Index" tab (already exists — skip)');
} else {
  console.log('Plan: create "Camping Index" tab with 21 headers');
  requests.push({
    addSheet: {
      properties: {
        title: 'Camping Index',
        gridProperties: { rowCount: 2000, columnCount: CAMPING_INDEX_HEADERS.length },
      },
    },
  });
}

// After batchUpdate, if it was created, write header row:
if (!campingIndexExists) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'Camping Index'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [CAMPING_INDEX_HEADERS] },
  });
}
```

- [ ] **Step 3: Add npm script for the seed**

In `package.json` scripts:

```json
"seed-camping": "tsx scripts/seed-camping-index.ts"
```

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit
git add scripts/seed-camping-index.ts scripts/bootstrap-sheet.ts package.json
git commit -m "feat(camping): seed script + Camping Index tab in bootstrap"
```

---

## Task 16: `freecamping.ts` — unified search facade

**Files:**
- Create: `domains/outdoor/integrations/freecamping.ts`
- Create: `tests/domains/outdoor/integrations/freecamping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domains/outdoor/integrations/freecamping.test.ts
import { describe, test, expect } from 'vitest';
import { searchFreeCampsites } from '../../../../domains/outdoor/integrations/freecamping.js';
import type { CampingIndex, Facility } from '../../../../lib/reccgov/types.js';
import type { IOverlanderSnapshot } from '../../../../lib/iOverlander/cache.js';

const f = (p: Partial<Facility>): Facility => ({
  facilityId: 'F', name: 'X', state: 'CO', parentUnit: '', region: null,
  lat: 0, lng: 0, agency: 'USFS', useType: 'overnight',
  leadTimeDays: 180, specialReleaseDate: null, seasonStart: null, seasonEnd: null,
  feeUSD: 0, reservationType: 'reservation',
  tentEligibleSites: ['s1'], totalSites: 1, restrictions: [],
  amenities: ['Vault Toilets'], hasRestrooms: true,
  reservationUrl: '', lastMetadataRefresh: '', active: true, ...p,
});

describe('searchFreeCampsites', () => {
  const index: CampingIndex = {
    facilities: [
      f({ facilityId: 'A', name: 'Near tent', lat: 39.5, lng: -106.0, feeUSD: 0 }),
      f({ facilityId: 'B', name: 'Far tent', lat: 50.0, lng: -106.0, feeUSD: 0 }),
      f({ facilityId: 'C', name: 'Near paid', lat: 39.5, lng: -106.0, feeUSD: 25 }),
      f({ facilityId: 'D', name: 'RV-only', lat: 39.5, lng: -106.0, feeUSD: 0, tentEligibleSites: [], active: false }),
      f({ facilityId: 'E', name: 'Picnic', lat: 39.5, lng: -106.0, useType: 'day-use', tentEligibleSites: [] }),
    ],
  };
  const overlander: IOverlanderSnapshot = {
    refreshedAt: '',
    spots: [{
      id: 'io1', name: 'Boondock', lat: 39.5, lng: -106.0,
      description: '', amenities: [], hasRestrooms: false,
      lastVerified: null, sourceUrl: '', type: 'wild_camping',
    }],
  };

  test('returns near + free + tent-eligible facilities, excludes paid/far/RV-only/picnic', () => {
    const out = searchFreeCampsites({
      lat: 39.5, lng: -106.0, radiusKm: 50, includeDayUse: false,
      index, overlander,
    });
    const ids = out.map((r) => r.id);
    expect(ids).toContain('A');
    expect(ids).toContain('io1');
    expect(ids).not.toContain('B');
    expect(ids).not.toContain('C');
    expect(ids).not.toContain('D');
    expect(ids).not.toContain('E');
  });

  test('includeDayUse=true adds picnic areas', () => {
    const out = searchFreeCampsites({
      lat: 39.5, lng: -106.0, radiusKm: 50, includeDayUse: true,
      index, overlander,
    });
    expect(out.map((r) => r.id)).toContain('E');
  });

  test('sorts by distance ascending and caps at 10', () => {
    const many: CampingIndex = {
      facilities: Array.from({ length: 15 }, (_, i) =>
        f({ facilityId: `F${i}`, name: `Site ${i}`, lat: 39.5 + i * 0.001, lng: -106.0, feeUSD: 0 })),
    };
    const out = searchFreeCampsites({
      lat: 39.5, lng: -106.0, radiusKm: 100, includeDayUse: false,
      index: many, overlander: { refreshedAt: '', spots: [] },
    });
    expect(out).toHaveLength(10);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.distanceKm).toBeGreaterThanOrEqual(out[i - 1]!.distanceKm);
    }
  });
});
```

- [ ] **Step 2: Implement**

```ts
// domains/outdoor/integrations/freecamping.ts
import type { CampingIndex, Facility } from '../../../lib/reccgov/types.js';
import type { IOverlanderSnapshot } from '../../../lib/iOverlander/cache.js';

export interface CampsiteResult {
  id: string;
  source: 'recgov' | 'iOverlander';
  name: string;
  distanceKm: number;
  agency: string;
  lat: number;
  lng: number;
  useType: 'overnight' | 'day-use';
  reservationType: string;
  restrictions: string[];
  amenities: string[];
  hasRestrooms: boolean;
  sourceUrl: string;
}

export interface SearchOpts {
  lat: number;
  lng: number;
  radiusKm: number;
  includeDayUse: boolean;
  index: CampingIndex;
  overlander: IOverlanderSnapshot;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la = a.lat * Math.PI / 180;
  const lb = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isEligible(f: Facility, includeDayUse: boolean): boolean {
  if (!f.active) return false;
  if (f.feeUSD !== 0) return false;
  if (f.useType === 'overnight' && f.tentEligibleSites.length === 0 && f.reservationType !== 'permit') return false;
  if (f.useType === 'day-use' && !includeDayUse) return false;
  return true;
}

export function searchFreeCampsites(opts: SearchOpts): CampsiteResult[] {
  const center = { lat: opts.lat, lng: opts.lng };
  const recgov: CampsiteResult[] = opts.index.facilities
    .filter((f) => isEligible(f, opts.includeDayUse))
    .map((f) => ({
      id: f.facilityId, source: 'recgov' as const, name: f.name,
      distanceKm: haversineKm(center, f),
      agency: f.agency, lat: f.lat, lng: f.lng,
      useType: f.useType, reservationType: f.reservationType,
      restrictions: f.restrictions, amenities: f.amenities, hasRestrooms: f.hasRestrooms,
      sourceUrl: f.reservationUrl,
    }))
    .filter((r) => r.distanceKm <= opts.radiusKm);

  const io: CampsiteResult[] = opts.overlander.spots
    .map((s) => ({
      id: s.id, source: 'iOverlander' as const, name: s.name,
      distanceKm: haversineKm(center, s),
      agency: 'iOverlander community', lat: s.lat, lng: s.lng,
      useType: 'overnight' as const, reservationType: 'walk-up',
      restrictions: [], amenities: s.amenities, hasRestrooms: s.hasRestrooms,
      sourceUrl: s.sourceUrl,
    }))
    .filter((r) => r.distanceKm <= opts.radiusKm);

  return [...recgov, ...io].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 10);
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/domains/outdoor/integrations/freecamping.test.ts
git add domains/outdoor/integrations/freecamping.ts tests/domains/outdoor/integrations/freecamping.test.ts
git commit -m "feat(camping): unified search facade over Rec.gov + iOverlander"
```

---

## Task 17: `find_free_campsites` agent tool

**Files:**
- Modify: `domains/outdoor/tools.ts` (add schema + handler dispatch)
- Modify: `tests/domains/outdoor/tools.test.ts` (extend existing test)

- [ ] **Step 1: Add the tool schema to `TOOL_SCHEMAS` and handler dispatch**

In `domains/outdoor/tools.ts`, add to the schemas list and the dispatch switch:

```ts
// Add to TOOL_SCHEMAS array:
{
  name: 'find_free_campsites',
  description: 'Find free Rec.gov + iOverlander campsites within a radius of a location. Tent-eligible only; picnic areas optional. Use when the user asks where to camp free near somewhere.',
  input_schema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'Place name to search near (e.g. "Moab, UT" or "Maroon Bells").' },
      radius_km: { type: 'integer', minimum: 1, maximum: 500, description: 'Search radius in km. Default 80 (~50 mi). Ask the user if unsure.' },
      include_day_use: { type: 'boolean', description: 'If true, also include picnic areas (day-use). Default false.' },
    },
    required: ['location'],
  },
},

// In dispatchTool, add a case:
if (name === 'find_free_campsites') {
  return findFreeCampsitesHandler(input as { location: string; radius_km?: number; include_day_use?: boolean }, deps);
}
```

Wire the handler at the top of the file:

```ts
import { searchFreeCampsites } from './integrations/freecamping.js';
import { geocode } from './integrations/weather.js'; // reuse Phase 3 Nominatim
import { readCampingIndex } from '../../lib/campingState.js';
import { readIOverlanderSnapshot } from '../../lib/iOverlander/cache.js';

async function findFreeCampsitesHandler(
  input: { location: string; radius_km?: number; include_day_use?: boolean },
  deps: { /* ... */ },
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  if (!input.location?.trim()) return { ok: false, error: 'location is required' };
  const coords = await geocode(input.location).catch(() => null);
  if (!coords) return { ok: false, error: 'could_not_geocode' };
  const radiusKm = input.radius_km ?? 80;
  const indexPath = process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json';
  const ioPath = process.env.IOVERLANDER_CACHE_PATH ?? '/data/iOverlander.json';
  const index = await readCampingIndex(indexPath);
  const overlander = await readIOverlanderSnapshot(ioPath) ?? { refreshedAt: '', spots: [] };
  const results = searchFreeCampsites({
    lat: coords.lat, lng: coords.lng, radiusKm,
    includeDayUse: input.include_day_use ?? false,
    index, overlander,
  });
  return { ok: true, data: { location: input.location, coords, results } };
}
```

- [ ] **Step 2: Update tests/domains/outdoor/tools.test.ts**

Add a test:

```ts
test('exports find_free_campsites', () => {
  const names = TOOL_SCHEMAS.map((s) => s.name);
  expect(names).toContain('find_free_campsites');
});

test('find_free_campsites schema requires location', () => {
  const t = TOOL_SCHEMAS.find((s) => s.name === 'find_free_campsites')!;
  expect(t.input_schema.required).toContain('location');
});
```

Update the existing length assertion (if any) to reflect new total tools.

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/domains/outdoor/tools.test.ts
npx tsc --noEmit
git add domains/outdoor/tools.ts tests/domains/outdoor/tools.test.ts
git commit -m "feat(camping): find_free_campsites agent tool"
```

---

## Task 18: Smoke script + run the seed

**Files:**
- Create: `scripts/smoke-camping.ts`

- [ ] **Step 1: Create the smoke script**

```ts
// scripts/smoke-camping.ts
import 'dotenv/config';
import { createRecGovClient } from '../lib/reccgov/client.js';

async function main(): Promise<void> {
  const client = createRecGovClient({ apiKey: process.env.RECGOV_API_KEY! });
  console.log('Fetching first 5 CO facilities...');
  const list = await client.searchFacilities({ state: 'CO', limit: 5 });
  for (const f of list) {
    console.log(`  ${f.facilityId}  ${f.name}  (${f.parentUnit})`);
  }
  if (list[0]?.facilityId) {
    console.log('\nFetching first facility details...');
    const detail = await client.getFacility(list[0].facilityId);
    console.log(JSON.stringify(detail, null, 2).slice(0, 500));
    const campsites = await client.getFacilityCampsites(list[0].facilityId);
    console.log(`\nCampsites: ${campsites.length} (sample: ${campsites.slice(0, 3).map((c) => c.campsiteType).join(', ')})`);
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

```json
"smoke-camping": "tsx scripts/smoke-camping.ts"
```

- [ ] **Step 3: Verify locally + commit**

```bash
# only run if RECGOV_API_KEY is set in .env
npm run smoke-camping
git add scripts/smoke-camping.ts package.json
git commit -m "chore(smoke): smoke-camping script hits real Rec.gov"
```

---

## Task 19: Update DECISIONS / CLAUDE / PLAN docs

**Files:**
- Modify: `DECISIONS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/PLAN.md`

- [ ] **Step 1: Append DECISIONS.md entry**

Add before the "How to use this file" footer:

```markdown
## 2026-05-15 — Phase 5: Free-camping search + reservation-release tracking

**Context:** Shipped Phase 5 of the outdoor companion. Spec: `docs/superpowers/specs/2026-05-15-phase-5-camping-design.md`. Combines on-demand free-camping search (Rec.gov + iOverlander) with proactive reservation-release tracking via a Railway-side index of all CO tent-eligible Rec.gov facilities.

**Key locked decisions:**
- **Tent-eligible only** — index filters out RV-only sites, cabins, yurts. Picnic areas included with useType='day-use'.
- **Auto-booking deferred:** Flavor A only (Telegram alert + deep link at the exact release moment). No headless-browser checkout in v1.
- **Sheet authoritative for muted state.** "Camping Index" tab has writable Muted + Notes columns; cron preserves them across refreshes.
- **Separate Railway cron service** (`railway.camping.json`, per-minute schedule). Each tick self-gates by cadence.
- **Regions are both auto (parent unit) AND curated** (Front Range, Western Slope, San Juans, Sangres, Northern Mountains).

**Out of scope (deferred v1.5+):** Camping Trips sheet tab, auto-booking flavors B/C, non-CO seeds, walk-up alerts, USFS MVUM integration.

---
```

- [ ] **Step 2: Update CLAUDE.md "Locked decisions" table**

Add new rows after Notifications:

```markdown
| Camping index | Railway-volume JSON (`/data/camping-index.json`) auto-maintained by separate per-minute camping cron. Mirrored to "Camping Index" sheet tab; Muted + Notes columns are writable and authoritative. |
| Camping data sources | Recreation.gov (facility search + metadata + campsites endpoints, free with RIDB API key) + iOverlander weekly CSV snapshot. Tent-eligible filter applied. |
| Auto-booking | Flavor A only — Telegram deep-link alert at exact release moment. No headless browser, no stored credentials. |
```

- [ ] **Step 3: Update PLAN.md — mark Phase 5 shipped**

In the phase table:

```markdown
| **5** | Outdoor + Free-camping integration ✅ shipped 2026-05-15 | ~1 week | Agent answers "where can I camp free near [location]?" + proactive reservation-release nudges (season opener + trip-date + deep-link alert at release moment) |
```

Add a phase body section near where Phase 4 is documented:

```markdown
## Phase 5: Outdoor + Free camping ✅ SHIPPED 2026-05-15

See `docs/superpowers/specs/2026-05-15-phase-5-camping-design.md` and `docs/superpowers/plans/2026-05-15-phase-5-camping.md` for design + implementation. Ships two outcomes (search + tracking) as one phase.
```

- [ ] **Step 4: Commit**

```bash
git add DECISIONS.md CLAUDE.md docs/PLAN.md
git commit -m "docs: Phase 5 camping shipped — DECISIONS, CLAUDE, PLAN"
```

---

## Task 20: Push + run the seed in production

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Provision Railway**

In Railway dashboard:
1. Add new cron service from `railway.camping.json`.
2. Add env vars: `RECGOV_API_KEY` (request at https://ridb.recreation.gov/), `CAMPING_INDEX_PATH=/data/camping-index.json`, `CAMPING_TRIPS_PATH=/data/camping-trips.json`, `IOVERLANDER_CACHE_PATH=/data/iOverlander.json`, `IOVERLANDER_CSV_URL=<TBD when iOverlander cache job lands>`.
3. Attach a Railway volume at `/data` shared between the camping cron and bot services.

- [ ] **Step 3: Run the seed once**

```bash
# Locally with .env populated:
npm run seed-camping
```

This populates `/data/camping-index.json` (locally) and the Camping Index sheet tab with all CO tent-eligible facilities + metadata. To run on Railway, exec into the camping-cron service:

```bash
railway run --service camping-cron npm run seed-camping
```

- [ ] **Step 4: Verify**

Open the sheet → Camping Index tab should have hundreds of CO rows with full metadata. Check a known facility:
- Maroon Bells should show parentUnit="White River National Forest", region="Western Slope", useType="overnight", tent-eligible sites > 0.

- [ ] **Step 5: Bot live test**

In Telegram:
1. `/regions` → should list the 5 curated regions.
2. `/watchlist` → should show grouped facility list.
3. `/plan-trip "Maroon Bells" 2026-08-22` → should reply with computed release date.
4. `/trips` → should show the planned trip with `7d ⏳ release ⏳`.
5. Ask the agent: "where can I camp free within 30 km of Estes Park?" → should call `find_free_campsites` and return real results.

(No code change needed at this step — verification only.)

---

## Self-review checklist

**Spec coverage:**
- ✅ 5a search via `find_free_campsites` (Task 16, 17)
- ✅ Tent-eligible filter (Task 9, 16)
- ✅ Picnic areas with useType (Task 9, 16)
- ✅ Amenities + hasRestrooms (Task 9, 5)
- ✅ Camping Index sheet tab with writable Muted + Notes (Task 6, 13)
- ✅ Railway-side JSON state with file locking (Task 4)
- ✅ Weekly index refresh (Task 8)
- ✅ Monthly metadata refresh (Task 9)
- ✅ Daily nudge-tick — season opener + trip-date (Task 10)
- ✅ Per-minute release-tick — deep-link alert + 5-min backstop (Task 11)
- ✅ Curated regions + auto parent-unit grouping (Task 1, 13)
- ✅ Telegram commands (Task 13)
- ✅ /help updated (Task 14)
- ✅ Seed script + bootstrap-sheet update (Task 15)
- ✅ Smoke script (Task 18)
- ✅ Docs (Task 19)

**Type consistency:** `Facility` shape defined in Task 1 and used identically across Tasks 4, 6, 8, 9, 10, 11, 13, 16, 17.

**No placeholders:** every step has concrete code or a specific command.

Plan ready.
