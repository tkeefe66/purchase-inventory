import { createHash } from 'node:crypto';
import type { MasterRow } from '../../lib/types.js';
import { itemId } from './types.js';

const HEADER = `=== ACTIVE OUTDOOR INVENTORY ===
Format: [id] | Year | [Brand] Item (Color, Size) | $price [Category/Sub-Category]
Note: Only items with status=active are shown. Non-active items (retired/returned/lost/broken/sold/donated) are out of view in this conversation.`;

export interface CompactView {
  text: string;
  hash: string;
}

export function serializeCompact(rows: readonly MasterRow[]): CompactView {
  const filtered = rows.filter((r) => r.domain === 'Outdoor' && r.status === 'active');
  const sorted = [...filtered].sort(compareForStableHash);
  const lines = sorted.map(formatRow);
  const body = lines.join('\n');
  const text = `${HEADER}\nTotal rows: ${sorted.length}\n\n${body}`;
  const hash = createHash('sha256').update(text).digest('hex');
  return { text, hash };
}

function compareForStableHash(a: MasterRow, b: MasterRow): number {
  const cat = a.category.localeCompare(b.category);
  if (cat !== 0) return cat;
  const yr = b.year.localeCompare(a.year);
  if (yr !== 0) return yr;
  return a.itemName.localeCompare(b.itemName);
}

function formatRow(row: MasterRow): string {
  const id = itemId(row);
  const brandPart = row.brand ? `${row.brand} ` : '';
  const colorSize = formatColorSize(row.color, row.size);
  const cat = row.subCategory ? `${row.category}/${row.subCategory}` : row.category;
  const price = formatPrice(row.price);
  return `[${id}] | ${row.year} | ${brandPart}${row.itemName}${colorSize} | $${price} [${cat}]`;
}

function formatColorSize(color: string, size: string): string {
  if (!color && !size) return '';
  if (color && size) return ` (${color}, ${size})`;
  return ` (${color || size})`;
}

function formatPrice(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}
