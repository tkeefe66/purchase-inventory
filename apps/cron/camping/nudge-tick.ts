import type { CampingIndex, CampingTrips } from '../../../lib/reccgov/types.js';
import { addDays, nextSeasonOpenDate, todayMtDateString } from '../../../lib/reccgov/seasons.js';

export interface RunNudgeTickOpts {
  now: Date;
  index: CampingIndex;
  trips: CampingTrips;
  mutedFacilityIds: string[];
  sendTelegram: (text: string) => Promise<void>;
}

export interface NudgeTickResult {
  seasonOpenerFired: number;
  sevenDayFired: number;
  trips: CampingTrips;
}

export async function runNudgeTick(opts: RunNudgeTickOpts): Promise<NudgeTickResult> {
  const todayMt = todayMtDateString(opts.now);
  const muted = new Set(opts.mutedFacilityIds);
  const facilitiesById = new Map(opts.index.facilities.map((f) => [f.facilityId, f]));

  let seasonOpenerFired = 0;
  const seasonHits: string[] = [];
  for (const f of opts.index.facilities) {
    if (!f.active || muted.has(f.facilityId)) continue;
    const seasonOpen = nextSeasonOpenDate(f, todayMt);
    if (!seasonOpen) continue;
    const ninetyOut = addDays(todayMt, 90);
    if (seasonOpen === ninetyOut) {
      seasonHits.push(`• ${f.name} (${f.parentUnit}) — booking opens ${seasonOpen}`);
      seasonOpenerFired++;
    }
  }
  if (seasonHits.length > 0) {
    const msg = [`🗓️ Camping season opens in 90 days for ${seasonHits.length} site(s):`, ...seasonHits].join('\n');
    await opts.sendTelegram(msg);
  }

  let sevenDayFired = 0;
  const updatedTrips: CampingTrips = { trips: opts.trips.trips.map((t) => ({ ...t, nudges: [...t.nudges] })) };
  for (const trip of updatedTrips.trips) {
    if (trip.cancelledAt) continue;
    const f = facilitiesById.get(trip.facilityId);
    if (!f) continue;
    const releaseDate = addDays(trip.visitDate, -f.leadTimeDays);
    const sevenOut = addDays(todayMt, 7);
    if (releaseDate === sevenOut) {
      const existing = trip.nudges.find((n) => n.kind === '7-day');
      if (!existing || existing.firedAt === null) {
        await opts.sendTelegram(
          `⏰ 7-day heads up: ${f.name} booking for ${trip.visitDate} opens in 7 days (${releaseDate}).`,
        );
        const nudge = existing ?? { kind: '7-day' as const, firedAt: null };
        nudge.firedAt = opts.now.toISOString();
        if (!existing) trip.nudges.push(nudge);
        sevenDayFired++;
      }
    }
  }

  return { seasonOpenerFired, sevenDayFired, trips: updatedTrips };
}
