import { formatInTimeZone } from 'date-fns-tz';
import type { Facility } from './types.js';

/**
 * Season-window data layer for Rec.gov facilities.
 *
 * Why this file exists: RIDB v1 does NOT expose seasonStart / seasonEnd as
 * structured fields, so T9's metadata-refresh can never populate them from
 * the API. Without a non-null seasonStart, nextSeasonOpenDate returns null
 * and the 90-day season-opener nudge never fires.
 *
 * Strategy: layered defaults.
 *   1. If a facility appears in FACILITY_SEASON_OVERRIDES, use that window.
 *   2. Otherwise use DEFAULT_SEASON.
 *
 * Both are MM-DD strings (no year), matching the existing Facility schema.
 *
 * DEFAULT_SEASON is tuned for CO USFS rolling-release campgrounds — most
 * open around mid-May and close around mid-October. Refine on a per-site
 * basis by adding entries below.
 */

const TZ = 'America/Denver';

export interface SeasonWindow {
  seasonStart: string;
  seasonEnd: string;
}

export const DEFAULT_SEASON: SeasonWindow = {
  seasonStart: '05-15',
  seasonEnd: '10-15',
};

/**
 * Default rolling-release booking window for USFS campgrounds.
 *
 * Rec.gov's RIDB v1 does NOT expose this as a structured field. Most USFS
 * rolling-release sites use 6 months (180 days), which is the standard
 * advance-booking window. Special-release sites (like Maroon Bells) use a
 * specialReleaseDate instead.
 */
export const DEFAULT_LEAD_TIME_DAYS = 180;

export const FACILITY_SEASON_OVERRIDES: Record<string, SeasonWindow> = {
  // Add high-priority sites here as you learn their actual open/close dates.
  // Example:
  // '231959': { seasonStart: '05-22', seasonEnd: '10-09' },  // Maroon Bells Amphitheater
};

export function seasonForFacility(facilityId: string): SeasonWindow {
  return FACILITY_SEASON_OVERRIDES[facilityId] ?? DEFAULT_SEASON;
}

export function todayMtDateString(now: Date): string {
  return formatInTimeZone(now, TZ, 'yyyy-MM-dd');
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * For a facility with rolling release, compute the next "season open" date —
 * the first day each year that any season-date becomes bookable. Equals
 * (nextSeasonStart - leadTimeDays). For special-release facilities, returns
 * the specialReleaseDate directly if it's still in the future.
 */
export function nextSeasonOpenDate(
  f: Pick<Facility, 'specialReleaseDate' | 'seasonStart' | 'leadTimeDays'>,
  todayMt: string,
): string | null {
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

/**
 * The date the 90-day season-opener nudge will fire for this facility.
 * Equals nextSeasonOpenDate − 90 days. Returns null when no future open
 * date is known (no seasonStart and no specialReleaseDate, or special
 * release already past).
 */
export function nextReminderDate(
  f: Pick<Facility, 'specialReleaseDate' | 'seasonStart' | 'leadTimeDays'>,
  todayMt: string,
): string | null {
  const open = nextSeasonOpenDate(f, todayMt);
  return open ? addDays(open, -90) : null;
}
