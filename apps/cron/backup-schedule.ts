import { formatInTimeZone } from 'date-fns-tz';

/**
 * Daily sheet-backup tick — fires at 03:00 Mountain every day. Single-hour
 * window keeps the hourly cron from re-running the backup all day.
 * Extracted to its own file so tests can import without triggering the
 * cron's main() side effect at module load.
 */
export function shouldRunDailyBackup(now: Date): boolean {
  const tz = process.env['TZ'] ?? 'America/Denver';
  const hour = parseInt(formatInTimeZone(now, tz, 'H'), 10);
  return hour === 3;
}
