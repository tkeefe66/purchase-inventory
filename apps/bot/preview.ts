import type { MasterRow } from '../../lib/types.js';

const DASH = '—';

/**
 * Build the labeled "About to log" preview shared by /addgear and /log.
 * Each field is one line, `Label: Value` — the labels match the keys the
 * user types for 'field: value' corrections, so the preview doubles as a
 * cheat-sheet for the edit syntax.
 */
export function formatLogPreview(row: MasterRow): string {
  return [
    `About to log:`,
    `Item: ${row.itemName || DASH}`,
    `Brand: ${row.brand || DASH}`,
    `Color: ${row.color || DASH}`,
    `Size: ${row.size || DASH}`,
    `Price: $${row.price}`,
    `Date: ${row.date || DASH}`,
    `Source: ${row.source}`,
    `Category: ${row.category || DASH}`,
    `Sub-Category: ${row.subCategory || DASH}`,
    `Domain: ${row.domain || DASH}`,
    `Type: ${row.type || DASH}`,
    `URL: ${row.productUrl || DASH}`,
  ].join('\n');
}
