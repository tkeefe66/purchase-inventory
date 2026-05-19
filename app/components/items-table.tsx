'use client';
import { useMemo, useRef, useState } from 'react';
import type { MasterRow, Status } from '../../lib/types.js';
import { STATUS_VALUES } from '../../lib/types.js';
import { useTableFilters } from '../lib/hooks/use-table-filters.js';
import { ColumnFilterPopover } from './column-filter-menu/popover.js';
import { TextFilter } from './column-filter-menu/text-filter.js';
import { EnumFilter } from './column-filter-menu/enum-filter.js';
import { DateFilterMenu } from './column-filter-menu/date-filter.js';
import { PriceFilter as PriceFilterMenu } from './column-filter-menu/price-filter.js';
import { ActiveFilterChip } from './filter-chip.js';
import { StatusPill } from './status-pill.js';

type SortKey = 'date' | 'brand' | 'itemName' | 'price' | 'category' | 'status';
type SortDir = 'asc' | 'desc';
type FilterKey = 'date' | 'brand' | 'itemName' | 'category' | 'subCategory' | 'price' | 'status';

export function ItemsTable({ rows }: { rows: MasterRow[] }) {
  const { state, setState, filtered, total } = useTableFilters(rows);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [openFilter, setOpenFilter] = useState<{ key: FilterKey; anchor: HTMLElement } | null>(null);

  const brands = useMemo(() => uniqueSorted(rows.map((r) => r.brand)), [rows]);
  const _items = useMemo(() => uniqueSorted(rows.map((r) => r.itemName)), [rows]);
  const categories = useMemo(() => uniqueSorted(rows.map((r) => r.category)), [rows]);
  const subCats = useMemo(() => uniqueSorted(rows.map((r) => r.subCategory)), [rows]);
  const years = useMemo(() => uniqueSorted(rows.map((r) => r.year)).sort((a, b) => b.localeCompare(a)), [rows]); // passed to DateFilterMenu for year preset chips

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'price': return (a.price - b.price) * dir;
        case 'date': return a.date.localeCompare(b.date) * dir;
        case 'brand': return a.brand.localeCompare(b.brand) * dir;
        case 'itemName': return a.itemName.localeCompare(b.itemName) * dir;
        case 'category': return a.category.localeCompare(b.category) * dir;
        case 'status': return a.status.localeCompare(b.status) * dir;
      }
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'price' || key === 'date' ? 'desc' : 'asc'); }
  }
  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  function clearAll() { setState({ ...state, q: '' }); }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search" placeholder="Search…"
          value={state.q}
          onChange={(e) => setState({ ...state, q: e.target.value })}
          className="w-44 rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-from"
        />
        {activeFilterChips(state, setState)}
        {/* AddFilterChip (column picker) deferred — column-header dropdowns are the v1 primary filter affordance */}
        <span className="ml-auto text-[11px] tabular-nums text-text-muted">{filtered.length} of {total}</span>
        {(state.status.length || state.brand.length || state.category.length || state.date || state.price) && (
          <button type="button" onClick={clearAll} className="text-[11px] text-text-muted hover:text-text-secondary">Clear all</button>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-card border border-border-subtle bg-bg-surface shadow-card md:block">
        <table className="min-w-full text-[13px]">
          <thead className="sticky top-0 bg-bg-surface-raised text-left text-text-muted">
            <tr>
              <Th onSort={() => toggleSort('date')} indicator={sortIndicator('date')} hasFilter={state.date !== undefined} onFilter={(el) => setOpenFilter({ key: 'date', anchor: el })}>Date</Th>
              <Th onSort={() => toggleSort('brand')} indicator={sortIndicator('brand')} hasFilter={state.brand.length > 0} onFilter={(el) => setOpenFilter({ key: 'brand', anchor: el })}>Brand</Th>
              <Th onSort={() => toggleSort('itemName')} indicator={sortIndicator('itemName')} hasFilter={state.subCategory.length > 0} onFilter={(el) => setOpenFilter({ key: 'subCategory', anchor: el })}>Item</Th>
              <Th onSort={() => toggleSort('category')} indicator={sortIndicator('category')} hasFilter={state.category.length > 0} onFilter={(el) => setOpenFilter({ key: 'category', anchor: el })}>Category</Th>
              <Th onSort={() => toggleSort('price')} indicator={sortIndicator('price')} hasFilter={state.price !== undefined} onFilter={(el) => setOpenFilter({ key: 'price', anchor: el })} className="text-right">Price</Th>
              <Th onSort={() => toggleSort('status')} indicator={sortIndicator('status')} hasFilter={state.status.length > 0} onFilter={(el) => setOpenFilter({ key: 'status', anchor: el })}>Status</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={`${r.orderId}-${r.itemName}-${i}`} className="border-t border-border-divider hover:bg-bg-surface-raised">
                <Td className="text-text-secondary">{shortDate(r.date)}</Td>
                <Td className="text-text-secondary">{r.brand}</Td>
                <Td>
                  <div className="font-medium text-text-primary">{r.productUrl ? (
                    <a href={r.productUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.itemName}</a>
                  ) : r.itemName}</div>
                  {r.subCategory && <div className="text-[11px] text-text-muted">{r.subCategory}</div>}
                </Td>
                <Td className="text-text-secondary">{r.category}</Td>
                <Td className="text-right tabular-nums text-text-primary">${r.price.toFixed(2)}</Td>
                <Td><StatusPill status={r.status as Status} /></Td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-text-muted">No matching items.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden">
        {sorted.length === 0 && <div className="rounded-card border border-border-subtle bg-bg-surface p-6 text-center text-text-muted">No matching items.</div>}
        {sorted.map((r, i) => (
          <a
            key={`${r.orderId}-${r.itemName}-${i}`}
            href={r.productUrl || '#'}
            target={r.productUrl ? '_blank' : undefined}
            rel="noopener noreferrer"
            className="mb-2 block rounded-card border border-border-divider bg-bg-surface p-3.5"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">{r.brand}</span>
              <span className="text-[14px] font-bold tabular-nums text-text-primary">${r.price.toFixed(0)}</span>
            </div>
            <div className="mt-1 text-[14px] font-medium leading-snug text-text-primary">{r.itemName}</div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
              <span>{r.category || r.subCategory}</span>
              <span>·</span>
              <span>{shortDate(r.date)}</span>
              {r.status !== 'active' && <StatusPill status={r.status as Status} />}
            </div>
          </a>
        ))}
      </div>

      <ColumnFilterPopover open={openFilter !== null} onClose={() => setOpenFilter(null)} anchor={openFilter?.anchor ?? null}>
        {openFilter?.key === 'date' && (
          <DateFilterMenu value={state.date} onChange={(d) => { setState({ ...state, date: d }); setOpenFilter(null); }} yearsInData={years} />
        )}
        {openFilter?.key === 'price' && (
          <PriceFilterMenu value={state.price} onChange={(p) => { setState({ ...state, price: p }); setOpenFilter(null); }} />
        )}
        {openFilter?.key === 'brand' && (
          <TextFilter label="Brand" selected={state.brand} options={brands} onChange={(v) => setState({ ...state, brand: v })} />
        )}
        {openFilter?.key === 'subCategory' && (
          <TextFilter label="Sub-category" selected={state.subCategory} options={subCats} onChange={(v) => setState({ ...state, subCategory: v })} />
        )}
        {openFilter?.key === 'category' && (
          <TextFilter label="Category" selected={state.category} options={categories} onChange={(v) => setState({ ...state, category: v })} />
        )}
        {openFilter?.key === 'status' && (
          <EnumFilter label="Status" selected={state.status} options={STATUS_VALUES} onChange={(v) => setState({ ...state, status: v })} />
        )}
      </ColumnFilterPopover>
    </div>
  );
}

function Th({
  children, onSort, indicator = '', hasFilter, onFilter, className = '',
}: {
  children: React.ReactNode;
  onSort: () => void;
  indicator?: string;
  hasFilter: boolean;
  onFilter: (anchor: HTMLElement) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <th className={`group px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${className}`}>
      <div ref={ref} className="flex items-center gap-1.5">
        <button type="button" onClick={onSort} className="hover:text-text-primary">{children}{indicator}</button>
        {hasFilter && <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-gradient shadow-accent-glow" />}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (ref.current) onFilter(ref.current); }}
          className="opacity-0 transition group-hover:opacity-100 hover:text-text-primary"
          aria-label="Filter column"
        >▾</button>
      </div>
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

function uniqueSorted(values: readonly string[]): string[] {
  const set = new Set<string>();
  for (const v of values) if (v) set.add(v);
  return Array.from(set).sort();
}

function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function activeFilterChips(state: ReturnType<typeof useTableFilters>['state'], setState: ReturnType<typeof useTableFilters>['setState']) {
  const chips: React.ReactNode[] = [];
  for (const s of state.status) {
    chips.push(<ActiveFilterChip key={`status-${s}`} label={`Status: ${s}`} onRemove={() => setState({ ...state, status: state.status.filter((x) => x !== s) })} />);
  }
  for (const b of state.brand) {
    chips.push(<ActiveFilterChip key={`brand-${b}`} label={`Brand: ${b}`} onRemove={() => setState({ ...state, brand: state.brand.filter((x) => x !== b) })} />);
  }
  for (const c of state.category) {
    chips.push(<ActiveFilterChip key={`cat-${c}`} label={`Category: ${c}`} onRemove={() => setState({ ...state, category: state.category.filter((x) => x !== c) })} />);
  }
  for (const sc of state.subCategory) {
    chips.push(<ActiveFilterChip key={`sub-${sc}`} label={`Sub: ${sc}`} onRemove={() => setState({ ...state, subCategory: state.subCategory.filter((x) => x !== sc) })} />);
  }
  if (state.date) {
    chips.push(<ActiveFilterChip key="date" label={`Date: ${dateLabel(state.date)}`} onRemove={() => setState({ ...state, date: undefined })} />);
  }
  if (state.price) {
    chips.push(<ActiveFilterChip key="price" label={`Price: ${priceLabel(state.price)}`} onRemove={() => setState({ ...state, price: undefined })} />);
  }
  return chips;
}

function dateLabel(d: NonNullable<ReturnType<typeof useTableFilters>['state']['date']>): string {
  switch (d.kind) {
    case 'preset': return d.value.replace(/-/g, ' ');
    case 'year': return String(d.value);
    case 'month': return `${d.year}-${String(d.month).padStart(2,'0')}`;
    case 'range': return `${d.start} → ${d.end}`;
  }
}

function priceLabel(p: NonNullable<ReturnType<typeof useTableFilters>['state']['price']>): string {
  switch (p.kind) {
    case 'gte': return `≥ $${p.value}`;
    case 'lte': return `≤ $${p.value}`;
    case 'range': return `$${p.min}–$${p.max}`;
  }
}
