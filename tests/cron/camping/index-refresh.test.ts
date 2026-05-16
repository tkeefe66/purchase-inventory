import { describe, test, expect, vi } from 'vitest';
import { runIndexRefresh } from '../../../apps/cron/camping/index-refresh.js';
import type { Facility, CampingIndex } from '../../../lib/reccgov/types.js';

function makeFacility(partial: Partial<Facility>): Facility {
  return {
    facilityId: '',
    name: '',
    state: 'CO',
    parentUnit: '',
    region: null,
    lat: 0,
    lng: 0,
    agency: 'USFS',
    useType: 'overnight',
    leadTimeDays: 0,
    specialReleaseDate: null,
    seasonStart: null,
    seasonEnd: null,
    feeUSD: 0,
    reservationType: 'reservation',
    tentEligibleSites: [],
    totalSites: 0,
    restrictions: [],
    amenities: [],
    hasRestrooms: false,
    reservationUrl: '',
    lastMetadataRefresh: '',
    active: true,
    ...partial,
  };
}

describe('runIndexRefresh', () => {
  test('adds new facilities, deactivates vanished ones, preserves trip-relevant data', async () => {
    const existingIndex: CampingIndex = {
      facilities: [
        makeFacility({
          facilityId: 'OLD',
          name: 'Old CG',
          parentUnit: 'Old NF',
          active: true,
        }),
        makeFacility({
          facilityId: 'KEEP',
          name: 'Old name',
          parentUnit: 'Roosevelt National Forest',
          active: true,
        }),
      ],
    };

    const searchResults = [
      {
        facilityId: 'KEEP',
        name: 'New name',
        parentUnit: 'Roosevelt National Forest',
        lat: 40,
        lng: -105,
        state: 'CO',
        useType: 'overnight' as const,
      },
      {
        facilityId: 'NEW',
        name: 'New CG',
        parentUnit: 'San Juan National Forest',
        lat: 37,
        lng: -108,
        state: 'CO',
        useType: 'overnight' as const,
      },
    ];

    const client = { searchFacilities: vi.fn().mockResolvedValue(searchResults) };
    const mirror = vi.fn().mockResolvedValue(undefined);

    const result = await runIndexRefresh({
      existingIndex,
      client: client as never,
      mirror: mirror as never,
      sheetSpreadsheetId: 'sid',
      sheets: {} as never,
    });

    expect(result.added).toBe(1);
    expect(result.deactivated).toBe(1);

    const byId = new Map(result.index.facilities.map((f) => [f.facilityId, f]));

    expect(byId.get('OLD')!.active).toBe(false);
    expect(byId.get('KEEP')!.name).toBe('New name');
    expect(byId.get('KEEP')!.region).toBe('Front Range');
    expect(byId.get('NEW')!.region).toBe('San Juans');

    expect(mirror).toHaveBeenCalledOnce();
  });

  test('throws if Rec.gov returns 0 facilities while existing index is non-empty (data loss guard)', async () => {
    const existingIndex: CampingIndex = {
      facilities: [
        makeFacility({ facilityId: 'A', name: 'Camp A', active: true }),
      ],
    };
    const client = { searchFacilities: vi.fn().mockResolvedValue([]) };
    const mirror = vi.fn().mockResolvedValue(undefined);

    await expect(
      runIndexRefresh({
        existingIndex,
        client: client as never,
        mirror: mirror as never,
        sheetSpreadsheetId: 'sid',
        sheets: {} as never,
      })
    ).rejects.toThrow(/critical data loss guard/);
    expect(mirror).not.toHaveBeenCalled();
  });

  test('proceeds normally when existing index is empty (initial seed)', async () => {
    const existingIndex: CampingIndex = { facilities: [] };
    const searchResults = [
      { facilityId: 'A', name: 'Camp A', parentUnit: 'Roosevelt National Forest', lat: 40, lng: -105, state: 'CO', useType: 'overnight' as const },
    ];
    const client = { searchFacilities: vi.fn().mockResolvedValue(searchResults) };
    const mirror = vi.fn().mockResolvedValue(undefined);

    const result = await runIndexRefresh({
      existingIndex,
      client: client as never,
      mirror: mirror as never,
      sheetSpreadsheetId: 'sid',
      sheets: {} as never,
    });

    expect(result.added).toBe(1);
    expect(result.deactivated).toBe(0);
    expect(result.totalActive).toBe(1);
    expect(mirror).toHaveBeenCalledOnce();
  });
});
