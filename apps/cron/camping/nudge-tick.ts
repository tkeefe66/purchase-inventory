// apps/cron/camping/nudge-tick.ts
import type { CampingIndex, CampingTrips, Facility } from '../../../lib/reccgov/types.js';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/Denver';

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

function todayMtDateString(now: Date): string {
  return formatInTimeZone(now, TZ, 'yyyy-MM-dd');
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * For a facility with rolling release, compute the next "season open" date — the
 * first day each year that any season-date becomes bookable. Equals (nextSeasonStart - leadTimeDays).
 * For special-release facilities, returns the specialReleaseDate directly.
 */
function nextSeasonOpenDate(f: Facility, todayMt: string): string | null {
  if (f.specialReleaseDate) {
    return f.specialReleaseDate >= todayMt ? f.specialReleaseDate : null;
  }
  if (!f.seasonStart) return null;
  const [yyyy] = todayMt.split('-');
  let year = Number(yyyy);
  for (let i = 0; i < 3; i++) {
    const seasonStart = `${year}-${f.seasonStart}`;
    const openDate = addDays(seasonStart, -f.leadTimeDays);
    if (openDate >= todayMt) return openDate;
    year++;
  }
  return null;
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
