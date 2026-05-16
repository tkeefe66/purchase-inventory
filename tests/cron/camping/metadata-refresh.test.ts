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
      getCampgroundReleases: vi.fn(async () => ({ current_release: null, next_release: null })),
      getCampgroundRates: vi.fn(async () => ({ rates_list: [] })),
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

    // Optimization check: rates + releases NOT called for the soon-to-be-
    // deactivated RV-only facility (saves ~95% of public API calls on first
    // metadata-refresh pass).
    expect(client.getCampgroundRates).toHaveBeenCalledTimes(1);
    expect(client.getCampgroundReleases).toHaveBeenCalledTimes(1);
    expect(client.getCampgroundRates).toHaveBeenCalledWith('TENT');
  });

  test('populates bookingWindows + nextReleaseAtIso from public endpoints', async () => {
    const existing: CampingIndex = {
      facilities: [{ facilityId: 'CASCADE', name: 'Cascade', state: 'CO', parentUnit: '', region: null,
        lat: 0, lng: 0, agency: 'USFS', useType: 'overnight', leadTimeDays: 0,
        specialReleaseDate: null, seasonStart: null, seasonEnd: null, feeUSD: 0,
        reservationType: 'reservation', tentEligibleSites: [], totalSites: 0,
        restrictions: [], amenities: [], hasRestrooms: false, reservationUrl: '',
        lastMetadataRefresh: '', active: true }],
    };
    const client = {
      getFacility: vi.fn(async () => ({})),
      getFacilityCampsites: vi.fn(async () => [{ campsiteId: 'S1', campsiteType: 'TENT ONLY NONELECTRIC' }]),
      getCampgroundReleases: vi.fn(async () => ({
        current_release: { release_time: '2026-05-16T17:00:00-04:00', end: '2026-10-11T00:00:00Z' },
        next_release: { release_time: '2026-12-04T10:00:00-05:00', end: '2027-06-04T00:00:00Z' },
      })),
      getCampgroundRates: vi.fn(async () => ({
        rates_list: [
          { season_start: '2026-05-15T00:00:00Z', season_end: '2026-05-21T00:00:00Z', season_type: 'Walk In', season_description: '' },
          { season_start: '2026-05-22T00:00:00Z', season_end: '2026-09-21T00:00:00Z', season_type: 'Peak', season_description: '' },
        ],
      })),
    };
    const result = await runMetadataRefresh({ existingIndex: existing, client: client as never });
    const f = result.index.facilities[0]!;
    expect(f.nextReleaseAtIso).toBe('2026-05-16T17:00:00-04:00');
    expect(f.bookingWindows).toEqual({
      seasonOpenDate: '2026-05-15',
      fcfsStartDate: '2026-05-15',
      reservableStartDate: '2026-05-22',
      seasonCloseDate: '2026-09-21',
      nextSeasonStartDate: null,
    });
  });

  test('gracefully sets bookingWindows=null when the public rates endpoint throws', async () => {
    const existing: CampingIndex = {
      facilities: [{ facilityId: 'X', name: 'X', state: 'CO', parentUnit: '', region: null,
        lat: 0, lng: 0, agency: 'USFS', useType: 'overnight', leadTimeDays: 0,
        specialReleaseDate: null, seasonStart: null, seasonEnd: null, feeUSD: 0,
        reservationType: 'reservation', tentEligibleSites: [], totalSites: 0,
        restrictions: [], amenities: [], hasRestrooms: false, reservationUrl: '',
        lastMetadataRefresh: '', active: true }],
    };
    const client = {
      getFacility: vi.fn(async () => ({})),
      getFacilityCampsites: vi.fn(async () => [{ campsiteId: 'S1', campsiteType: 'TENT ONLY NONELECTRIC' }]),
      getCampgroundReleases: vi.fn(async () => { throw new Error('500'); }),
      getCampgroundRates: vi.fn(async () => { throw new Error('500'); }),
    };
    const result = await runMetadataRefresh({ existingIndex: existing, client: client as never });
    const f = result.index.facilities[0]!;
    expect(f.bookingWindows).toBeNull();
    expect(f.nextReleaseAtIso).toBeNull();
    expect(f.active).toBe(true); // not failed — main pipeline continued
  });

  test('falls back to DEFAULT_LEAD_TIME_DAYS (180) when index-refresh seeded leadTimeDays=0', async () => {
    // Regression: ?? operator short-circuits on 0, leaving leadTimeDays=0
    // which breaks every nudge calculation. Must use || here.
    const existing: CampingIndex = {
      facilities: [
        { facilityId: 'F1', name: 'X', state: 'CO', parentUnit: 'Y', region: null, lat: 0, lng: 0,
          agency: 'USFS', useType: 'overnight', leadTimeDays: 0, specialReleaseDate: null,
          seasonStart: null, seasonEnd: null, feeUSD: 0, reservationType: 'reservation',
          tentEligibleSites: [], totalSites: 0, restrictions: [], amenities: [], hasRestrooms: false,
          reservationUrl: '', lastMetadataRefresh: '', active: true },
      ],
    };
    const client = {
      getFacility: vi.fn(async () => ({ /* no leadTimeDays from RIDB */ })),
      getFacilityCampsites: vi.fn(async () => [{ campsiteId: 'S1', campsiteType: 'TENT ONLY NONELECTRIC' }]),
      getCampgroundReleases: vi.fn(async () => ({ current_release: null, next_release: null })),
      getCampgroundRates: vi.fn(async () => ({ rates_list: [] })),
    };
    const result = await runMetadataRefresh({ existingIndex: existing, client: client as never });
    expect(result.index.facilities[0]!.leadTimeDays).toBe(180);
  });

  test('falls back to DEFAULT_SEASON when RIDB returns no seasonStart/seasonEnd', async () => {
    // RIDB v1 reality: getFacility does NOT return season fields. Without
    // the seasonForFacility fallback, seasonStart stays null and T10's
    // 90-day season-opener nudge never fires.
    const existing: CampingIndex = {
      facilities: [
        { facilityId: 'NOSEASON', name: 'X', state: 'CO', parentUnit: 'Y', region: null, lat: 0, lng: 0,
          agency: 'USFS', useType: 'overnight', leadTimeDays: 0, specialReleaseDate: null,
          seasonStart: null, seasonEnd: null, feeUSD: 0, reservationType: 'reservation',
          tentEligibleSites: [], totalSites: 0, restrictions: [], amenities: [], hasRestrooms: false,
          reservationUrl: '', lastMetadataRefresh: '', active: true },
      ],
    };
    const client = {
      getFacility: vi.fn(async () => ({ /* no seasonStart, no seasonEnd */ })),
      getFacilityCampsites: vi.fn(async () => [
        { campsiteId: 'S1', campsiteType: 'TENT ONLY NONELECTRIC' },
      ]),
      getCampgroundReleases: vi.fn(async () => ({ current_release: null, next_release: null })),
      getCampgroundRates: vi.fn(async () => ({ rates_list: [] })),
    };

    const result = await runMetadataRefresh({ existingIndex: existing, client: client as never });
    const f = result.index.facilities[0]!;
    expect(f.seasonStart).toBe('05-15');
    expect(f.seasonEnd).toBe('10-15');
  });
});
