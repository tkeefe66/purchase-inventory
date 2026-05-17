import { describe, test, expect, vi } from 'vitest';
import { runDispersedRefresh } from '../../../apps/cron/camping/dispersed-refresh.js';
import { shouldRunDispersedRefresh } from '../../../apps/cron/camping/schedule.js';

function mkArcgisResp(features: object[]): Response {
  return new Response(JSON.stringify({ features, exceededTransferLimit: false }), { status: 200 });
}

function mkOverpassResp(elements: object[]): Response {
  return new Response(JSON.stringify({ elements }), { status: 200 });
}

describe('shouldRunDispersedRefresh', () => {
  test('fires Sunday 5am Mountain', () => {
    // 2026-05-17 was a Sunday. 5am MDT (UTC-6) = 11:00 UTC.
    expect(shouldRunDispersedRefresh(new Date('2026-05-17T11:00:00Z'))).toBe(true);
  });
  test('does not fire Sunday 4am', () => {
    expect(shouldRunDispersedRefresh(new Date('2026-05-17T10:00:00Z'))).toBe(false);
  });
  test('does not fire on a Saturday', () => {
    expect(shouldRunDispersedRefresh(new Date('2026-05-16T11:00:00Z'))).toBe(false);
  });
});

describe('runDispersedRefresh', () => {
  test('merges spots from all three sources', async () => {
    const usfs = vi.fn().mockResolvedValue(mkArcgisResp([
      { attributes: { recareaid: 'u1', recareaname: 'A', forestname: 'F', recareadescription: '', longitude: -110, latitude: 40 } },
    ]));
    const blm = vi.fn().mockResolvedValue(mkArcgisResp([
      { attributes: { OBJECTID: 'b1', FET_NAME: 'B', UNIT_NAME: 'BFO', LAT: 41, LONG: -111 } },
    ]));
    const osm = vi.fn().mockResolvedValue(mkOverpassResp([
      { type: 'node', id: 99, lat: 42, lon: -112, tags: { name: 'C', tourism: 'camp_site' } },
    ]));
    const res = await runDispersedRefresh({
      usfsFetcher: usfs as never,
      blmFetcher: blm as never,
      osmFetcher: osm as never,
    });
    expect(res.snapshot.spots).toHaveLength(3);
    expect(res.countsBySource).toEqual({ USFS: 1, BLM: 1, OSM: 1 });
    expect(res.failures).toHaveLength(0);
    expect(res.snapshot.refreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('records per-source failures without aborting other sources', async () => {
    const usfs = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    const blm = vi.fn().mockResolvedValue(mkArcgisResp([
      { attributes: { OBJECTID: 'b1', FET_NAME: 'B', UNIT_NAME: 'BFO', LAT: 41, LONG: -111 } },
    ]));
    const osm = vi.fn().mockResolvedValue(mkOverpassResp([]));
    const res = await runDispersedRefresh({
      usfsFetcher: usfs as never,
      blmFetcher: blm as never,
      osmFetcher: osm as never,
    });
    expect(res.snapshot.spots).toHaveLength(1);
    expect(res.countsBySource.USFS).toBe(0);
    expect(res.countsBySource.BLM).toBe(1);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]!.source).toBe('USFS');
  });
});
