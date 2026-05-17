import { describe, test, expect, vi } from 'vitest';
import { runDispersedRefresh, parseEnabledSources } from '../../../apps/cron/camping/dispersed-refresh.js';
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

describe('parseEnabledSources', () => {
  test('defaults to USFS + BLM when env var is unset', () => {
    const out = parseEnabledSources(undefined);
    expect(out.has('USFS')).toBe(true);
    expect(out.has('BLM')).toBe(true);
    expect(out.has('OSM')).toBe(false);
  });
  test('parses a comma-separated list', () => {
    const out = parseEnabledSources('USFS,BLM,OSM');
    expect(out.size).toBe(3);
  });
  test('ignores whitespace and invalid tokens', () => {
    const out = parseEnabledSources('USFS, BLM , bogus, OSM');
    expect(out.has('USFS')).toBe(true);
    expect(out.has('BLM')).toBe(true);
    expect(out.has('OSM')).toBe(true);
    expect(out.size).toBe(3);
  });
  test('falls back to default when env var is all-invalid', () => {
    const out = parseEnabledSources('garbage,trash');
    expect(out.has('USFS')).toBe(true);
    expect(out.has('BLM')).toBe(true);
    expect(out.has('OSM')).toBe(false);
  });
});

describe('runDispersedRefresh', () => {
  test('merges spots from enabled sources (USFS + BLM default)', async () => {
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
      enabledSources: new Set(['USFS', 'BLM']),
    });
    expect(res.snapshot.spots).toHaveLength(2);
    expect(res.countsBySource).toEqual({ USFS: 1, BLM: 1, OSM: 0 });
    expect(osm).not.toHaveBeenCalled();
    expect(res.enabledSources.sort()).toEqual(['BLM', 'USFS']);
  });

  test('includes OSM when explicitly enabled', async () => {
    const usfs = vi.fn().mockResolvedValue(mkArcgisResp([]));
    const blm = vi.fn().mockResolvedValue(mkArcgisResp([]));
    const osm = vi.fn().mockResolvedValue(mkOverpassResp([
      { type: 'node', id: 99, lat: 42, lon: -112, tags: { name: 'C', tourism: 'camp_site' } },
    ]));
    const res = await runDispersedRefresh({
      usfsFetcher: usfs as never,
      blmFetcher: blm as never,
      osmFetcher: osm as never,
      enabledSources: new Set(['USFS', 'BLM', 'OSM']),
    });
    expect(res.snapshot.spots).toHaveLength(1);
    expect(osm).toHaveBeenCalled();
  });

  test('records per-source failures without aborting other sources', async () => {
    const usfs = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    const blm = vi.fn().mockResolvedValue(mkArcgisResp([
      { attributes: { OBJECTID: 'b1', FET_NAME: 'B', UNIT_NAME: 'BFO', LAT: 41, LONG: -111 } },
    ]));
    const res = await runDispersedRefresh({
      usfsFetcher: usfs as never,
      blmFetcher: blm as never,
      enabledSources: new Set(['USFS', 'BLM']),
    });
    expect(res.snapshot.spots).toHaveLength(1);
    expect(res.countsBySource.USFS).toBe(0);
    expect(res.countsBySource.BLM).toBe(1);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]!.source).toBe('USFS');
  });
});
