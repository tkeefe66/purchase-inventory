import { describe, test, expect, vi } from 'vitest';
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
});
