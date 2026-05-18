import { describe, test, expect, vi } from 'vitest';
import {
  buildSearchNearbyQuery, buildLookupByNameQuery,
  computeLengthKm, mapOsmWay, searchTrailsNearby, lookupTrail,
  type OverpassWay,
} from '../../../../domains/outdoor/integrations/trails.js';

describe('buildSearchNearbyQuery', () => {
  test('hiking activity filters to sac_scale + named paths', () => {
    const q = buildSearchNearbyQuery({ lat: 39.5, lng: -106, radiusKm: 10, activity: 'hiking' });
    expect(q).toContain('sac_scale');
    expect(q).toContain('highway"="path"');
    expect(q).toContain('39.500000');
    expect(q).toContain('-106.000000');
    expect(q).toContain('around:10000');
  });
  test('mtb activity includes mtb:scale + bicycle yes', () => {
    const q = buildSearchNearbyQuery({ lat: 0, lng: 0, radiusKm: 5, activity: 'mtb' });
    expect(q).toContain('mtb:scale');
    expect(q).toContain('"bicycle"="yes"');
  });
  test('no activity returns generic hiking + mtb query', () => {
    const q = buildSearchNearbyQuery({ lat: 0, lng: 0, radiusKm: 5 });
    expect(q).toContain('highway"="path"');
    expect(q).toContain('mtb:scale');
  });
  test('out geom tags so we get full geometry + tags', () => {
    const q = buildSearchNearbyQuery({ lat: 0, lng: 0, radiusKm: 5 });
    expect(q).toContain('out geom tags');
  });
});

describe('buildLookupByNameQuery', () => {
  test('exact name match (uses Overpass name index, sub-second)', () => {
    const q = buildLookupByNameQuery('Manitou Incline', {});
    expect(q).toContain('"name"="Manitou Incline"');
    expect(q).toContain('"name:en"="Manitou Incline"');
  });
  test('optional center biases via around', () => {
    const q = buildLookupByNameQuery('Test', { lat: 38, lng: -105, radiusKm: 30 });
    expect(q).toContain('(around:30000,38.000000,-105.000000)');
  });
  test('defaults to CONUS bbox scope when no center provided', () => {
    const q = buildLookupByNameQuery('Test', {});
    expect(q).toContain('(24.0,-125.0,50.0,-66.0)');
  });
});

describe('computeLengthKm', () => {
  test('returns null on fewer than 2 points', () => {
    expect(computeLengthKm([])).toBeNull();
    expect(computeLengthKm([{ lat: 0, lon: 0 }])).toBeNull();
  });
  test('sums Haversine distances along the path', () => {
    // (39.5, -106) → (39.6, -106) is roughly 11.1 km of latitude.
    const km = computeLengthKm([
      { lat: 39.5, lon: -106 },
      { lat: 39.6, lon: -106 },
    ]);
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(10);
    expect(km!).toBeLessThan(12);
  });
});

describe('mapOsmWay', () => {
  test('maps a typical hiking path way', () => {
    const way: OverpassWay = {
      type: 'way', id: 12345,
      tags: { name: 'Bear Lake Trail', highway: 'path', sac_scale: 'T2', surface: 'dirt' },
      geometry: [
        { lat: 40.31, lon: -105.65 },
        { lat: 40.32, lon: -105.65 },
      ],
    };
    const t = mapOsmWay(way);
    expect(t).not.toBeNull();
    expect(t!.id).toBe('osm-way-12345');
    expect(t!.name).toBe('Bear Lake Trail');
    expect(t!.difficulty).toBe('T2');
    expect(t!.surface).toBe('dirt');
    expect(t!.activities).toContain('hiking');
    expect(t!.activities).toContain('trail-running');
    expect(t!.sourceUrl).toContain('openstreetmap.org/way/12345');
    expect(t!.lengthKm).toBeGreaterThan(0);
  });

  test('marks MTB activity from mtb:scale', () => {
    const way: OverpassWay = {
      type: 'way', id: 7, tags: { name: 'Picketwire Loop', 'mtb:scale': '3', highway: 'path' },
      geometry: [{ lat: 39, lon: -106 }, { lat: 39.001, lon: -106 }],
    };
    const t = mapOsmWay(way);
    expect(t!.activities).toContain('mtb');
    expect(t!.difficulty).toBe('3');
  });

  test('skips access=private', () => {
    const way: OverpassWay = {
      type: 'way', id: 1, tags: { name: 'Private Trail', highway: 'path', access: 'private' },
      geometry: [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }],
    };
    expect(mapOsmWay(way)).toBeNull();
  });

  test('skips unnamed ways', () => {
    const way: OverpassWay = {
      type: 'way', id: 1, tags: { highway: 'path' },
      geometry: [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }],
    };
    expect(mapOsmWay(way)).toBeNull();
  });

  test('skips ways without geometry', () => {
    const way: OverpassWay = {
      type: 'way', id: 1, tags: { name: 'X', highway: 'path' },
    };
    expect(mapOsmWay(way)).toBeNull();
  });
});

describe('searchTrailsNearby', () => {
  function mkResp(elements: object[]): Response {
    return new Response(JSON.stringify({ elements }), { status: 200 });
  }

  test('returns mapped + deduped trails sorted by distance', async () => {
    const elements = [
      { type: 'way', id: 1, tags: { name: 'Near', highway: 'path' },
        geometry: [{ lat: 39.50, lon: -106 }, { lat: 39.51, lon: -106 }] },
      { type: 'way', id: 2, tags: { name: 'Far', highway: 'path' },
        geometry: [{ lat: 39.80, lon: -106 }, { lat: 39.81, lon: -106 }] },
      { type: 'way', id: 1, tags: { name: 'Near', highway: 'path' },  // dupe
        geometry: [{ lat: 39.50, lon: -106 }, { lat: 39.51, lon: -106 }] },
    ];
    const fetcher = vi.fn().mockResolvedValue(mkResp(elements));
    const out = await searchTrailsNearby({
      lat: 39.5, lng: -106, radiusKm: 50, fetcher: fetcher as never,
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.name).toBe('Near');
    expect(out[1]!.name).toBe('Far');
  });

  test('caps results at 50', async () => {
    const elements = Array.from({ length: 100 }, (_, i) => ({
      type: 'way', id: i, tags: { name: `Trail ${i}`, highway: 'path' },
      geometry: [{ lat: 39 + i * 0.001, lon: -106 }, { lat: 39 + i * 0.001 + 0.001, lon: -106 }],
    }));
    const fetcher = vi.fn().mockResolvedValue(mkResp(elements));
    const out = await searchTrailsNearby({ lat: 39, lng: -106, radiusKm: 50, fetcher: fetcher as never });
    expect(out.length).toBeLessThanOrEqual(50);
  });

  test('throws on HTTP error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    await expect(searchTrailsNearby({
      lat: 0, lng: 0, radiusKm: 5, fetcher: fetcher as never,
    })).rejects.toThrow(/HTTP 429/);
  });

  test('throws on Overpass timeout remark', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      remark: 'query timed out after 30s', elements: [],
    }), { status: 200 }));
    await expect(searchTrailsNearby({
      lat: 0, lng: 0, radiusKm: 5, fetcher: fetcher as never,
    })).rejects.toThrow(/timed/);
  });
});

describe('lookupTrail (Nominatim + Overpass)', () => {
  test('returns trails matched by Nominatim then enriched via Overpass', async () => {
    // First call: Nominatim search
    const nominatimResp = [
      {
        osm_type: 'way', osm_id: 56228063, class: 'highway',
        lat: '38.8576', lon: '-104.9399', display_name: 'The Incline, Manitou Springs, CO',
      },
    ];
    // Second call: Overpass by ID
    const overpassResp = {
      elements: [
        { type: 'way', id: 56228063, tags: { name: 'The Incline', highway: 'steps' },
          geometry: [{ lat: 38.857, lon: -104.94 }, { lat: 38.858, lon: -104.93 }] },
      ],
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(nominatimResp), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(overpassResp), { status: 200 }));
    const out = await lookupTrail('Manitou Incline', { fetcher: fetcher as never });
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('The Incline');
    // Nominatim was hit first
    expect(fetcher.mock.calls[0]![0]).toMatch(/nominatim/);
    expect(fetcher.mock.calls[1]![0]).toMatch(/overpass/);
  });

  test('returns empty when Nominatim has no candidates', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const out = await lookupTrail('Nonexistent Trail', { fetcher: fetcher as never });
    expect(out).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);   // only Nominatim called
  });

  test('skips non-way / non-highway Nominatim results', async () => {
    const nominatimResp = [
      { osm_type: 'node', osm_id: 1, class: 'highway' },           // wrong type
      { osm_type: 'way', osm_id: 2, class: 'natural' },             // wrong class
      { osm_type: 'way', osm_id: 3, class: 'highway',
        lat: '38', lon: '-105', display_name: 'Good Trail' },       // ✓
    ];
    const overpassResp = { elements: [
      { type: 'way', id: 3, tags: { name: 'Good Trail', highway: 'path' },
        geometry: [{ lat: 38, lon: -105 }, { lat: 38.1, lon: -105 }] },
    ]};
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(nominatimResp), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(overpassResp), { status: 200 }));
    const out = await lookupTrail('Good Trail', { fetcher: fetcher as never });
    expect(out).toHaveLength(1);
  });
});

describe('searchTrailsNearby — quality filters', () => {
  test('drops trails under MIN_TRAIL_LENGTH_KM (0.5km)', async () => {
    const elements = [
      { type: 'way', id: 1, tags: { name: 'Tiny Path', highway: 'path' },
        geometry: [{ lat: 39.5, lon: -106 }, { lat: 39.5001, lon: -106 }] },   // ~11m
      { type: 'way', id: 2, tags: { name: 'Real Trail', highway: 'path' },
        geometry: [{ lat: 39.5, lon: -106 }, { lat: 39.51, lon: -106 }] },     // ~1.1km
    ];
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements }), { status: 200 }));
    const out = await searchTrailsNearby({ lat: 39.5, lng: -106, radiusKm: 50, fetcher: fetcher as never });
    expect(out.map((t) => t.name)).toEqual(['Real Trail']);
  });

  test('dedupes multi-segment OSM ways by name + sums their lengths', async () => {
    const elements = [
      { type: 'way', id: 1, tags: { name: 'Long Trail', highway: 'path' },
        geometry: [{ lat: 39.50, lon: -106 }, { lat: 39.51, lon: -106 }] },    // ~1.1km
      { type: 'way', id: 2, tags: { name: 'Long Trail', highway: 'path' },
        geometry: [{ lat: 39.51, lon: -106 }, { lat: 39.52, lon: -106 }] },    // ~1.1km
    ];
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements }), { status: 200 }));
    const out = await searchTrailsNearby({ lat: 39.5, lng: -106, radiusKm: 50, fetcher: fetcher as never });
    expect(out).toHaveLength(1);
    expect(out[0]!.lengthKm).toBeGreaterThan(2);  // segments summed
  });
});
