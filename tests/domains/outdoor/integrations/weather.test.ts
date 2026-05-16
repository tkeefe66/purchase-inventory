import { describe, test, expect, vi } from 'vitest';
import {
  createWeatherClient,
  ForecastError,
  type PirateHourData,
  type PirateWeatherResponse,
} from '../../../../domains/outdoor/integrations/weather.js';

describe('weather module', () => {
  test('exports load', () => {
    expect(typeof createWeatherClient).toBe('function');
    expect(ForecastError).toBeDefined();
  });
});

function mockFetch(responses: Map<string | RegExp, { status: number; json: unknown }>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
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
      ['pirateweather.net', { status: 200, json: { latitude: 38.57, longitude: -109.55, timezone: 'America/Denver', daily: { data: [] }, hourly: { data: [] } } }],
    ]));
    const client = createWeatherClient({ apiKey: 'test', fetchImpl });
    const result = await client.getForecast({ location: 'Moab, UT', days: 1 });
    expect(result.resolved.lat).toBeCloseTo(38.5733);
    expect(result.resolved.lon).toBeCloseTo(-109.5498);
    expect(result.resolved.name).toContain('Moab');
  });

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
});

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
