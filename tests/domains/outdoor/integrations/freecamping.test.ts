import { describe, test, expect } from 'vitest';
import { searchFreeCampsites } from '../../../../domains/outdoor/integrations/freecamping.js';
import type { CampingIndex, Facility } from '../../../../lib/reccgov/types.js';
import type { DispersedSnapshot } from '../../../../lib/dispersed/types.js';

const f = (p: Partial<Facility>): Facility => ({
  facilityId: 'F', name: 'X', state: 'CO', parentUnit: '', region: null,
  lat: 0, lng: 0, agency: 'USFS', useType: 'overnight',
  leadTimeDays: 180, specialReleaseDate: null, seasonStart: null, seasonEnd: null,
  feeUSD: 0, reservationType: 'reservation',
  tentEligibleSites: ['s1'], totalSites: 1, restrictions: [],
  amenities: ['Vault Toilets'], hasRestrooms: true,
  reservationUrl: '', lastMetadataRefresh: '', active: true, ...p,
});

describe('searchFreeCampsites', () => {
  const index: CampingIndex = {
    facilities: [
      f({ facilityId: 'A', name: 'Near tent', lat: 39.5, lng: -106.0, feeUSD: 0 }),
      f({ facilityId: 'B', name: 'Far tent', lat: 50.0, lng: -106.0, feeUSD: 0 }),
      f({ facilityId: 'C', name: 'Near paid', lat: 39.5, lng: -106.0, feeUSD: 25 }),
      f({ facilityId: 'D', name: 'RV-only', lat: 39.5, lng: -106.0, feeUSD: 0, tentEligibleSites: [], active: false }),
      f({ facilityId: 'E', name: 'Picnic', lat: 39.5, lng: -106.0, useType: 'day-use', tentEligibleSites: [] }),
    ],
  };
  const dispersed: DispersedSnapshot = {
    refreshedAt: '',
    spots: [{
      source: 'USFS', id: 'u1', name: 'Dispersed CG', lat: 39.5, lng: -106.0,
      description: '', agency: 'Modoc National Forest', amenities: [],
      hasRestrooms: false, sourceUrl: '', lastVerified: null,
    }],
  };

  test('returns near + free + tent-eligible facilities + dispersed spots, excludes paid/far/RV-only/picnic', () => {
    const out = searchFreeCampsites({
      lat: 39.5, lng: -106.0, radiusKm: 50, includeDayUse: false,
      index, dispersed,
    });
    const ids = out.map((r) => r.id);
    expect(ids).toContain('A');
    expect(ids).toContain('u1');
    expect(ids).not.toContain('B');
    expect(ids).not.toContain('C');
    expect(ids).not.toContain('D');
    expect(ids).not.toContain('E');
  });

  test('source field reflects origin (rec.gov vs USFS/BLM/OSM)', () => {
    const out = searchFreeCampsites({
      lat: 39.5, lng: -106.0, radiusKm: 50, includeDayUse: false,
      index, dispersed,
    });
    expect(out.find((r) => r.id === 'A')!.source).toBe('rec.gov');
    expect(out.find((r) => r.id === 'u1')!.source).toBe('USFS');
  });

  test('includeDayUse=true adds picnic areas', () => {
    const out = searchFreeCampsites({
      lat: 39.5, lng: -106.0, radiusKm: 50, includeDayUse: true,
      index, dispersed,
    });
    expect(out.map((r) => r.id)).toContain('E');
  });

  test('sorts by distance ascending and caps at 10', () => {
    const many: CampingIndex = {
      facilities: Array.from({ length: 15 }, (_, i) =>
        f({ facilityId: `F${i}`, name: `Site ${i}`, lat: 39.5 + i * 0.001, lng: -106.0, feeUSD: 0 })),
    };
    const out = searchFreeCampsites({
      lat: 39.5, lng: -106.0, radiusKm: 100, includeDayUse: false,
      index: many, dispersed: { refreshedAt: '', spots: [] },
    });
    expect(out).toHaveLength(10);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.distanceKm).toBeGreaterThanOrEqual(out[i - 1]!.distanceKm);
    }
  });
});
