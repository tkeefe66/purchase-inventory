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
 *
 * Preferred path: if `f.nextReleaseAtIso` is set (populated by metadata-refresh
 * from Rec.gov's /releases endpoint), use its time-of-day applied to
 * (visitDate − leadTimeDays). Precise per-facility release time.
 *
 * Fallback (pre-Tier-3 facilities): 5am UTC approximation (~10pm MT prev day)
 * for rolling releases, 14:00 UTC for special-release dates. ±5 min backstop
 * in runReleaseTick covers minor drift.
 */
function releaseAt(f: Facility, trip: { visitDate: string }): Date {
  if (f.specialReleaseDate) {
    if (f.nextReleaseAtIso) return new Date(f.nextReleaseAtIso);
    return new Date(`${f.specialReleaseDate}T14:00:00Z`);
  }
  const releaseDate = new Date(`${trip.visitDate}T00:00:00Z`);
  releaseDate.setUTCDate(releaseDate.getUTCDate() - f.leadTimeDays);
  if (f.nextReleaseAtIso) {
    const apiTime = new Date(f.nextReleaseAtIso);
    releaseDate.setUTCHours(apiTime.getUTCHours(), apiTime.getUTCMinutes(), apiTime.getUTCSeconds(), 0);
  } else {
    releaseDate.setUTCHours(5, 0, 0, 0);
  }
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
