import type { CampingIndex, CampingTrips, Facility } from '../../../lib/reccgov/types.js';
import { buildBookingUrl } from '../../../lib/reccgov/deep-link.js';

export interface RunReleaseTickOpts {
  now: Date;
  index: CampingIndex;
  trips: CampingTrips;
  sendTelegram: (text: string) => Promise<void>;
}

export interface ReleaseTickResult {
  fired: number;
  trips: CampingTrips;
}

/**
 * Compute the release moment (UTC Date) for a trip on a given facility.
 * Rolling-release: 10pm MT the day before the release date (== midnight Eastern == 04:00 UTC during MDT, 05:00 UTC during MST).
 * Special release: 7am MT on specialReleaseDate.
 * We approximate: rolling = (visitDate - leadTimeDays) at 05:00 UTC; backstop window is ±5 min.
 */
function releaseAt(f: Facility, trip: { visitDate: string }): Date {
  if (f.specialReleaseDate) {
    // 7am MT on special release date — use 14:00 UTC (works for both DST and STD with 5-min tolerance).
    return new Date(`${f.specialReleaseDate}T14:00:00Z`);
  }
  // Rolling: midnight Eastern the day before booking-open.
  const releaseDate = new Date(`${trip.visitDate}T00:00:00Z`);
  releaseDate.setUTCDate(releaseDate.getUTCDate() - f.leadTimeDays);
  releaseDate.setUTCHours(5, 0, 0, 0); // 10pm MT prev day in MST window
  return releaseDate;
}

export async function runReleaseTick(opts: RunReleaseTickOpts): Promise<ReleaseTickResult> {
  const byId = new Map(opts.index.facilities.map((f) => [f.facilityId, f]));
  const nowMs = opts.now.getTime();
  let fired = 0;
  const updated: CampingTrips = { trips: opts.trips.trips.map((t) => ({ ...t, nudges: [...t.nudges] })) };
  for (const trip of updated.trips) {
    if (trip.cancelledAt) continue;
    const f = byId.get(trip.facilityId);
    if (!f) continue;
    const releaseNudge = trip.nudges.find((n) => n.kind === 'release-moment');
    if (!releaseNudge || releaseNudge.firedAt) continue;
    const releaseTime = releaseAt(f, trip).getTime();
    const diffMin = (nowMs - releaseTime) / 60000;
    // Fire if within [-1 min, +5 min] of release.
    if (diffMin >= -1 && diffMin <= 5) {
      const url = buildBookingUrl(f.facilityId, trip.visitDate);
      const link = url ?? f.reservationUrl ?? `https://www.recreation.gov/camping/campgrounds/${f.facilityId}`;
      await opts.sendTelegram(
        `🔔 ${f.name} booking JUST OPENED for ${trip.visitDate}. Tap to grab: ${link}`,
      );
      releaseNudge.firedAt = opts.now.toISOString();
      fired++;
    }
  }
  return { fired, trips: updated };
}
