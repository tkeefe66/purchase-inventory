import type { MasterRow } from '../../lib/types.js';
import { itemId } from '../../lib/itemId.js';

export function filterToActivePhotography(rows: readonly MasterRow[]): MasterRow[] {
  return rows.filter((r) => r.domain === 'Photography' && r.status === 'active');
}

export function getById(rows: readonly MasterRow[], id: string): MasterRow | null {
  return filterToActivePhotography(rows).find((r) => itemId(r) === id) ?? null;
}

export function findByFuzzyName(rows: readonly MasterRow[], query: string): MasterRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return filterToActivePhotography(rows).filter((r) => {
    const haystack = `${r.brand} ${r.itemName}`.toLowerCase();
    return haystack.includes(q);
  });
}
