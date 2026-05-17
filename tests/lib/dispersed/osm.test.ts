import { describe, test, expect, vi } from 'vitest';
import { buildOverpassQuery, mapOsmElement, fetchOsmDispersed } from '../../../lib/dispersed/osm.js';

describe('buildOverpassQuery', () => {
  test('queries camp_site + camping=dispersed in given bbox', () => {
    const q = buildOverpassQuery();
    expect(q).toContain('"tourism"="camp_site"');
    expect(q).toContain('"camping"="dispersed"');
    expect(q).toContain('out center tags');
    expect(q).toContain('[out:json]');
  });
});

describe('mapOsmElement', () => {
  test('maps a node camp_site to a DispersedSpot', () => {
    const spot = mapOsmElement({
      type: 'node', id: 42, lat: 40.5, lon: -109.5,
      tags: { name: 'Foo Camp', tourism: 'camp_site', operator: 'BLM',
              toilets: 'yes', drinking_water: 'no', fee: 'no' },
    });
    expect(spot).not.toBeNull();
    expect(spot!.source).toBe('OSM');
    expect(spot!.id).toBe('osm-node-42');
    expect(spot!.name).toBe('Foo Camp');
    expect(spot!.agency).toBe('BLM');
    expect(spot!.lat).toBe(40.5);
    expect(spot!.lng).toBe(-109.5);
    expect(spot!.amenities).toContain('toilets');
    expect(spot!.hasRestrooms).toBe(true);
  });

  test('uses way center coordinates when present', () => {
    const spot = mapOsmElement({
      type: 'way', id: 99, center: { lat: 41, lon: -110 },
      tags: { name: 'X', tourism: 'camp_site' },
    });
    expect(spot!.lat).toBe(41);
    expect(spot!.lng).toBe(-110);
    expect(spot!.id).toBe('osm-way-99');
  });

  test('returns null on private-access pins', () => {
    expect(mapOsmElement({
      type: 'node', id: 1, lat: 40, lon: -110,
      tags: { name: 'Private', tourism: 'camp_site', access: 'private' },
    })).toBeNull();
  });

  test('returns null on fee=yes (Rec.gov covers paid sites)', () => {
    expect(mapOsmElement({
      type: 'node', id: 1, lat: 40, lon: -110,
      tags: { name: 'Paid', tourism: 'camp_site', fee: 'yes' },
    })).toBeNull();
  });

  test('returns null when coords missing', () => {
    expect(mapOsmElement({ type: 'node', id: 1, tags: { name: 'X' } })).toBeNull();
  });

  test('falls back to descriptive name on dispersed-only tags', () => {
    const spot = mapOsmElement({
      type: 'node', id: 1, lat: 40, lon: -110,
      tags: { camping: 'dispersed' },
    });
    expect(spot!.name).toBe('OSM Dispersed Site');
    expect(spot!.amenities).toContain('dispersed');
  });

  test('sourceUrl falls back to openstreetmap.org link when website missing', () => {
    const spot = mapOsmElement({
      type: 'node', id: 42, lat: 40, lon: -110,
      tags: { name: 'X', tourism: 'camp_site' },
    });
    expect(spot!.sourceUrl).toBe('https://www.openstreetmap.org/node/42');
  });

  test('uses check_date tag for lastVerified', () => {
    const spot = mapOsmElement({
      type: 'node', id: 1, lat: 40, lon: -110,
      tags: { name: 'X', tourism: 'camp_site', check_date: '2024-08-15' },
    });
    expect(spot!.lastVerified).toBe('2024-08-15');
  });
});

describe('fetchOsmDispersed', () => {
  test('POSTs to Overpass and returns mapped spots', async () => {
    const body = {
      elements: [
        { type: 'node', id: 1, lat: 40, lon: -110, tags: { name: 'A', tourism: 'camp_site' } },
        { type: 'way', id: 2, center: { lat: 41, lon: -111 }, tags: { name: 'B', camping: 'dispersed' } },
      ],
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await fetchOsmDispersed({ fetcher: fetcher as never });
    expect(out).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('overpass-api.de'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('throws on HTTP error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    await expect(fetchOsmDispersed({ fetcher: fetcher as never })).rejects.toThrow(/HTTP 429/);
  });

  test('throws on Overpass timeout remark (200 with degraded body)', async () => {
    const body = { remark: 'runtime error: query timed out after 60 seconds.', elements: [] };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(fetchOsmDispersed({ fetcher: fetcher as never })).rejects.toThrow(/timed/);
  });
});
