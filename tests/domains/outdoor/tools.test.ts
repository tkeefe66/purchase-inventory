import { describe, test, expect, vi } from 'vitest';
import { createTools, TOOL_SCHEMAS, type ToolDeps } from '../../../domains/outdoor/tools.js';
import { InventoryCache } from '../../../apps/bot/inventoryCache.js';
import { itemId } from '../../../domains/outdoor/types.js';
import type { MasterRow } from '../../../lib/types.js';
import type { WeatherClient, ForecastResult } from '../../../domains/outdoor/integrations/weather.js';
import { ForecastError } from '../../../domains/outdoor/integrations/weather.js';
import {
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
} from '../../fixtures/outdoor-items.js';

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
  const fakeGeocode: ToolDeps['geocode'] = async () => { throw new Error('geocode not configured in this test'); };
  return {
    cache,
    updateCalls,
    deps: {
      cache,
      sheets: fakeSheets,
      spreadsheetId: 'TEST_SHEET_ID',
      updateRowStatus: fakeUpdate as unknown as ToolDeps['updateRowStatus'],
      weather: fakeWeather,
      geocode: fakeGeocode,
      campingIndexPath: '/tmp/test-camping-index.json',
      dispersedSnapshotPath: '/tmp/test-dispersed.json',
    },
  };
}

function makeWeather(impl: WeatherClient['getForecast']): WeatherClient {
  return { getForecast: impl };
}

function makeDepsWithWeather(rows: MasterRow[], weather: WeatherClient): { deps: ToolDeps; cache: InventoryCache } {
  const { deps, cache } = makeDeps(rows);
  return { deps: { ...deps, weather }, cache };
}

describe('TOOL_SCHEMAS', () => {
  test('exports two tools: get_product_url and update_status', () => {
    const names = TOOL_SCHEMAS.map((s) => s.name);
    expect(names).toContain('get_product_url');
    expect(names).toContain('update_status');
    expect(names).toContain('get_forecast');
    expect(names).toContain('find_free_campsites');
    expect(names).toContain('lookup_trail');
    expect(names).toContain('search_trails_nearby');
    expect(TOOL_SCHEMAS).toHaveLength(6);
  });

  test('update_status schema constrains new_status to the valid enum', () => {
    const t = TOOL_SCHEMAS.find((s) => s.name === 'update_status')!;
    const statusProp = (t.input_schema.properties as Record<string, { enum?: readonly string[] }>).new_status;
    expect(statusProp?.enum).toEqual(
      expect.arrayContaining(['active', 'retired', 'returned', 'lost', 'broken', 'sold', 'donated', 'excluded']),
    );
  });

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

  test('exports find_free_campsites', () => {
    const names = TOOL_SCHEMAS.map((s) => s.name);
    expect(names).toContain('find_free_campsites');
  });

  test('find_free_campsites schema requires location', () => {
    const t = TOOL_SCHEMAS.find((s) => s.name === 'find_free_campsites')!;
    expect(t.input_schema.required).toContain('location');
  });
});

describe('get_product_url handler', () => {
  test('returns the product URL for a known item id', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.get_product_url({ item_id: itemId(FIXTURE_THERMAREST) });
    expect(result.ok).toBe(true);
    expect(result.product_url).toBe(FIXTURE_THERMAREST.productUrl);
  });

  test('returns ok=false when the id is unknown', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.get_product_url({ item_id: '000000' });
    expect(result.ok).toBe(false);
    expect(result.product_url).toBeNull();
  });
});

describe('update_status handler', () => {
  test('writes the new status to the sheet and updates the cache', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    await cache.refresh();
    const tools = createTools(deps);
    const tid = itemId(FIXTURE_THERMAREST);
    const result = await tools.update_status({ item_id: tid, new_status: 'retired' });

    expect(result.ok).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.rowIndex).toBe(2);
    expect(updateCalls[0]!.newStatus).toBe('retired');
    expect(cache.getCompactView().text).not.toContain('Therm-a-Rest');
  });

  test('returns ok=false for unknown item id; does not touch the sheet', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.update_status({ item_id: 'xxxxxx', new_status: 'retired' });
    expect(result.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  test('rejects an invalid status value before touching the sheet', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.update_status({
      item_id: itemId(FIXTURE_THERMAREST),
      // @ts-expect-error — testing runtime rejection
      new_status: 'gone-fishing',
    });
    expect(result.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });
});

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

describe('find_free_campsites handler', () => {
  test('returns ok=false when geocode throws', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const failGeocode: ToolDeps['geocode'] = async () => { throw new Error('no match'); };
    const tools = createTools({ ...deps, geocode: failGeocode });
    const result = await tools.find_free_campsites({ location: 'NowhereXYZ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('could_not_geocode');
  });

  test('returns ok=false when location is blank', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.find_free_campsites({ location: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('location is required');
  });

  test('happy path returns ok=true with results array', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const fakeGeocode: ToolDeps['geocode'] = async () => ({ lat: 38.57, lon: -109.55, name: 'Moab, UT' });
    const tools = createTools({ ...deps, geocode: fakeGeocode });
    // Files don't exist at /tmp paths — readCampingIndex returns { facilities: [] } and readDispersedSnapshot returns null
    const result = await tools.find_free_campsites({ location: 'Moab, UT', radius_km: 80 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.location).toBe('Moab, UT');
      expect(Array.isArray(result.data.results)).toBe(true);
    }
  });
});
