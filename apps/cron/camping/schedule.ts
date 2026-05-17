import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/Denver';

function mt(now: Date, fmt: string): string {
  return formatInTimeZone(now, TZ, fmt);
}

export function shouldRunIndexRefresh(now: Date): boolean {
  return mt(now, 'EEEE') === 'Sunday' && mt(now, 'H') === '4' && mt(now, 'm') === '0';
}

export function shouldRunMetadataRefresh(now: Date): boolean {
  return mt(now, 'd') === '1' && mt(now, 'H') === '4' && mt(now, 'm') === '0';
}

export function shouldRunNudgeTick(now: Date): boolean {
  return mt(now, 'H') === '7' && mt(now, 'm') === '0';
}

export function shouldCheckReleaseTick(_now: Date): boolean {
  return true;  // gated internally by checking camping-trips.json
}

/**
 * Weekly Sunday at 5:00 AM Mountain — one hour after index-refresh (4am)
 * so the two big network-heavy tasks don't pile up on the same minute and
 * trip Telegram rate limits if something fails.
 */
export function shouldRunDispersedRefresh(now: Date): boolean {
  return mt(now, 'EEEE') === 'Sunday' && mt(now, 'H') === '5' && mt(now, 'm') === '0';
}
