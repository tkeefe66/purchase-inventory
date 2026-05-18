import type { SheetsClient } from '../../lib/sheets.js';
import type { MasterRow } from '../../lib/types.js';
import { evaluateInventory, mergeFindings, type MergedFinding } from '../../domains/outdoor/maintenance.js';
import { readActiveMaintenanceAcks } from '../../lib/sheets.js';

/**
 * Monthly gear-maintenance nudge. Pipeline:
 *
 *   1. evaluate active outdoor gear against the rule set
 *   2. merge multi-rule findings per item
 *   3. drop items with a recent ack (12mo window)
 *   4. cap to MAX_LINES (oldest first)
 *   5. format a Telegram message
 *
 * Returns a result the caller can use for logging / dry-run printing without
 * the side-effect of actually sending Telegram.
 */

const MAX_LINES = 10;
const ACK_WINDOW_DAYS = 365;

export interface MaintenanceNudgeOpts {
  sheets: SheetsClient;
  spreadsheetId: string;
  rows: readonly MasterRow[];
  now: Date;
}

export interface MaintenanceNudgeResult {
  /** All findings produced by the rules engine before suppression. */
  rawFindings: MergedFinding[];
  /** After suppressing acked items + capping to MAX_LINES. */
  surfaced: MergedFinding[];
  /** Item IDs we dropped because of an active ack. */
  suppressedItemIds: string[];
  /** The Telegram message body, or empty string when nothing to report. */
  message: string;
}

export async function runMaintenanceNudge(opts: MaintenanceNudgeOpts): Promise<MaintenanceNudgeResult> {
  const cutoff = new Date(opts.now.getTime() - ACK_WINDOW_DAYS * 86400 * 1000).toISOString();
  const acked = await readActiveMaintenanceAcks(opts.sheets, opts.spreadsheetId, cutoff);

  const findings = evaluateInventory({ rows: opts.rows, today: opts.now });
  const merged = mergeFindings(findings);

  const suppressedItemIds: string[] = [];
  const survivors: MergedFinding[] = [];
  for (const f of merged) {
    if (acked.has(f.itemId)) {
      suppressedItemIds.push(f.itemId);
    } else {
      survivors.push(f);
    }
  }

  const surfaced = survivors.slice(0, MAX_LINES);
  const message = surfaced.length === 0 ? '' : formatMessage(surfaced, survivors.length);

  return {
    rawFindings: merged,
    surfaced,
    suppressedItemIds,
    message,
  };
}

/**
 * Compact-table format chosen 2026-05-17. Single monospace block aligned
 * for readability; oldest-first; truncation note when over the cap.
 */
export function formatMessage(items: readonly MergedFinding[], totalCount: number): string {
  const lines: string[] = [];
  const header = `Monthly gear check (${totalCount} item${totalCount === 1 ? '' : 's'}):`;
  lines.push(header, '');

  // Compute column widths so the table aligns. Names get truncated at 28.
  const maxName = Math.min(28, Math.max(...items.map((i) => visualWidth(i.emoji + ' ' + truncate(`${i.brand} ${i.itemName}`.trim(), 28)))));
  for (const f of items) {
    const label = `${f.emoji} ${truncate(`${f.brand} ${f.itemName}`.trim(), 28)}`;
    const padded = label + ' '.repeat(Math.max(2, maxName - visualWidth(label) + 2));
    const age = `${formatAge(f.ageYears)}`.padEnd(5);
    lines.push(`${padded}${age} ${f.issue}`);
  }

  if (totalCount > items.length) {
    lines.push('', `…and ${totalCount - items.length} more (cap at ${MAX_LINES}).`);
  }
  lines.push('', `Reply /ack-maintenance <id> to silence an item for 12 months. IDs:`);
  for (const f of items) lines.push(`  ${f.emoji} ${truncate(`${f.brand} ${f.itemName}`.trim(), 28)} → ${f.itemId}`);

  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function visualWidth(s: string): number {
  // Emojis can render double-width on some clients; we account for them by
  // counting them as 2. Crude but sufficient for the small set we use.
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    w += cp > 0xFFFF ? 2 : 1;
  }
  return w;
}

function formatAge(years: number): string {
  if (years >= 10) return `${Math.round(years)}y`;
  // One decimal for sub-10y so "4.5y" reads naturally.
  const rounded = Math.round(years * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}y` : `${rounded.toFixed(1)}y`;
}
