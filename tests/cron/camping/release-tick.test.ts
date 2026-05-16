import { describe, test, expect } from 'vitest';
import { runReleaseTick } from '../../../apps/cron/camping/release-tick.js';
import type { CampingIndex, CampingTrips, Facility } from '../../../lib/reccgov/types.js';

const f = (partial: Partial<Facility> = {}): Facility => ({
  facilityId: 'F1', name: 'Site', state: 'CO', parentUnit: 'X', region: null,
  lat: 0, lng: 0, agency: 'USFS', useType: 'overnight',
  leadTimeDays: 180, specialReleaseDate: null, seasonStart: null, seasonEnd: null,
  feeUSD: 0, reservationType: 'reservation',
  tentEligibleSites: ['s1'], totalSites: 1,
  restrictions: [], amenities: [], hasRestrooms: false,
  reservationUrl: '', lastMetadataRefresh: '', active: true,
  ...partial,
});

describe('runReleaseTick', () => {
  test('fires alert when now is within 1 minute of release time (10pm MT prev day for rolling-release)', async () => {
    const now = new Date('2026-02-23T05:00:00Z'); // 10pm MT prev day in MST
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: null }], cancelledAt: null,
    }] };
    const messages: string[] = [];
    const res = await runReleaseTick({
      now, index: { facilities: [f()] }, trips,
      sendTelegram: async (text: string) => { messages.push(text); },
    });
    expect(res.fired).toBe(1);
    expect(messages[0]).toContain('https://www.recreation.gov/camping/campgrounds/F1');
  });

  test('does not re-fire when already fired', async () => {
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: '2026-02-23T05:00:00Z' }], cancelledAt: null,
    }] };
    const res = await runReleaseTick({
      now: new Date('2026-02-23T05:00:00Z'),
      index: { facilities: [f()] }, trips,
      sendTelegram: async () => {},
    });
    expect(res.fired).toBe(0);
  });

  test('T+5 minute backstop still fires if missed', async () => {
    // releaseAt: 2026-02-23T05:00:00Z. Now is T+4 min.
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: null }], cancelledAt: null,
    }] };
    const res = await runReleaseTick({
      now: new Date('2026-02-23T05:04:00Z'),
      index: { facilities: [f()] }, trips,
      sendTelegram: async () => {},
    });
    expect(res.fired).toBe(1);
  });

  test('does NOT fire when more than 5 minutes after release window', async () => {
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: null }], cancelledAt: null,
    }] };
    const res = await runReleaseTick({
      now: new Date('2026-02-23T05:30:00Z'),
      index: { facilities: [f()] }, trips,
      sendTelegram: async () => {},
    });
    expect(res.fired).toBe(0);
  });

  test('uses nextReleaseAtIso time-of-day for precise release timing when available', async () => {
    // CASCADE-style: API says daily release fires at 17:00 EDT (= 21:00 UTC).
    // Visit Aug 22, leadTime 180 → release calendar date Feb 23. With API time
    // applied, the precise release moment is 2026-02-23T21:00:00Z.
    const facility = f({ nextReleaseAtIso: '2026-05-16T17:00:00-04:00' });
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: null }], cancelledAt: null,
    }] };

    // Now = 2026-02-23T21:00:00Z (exact API release moment) → should fire
    const fires = await runReleaseTick({
      now: new Date('2026-02-23T21:00:00Z'),
      index: { facilities: [facility] }, trips,
      sendTelegram: async () => {},
    });
    expect(fires.fired).toBe(1);

    // Now = 2026-02-23T05:00:00Z (old 5am UTC approximation) → should NOT fire
    // because the precise release happens 16 hours later
    const noFire = await runReleaseTick({
      now: new Date('2026-02-23T05:00:00Z'),
      index: { facilities: [facility] }, trips: { trips: [{
        id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
        plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: null }], cancelledAt: null,
      }] },
      sendTelegram: async () => {},
    });
    expect(noFire.fired).toBe(0);
  });

  test('falls back to 5am UTC approximation when nextReleaseAtIso is absent (pre-Tier-3 facilities)', async () => {
    const facility = f(); // omits nextReleaseAtIso entirely
    const trips: CampingTrips = { trips: [{
      id: 't1', facilityId: 'F1', visitDate: '2026-08-22',
      plannedAt: '', nudges: [{ kind: 'release-moment', firedAt: null }], cancelledAt: null,
    }] };
    const res = await runReleaseTick({
      now: new Date('2026-02-23T05:00:00Z'),
      index: { facilities: [facility] }, trips,
      sendTelegram: async () => {},
    });
    expect(res.fired).toBe(1);
  });
});
