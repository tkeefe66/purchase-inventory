import { describe, test, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCampingIndex, writeCampingIndex, readCampingTrips, writeCampingTrips } from '../../lib/campingState.js';
import type { CampingIndex, CampingTrips } from '../../lib/reccgov/types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'camping-')); });

describe('campingState', () => {
  test('readCampingIndex returns empty when file missing', async () => {
    const out = await readCampingIndex(join(dir, 'index.json'));
    expect(out).toEqual({ facilities: [] });
  });

  test('write then read round-trips', async () => {
    const idx: CampingIndex = {
      facilities: [{
        facilityId: '1', name: 'Test', state: 'CO', parentUnit: 'Test NF', region: null,
        lat: 39, lng: -106, agency: 'USFS', useType: 'overnight',
        leadTimeDays: 180, specialReleaseDate: null, seasonStart: null, seasonEnd: null,
        feeUSD: 0, reservationType: 'reservation',
        tentEligibleSites: [], totalSites: 0, restrictions: [],
        amenities: [], hasRestrooms: false,
        reservationUrl: '', lastMetadataRefresh: '', active: true,
      }],
    };
    await writeCampingIndex(join(dir, 'index.json'), idx);
    const out = await readCampingIndex(join(dir, 'index.json'));
    expect(out.facilities).toHaveLength(1);
    expect(out.facilities[0]!.facilityId).toBe('1');
  });

  test('campingTrips round-trip', async () => {
    const trips: CampingTrips = {
      trips: [{
        id: 'abc', facilityId: '1', visitDate: '2026-07-04',
        plannedAt: '2026-05-15T00:00:00Z', nudges: [], cancelledAt: null,
      }],
    };
    await writeCampingTrips(join(dir, 'trips.json'), trips);
    const out = await readCampingTrips(join(dir, 'trips.json'));
    expect(out.trips).toHaveLength(1);
  });
});
