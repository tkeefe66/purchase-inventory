# Phase 3 Weather Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `get_forecast(location, days)` tool to the outdoor agent, backed by Pirate Weather (forecasts) and OSM Nominatim (geocoding), so the agent can answer trip-prep questions grounded in real forecast data.

**Architecture:** New module `domains/outdoor/integrations/weather.ts` exposes a `createWeatherClient({ apiKey })` factory returning `{ getForecast }`. Tools register `get_forecast` in `domains/outdoor/tools.ts`. Agent's `dispatchTool` gets a new case. Bot wires env var → factory → tool deps.

**Tech Stack:** Node 20 native `fetch`, vitest (mocked via `vi.stubGlobal`), `date-fns-tz` (already a dep, used for "destination's local tomorrow" anchoring).

**Branch:** `phase-3-weather` (already created).

**Spec:** `docs/superpowers/specs/2026-05-15-phase-3-weather-design.md`.

---

## File Structure

**Create:**
- `domains/outdoor/integrations/weather.ts` — geocode + forecast client, all types, all errors
- `tests/domains/outdoor/integrations/weather.test.ts` — unit tests

**Modify:**
- `.env.example` — add `PIRATE_WEATHER_API_KEY`
- `domains/outdoor/tools.ts` — add `get_forecast` schema + handler, extend `ToolDeps`
- `domains/outdoor/agent.ts` — add `dispatchTool` case, update `TOOL_GUIDANCE` string
- `apps/bot/index.ts` — read env var, instantiate weather client, pass through to agent
- `tests/domains/outdoor/tools.test.ts` — extend with `get_forecast` tests

**No new fixture JSON files** — fixtures are inline TS constants in the test file. (Spec mentioned saved JSON; pragmatic deviation — inline keeps tests self-contained and lets us iterate without re-capturing real API responses. Real captures can be added later if a regression makes them useful.)

---

## Task 1: Add `PIRATE_WEATHER_API_KEY` env var

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the env var to `.env.example`**

Find the `# Outdoor integrations (later phases)` block and replace it:

```bash
# Outdoor integrations (later phases)
OPENWEATHERMAP_API_KEY=
PIRATE_WEATHER_API_KEY=
RECREATIONGOV_API_KEY=
```

(Keep `OPENWEATHERMAP_API_KEY` as-is — it's a leftover from PLAN.md's earlier draft, but harmless. Phase 3 uses Pirate Weather, not OpenWeatherMap.)

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): add PIRATE_WEATHER_API_KEY placeholder"
```

---

## Task 2: Create module skeleton with types + error class

**Files:**
- Create: `domains/outdoor/integrations/weather.ts`
- Create: `tests/domains/outdoor/integrations/weather.test.ts`

- [ ] **Step 1: Write the skeleton with types and error class**

```ts
// domains/outdoor/integrations/weather.ts

export interface ForecastInput {
  location: string;
  days: number;
}

export interface DailyForecast {
  date: string;
  tempHighF: number;
  tempLowF: number;
  precipProbability: number;
  precipAmountIn: number;
  windMaxMph: number;
  conditions: string;
}

export interface HourlyForecast {
  time: string;
  tempF: number;
  precipProbability: number;
  windMph: number;
  conditions: string;
}

export interface ForecastResult {
  resolved: { name: string; lat: number; lon: number; timezone: string };
  daily: DailyForecast[];
  hourlyTomorrow: HourlyForecast[];
}

export type ForecastErrorKind = 'no_match' | 'rate_limited' | 'api_error';

export class ForecastError extends Error {
  constructor(
    public readonly kind: ForecastErrorKind,
    public readonly service: 'nominatim' | 'pirateweather',
    public readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ForecastError';
  }
}

export interface WeatherClient {
  getForecast(input: ForecastInput): Promise<ForecastResult>;
}

export interface WeatherClientOptions {
  apiKey: string;
  /** Override for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Override for tests; defaults to `Date.now`. */
  now?: () => number;
}

export function createWeatherClient(_opts: WeatherClientOptions): WeatherClient {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Write a smoke test that the module exports load**

```ts
// tests/domains/outdoor/integrations/weather.test.ts

import { describe, test, expect } from 'vitest';
import {
  createWeatherClient,
  ForecastError,
} from '../../../../domains/outdoor/integrations/weather.js';

describe('weather module', () => {
  test('exports load', () => {
    expect(typeof createWeatherClient).toBe('function');
    expect(ForecastError).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the test, verify it passes**

```bash
npm test -- tests/domains/outdoor/integrations/weather.test.ts
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add domains/outdoor/integrations/weather.ts tests/domains/outdoor/integrations/weather.test.ts
git commit -m "feat(weather): scaffold weather module with types and ForecastError"
```

---

## Task 3: Nominatim geocoder — happy path

**Files:**
- Modify: `domains/outdoor/integrations/weather.ts`
- Modify: `tests/domains/outdoor/integrations/weather.test.ts`

The Nominatim search response shape (real shape, abbreviated):

```json
[
  {
    "place_id": 257687844,
    "lat": "38.5733",
    "lon": "-109.5498",
    "display_name": "Moab, Grand County, Utah, United States",
    "boundingbox": ["38.55","38.59","-109.58","-109.53"]
  }
]
```

- [ ] **Step 1: Write the failing test**

Add to `tests/domains/outdoor/integrations/weather.test.ts`:

```ts
import { vi } from 'vitest';

function mockFetch(responses: Map<string | RegExp, { status: number; json: unknown }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const [pattern, resp] of responses) {
      if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
        return new Response(JSON.stringify(resp.json), {
          status: resp.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

const NOMINATIM_MOAB = [
  {
    place_id: 257687844,
    lat: '38.5733',
    lon: '-109.5498',
    display_name: 'Moab, Grand County, Utah, United States',
  },
];

describe('geocoding (Nominatim)', () => {
  test('happy path: returns lat/lon and display name', async () => {
    const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
      ['nominatim.openstreetmap.org', { status: 200, json: NOMINATIM_MOAB }],
      // Stub pirateweather so getForecast doesn't fail later in this test;
      // we'll exercise it in a dedicated test.
      ['pirateweather.net', { status: 200, json: { latitude: 38.57, longitude: -109.55, timezone: 'America/Denver', daily: { data: [] }, hourly: { data: [] } } }],
    ]));
    const client = createWeatherClient({ apiKey: 'test', fetchImpl });
    const result = await client.getForecast({ location: 'Moab, UT', days: 1 });
    expect(result.resolved.lat).toBeCloseTo(38.5733);
    expect(result.resolved.lon).toBeCloseTo(-109.5498);
    expect(result.resolved.name).toContain('Moab');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npm test -- tests/domains/outdoor/integrations/weather.test.ts
```

Expected: FAIL with `not implemented`.

- [ ] **Step 3: Implement minimum to pass**

Replace the `createWeatherClient` stub in `weather.ts`:

```ts
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const PIRATE_WEATHER_URL = 'https://api.pirateweather.net/forecast';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface PirateWeatherResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  daily?: { data: PirateDayData[] };
  hourly?: { data: PirateHourData[] };
}

interface PirateDayData {
  time: number;
  summary: string;
  temperatureHigh: number;
  temperatureLow: number;
  precipProbability: number;
  precipAccumulation: number;
  windSpeed: number;
}

interface PirateHourData {
  time: number;
  summary: string;
  temperature: number;
  precipProbability: number;
  windSpeed: number;
}

export function createWeatherClient(opts: WeatherClientOptions): WeatherClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  async function geocode(query: string): Promise<{ lat: number; lon: number; name: string }> {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'outdoor-inventory-bot/1.0 (tkeefe66@gmail.com)' },
    });
    if (!res.ok) {
      throw new ForecastError('api_error', 'nominatim', res.status, `nominatim ${res.status}`);
    }
    const body = (await res.json()) as NominatimResult[];
    if (!Array.isArray(body) || body.length === 0) {
      throw new ForecastError('no_match', 'nominatim', undefined, `no match for "${query}"`);
    }
    const first = body[0]!;
    return { lat: parseFloat(first.lat), lon: parseFloat(first.lon), name: first.display_name };
  }

  async function fetchForecast(lat: number, lon: number): Promise<PirateWeatherResponse> {
    const url = `${PIRATE_WEATHER_URL}/${opts.apiKey}/${lat},${lon}?units=us&exclude=minutely,alerts`;
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new ForecastError('api_error', 'pirateweather', res.status, `pirateweather ${res.status}`);
    }
    return (await res.json()) as PirateWeatherResponse;
  }

  return {
    async getForecast(input) {
      const { lat, lon, name } = await geocode(input.location);
      const fc = await fetchForecast(lat, lon);
      return {
        resolved: { name, lat, lon, timezone: fc.timezone },
        daily: [],
        hourlyTomorrow: [],
      };
    },
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npm test -- tests/domains/outdoor/integrations/weather.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add domains/outdoor/integrations/weather.ts tests/domains/outdoor/integrations/weather.test.ts
git commit -m "feat(weather): geocode happy path via Nominatim"
```

---

## Task 4: Nominatim geocoder — in-memory cache

**Files:**
- Modify: `domains/outdoor/integrations/weather.ts`
- Modify: `tests/domains/outdoor/integrations/weather.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `weather.test.ts` inside `describe('geocoding (Nominatim)', ...)`:

```ts
test('caches geocode results across calls', async () => {
  const responses = new Map<string | RegExp, { status: number; json: unknown }>([
    ['nominatim.openstreetmap.org', { status: 200, json: NOMINATIM_MOAB }],
    ['pirateweather.net', { status: 200, json: { latitude: 38.57, longitude: -109.55, timezone: 'America/Denver', daily: { data: [] }, hourly: { data: [] } } }],
  ]);
  const fetchImpl = mockFetch(responses);
  const client = createWeatherClient({ apiKey: 'test', fetchImpl });
  await client.getForecast({ location: 'Moab, UT', days: 1 });
  await client.getForecast({ location: 'Moab, UT', days: 1 });

  const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const nominatimCalls = calls.filter(([url]) => String(url).includes('nominatim'));
  expect(nominatimCalls).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL — Nominatim called twice.

- [ ] **Step 3: Add the cache**

In `createWeatherClient`, before `geocode`, add:

```ts
const geocodeCache = new Map<string, { lat: number; lon: number; name: string }>();
```

Replace `geocode` body to check the cache:

```ts
async function geocode(query: string): Promise<{ lat: number; lon: number; name: string }> {
  const key = query.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached) return cached;
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'outdoor-inventory-bot/1.0 (tkeefe66@gmail.com)' },
  });
  if (!res.ok) {
    throw new ForecastError('api_error', 'nominatim', res.status, `nominatim ${res.status}`);
  }
  const body = (await res.json()) as NominatimResult[];
  if (!Array.isArray(body) || body.length === 0) {
    throw new ForecastError('no_match', 'nominatim', undefined, `no match for "${query}"`);
  }
  const first = body[0]!;
  const resolved = { lat: parseFloat(first.lat), lon: parseFloat(first.lon), name: first.display_name };
  geocodeCache.set(key, resolved);
  return resolved;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add domains/outdoor/integrations/weather.ts tests/domains/outdoor/integrations/weather.test.ts
git commit -m "feat(weather): cache geocode results in-process"
```

---

## Task 5: Nominatim error paths

**Files:**
- Modify: `tests/domains/outdoor/integrations/weather.test.ts`

The cache + error logic from Task 4 already returns the right errors — these tests lock that in.

- [ ] **Step 1: Write the failing tests**

Add to `describe('geocoding (Nominatim)', ...)`:

```ts
test('throws no_match when Nominatim returns an empty array', async () => {
  const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
    ['nominatim.openstreetmap.org', { status: 200, json: [] }],
  ]));
  const client = createWeatherClient({ apiKey: 'test', fetchImpl });
  await expect(client.getForecast({ location: 'gibberish-xyz', days: 1 })).rejects.toMatchObject({
    kind: 'no_match',
    service: 'nominatim',
  });
});

test('throws api_error when Nominatim returns 5xx', async () => {
  const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
    ['nominatim.openstreetmap.org', { status: 503, json: { error: 'service unavailable' } }],
  ]));
  const client = createWeatherClient({ apiKey: 'test', fetchImpl });
  await expect(client.getForecast({ location: 'Moab', days: 1 })).rejects.toMatchObject({
    kind: 'api_error',
    service: 'nominatim',
    status: 503,
  });
});

test('throws rate_limited when Nominatim returns 429', async () => {
  const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
    ['nominatim.openstreetmap.org', { status: 429, json: { error: 'too many requests' } }],
  ]));
  const client = createWeatherClient({ apiKey: 'test', fetchImpl });
  await expect(client.getForecast({ location: 'Moab', days: 1 })).rejects.toMatchObject({
    kind: 'rate_limited',
    service: 'nominatim',
  });
});

test('throws no_match when coordinates are out of range', async () => {
  const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
    ['nominatim.openstreetmap.org', { status: 200, json: [{ lat: '999', lon: '0', display_name: 'bad' }] }],
  ]));
  const client = createWeatherClient({ apiKey: 'test', fetchImpl });
  await expect(client.getForecast({ location: 'bad', days: 1 })).rejects.toMatchObject({
    kind: 'no_match',
    service: 'nominatim',
  });
});
```

- [ ] **Step 2: Run the tests, verify which fail**

Expected: `429` test fails (we currently throw `api_error` for any non-ok), and the lat/lon out-of-range test fails (no guard).

- [ ] **Step 3: Implement the missing branches**

In `weather.ts`, replace the geocode error/validation block:

```ts
if (!res.ok) {
  const kind: ForecastErrorKind = res.status === 429 ? 'rate_limited' : 'api_error';
  throw new ForecastError(kind, 'nominatim', res.status, `nominatim ${res.status}`);
}
const body = (await res.json()) as NominatimResult[];
if (!Array.isArray(body) || body.length === 0) {
  throw new ForecastError('no_match', 'nominatim', undefined, `no match for "${query}"`);
}
const first = body[0]!;
const lat = parseFloat(first.lat);
const lon = parseFloat(first.lon);
if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
  throw new ForecastError('no_match', 'nominatim', undefined, `invalid coordinates for "${query}"`);
}
const resolved = { lat, lon, name: first.display_name };
geocodeCache.set(key, resolved);
return resolved;
```

- [ ] **Step 4: Run the tests, verify they all pass**

Expected: 7 passed (3 from before + 4 new).

- [ ] **Step 5: Commit**

```bash
git add domains/outdoor/integrations/weather.ts tests/domains/outdoor/integrations/weather.test.ts
git commit -m "feat(weather): typed errors for Nominatim (no_match, rate_limited, api_error, bad-coords)"
```

---

## Task 6: Nominatim rate gate — enforce ≥1s between calls

**Files:**
- Modify: `domains/outdoor/integrations/weather.ts`
- Modify: `tests/domains/outdoor/integrations/weather.test.ts`

Nominatim's usage policy asks clients to limit to ≤1 request/second. Our cache reduces volume, but distinct queries within the same minute need a gate.

- [ ] **Step 1: Write the failing test**

Add to `describe('geocoding (Nominatim)', ...)`:

```ts
test('enforces ≥1s gap between distinct Nominatim calls', async () => {
  let virtualTime = 1_000_000;
  const sleepCalls: number[] = [];
  const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
    [/nominatim.*Moab/, { status: 200, json: [{ lat: '38.57', lon: '-109.55', display_name: 'Moab, UT' }] }],
    [/nominatim.*Aspen/, { status: 200, json: [{ lat: '39.19', lon: '-106.82', display_name: 'Aspen, CO' }] }],
    ['pirateweather.net', { status: 200, json: { latitude: 0, longitude: 0, timezone: 'America/Denver', daily: { data: [] }, hourly: { data: [] } } }],
  ]));
  const client = createWeatherClient({
    apiKey: 'test',
    fetchImpl,
    now: () => virtualTime,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
      virtualTime += ms;
    },
  } as unknown as Parameters<typeof createWeatherClient>[0]);

  await client.getForecast({ location: 'Moab', days: 1 });
  // Advance only 200ms before the second call
  virtualTime += 200;
  await client.getForecast({ location: 'Aspen', days: 1 });

  // Expect a sleep of ~800ms inserted before the second Nominatim call
  expect(sleepCalls.some((ms) => ms >= 700 && ms <= 900)).toBe(true);
});
```

- [ ] **Step 2: Add `sleep` to `WeatherClientOptions`**

In `weather.ts`:

```ts
export interface WeatherClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Override for tests; defaults to `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}
```

- [ ] **Step 3: Run the test, verify it fails**

Expected: FAIL — `sleepCalls` is empty.

- [ ] **Step 4: Add the rate gate**

In `createWeatherClient`, add near the cache:

```ts
const now = opts.now ?? (() => Date.now());
const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
const NOMINATIM_MIN_GAP_MS = 1000;
let lastNominatimAtMs = 0;
```

In `geocode`, after the cache check and before the `fetchImpl` call:

```ts
const sinceLast = now() - lastNominatimAtMs;
if (lastNominatimAtMs > 0 && sinceLast < NOMINATIM_MIN_GAP_MS) {
  await sleep(NOMINATIM_MIN_GAP_MS - sinceLast);
}
lastNominatimAtMs = now();
```

- [ ] **Step 5: Run the test, verify it passes**

Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add domains/outdoor/integrations/weather.ts tests/domains/outdoor/integrations/weather.test.ts
git commit -m "feat(weather): enforce ≥1s gap between Nominatim calls per usage policy"
```

---

## Task 7: Pirate Weather — daily forecast mapping

**Files:**
- Modify: `domains/outdoor/integrations/weather.ts`
- Modify: `tests/domains/outdoor/integrations/weather.test.ts`

Pirate Weather daily payload (real shape, abbreviated, units=us):

```json
{
  "latitude": 38.5733,
  "longitude": -109.5498,
  "timezone": "America/Denver",
  "daily": {
    "data": [
      { "time": 1684080000, "summary": "Sunny.", "temperatureHigh": 82.4, "temperatureLow": 56.7, "precipProbability": 0.0, "precipAccumulation": 0.0, "windSpeed": 6.1 },
      { "time": 1684166400, "summary": "Rain.",  "temperatureHigh": 71.2, "temperatureLow": 52.1, "precipProbability": 0.85, "precipAccumulation": 0.42, "windSpeed": 12.3 },
      { "time": 1684252800, "summary": "Partly cloudy.", "temperatureHigh": 78.9, "temperatureLow": 54.5, "precipProbability": 0.1, "precipAccumulation": 0.0, "windSpeed": 8.5 }
    ]
  },
  "hourly": { "data": [] }
}
```

- [ ] **Step 1: Write the failing test**

Add a new `describe` block:

```ts
const PIRATE_3DAY = {
  latitude: 38.5733,
  longitude: -109.5498,
  timezone: 'America/Denver',
  daily: {
    data: [
      { time: 1684080000, summary: 'Sunny.', temperatureHigh: 82.4, temperatureLow: 56.7, precipProbability: 0.0, precipAccumulation: 0.0, windSpeed: 6.1 },
      { time: 1684166400, summary: 'Rain.',  temperatureHigh: 71.2, temperatureLow: 52.1, precipProbability: 0.85, precipAccumulation: 0.42, windSpeed: 12.3 },
      { time: 1684252800, summary: 'Partly cloudy.', temperatureHigh: 78.9, temperatureLow: 54.5, precipProbability: 0.1, precipAccumulation: 0.0, windSpeed: 8.5 },
    ],
  },
  hourly: { data: [] },
};

describe('Pirate Weather daily mapping', () => {
  test('maps daily entries and trims to requested days', async () => {
    const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
      ['nominatim.openstreetmap.org', { status: 200, json: NOMINATIM_MOAB }],
      ['pirateweather.net', { status: 200, json: PIRATE_3DAY }],
    ]));
    const client = createWeatherClient({ apiKey: 'test', fetchImpl });
    const result = await client.getForecast({ location: 'Moab, UT', days: 2 });

    expect(result.daily).toHaveLength(2);
    expect(result.daily[0]).toMatchObject({
      tempHighF: 82.4,
      tempLowF: 56.7,
      precipProbability: 0,
      precipAmountIn: 0,
      windMaxMph: 6.1,
      conditions: 'Sunny.',
    });
    expect(result.daily[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.daily[1]!.precipProbability).toBeCloseTo(0.85);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL — `daily` is currently `[]`.

- [ ] **Step 3: Implement the daily mapping**

Add at the top of `weather.ts`:

```ts
import { formatInTimeZone } from 'date-fns-tz';
```

Add a private helper near the bottom of the module:

```ts
function mapDaily(fc: PirateWeatherResponse, days: number): DailyForecast[] {
  const entries = fc.daily?.data ?? [];
  return entries.slice(0, days).map((d) => ({
    date: formatInTimeZone(d.time * 1000, fc.timezone, 'yyyy-MM-dd'),
    tempHighF: d.temperatureHigh,
    tempLowF: d.temperatureLow,
    precipProbability: d.precipProbability,
    precipAmountIn: d.precipAccumulation,
    windMaxMph: d.windSpeed,
    conditions: d.summary,
  }));
}
```

Update `getForecast`'s return to use it:

```ts
return {
  resolved: { name, lat, lon, timezone: fc.timezone },
  daily: mapDaily(fc, input.days),
  hourlyTomorrow: [],
};
```

- [ ] **Step 4: Run the test, verify it passes**

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add domains/outdoor/integrations/weather.ts tests/domains/outdoor/integrations/weather.test.ts
git commit -m "feat(weather): map Pirate Weather daily entries to DailyForecast"
```

---

## Task 8: Pirate Weather — `hourlyTomorrow` anchoring (destination-local)

**Files:**
- Modify: `domains/outdoor/integrations/weather.ts`
- Modify: `tests/domains/outdoor/integrations/weather.test.ts`

The hard part of this task: "tomorrow" means *tomorrow at the destination*. For Byron Bay, AUS, when Tom asks at 8pm Mountain time (which is already tomorrow in Byron Bay), we need Byron Bay's *next* local date — not "today at the destination because it's already tomorrow there."

The rule: `tomorrow = the destination-local calendar date that follows the destination-local current date`. Always one day after destination-local "today."

- [ ] **Step 1: Write the failing test**

Add to the `describe('Pirate Weather daily mapping', ...)` block (or a sibling block):

```ts
describe('Pirate Weather hourly anchoring', () => {
  test('hourlyTomorrow has 24 entries starting at destination-local midnight', async () => {
    // Byron Bay, AUS — UTC+10 (no DST in NSW for our purposes). When Tom asks at
    // Mountain noon (19:00 UTC), Byron Bay is already 05:00 the next day local.
    // "Tomorrow" should be the day AFTER Byron Bay's current day.
    // Pirate Weather returns hourly UTC timestamps; we filter to entries whose
    // destination-local date matches tomorrow's destination-local date.

    // Fixed "now": 2026-05-15 19:00 UTC. Byron Bay local: 2026-05-16 05:00.
    // Byron Bay's "tomorrow" → 2026-05-17.
    const nowUtcMs = Date.UTC(2026, 4, 15, 19, 0, 0); // May=4
    const tz = 'Australia/Sydney';

    // Build 72 hourly entries starting 24h before "now" (so we have data
    // before and after destination-local tomorrow).
    const hourly: PirateHourData[] = [];
    for (let h = -24; h < 72; h += 1) {
      hourly.push({
        time: Math.floor(nowUtcMs / 1000) + h * 3600,
        summary: 'Mostly cloudy',
        temperature: 70 + (h % 5),
        precipProbability: 0.1,
        windSpeed: 8,
      });
    }

    const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
      ['nominatim.openstreetmap.org', {
        status: 200,
        json: [{ lat: '-28.6474', lon: '153.6020', display_name: 'Byron Bay, NSW, Australia' }],
      }],
      ['pirateweather.net', {
        status: 200,
        json: {
          latitude: -28.6474, longitude: 153.6020, timezone: tz,
          daily: { data: [] },
          hourly: { data: hourly },
        } satisfies PirateWeatherResponse,
      }],
    ]));

    const client = createWeatherClient({ apiKey: 'test', fetchImpl, now: () => nowUtcMs });
    const result = await client.getForecast({ location: 'Byron Bay', days: 1 });

    expect(result.hourlyTomorrow).toHaveLength(24);
    // Every entry's destination-local date must equal 2026-05-17 (Byron Bay tomorrow).
    for (const entry of result.hourlyTomorrow) {
      const date = entry.time.slice(0, 10);
      expect(date).toBe('2026-05-17');
    }
  });
});
```

Also export `PirateHourData` from `weather.ts` for the test (or restructure — for now just expose what the test needs):

In `weather.ts`, change the existing interface to be exported, or add a non-exported type and structurally type the test. Simpler: export it.

```ts
export interface PirateHourData {
  time: number;
  summary: string;
  temperature: number;
  precipProbability: number;
  windSpeed: number;
}

export interface PirateWeatherResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  daily?: { data: PirateDayData[] };
  hourly?: { data: PirateHourData[] };
}

export interface PirateDayData {
  time: number;
  summary: string;
  temperatureHigh: number;
  temperatureLow: number;
  precipProbability: number;
  precipAccumulation: number;
  windSpeed: number;
}
```

(These were already declared as non-exported in Task 3; just add the `export` keyword.)

Import the types in the test:

```ts
import {
  createWeatherClient,
  ForecastError,
  type PirateHourData,
  type PirateWeatherResponse,
} from '../../../../domains/outdoor/integrations/weather.js';
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL — `hourlyTomorrow` is empty.

- [ ] **Step 3: Implement hourly anchoring**

Add to `weather.ts`:

```ts
function destinationTomorrow(nowMs: number, tz: string): string {
  const todayStr = formatInTimeZone(nowMs, tz, 'yyyy-MM-dd');
  // Add one day in destination-local terms by going to noon-tz today and adding 24h.
  // (Adding 24h works for non-DST cases; DST transitions can produce 23h or 25h
  // local days, but adding 24h still lands on the next local date for any timezone.)
  const nextMs = nowMs + 24 * 60 * 60 * 1000;
  // If for some reason nextMs still maps to today (impossible with 24h, but safe), bump again.
  let candidate = formatInTimeZone(nextMs, tz, 'yyyy-MM-dd');
  if (candidate === todayStr) {
    candidate = formatInTimeZone(nextMs + 60 * 60 * 1000, tz, 'yyyy-MM-dd');
  }
  return candidate;
}

function mapHourlyTomorrow(fc: PirateWeatherResponse, nowMs: number): HourlyForecast[] {
  const entries = fc.hourly?.data ?? [];
  const tz = fc.timezone;
  const targetDate = destinationTomorrow(nowMs, tz);
  return entries
    .filter((h) => formatInTimeZone(h.time * 1000, tz, 'yyyy-MM-dd') === targetDate)
    .map((h) => ({
      time: formatInTimeZone(h.time * 1000, tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      tempF: h.temperature,
      precipProbability: h.precipProbability,
      windMph: h.windSpeed,
      conditions: h.summary,
    }));
}
```

Update `getForecast` to use it:

```ts
return {
  resolved: { name, lat, lon, timezone: fc.timezone },
  daily: mapDaily(fc, input.days),
  hourlyTomorrow: mapHourlyTomorrow(fc, now()),
};
```

- [ ] **Step 4: Run the test, verify it passes**

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add domains/outdoor/integrations/weather.ts tests/domains/outdoor/integrations/weather.test.ts
git commit -m "feat(weather): anchor hourlyTomorrow to destination-local next-day midnight"
```

---

## Task 9: Pirate Weather error paths

**Files:**
- Modify: `tests/domains/outdoor/integrations/weather.test.ts`
- Modify: `domains/outdoor/integrations/weather.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block:

```ts
describe('Pirate Weather errors', () => {
  test('throws rate_limited on 429', async () => {
    const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
      ['nominatim.openstreetmap.org', { status: 200, json: NOMINATIM_MOAB }],
      ['pirateweather.net', { status: 429, json: { error: 'too many requests' } }],
    ]));
    const client = createWeatherClient({ apiKey: 'test', fetchImpl });
    await expect(client.getForecast({ location: 'Moab', days: 1 })).rejects.toMatchObject({
      kind: 'rate_limited',
      service: 'pirateweather',
    });
  });

  test('throws api_error on 503', async () => {
    const fetchImpl = mockFetch(new Map<string | RegExp, { status: number; json: unknown }>([
      ['nominatim.openstreetmap.org', { status: 200, json: NOMINATIM_MOAB }],
      ['pirateweather.net', { status: 503, json: { error: 'service unavailable' } }],
    ]));
    const client = createWeatherClient({ apiKey: 'test', fetchImpl });
    await expect(client.getForecast({ location: 'Moab', days: 1 })).rejects.toMatchObject({
      kind: 'api_error',
      service: 'pirateweather',
      status: 503,
    });
  });
});
```

- [ ] **Step 2: Run the tests, verify which fail**

Expected: `429` test fails — currently we throw `api_error` for any non-ok.

- [ ] **Step 3: Implement the 429 branch**

In `fetchForecast` in `weather.ts`, replace the `if (!res.ok)` block:

```ts
if (!res.ok) {
  const kind: ForecastErrorKind = res.status === 429 ? 'rate_limited' : 'api_error';
  throw new ForecastError(kind, 'pirateweather', res.status, `pirateweather ${res.status}`);
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add domains/outdoor/integrations/weather.ts tests/domains/outdoor/integrations/weather.test.ts
git commit -m "feat(weather): typed Pirate Weather errors (rate_limited vs api_error)"
```

---

## Task 10: `get_forecast` tool schema

**Files:**
- Modify: `domains/outdoor/tools.ts`
- Modify: `tests/domains/outdoor/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/domains/outdoor/tools.test.ts` inside `describe('TOOL_SCHEMAS', ...)`:

```ts
test('exports get_forecast', () => {
  const names = TOOL_SCHEMAS.map((s) => s.name);
  expect(names).toContain('get_forecast');
});

test('get_forecast schema requires location and days', () => {
  const t = TOOL_SCHEMAS.find((s) => s.name === 'get_forecast')!;
  expect(t.input_schema.required).toEqual(expect.arrayContaining(['location', 'days']));
  const props = t.input_schema.properties as Record<string, { type: string; minimum?: number; maximum?: number }>;
  expect(props.location?.type).toBe('string');
  expect(props.days?.type).toBe('integer');
  expect(props.days?.minimum).toBe(1);
  expect(props.days?.maximum).toBe(7);
});
```

Also update the existing `expect(TOOL_SCHEMAS).toHaveLength(2);` assertion → `toHaveLength(3)`.

- [ ] **Step 2: Run the tests, verify they fail**

Expected: FAIL — `get_forecast` not in `TOOL_SCHEMAS`.

- [ ] **Step 3: Add the schema entry**

In `domains/outdoor/tools.ts`, extend `TOOL_SCHEMAS`:

```ts
export const TOOL_SCHEMAS = [
  {
    name: 'get_product_url',
    // ...existing...
  },
  {
    name: 'update_status',
    // ...existing...
  },
  {
    name: 'get_forecast',
    description:
      "Get the weather forecast for a location. Use when Tom asks about weather, packing for a trip, conditions at a destination, or anything that depends on temperature, precipitation, or wind. Returns a daily summary for the requested number of days plus an hourly breakdown for tomorrow at the destination. Use the destination's local time, not Tom's. Don't call this for general climate questions ('what's Iceland like in July?') — only for specific forecasts within the next 7 days.",
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Free-form place name. Be as specific as helpful — "Moab, UT" beats "Moab". Country/state suffix avoids ambiguity for common names.',
        },
        days: {
          type: 'integer',
          minimum: 1,
          maximum: 7,
          description: 'Number of forecast days to return. Use 1 for "tomorrow", 3-5 for a multi-day trip, 7 for the full week.',
        },
      },
      required: ['location', 'days'],
    },
  },
] as const;
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
npm test -- tests/domains/outdoor/tools.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add domains/outdoor/tools.ts tests/domains/outdoor/tools.test.ts
git commit -m "feat(tools): add get_forecast tool schema"
```

---

## Task 11: `get_forecast` tool handler

**Files:**
- Modify: `domains/outdoor/tools.ts`
- Modify: `tests/domains/outdoor/tools.test.ts`

The handler needs a `WeatherClient` dependency. We extend `ToolDeps` to accept one (so it can be mocked in tests and injected from `apps/bot/index.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/domains/outdoor/tools.test.ts`:

```ts
import type { WeatherClient, ForecastResult } from '../../../domains/outdoor/integrations/weather.js';
import { ForecastError } from '../../../domains/outdoor/integrations/weather.js';

function makeWeather(impl: WeatherClient['getForecast']): WeatherClient {
  return { getForecast: impl };
}

function makeDepsWithWeather(rows: MasterRow[], weather: WeatherClient): { deps: ToolDeps; cache: InventoryCache } {
  const { deps, cache } = makeDeps(rows);
  return { deps: { ...deps, weather }, cache };
}

describe('get_forecast handler', () => {
  const fakeForecast: ForecastResult = {
    resolved: { name: 'Moab, UT', lat: 38.57, lon: -109.55, timezone: 'America/Denver' },
    daily: [
      { date: '2026-05-16', tempHighF: 82.4, tempLowF: 56.7, precipProbability: 0.1, precipAmountIn: 0, windMaxMph: 6.1, conditions: 'Sunny.' },
    ],
    hourlyTomorrow: [],
  };

  test('happy path returns ok with forecast', async () => {
    const weather = makeWeather(async () => fakeForecast);
    const { deps, cache } = makeDepsWithWeather([FIXTURE_THERMAREST], weather);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.get_forecast({ location: 'Moab, UT', days: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.forecast.resolved.name).toBe('Moab, UT');
    }
  });

  test('no_match returns ok=false with human message', async () => {
    const weather = makeWeather(async () => { throw new ForecastError('no_match', 'nominatim', undefined, 'no match'); });
    const { deps, cache } = makeDepsWithWeather([FIXTURE_THERMAREST], weather);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.get_forecast({ location: 'gibberish', days: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('no_match');
      expect(result.message).toMatch(/couldn't find/i);
    }
  });

  test('api_error returns ok=false with generic message', async () => {
    const weather = makeWeather(async () => { throw new ForecastError('api_error', 'pirateweather', 503, 'boom'); });
    const { deps, cache } = makeDepsWithWeather([FIXTURE_THERMAREST], weather);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.get_forecast({ location: 'Moab', days: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('api_error');
    }
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Expected: FAIL — `tools.get_forecast` doesn't exist.

- [ ] **Step 3: Implement the handler**

In `domains/outdoor/tools.ts`:

```ts
import type { WeatherClient, ForecastErrorKind, ForecastResult } from './integrations/weather.js';
import { ForecastError } from './integrations/weather.js';
```

Extend `ToolDeps`:

```ts
export interface ToolDeps {
  cache: InventoryCache;
  sheets: SheetsClient;
  spreadsheetId: string;
  updateRowStatus: (
    sheets: SheetsClient,
    spreadsheetId: string,
    input: { rowIndex: number; newStatus: Status },
  ) => Promise<void>;
  weather: WeatherClient;
}
```

Add types and handler:

```ts
export interface GetForecastInput {
  location: string;
  days: number;
}

export type GetForecastResult =
  | { ok: true; forecast: ForecastResult }
  | { ok: false; error: ForecastErrorKind; message: string };

export interface ToolHandlers {
  get_product_url: (input: GetProductUrlInput) => Promise<GetProductUrlResult>;
  update_status: (input: UpdateStatusInput) => Promise<UpdateStatusResult>;
  get_forecast: (input: GetForecastInput) => Promise<GetForecastResult>;
}

function humanForecastMessage(e: ForecastError, query: string): string {
  switch (e.kind) {
    case 'no_match':
      return `I couldn't find a location matching "${query}" — can you give me a state or country?`;
    case 'rate_limited':
      return 'Having trouble looking that up — try again in a moment.';
    case 'api_error':
      return 'Weather service is temporarily unavailable.';
  }
}
```

In `createTools`, add the new method:

```ts
async get_forecast(input: GetForecastInput): Promise<GetForecastResult> {
  try {
    const forecast = await deps.weather.getForecast(input);
    return { ok: true, forecast };
  } catch (e) {
    if (e instanceof ForecastError) {
      return { ok: false, error: e.kind, message: humanForecastMessage(e, input.location) };
    }
    throw e;
  }
},
```

- [ ] **Step 4: Update existing `makeDeps` in tools.test.ts**

The existing `makeDeps` doesn't include `weather` — TypeScript will fail. Add a default:

```ts
function makeDeps(rows: MasterRow[]): { deps: ToolDeps; cache: InventoryCache; updateCalls: { rowIndex: number; newStatus: string }[] } {
  const updateCalls: { rowIndex: number; newStatus: string }[] = [];
  const fakeSheets = {} as ToolDeps['sheets'];
  const fakeUpdate = vi.fn(async (_s: unknown, _id: string, input: { rowIndex: number; newStatus: string }) => {
    updateCalls.push(input);
  });
  const cache = new InventoryCache(async () => rows);
  const fakeWeather: WeatherClient = {
    getForecast: async () => { throw new Error('weather not configured in this test'); },
  };
  return {
    cache,
    updateCalls,
    deps: {
      cache,
      sheets: fakeSheets,
      spreadsheetId: 'TEST_SHEET_ID',
      updateRowStatus: fakeUpdate as unknown as ToolDeps['updateRowStatus'],
      weather: fakeWeather,
    },
  };
}
```

- [ ] **Step 5: Run the tests, verify they pass**

```bash
npm test -- tests/domains/outdoor/tools.test.ts
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add domains/outdoor/tools.ts tests/domains/outdoor/tools.test.ts
git commit -m "feat(tools): get_forecast handler with typed errors → ok/false shape"
```

---

## Task 12: Wire `get_forecast` into agent's `dispatchTool`

**Files:**
- Modify: `domains/outdoor/agent.ts`
- Modify: `tests/domains/outdoor/agent.test.ts`

The agent's `dispatchTool` method currently has cases for `get_product_url` and `update_status`. Add `get_forecast`.

- [ ] **Step 1: Check whether `agent.test.ts` tests `dispatchTool` directly**

```bash
grep -n "dispatchTool\|get_forecast" tests/domains/outdoor/agent.test.ts
```

If `dispatchTool` is not tested directly (it's a private method), skip the test step for Task 12 and rely on the manual acceptance test. If there's a coverage path, add an assertion. For most likely case (private, untested):

- [ ] **Step 2: Update `OutdoorAgentOptions` to require a weather client**

In `domains/outdoor/agent.ts`:

```ts
import type { WeatherClient } from './integrations/weather.js';

export interface OutdoorAgentOptions {
  cache: InventoryCache;
  conversations: ConversationStore;
  stats: Stats;
  anthropic: Anthropic;
  sheets: SheetsClient;
  spreadsheetId: string;
  weather: WeatherClient;
  updateRowStatus: (
    sheets: SheetsClient,
    spreadsheetId: string,
    input: { rowIndex: number; newStatus: Status },
  ) => Promise<void>;
}
```

In the constructor's `createTools` call:

```ts
this.tools = createTools({
  cache: opts.cache,
  sheets: opts.sheets,
  spreadsheetId: opts.spreadsheetId,
  updateRowStatus: opts.updateRowStatus,
  weather: opts.weather,
});
```

In `dispatchTool`, add the new branch BEFORE the unknown-tool fallback:

```ts
if (name === 'get_forecast') {
  return this.tools.get_forecast(input as { location: string; days: number });
}
```

- [ ] **Step 3: Update `TOOL_GUIDANCE` system-prompt string**

Replace the `TOOL_GUIDANCE` constant in `agent.ts`:

```ts
const TOOL_GUIDANCE = `You have four tools available:

- web_search — use for anything time-sensitive: current prices, current trail/snow/surf/weather conditions in prose form, recent product releases, reviews from the past year, current park/trail status. Do NOT search for things in Tom's inventory (already in context) or for general outdoor knowledge (you already know). Capped at 3 searches per turn. When you do search, cite the source domain in your reply so Tom can verify (e.g., "per outdoorgearlab.com").

- get_forecast(location, days) — call this when the user asks about weather or packing for a real upcoming trip. Pair it with the inventory you already have in context to give specific gear recommendations ("you have the Patagonia Houdini for the wind, but the forecast shows 0.6in of rain Thursday — bring the shell instead"). Don't call it for climatology questions or vague "what's it like there in spring" — only for specific forecasts in the next 7 days. Always include the destination + dates in your reply so Tom can verify. Prefer this over web_search for any weather question, since it returns structured numeric data.

- update_status(item_id, new_status) — when the user tells you they lost, sold, donated, retired, returned, or broke an item, or wants to mark it excluded. Possible new_status values: active, retired, returned, lost, broken, sold, donated, excluded. After calling this tool, confirm to the user what changed.

- get_product_url(item_id) — usually NOT needed since each inventory row already includes its product URL. Use only as a fallback if a URL is missing from the row.

Use tools sparingly: only call when needed.`;
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: success. If there are errors in `agent.test.ts` (e.g., test fixtures don't pass `weather`), update them in the same step:

```bash
grep -n "new OutdoorAgent(" tests/domains/outdoor/agent.test.ts
```

If the test instantiates `OutdoorAgent`, add a `weather: { getForecast: async () => { throw new Error('not used') } }` field to the options.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add domains/outdoor/agent.ts tests/domains/outdoor/agent.test.ts
git commit -m "feat(agent): wire get_forecast into dispatchTool + tool guidance"
```

---

## Task 13: Wire env var + weather client into `apps/bot/index.ts`

**Files:**
- Modify: `apps/bot/index.ts`

- [ ] **Step 1: Add `PIRATE_WEATHER_API_KEY` to `Env` interface and `readEnv()`**

In `apps/bot/index.ts`, update the `Env` interface:

```ts
interface Env {
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  spreadsheetId: string;
  anthropicApiKey: string;
  telegramBotToken: string;
  authorizedChatIds: Set<string>;
  pirateWeatherApiKey: string;
  ingestAfterDate: string | undefined;
}
```

In `readEnv()`, add to `required`:

```ts
const required = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_AUTHORIZED_CHAT_IDS: process.env.TELEGRAM_AUTHORIZED_CHAT_IDS,
  PIRATE_WEATHER_API_KEY: process.env.PIRATE_WEATHER_API_KEY,
};
```

And in the returned object:

```ts
return {
  googleClientId: required.GOOGLE_CLIENT_ID!,
  googleClientSecret: required.GOOGLE_CLIENT_SECRET!,
  googleRefreshToken: required.GOOGLE_REFRESH_TOKEN!,
  spreadsheetId: required.GOOGLE_SHEET_ID!,
  anthropicApiKey: required.ANTHROPIC_API_KEY!,
  telegramBotToken: required.TELEGRAM_BOT_TOKEN!,
  pirateWeatherApiKey: required.PIRATE_WEATHER_API_KEY!,
  authorizedChatIds: new Set(
    required.TELEGRAM_AUTHORIZED_CHAT_IDS!.split(',').map((s) => s.trim()).filter(Boolean),
  ),
  ingestAfterDate: process.env.INGEST_AFTER_DATE,
};
```

- [ ] **Step 2: Create the weather client and pass it to the agent**

In `main()`, after the `anthropic` and before the `OutdoorAgent` instantiation, add:

```ts
import { createWeatherClient } from '../../domains/outdoor/integrations/weather.js';
// ... in main():
const weather = createWeatherClient({ apiKey: env.pirateWeatherApiKey });
```

Pass into the agent options:

```ts
const agent = new OutdoorAgent({
  cache,
  conversations,
  stats,
  anthropic,
  sheets,
  spreadsheetId: env.spreadsheetId,
  weather,
  updateRowStatus,
});
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: success.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/index.ts
git commit -m "feat(bot): wire PIRATE_WEATHER_API_KEY → WeatherClient → OutdoorAgent"
```

---

## Task 14: Manual acceptance test

**Files:** none (operational task)

This is the Phase 3 ship gate per PLAN.md.

- [ ] **Step 1: Sign up for a Pirate Weather API key**

Visit https://pirate-weather.apiable.io and sign up. Copy the API key.

- [ ] **Step 2: Set the env var locally and on Railway**

Local:

```bash
echo "PIRATE_WEATHER_API_KEY=<your-key>" >> .env
```

Railway: Add `PIRATE_WEATHER_API_KEY` to the bot service's env vars (NOT the cron service — Phase 3 only adds it to the bot).

- [ ] **Step 3: Start the bot locally**

```bash
npm run bot
```

Expected: bot starts, prints "polling started", no errors.

- [ ] **Step 4: Ask the acceptance test question via Telegram**

DM the bot:

> "What should I bring for a 2-day trip to Moab, UT starting tomorrow?"

Verify:
- Bot calls `get_forecast` (visible in server logs).
- Reply references specific forecast numbers (temps, precip prob).
- Reply names specific items from inventory ("your Patagonia X for the wind").
- Reply mentions Moab and the dates.

- [ ] **Step 5: Test a no-match path**

DM the bot:

> "What's the forecast for asdfqwerty tomorrow?"

Verify: bot gracefully reports it couldn't find the location, asks for clarification.

- [ ] **Step 6: Test a non-Mountain TZ destination**

DM the bot:

> "I'm going to Reykjavik for 3 days next week. What's the weather?"

Verify: dates make sense for Iceland (not Mountain time), temp units are F, response cites Reykjavik.

- [ ] **Step 7: Deploy to Railway**

```bash
git push -u origin phase-3-weather
```

Then in Railway: trigger a deploy of the bot service from the `phase-3-weather` branch. Verify the new env var is set. Verify the bot starts cleanly.

- [ ] **Step 8: Repeat the acceptance question against the deployed bot**

DM the production bot with the same Moab question. Verify the same behavior.

- [ ] **Step 9: Merge to main**

Once production is verified, merge the branch:

```bash
git checkout main
git merge --no-ff phase-3-weather
git push origin main
```

(Or open a PR if you've moved to that workflow.)

---

## Self-review

Spec coverage check:

| Spec requirement | Task |
|---|---|
| `domains/outdoor/integrations/weather.ts` with `getForecast` | Tasks 2–9 |
| Nominatim geocoding + cache + 1 req/sec gate + User-Agent | Tasks 3, 4, 6 |
| Pirate Weather fetch + daily mapping | Task 7 |
| `hourlyTomorrow` anchored to destination-local next-day | Task 8 |
| Typed errors (no_match / rate_limited / api_error) for both services | Tasks 5, 9 |
| Coordinate bounds validation | Task 5 |
| `get_forecast` tool schema | Task 10 |
| `get_forecast` tool handler with `{ok: true/false}` shape | Task 11 |
| System prompt update | Task 12 |
| Env var (`PIRATE_WEATHER_API_KEY`) + bot wiring | Tasks 1, 13 |
| Manual acceptance test | Task 14 |

Type consistency: `WeatherClient`, `ForecastResult`, `ForecastError`, `GetForecastResult` are introduced in Task 2 and used by-name through Task 13. No drift.

Placeholders: none — every step has full code or a concrete command.
