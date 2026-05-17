import { describe, test, expect, vi } from 'vitest';
import { buildUsfsQueryUrl, mapUsfsFeature, fetchUsfsDispersed } from '../../../lib/dispersed/usfs.js';

describe('buildUsfsQueryUrl', () => {
  test('filters to dispersed camping and Western US bbox by default', () => {
    const url = buildUsfsQueryUrl(0);
    expect(url).toContain("markeractivity%3D%27Dispersed+Camping%27");
    expect(url).toContain('resultOffset=0');
    expect(url).toContain('outSR=4326');
    expect(url).toContain('geometryType=esriGeometryEnvelope');
    expect(url).toMatch(/geometry=-?\d+/);
  });
  test('paginates via resultOffset', () => {
    const url = buildUsfsQueryUrl(2000);
    expect(url).toContain('resultOffset=2000');
  });
});

describe('mapUsfsFeature', () => {
  test('maps a typical feature to DispersedSpot', () => {
    const spot = mapUsfsFeature({
      attributes: {
        recareaid: 71338,
        recareaname: 'Red Tail Rim Trail North Trailhead',
        forestname: 'Modoc National Forest',
        recareadescription: 'Walk-in tent sites with vault toilets nearby.',
        recareaurl: 'https://www.fs.usda.gov/recarea/modoc/71338',
        longitude: -120.5,
        latitude: 41.6,
        markeractivity: 'Dispersed Camping',
      },
    });
    expect(spot).not.toBeNull();
    expect(spot!.source).toBe('USFS');
    expect(spot!.id).toBe('71338');
    expect(spot!.name).toBe('Red Tail Rim Trail North Trailhead');
    expect(spot!.agency).toBe('Modoc National Forest');
    expect(spot!.lat).toBe(41.6);
    expect(spot!.lng).toBe(-120.5);
    expect(spot!.hasRestrooms).toBe(true);
    expect(spot!.sourceUrl).toContain('fs.usda.gov');
  });
  test('parses string lat/lng (USFS returns them as strings, not numbers)', () => {
    const spot = mapUsfsFeature({
      attributes: {
        recareaid: 44076, recareaname: 'Trout Lakes', forestname: 'Carson NF',
        recareadescription: '', longitude: '-106.373800', latitude: '36.604300',
      },
    });
    expect(spot).not.toBeNull();
    expect(spot!.lat).toBeCloseTo(36.6043, 4);
    expect(spot!.lng).toBeCloseTo(-106.3738, 4);
  });
  test('falls back to geometry x/y when attribute lat/lng missing', () => {
    const spot = mapUsfsFeature({
      attributes: { recareaid: 1, recareaname: 'X', forestname: 'Y', recareadescription: '' },
      geometry: { x: -110, y: 40 },
    });
    expect(spot!.lng).toBe(-110);
    expect(spot!.lat).toBe(40);
  });
  test('returns null when coords are missing', () => {
    const spot = mapUsfsFeature({ attributes: { recareaid: 1, recareaname: 'X' } });
    expect(spot).toBeNull();
  });
  test('returns null when recareaid is missing', () => {
    const spot = mapUsfsFeature({ attributes: { recareaname: 'X', longitude: -110, latitude: 40 } });
    expect(spot).toBeNull();
  });
});

describe('fetchUsfsDispersed', () => {
  test('returns mapped spots from a single-page response', async () => {
    const body = {
      features: [
        { attributes: { recareaid: 1, recareaname: 'A', forestname: 'F1', recareadescription: '', longitude: -110, latitude: 40 } },
        { attributes: { recareaid: 2, recareaname: 'B', forestname: 'F2', recareadescription: '', longitude: -111, latitude: 41 } },
      ],
      exceededTransferLimit: false,
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await fetchUsfsDispersed({ fetcher: fetcher as never });
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.id).sort()).toEqual(['1', '2']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('paginates until exceededTransferLimit clears', async () => {
    const page1 = { features: Array.from({ length: 2000 }, (_, i) => ({
      attributes: { recareaid: i, recareaname: `S${i}`, forestname: 'F', recareadescription: '', longitude: -110, latitude: 40 },
    })), exceededTransferLimit: true };
    const page2 = { features: [
      { attributes: { recareaid: 2000, recareaname: 'X', forestname: 'F', recareadescription: '', longitude: -110, latitude: 40 } },
    ], exceededTransferLimit: false };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));
    const out = await fetchUsfsDispersed({ fetcher: fetcher as never });
    expect(out).toHaveLength(2001);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('dedupes by recareaid across activity tags', async () => {
    const body = {
      features: [
        { attributes: { recareaid: 1, recareaname: 'A', forestname: 'F', recareadescription: '', longitude: -110, latitude: 40, markeractivity: 'Dispersed Camping' } },
        { attributes: { recareaid: 1, recareaname: 'A', forestname: 'F', recareadescription: '', longitude: -110, latitude: 40, markeractivity: 'Tent Camping' } },
      ],
      exceededTransferLimit: false,
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await fetchUsfsDispersed({ fetcher: fetcher as never });
    expect(out).toHaveLength(1);
  });

  test('throws on HTTP error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(fetchUsfsDispersed({ fetcher: fetcher as never })).rejects.toThrow(/HTTP 500/);
  });

  test('throws on ArcGIS error response', async () => {
    const body = { error: { message: 'Bad request' } };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(fetchUsfsDispersed({ fetcher: fetcher as never })).rejects.toThrow(/Bad request/);
  });
});
