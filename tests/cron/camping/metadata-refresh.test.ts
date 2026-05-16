import { describe, test, expect, vi } from 'vitest';
import { runMetadataRefresh } from '../../../apps/cron/camping/metadata-refresh.js';
import type { CampingIndex } from '../../../lib/reccgov/types.js';

describe('runMetadataRefresh', () => {
  test('fills in metadata + tent-eligible filter; deactivates RV-only facilities', async () => {
    const existing: CampingIndex = {
      facilities: [
        { facilityId: 'TENT', name: 'A', state: 'CO', parentUnit: 'X', region: null, lat: 0, lng: 0,
          agency: 'USFS', useType: 'overnight', leadTimeDays: 0, specialReleaseDate: null,
          seasonStart: null, seasonEnd: null, feeUSD: 0, reservationType: 'reservation',
          tentEligibleSites: [], totalSites: 0, restrictions: [], amenities: [], hasRestrooms: false,
          reservationUrl: '', lastMetadataRefresh: '', active: true },
        { facilityId: 'RV', name: 'B', state: 'CO', parentUnit: 'X', region: null, lat: 0, lng: 0,
          agency: 'USFS', useType: 'overnight', leadTimeDays: 0, specialReleaseDate: null,
          seasonStart: null, seasonEnd: null, feeUSD: 0, reservationType: 'reservation',
          tentEligibleSites: [], totalSites: 0, restrictions: [], amenities: [], hasRestrooms: false,
          reservationUrl: '', lastMetadataRefresh: '', active: true },
      ],
    };
    const client = {
      getFacility: vi.fn(async (id: string) => ({
        leadTimeDays: 180, seasonStart: '05-15', seasonEnd: '10-15',
        feeUSD: id === 'TENT' ? 0 : 25, reservationType: 'reservation' as const,
        amenities: id === 'TENT' ? ['Vault Toilets', 'Picnic Tables'] : ['Dump Station'],
        restrictions: [], reservationUrl: `https://recreation.gov/${id}`,
      })),
      getFacilityCampsites: vi.fn(async (id: string) =>
        id === 'TENT'
          ? [{ campsiteId: 'S1', campsiteType: 'TENT ONLY NONELECTRIC' }, { campsiteId: 'S2', campsiteType: 'STANDARD NONELECTRIC' }]
          : [{ campsiteId: 'R1', campsiteType: 'RV ELECTRIC' }],
      ),
    };

    const result = await runMetadataRefresh({ existingIndex: existing, client: client as never });

    const tent = result.index.facilities.find((f) => f.facilityId === 'TENT')!;
    const rv = result.index.facilities.find((f) => f.facilityId === 'RV')!;
    expect(tent.tentEligibleSites).toEqual(['S1', 'S2']);
    expect(tent.active).toBe(true);
    expect(tent.hasRestrooms).toBe(true);
    expect(rv.tentEligibleSites).toEqual([]);
    expect(rv.active).toBe(false);
    expect(result.deactivated).toBe(1);
  });
});
