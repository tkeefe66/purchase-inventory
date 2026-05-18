import { formatInTimeZone } from 'date-fns-tz';

/**
 * Monthly gear-maintenance nudge — fires on the 1st of every month at 9 AM
 * Mountain. Single-hour window keeps the hourly cron from re-sending all
 * day. Extracted to its own file so tests can import without triggering
 * the cron's main() side effect at module load.
 */
export function shouldRunMaintenanceNudge(now: Date): boolean {
  const tz = process.env.TZ ?? 'America/Denver';
  const day = formatInTimeZone(now, tz, 'd');
  const hour = formatInTimeZone(now, tz, 'H');
  return day === '1' && hour === '9';
}
