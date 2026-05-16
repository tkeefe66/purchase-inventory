# Design — Phase 3: Outdoor + Weather integration

**Date:** 2026-05-15
**Status:** approved (pending spec review)
**Author:** Tom + Claude (brainstorming)

---

## Problem

The outdoor agent (Phase 2) has Tom's complete active inventory in context and `web_search` (Phase 2.5) for time-sensitive information. It has no first-class way to read forecast data, which is the most common grounding question for outdoor decisions: *"what should I bring tomorrow for [trip]?"*.

`web_search` could technically answer some weather questions, but:

- It costs 1 of 3 searches per turn — better budgeted for "current trail conditions" or "current prices."
- Forecast formats from random weather sites are inconsistent and not structured for downstream reasoning.
- Tom wants the agent to *combine* forecast with inventory to recommend specific gear — that needs a structured payload, not prose pulled from weather.com.

Phase 3 closes this gap by giving the agent a `get_forecast(location, days)` tool backed by Pirate Weather, with Nominatim for geocoding.

## Decisions locked in brainstorming

| Question | Answer |
|---|---|
| Weather provider? | **Pirate Weather.** Global, clean Dark-Sky-style payload, free tier (10k calls/month) generous for one user, requires API key. |
| Geocoding? | **OSM Nominatim.** Free, no key, 1 req/sec polite usage. In-memory cache per process. |
| Forecast detail? | **Daily summary for N days + hourly breakdown for tomorrow.** Compact enough for the agent, rich enough for "tomorrow morning specifically" decisions. |
| Caching? | **Geocoding only.** Forecast data is time-sensitive; re-fetching is rare in practice. |
| Units? | **Imperial** (Fahrenheit, inches, mph) — matches Tom's locale. |
| `hourlyTomorrow` anchor? | **Destination's next local midnight, 24 entries.** Not "next 24 hours from now" — anchored to the trip's local tomorrow regardless of when the user asks. |
| Alerts? | **No.** Pirate Weather has severe-weather alerts; defer until a real use case emerges. |
| Errors? | **Typed and thrown** inside the client; tool wrapper translates to `{ ok: false, error, message }` for the agent. Matches existing tool pattern. |

## Architecture

### 1. Weather client — `domains/outdoor/integrations/weather.ts`

Single new module. Pure infrastructure: no domain logic, no agent coupling, reusable from Phase 3.5 (calendar nudges).

```ts
export interface ForecastInput {
  location: string;   // free-form: "Moab, UT", "Yosemite Valley", "Iceland"
  days: number;       // 1-7
}

export interface DailyForecast {
  date: string;              // ISO YYYY-MM-DD, in the location's local TZ
  tempHighF: number;
  tempLowF: number;
  precipProbability: number; // 0-1
  precipAmountIn: number;
  windMaxMph: number;
  conditions: string;        // "Partly cloudy", "Rain", etc.
}

export interface HourlyForecast {
  time: string;              // ISO 8601 with offset
  tempF: number;
  precipProbability: number;
  windMph: number;
  conditions: string;
}

export interface ForecastResult {
  resolved: { name: string; lat: number; lon: number; timezone: string };
  daily: DailyForecast[];               // length === days
  hourlyTomorrow: HourlyForecast[];     // 24 entries, anchored to destination's next local midnight
}

export type ForecastError =
  | { kind: 'no_match'; query: string }
  | { kind: 'rate_limited'; service: 'nominatim' | 'pirateweather' }
  | { kind: 'api_error'; service: 'nominatim' | 'pirateweather'; status?: number; message: string };

export async function getForecast(input: ForecastInput): Promise<ForecastResult>;
```

Internals:

- **`geocode(query)`** — calls Nominatim, caches result in an in-process `Map<string, {lat,lon,displayName}>`. Sends `User-Agent: outdoor-inventory-bot/1.0 (tkeefe66@gmail.com)` (Nominatim policy requires identification). 1 req/sec gate via a `lastCallTimestamp` guard. Throws `no_match` on empty results, `rate_limited` on 429, `api_error` on other failures.
- **`fetchPirateWeather(lat, lon)`** — calls `https://api.pirateweather.net/forecast/{KEY}/{lat},{lon}?units=us&exclude=minutely,alerts`. Throws `rate_limited` on 429, `api_error` on 4xx/5xx/network failures.
- **Mapping** — Pirate Weather's `daily.data` → `DailyForecast[]` (trim to requested length); `hourly.data` filtered to the 24 entries starting at destination's next local midnight → `HourlyForecast[]`. Conditions string from Pirate Weather's `summary` field.
- **Defensive guard** — if geocoder returns lat/lon outside [-90,90]/[-180,180], treat as `no_match`.

### 2. Agent tool — `domains/outdoor/tools.ts` (extend)

Adds one entry to `TOOL_SCHEMAS`:

```ts
{
  name: 'get_forecast',
  description:
    "Get the weather forecast for a location. Use when Tom asks about weather, packing for a trip, conditions at a destination, or anything that depends on temperature, precipitation, or wind. Returns a daily summary for the requested number of days plus an hourly breakdown for tomorrow at the destination. Use the destination's local time, not Tom's. Don't call this for general climate questions ('what's Iceland like in July?') — only for specific forecasts within the next 7 days.",
  input_schema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'Free-form place name. Be as specific as helpful — "Moab, UT" beats "Moab".' },
      days: { type: 'integer', minimum: 1, maximum: 7, description: 'Number of forecast days. 1 for "tomorrow", 3-5 for a multi-day trip, 7 for the week.' },
    },
    required: ['location', 'days'],
  },
}
```

Handler in `createTools`:

```ts
async get_forecast(input: GetForecastInput): Promise<GetForecastResult> {
  try {
    const forecast = await weather.getForecast(input);
    return { ok: true, forecast };
  } catch (e) {
    if (isForecastError(e)) {
      return { ok: false, error: e.kind, message: humanMessage(e) };
    }
    throw e;
  }
}
```

`humanMessage(e)` produces a one-sentence string suited for the agent to surface to Tom (e.g., *"I couldn't find a location matching 'springfield' — try adding a state or country."*).

### 3. System prompt — `domains/outdoor/agent.ts` (extend)

Adds one paragraph to the existing tool-description section:

> **get_forecast** — call this when the user asks about weather or packing for a real upcoming trip. Pair it with the inventory you already have in context to give specific gear recommendations ("you have the Patagonia Houdini for the wind, but the forecast shows 0.6in of rain Thursday — bring the shell instead"). Don't call it for climatology questions or vague "what's it like there in spring" — only for specific forecasts in the next 7 days. Always include the destination + dates in your reply so Tom can verify.

### 4. Environment variable

```bash
PIRATE_WEATHER_API_KEY=
```

Added to `.env.example` and Railway env. Required at boot time of the bot service; the cron service does not need it (Phase 3.5 will).

### 5. Logging

Every forecast call logs at info: `{ query, resolvedName, lat, lon, days, durationMs }`. Failures log at error with full error context. Matches the style of `lib/gmail.ts` / `lib/sheets.ts`.

## Error handling — concrete cases

- **`no_match`** — Nominatim returned zero results, or coordinates out of range. Agent surfaces: *"I couldn't find a location matching 'X' — can you give me a state or country?"*
- **`rate_limited` (nominatim)** — One retry after 1.1s backoff; if still failing, surface: *"Having trouble looking that up — try again in a moment."*
- **`rate_limited` (pirateweather)** — Shouldn't happen at single-user volume, but handled. Same UX as above.
- **`api_error`** — Network failure, 5xx, malformed response. Full error logged server-side; agent surfaces a generic message.

## Testing

### Unit tests

**`tests/domains/outdoor/integrations/weather.test.ts`** (new):

- Geocode happy path: "Moab, UT" → cached coords on second call (Nominatim called once).
- Geocode no-match: empty results → throws `{ kind: 'no_match', query: '...' }`.
- Geocode rate-limit gate: two back-to-back calls have ≥1s gap (fake timer).
- Forecast happy path: mock Pirate Weather JSON fixture → mapped `ForecastResult` matches golden snapshot.
- Forecast: `hourlyTomorrow` anchored to destination's local midnight, length 24 (verify with non-Mountain-TZ fixture, e.g., Byron Bay AUS).
- Forecast: `daily.length === days` when `days=3`.
- Pirate Weather 429 → throws `rate_limited`.
- Pirate Weather 5xx → throws `api_error` with status.
- Geocoder returns lat=999 → throws `no_match`.

**`tests/domains/outdoor/tools.test.ts`** (extend):

- `get_forecast` happy path → `{ ok: true, forecast }`.
- `get_forecast` no_match → `{ ok: false, error: 'no_match', message }`.
- `get_forecast` api_error → `{ ok: false, error: 'api_error', message }`.

### Fixtures (`tests/fixtures/weather/`)

- `pirateweather-moab.json` — real Pirate Weather response captured once, sanitized.
- `pirateweather-byron-bay.json` — non-US timezone, validates `hourlyTomorrow` anchoring.
- `nominatim-moab.json` — Nominatim response shape.

### Manual acceptance (Phase 3 ship gate, per PLAN.md)

> *"What should I bring for a 2-day trip to [real place] starting tomorrow?"*

Bot calls `get_forecast`, reads inventory in-context, produces a packing list referencing both the forecast and Tom's actual items. Verified by Tom.

## Out of scope (Phase 3)

- Severe-weather alerts — deferred.
- Forecast caching — deferred until usage data shows redundant calls.
- A separate `packing_list(trip)` composition tool — agent composes from `get_forecast` output + in-context inventory directly.
- Geocoding fallback providers (Mapbox, Google) — Nominatim is sufficient at this scale.
- Calendar-driven proactive nudges — that's Phase 3.5.

## Open input

| Input | Blocks | Status |
|---|---|---|
| Pirate Weather API key | All of Phase 3 | ⏳ Tom to sign up at pirate-weather.apiable.io and add to `.env` + Railway |

## Implementation order (handoff to writing-plans)

1. `PIRATE_WEATHER_API_KEY` added to `.env.example`.
2. `lib/types.ts` — no changes (all weather types live in `weather.ts`).
3. `domains/outdoor/integrations/weather.ts` — geocode + fetchPirateWeather + getForecast, with all error paths, TDD.
4. Test fixtures captured.
5. `domains/outdoor/tools.ts` — add `get_forecast` schema + handler.
6. `domains/outdoor/agent.ts` — add system prompt paragraph.
7. Wire dependency in `apps/bot/index.ts` (read env var, pass through to `createTools`).
8. Manual acceptance test against the real bot.
