import type { MasterRow } from '../../lib/types.js';
import { itemId } from './types.js';

export function filterToActiveOutdoor(rows: readonly MasterRow[]): MasterRow[] {
  return rows.filter((r) => r.domain === 'Outdoor' && r.status === 'active');
}

export function getById(rows: readonly MasterRow[], id: string): MasterRow | null {
  return filterToActiveOutdoor(rows).find((r) => itemId(r) === id) ?? null;
}

export function findByFuzzyName(rows: readonly MasterRow[], query: string): MasterRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return filterToActiveOutdoor(rows).filter((r) => {
    const haystack = `${r.brand} ${r.itemName}`.toLowerCase();
    return haystack.includes(q);
  });
}
