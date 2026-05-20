'use client';
import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseFilterState, serializeFilterState, type FilterState } from '../filters.js';
import type { MasterRow } from '../../../lib/types.js';

export interface UseTableFilters {
  state: FilterState;
  setState: (next: FilterState) => void;
  filtered: MasterRow[];
  total: number;
}

export function useTableFilters(rows: MasterRow[]): UseTableFilters {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const state = useMemo(() => parseFilterState(new URLSearchParams(search.toString())), [search]);

  const setState = useCallback((next: FilterState) => {
    const params = serializeFilterState(next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname]);

  const filtered = useMemo(() => applyFilters(rows, state), [rows, state]);

  return { state, setState, filtered, total: rows.length };
}

function applyFilters(rows: MasterRow[], s: FilterState): MasterRow[] {
  const q = s.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (s.domain && r.domain.toLowerCase() !== s.domain.toLowerCase()) return false;
    if (s.status.length && !s.status.includes(r.status)) return false;
    if (s.brand.length && !s.brand.includes(r.brand)) return false;
    if (s.category.length && !s.category.includes(r.category)) return false;
    if (s.subCategory.length && !s.subCategory.includes(r.subCategory)) return false;
    if (s.type.length && !s.type.includes(r.type)) return false;
    if (s.year.length && !s.year.includes(r.year)) return false;
    if (s.color.length && !s.color.includes(r.color)) return false;
    if (s.size.length && !s.size.includes(r.size)) return false;
    if (s.source.length && !s.source.includes(r.source)) return false;
    if (s.entryMethod.length && !s.entryMethod.includes(r.entryMethod)) return false;
    if (s.date && !matchDate(r.date, s.date)) return false;
    if (s.price && !matchPrice(r.price, s.price)) return false;
    if (q && !`${r.brand} ${r.itemName} ${r.category} ${r.subCategory} ${r.notes}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function matchDate(rowDate: string, f: NonNullable<FilterState['date']>): boolean {
  // rowDate is YYYY-MM-DD. All ranges are inclusive.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rowDate);
  if (!ymd) return false;
  const y = Number(ymd[1]); const m = Number(ymd[2]); const d = Number(ymd[3]);
  const now = new Date();
  const todayIso = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const toIso = (dt: Date) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;

  switch (f.kind) {
    case 'year':
      return y === f.value;
    case 'month':
      return y === f.year && m === f.month;
    case 'range':
      return rowDate >= f.start && rowDate <= f.end;
    case 'preset': {
      const start = presetStart(f.value, now);
      return rowDate >= toIso(start) && rowDate <= todayIso;
    }
  }
}

function presetStart(p: 'last-30-days' | 'last-90-days' | 'ytd' | 'last-12-months', today: Date): Date {
  const d = new Date(today);
  switch (p) {
    case 'last-30-days': d.setUTCDate(d.getUTCDate() - 30); return d;
    case 'last-90-days': d.setUTCDate(d.getUTCDate() - 90); return d;
    case 'last-12-months': d.setUTCFullYear(d.getUTCFullYear() - 1); return d;
    case 'ytd': return new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  }
}

function matchPrice(price: number, f: NonNullable<FilterState['price']>): boolean {
  switch (f.kind) {
    case 'gte': return price >= f.value;
    case 'lte': return price <= f.value;
    case 'range': return price >= f.min && price <= f.max;
  }
}
