import { formatInTimeZone } from 'date-fns-tz';
import type { CronLogRow } from '../../lib/sheets.js';
import type { PipelineResult } from './pipeline.js';

const TZ = 'America/Denver';

/**
 * Aggregate today's Cron Log rows into the audible 7pm Mountain digest.
 * `totalRunsToday` is the count Telegram should reflect (e.g., 24 hourly
 * runs); it's passed explicitly so even a log-read failure produces a
 * useful "we ran N times" message.
 */
export function formatDailySummary(rows: readonly CronLogRow[], totalRunsToday: number): string {
  const totals = {
    itemsAdded: 0,
    returnsApplied: 0,
    messagesScanned: 0,
    errorsCount: 0,
    bySource: {} as Record<string, number>,
    byDomain: {} as Record<string, number>,
  };
  for (const r of rows) {
    totals.itemsAdded += r.itemsAdded;
    totals.returnsApplied += r.returnsApplied;
    totals.messagesScanned += r.messagesScanned;
    totals.errorsCount += r.errorsCount;
    for (const [k, v] of Object.entries(r.itemsBySource)) totals.bySource[k] = (totals.bySource[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.itemsByDomain)) totals.byDomain[k] = (totals.byDomain[k] ?? 0) + v;
  }

  const when = formatInTimeZone(new Date(), TZ, 'EEE MMM d');
  const lines: string[] = [`Daily inventory summary — ${when}`];

  if (totals.itemsAdded > 0) {
    lines.push(`✅ ${totals.itemsAdded} new item${totals.itemsAdded === 1 ? '' : 's'}`);
    const bySource = Object.entries(totals.bySource).map(([k, v]) => `${k}: ${v}`).join(', ');
    if (bySource) lines.push(`   ${bySource}`);
    const byDomain = Object.entries(totals.byDomain)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    if (byDomain) lines.push(`   Domains: ${byDomain}`);
  } else {
    lines.push(`📭 No new items today`);
  }

  if (totals.returnsApplied > 0) {
    lines.push(`↩️ ${totals.returnsApplied} return${totals.returnsApplied === 1 ? '' : 's'} applied`);
  }

  lines.push(
    `${totalRunsToday} runs, ${totals.messagesScanned} email${totals.messagesScanned === 1 ? '' : 's'} scanned`,
  );

  if (totals.errorsCount > 0) {
    lines.push(`(${totals.errorsCount} run${totals.errorsCount === 1 ? '' : 's'} had errors — alerted separately)`);
  }

  return lines.join('\n');
}

/**
 * Format an immediate audible alert when a single cron run hit errors.
 * Includes up to 5 errored messages; the rest are summarized.
 */
export function formatErrorAlert(result: PipelineResult): string {
  const lines: string[] = [];
  const when = formatInTimeZone(new Date(result.startedAt || new Date()), TZ, 'EEE MMM d h:mm a zzz');
  lines.push(`❌ Inventory cron error @ ${when}`);
  lines.push(`${result.errors.length} error${result.errors.length === 1 ? '' : 's'} on this run:`);
  for (const e of result.errors.slice(0, 5)) {
    lines.push(`   • ${e.subject.slice(0, 60)} — ${e.error.slice(0, 120)}`);
  }
  if (result.errors.length > 5) {
    lines.push(`   …and ${result.errors.length - 5} more`);
  }
  return lines.join('\n');
}

/**
 * Returns true if `now` falls within the 19:00 (7pm) hour in Mountain time.
 * DST-aware via date-fns-tz.
 */
export function shouldSendDailyDigestAt(now: Date): boolean {
  const hour = Number(formatInTimeZone(now, TZ, 'H'));
  return hour === 19;
}
