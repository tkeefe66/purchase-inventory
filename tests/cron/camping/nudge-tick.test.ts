// tests/cron/camping/nudge-tick.test.ts
import { describe, test, expect, vi } from 'vitest';
import { runNudgeTick } from '../../../apps/cron/camping/nudge-tick.js';
import type { CampingIndex, CampingTrips, Facility } from '../../../lib/reccgov/types.js';

function f(partial: Partial<Facility>): Facility {
  return {
    facilityId: 'F', name: 'Site', state: 'CO', parentUnit: 'X', region: null,
    lat: 0, lng: 0, agency: 'USFS', useType: 'overnight',
    leadTimeDays: 180, specialReleaseDate: null, seasonStart: '05-15', seasonEnd: '10-15',
    feeUSD: 0, reservationType: 'reservation',
    tentEligibleSites: ['s1'], totalSites: 1,
    restrictions: [], amenities: [], hasRestrooms: false,
    reservationUrl: '', lastMetadataRefresh: '', active: true,
    ...partial,
  };
}

describe('runNudgeTick', () => {
  test('emits season-opener nudge when today === season-open-date - 90 days', async () => {
    // seasonStart 05-15, leadTimeDays 180 → calendar opens around 11-16. Nudge fires 3 months before.
    // For 2027 season: calendar opens 2026-11-16; nudge fires 2026-08-18.
    const today = new Date('2026-08-18T13:00:00Z');
    const index: CampingIndex = { facilities: [f({ facilityId: 'SEASON' })] };
    const trips: CampingTrips = { trips: [] };
    const messages: string[] = [];
    const res = await runNudgeTick({
      now: today, index, trips, mutedFacilityIds: [],
      sendTelegram: async (text: string) => { messages.push(text); },
    });
    expect(res.seasonOpenerFired).toBe(1);
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  test('emits 7-day trip-date nudge', async () => {
    // visitDate 2026-08-22, leadTimeDays 180 → releaseDate 2026-02-23. 7 days before = 2026-02-16.
    const today = new Date('2026-02-16T14:00:00Z');
    const index: CampingIndex = { facilities: [f({ facilityId: 'F1' })] };
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '2026-02-01T00:00:00Z',
      nudges: [{ kind: 'release-moment', firedAt: null }, { kind: '7-day', firedAt: null }],
      cancelledAt: null,
    }] };
    const messages: string[] = [];
    const res = await runNudgeTick({
      now: today, index, trips, mutedFacilityIds: [],
      sendTelegram: async (text: string) => { messages.push(text); },
    });
    expect(res.sevenDayFired).toBe(1);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const nudge = res.trips.trips[0]!.nudges.find((n) => n.kind === '7-day')!;
    expect(nudge.firedAt).not.toBeNull();
  });

  test('skips muted facilities', async () => {
    const today = new Date('2026-08-18T13:00:00Z');
    const index: CampingIndex = { facilities: [f({ facilityId: 'M1' })] };
    const res = await runNudgeTick({
      now: today, index, trips: { trips: [] }, mutedFacilityIds: ['M1'],
      sendTelegram: async () => {},
    });
    expect(res.seasonOpenerFired).toBe(0);
  });

  test('does not re-fire a 7-day nudge already fired', async () => {
    const today = new Date('2026-02-16T14:00:00Z');
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: '7-day', firedAt: '2026-02-16T14:00:00Z' }], cancelledAt: null,
    }] };
    const res = await runNudgeTick({
      now: today, index: { facilities: [f({ facilityId: 'F1' })] }, trips, mutedFacilityIds: [],
      sendTelegram: async () => {},
    });
    expect(res.sevenDayFired).toBe(0);
  });
});
