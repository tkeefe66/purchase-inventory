import { createHash } from 'node:crypto';
import type { MasterRow } from '../../lib/types.js';

/**
 * Stable 6-char base36 id derived from natural-key fields only.
 * Survives sheet refreshes and ignores cosmetic fields (reasoning, notes,
 * productUrl) so an admin edit to those does not change the agent's
 * reference to the item.
 */
export function itemId(row: Pick<MasterRow, 'year' | 'brand' | 'itemName' | 'color' | 'size' | 'orderId'>): string {
  const naturalKey = [row.year, row.brand, row.itemName, row.color, row.size, row.orderId].join('|');
  const hex = createHash('sha256').update(naturalKey).digest('hex');
  // 6 base36 chars from the first 32 bits of the hash.
  const n = parseInt(hex.slice(0, 8), 16);
  return n.toString(36).padStart(6, '0').slice(-6);
}
