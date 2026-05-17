import { describe, test, expect, vi } from 'vitest';
import { buildBlmQueryUrl, mapBlmFeature, fetchBlmDispersed } from '../../../lib/dispersed/blm.js';

describe('buildBlmQueryUrl', () => {
  test('hits Layer 4 (Campsite - Primitive)', () => {
    const url = buildBlmQueryUrl(0);
    expect(url).toContain('/MapServer/4/query');
    expect(url).toContain('resultOffset=0');
  });
  test('Western US bbox by default', () => {
    const url = buildBlmQueryUrl(0);
    expect(url).toContain('geometryType=esriGeometryEnvelope');
    expect(url).toMatch(/geometry=-?\d+/);
  });
});

describe('mapBlmFeature', () => {
  test('maps a typical BLM primitive-camp feature', () => {
    const spot = mapBlmFeature({
      attributes: {
        OBJECTID: 12345,
        FET_NAME: 'Lower Dolores Dispersed',
        UNIT_NAME: 'Tres Rios Field Office',
        DESCRIPTION: 'Walk-in primitive camping along the Dolores River.',
        WEB_LINK: 'https://www.blm.gov/visit/lower-dolores',
        LAT: 38.1, LONG: -108.7, ADMIN_ST: 'CO',
      },
    });
    expect(spot).not.toBeNull();
    expect(spot!.source).toBe('BLM');
    expect(spot!.id).toBe('12345');
    expect(spot!.agency).toBe('BLM Tres Rios Field Office');
    expect(spot!.lat).toBe(38.1);
    expect(spot!.lng).toBe(-108.7);
    // WEB_LINK was provided, so use it verbatim
    expect(spot!.sourceUrl).toBe('https://www.blm.gov/visit/lower-dolores');
  });

  test('falls back to Google site-search URL when WEB_LINK missing', () => {
    const spot = mapBlmFeature({
      attributes: {
        OBJECTID: 1, FET_NAME: 'Miller Camp', UNIT_NAME: 'Tres Rios FO',
        LAT: 38, LONG: -108,
      },
    });
    expect(spot!.sourceUrl).toContain('google.com/search');
    expect(spot!.sourceUrl).toContain('blm.gov');
    expect(spot!.sourceUrl).toContain(encodeURIComponent('"Miller Camp"'));
  });
  test('falls back to "BLM" agency when UNIT_NAME missing', () => {
    const spot = mapBlmFeature({
      attributes: { OBJECTID: 1, FET_NAME: 'X', LAT: 40, LONG: -110 },
    });
    expect(spot!.agency).toBe('BLM');
  });
  test('falls back to geometry coords when LAT/LONG missing', () => {
    const spot = mapBlmFeature({
      attributes: { OBJECTID: 1, FET_NAME: 'X' },
      geometry: { x: -110, y: 40 },
    });
    expect(spot!.lng).toBe(-110);
    expect(spot!.lat).toBe(40);
  });
  test('returns null when no coordinates', () => {
    expect(mapBlmFeature({ attributes: { OBJECTID: 1, FET_NAME: 'X' } })).toBeNull();
  });
  test('returns null when OBJECTID missing', () => {
    expect(mapBlmFeature({ attributes: { FET_NAME: 'X', LAT: 40, LONG: -110 } })).toBeNull();
  });
  test('detects vault-toilet mention in description', () => {
    const spot = mapBlmFeature({
      attributes: {
        OBJECTID: 1, FET_NAME: 'X', LAT: 40, LONG: -110,
        DESCRIPTION: 'Has a vault toilet near the trailhead.',
      },
    });
    expect(spot!.hasRestrooms).toBe(true);
  });
});

describe('fetchBlmDispersed', () => {
  test('returns mapped spots from single-page response', async () => {
    const body = {
      features: [
        { attributes: { OBJECTID: 1, FET_NAME: 'A', UNIT_NAME: 'F1', LAT: 40, LONG: -110 } },
        { attributes: { OBJECTID: 2, FET_NAME: 'B', UNIT_NAME: 'F2', LAT: 41, LONG: -111 } },
      ],
      exceededTransferLimit: false,
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await fetchBlmDispersed({ fetcher: fetcher as never });
    expect(out).toHaveLength(2);
  });
  test('throws on HTTP error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(fetchBlmDispersed({ fetcher: fetcher as never })).rejects.toThrow(/HTTP 503/);
  });
});
