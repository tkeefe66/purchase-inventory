import { describe, test, expect, vi } from 'vitest';
import { handleCampingCommand } from '../../../../apps/bot/commands/camping.js';
import type { Facility } from '../../../../lib/reccgov/types.js';

const f: Facility = {
  facilityId: 'F1', name: 'Maroon Bells Amphitheater', state: 'CO',
  parentUnit: 'White River National Forest', region: 'Western Slope',
  lat: 39, lng: -106, agency: 'USFS', useType: 'overnight',
  leadTimeDays: 180, specialReleaseDate: null, seasonStart: '05-15', seasonEnd: '10-15',
  feeUSD: 0, reservationType: 'reservation',
  tentEligibleSites: ['s1'], totalSites: 1, restrictions: [],
  amenities: [], hasRestrooms: false, reservationUrl: '', lastMetadataRefresh: '', active: true,
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    readIndex: vi.fn(async () => ({ facilities: [f] })),
    readTrips: vi.fn(async () => ({ trips: [] })),
    writeTrips: vi.fn(async () => undefined),
    readMutedIds: vi.fn(async () => [] as string[]),
    setMuted: vi.fn(async () => undefined),
    ...overrides,
  } as never;
}

describe('handleCampingCommand', () => {
  test('/watchlist lists active facilities grouped by parent', async () => {
    const out = await handleCampingCommand({ name: 'watchlist', args: '' }, makeDeps());
    expect(out).toContain('Maroon Bells');
    expect(out).toContain('White River');
  });

  test('/unwatch by facility name calls setMuted with the matching ID', async () => {
    const setMuted = vi.fn(async () => undefined);
    const out = await handleCampingCommand(
      { name: 'unwatch', args: 'maroon bells' },
      makeDeps({ setMuted }),
    );
    expect(setMuted).toHaveBeenCalledWith(['F1'], true);
    expect(out).toMatch(/Muted/i);
  });

  test('/plan-trip records the trip and computes the release date', async () => {
    const writeTrips = vi.fn(async () => undefined);
    const out = await handleCampingCommand(
      { name: 'plan-trip', args: 'maroon bells 2026-08-22' },
      makeDeps({ writeTrips }),
    );
    expect(writeTrips).toHaveBeenCalled();
    expect(out).toMatch(/Planned/i);
    expect(out).toMatch(/2026-02-23/);  // visit - 180 days
  });

  test('ambiguous facility name returns top matches', async () => {
    const out = await handleCampingCommand(
      { name: 'unwatch', args: 'national forest' },
      makeDeps({ readIndex: vi.fn(async () => ({ facilities: [f, { ...f, facilityId: 'F2', name: 'Some Other Site' }] })) }),
    );
    expect(out).toMatch(/multiple matches/i);
  });
});
