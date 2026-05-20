'use client';
import { useMemo, useRef, useState } from 'react';
import type { MasterRow, Status } from '../../lib/types.js';
import { STATUS_VALUES, DOMAIN_VALUES, ITEM_TYPE_VALUES, ENTRY_METHOD_VALUES } from '../../lib/types.js';
import { useTableFilters } from '../lib/hooks/use-table-filters.js';
import { useColumnPrefs } from '../lib/hooks/use-column-prefs.js';
import { COLUMN_DEFS, type ColumnId } from '../lib/columns.js';
import { ColumnFilterPopover } from './column-filter-menu/popover.js';
import { TextFilter } from './column-filter-menu/text-filter.js';
import { EnumFilter } from './column-filter-menu/enum-filter.js';
import { DateFilterMenu } from './column-filter-menu/date-filter.js';
import { PriceFilter as PriceFilterMenu } from './column-filter-menu/price-filter.js';
import { ActiveFilterChip } from './filter-chip.js';
import { StatusPill } from './status-pill.js';
import { ColumnSettings } from './column-settings.js';
import { DetailPanel } from './detail-panel.js';

type SortDir = 'asc' | 'desc';
type FilterKey =
  | 'date' | 'brand' | 'category' | 'subCategory' | 'price' | 'status'
  | 'domain' | 'year' | 'type' | 'color' | 'size' | 'source' | 'entryMethod';

const FILTERABLE_COLUMNS: ReadonlySet<ColumnId> = new Set<ColumnId>([
  'date', 'brand', 'category', 'subCategory', 'price', 'status',
  'domain', 'year', 'type', 'color', 'size', 'source', 'entryMethod',
]);

export function ItemsTable({ rows }: { rows: MasterRow[] }) {
  const { state, setState, filtered, total } = useTableFilters(rows);
  const { prefs, setPrefs, reset: resetPrefs } = useColumnPrefs();
  const [sortKey, setSortKey] = useState<ColumnId>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [openFilter, setOpenFilter] = useState<{ key: FilterKey; anchor: HTMLElement } | null>(null);
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);

  const visibleColumns = useMemo(
    () => prefs.columns.filter((c) => c.visible).map((c) => c.id),
    [prefs.columns],
  );

  const brands = useMemo(() => uniqueSorted(rows.map((r) => r.brand)), [rows]);
  const categories = useMemo(() => uniqueSorted(rows.map((r) => r.category)), [rows]);
  const subCats = useMemo(() => uniqueSorted(rows.map((r) => r.subCategory)), [rows]);
  const years = useMemo(() => uniqueSorted(rows.map((r) => r.year)).sort((a, b) => b.localeCompare(a)), [rows]);
  const colors = useMemo(() => uniqueSorted(rows.map((r) => r.color)), [rows]);
  const sizes = useMemo(() => uniqueSorted(rows.map((r) => r.size)), [rows]);
  const sources = useMemo(() => uniqueSorted(rows.map((r) => r.source)), [rows]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const def = COLUMN_DEFS[sortKey];
      const av = def.accessor(a);
      const bv = def.accessor(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const openRow = useMemo(() => sorted.find((r, i) => rowKey(r, i) === openRowKey) ?? null, [sorted, openRowKey]);

  function toggleSort(key: ColumnId) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'price' || key === 'date' ? 'desc' : 'asc'); }
  }
  function sortState(key: ColumnId): 'asc' | 'desc' | 'none' {
    return sortKey === key ? sortDir : 'none';
  }

  function filterKeyForColumn(id: ColumnId): FilterKey | null {
    return FILTERABLE_COLUMNS.has(id) ? (id as FilterKey) : null;
  }

  function hasFilterFor(id: ColumnId): boolean {
    switch (id) {
      case 'date': return state.date !== undefined;
      case 'price': return state.price !== undefined;
      case 'brand': return state.brand.length > 0;
      case 'category': return state.category.length > 0;
      case 'subCategory': return state.subCategory.length > 0;
      case 'status': return state.status.length > 0;
      case 'domain': return state.domain !== '';
      case 'year': return state.year.length > 0;
      case 'type': return state.type.length > 0;
      case 'color': return state.color.length > 0;
      case 'size': return state.size.length > 0;
      case 'source': return state.source.length > 0;
      case 'entryMethod': return state.entryMethod.length > 0;
      default: return false;
    }
  }

  function clearAll() {
    setState({
      q: '',
      domain: state.domain,
      status: [], brand: [], category: [], subCategory: [], type: [], year: [],
      color: [], size: [], source: [], entryMethod: [],
      date: undefined, price: undefined,
    });
  }

  const hasActiveFilters = state.status.length || state.brand.length || state.category.length
    || state.subCategory.length || state.type.length || state.year.length
    || state.color.length || state.size.length || state.source.length
    || state.entryMethod.length || state.date || state.price;

  return (
    <div className="md:flex md:items-start md:gap-4">
      <div className="md:flex-1 md:min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="search" placeholder="Search…"
            value={state.q}
            onChange={(e) => setState({ ...state, q: e.target.value })}
            className="w-44 rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-from"
          />
          {activeFilterChips(state, setState)}
          <span className="ml-auto text-[11px] tabular-nums text-text-muted">{filtered.length} of {total}</span>
          {hasActiveFilters && (
            <button type="button" onClick={clearAll} className="text-[11px] text-text-muted hover:text-text-secondary">Clear all</button>
          )}
          <ColumnSettings prefs={prefs} onChange={setPrefs} onReset={resetPrefs} />
        </div>

        {/* Desktop table — horizontal scroll kicks in when columns exceed the viewport */}
        <div className="hidden overflow-x-auto rounded-card border border-border-subtle bg-bg-surface shadow-card md:block">
          <table className="min-w-full text-[13px]">
            <thead className="sticky top-0 bg-bg-surface-raised text-left text-text-muted">
              <tr>
                {visibleColumns.map((id) => {
                  const def = COLUMN_DEFS[id];
                  const filterKey = filterKeyForColumn(id);
                  return (
                    <Th
                      key={id}
                      onSort={() => toggleSort(id)}
                      sort={sortState(id)}
                      hasFilter={hasFilterFor(id)}
                      onFilter={filterKey ? (el) => setOpenFilter({ key: filterKey, anchor: el }) : null}
                      className={def.align === 'right' ? 'text-right' : ''}
                    >
                      {def.label}
                    </Th>
                  );
                })}
                <th className="w-[40px]"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const key = rowKey(r, i);
                const isOpen = openRowKey === key;
                return (
                  <tr
                    key={key}
                    onClick={() => setOpenRowKey(isOpen ? null : key)}
                    className={`group cursor-pointer border-t border-border-divider hover:bg-bg-surface-raised ${isOpen ? 'bg-bg-surface-raised' : ''}`}
                  >
                    {visibleColumns.map((id) => (
                      <Td key={id} align={COLUMN_DEFS[id].align}>{renderCell(id, r)}</Td>
                    ))}
                    <td className={`px-3 text-right text-[14px] transition ${isOpen ? 'text-accent-from' : 'text-text-muted opacity-0 group-hover:opacity-100'}`}>›</td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={visibleColumns.length + 1} className="px-4 py-10 text-center text-text-muted">No matching items.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden">
          {sorted.length === 0 && <div className="rounded-card border border-border-subtle bg-bg-surface p-6 text-center text-text-muted">No matching items.</div>}
          {sorted.map((r, i) => {
            const key = rowKey(r, i);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setOpenRowKey(key)}
                className="mb-2 block w-full rounded-card border border-border-divider bg-bg-surface p-3.5 text-left"
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
              </button>
            );
          })}
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
          {openFilter?.key === 'domain' && (
            <EnumFilter
              label="Domain"
              selected={state.domain ? [state.domain] : []}
              options={DOMAIN_VALUES}
              onChange={(v) => setState({ ...state, domain: v[0] ?? '' })}
            />
          )}
          {openFilter?.key === 'year' && (
            <TextFilter label="Year" selected={state.year} options={years} onChange={(v) => setState({ ...state, year: v })} />
          )}
          {openFilter?.key === 'type' && (
            <EnumFilter label="Type" selected={state.type} options={ITEM_TYPE_VALUES} onChange={(v) => setState({ ...state, type: v })} />
          )}
          {openFilter?.key === 'color' && (
            <TextFilter label="Color" selected={state.color} options={colors} onChange={(v) => setState({ ...state, color: v })} />
          )}
          {openFilter?.key === 'size' && (
            <TextFilter label="Size" selected={state.size} options={sizes} onChange={(v) => setState({ ...state, size: v })} />
          )}
          {openFilter?.key === 'source' && (
            <TextFilter label="Source" selected={state.source} options={sources} onChange={(v) => setState({ ...state, source: v })} />
          )}
          {openFilter?.key === 'entryMethod' && (
            <EnumFilter label="Entry Method" selected={state.entryMethod} options={ENTRY_METHOD_VALUES} onChange={(v) => setState({ ...state, entryMethod: v })} />
          )}
        </ColumnFilterPopover>
      </div>

      <DetailPanel row={openRow} onClose={() => setOpenRowKey(null)} />
    </div>
  );
}

function renderCell(id: ColumnId, r: MasterRow): React.ReactNode {
  switch (id) {
    case 'date': return <span className="whitespace-nowrap text-text-secondary">{fullDate(r.date)}</span>;
    case 'price': return <span className="tabular-nums text-text-primary">${r.price.toFixed(2)}</span>;
    case 'qty': return <span className="tabular-nums text-text-secondary">{r.qty}</span>;
    case 'status': return <StatusPill status={r.status as Status} />;
    case 'itemName': return <span className="font-medium text-text-primary">{r.itemName}</span>;
    case 'orderId': return <span className="font-mono text-[11px] text-text-secondary">{r.orderId}</span>;
    default: {
      const def = COLUMN_DEFS[id];
      const value = String(def.accessor(r) ?? '');
      return <span className="text-text-secondary">{value || <span className="text-text-muted">—</span>}</span>;
    }
  }
}

function rowKey(r: MasterRow, i: number): string {
  return `${r.orderId}-${r.itemName}-${i}`;
}

function Th({
  children, onSort, sort, hasFilter, onFilter, className = '',
}: {
  children: React.ReactNode;
  onSort: () => void;
  sort: 'asc' | 'desc' | 'none';
  hasFilter: boolean;
  onFilter: ((anchor: HTMLElement) => void) | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const arrow = sort === 'asc' ? '↑' : sort === 'desc' ? '↓' : '↕';
  const arrowClass = sort === 'none'
    ? 'text-text-muted group-hover:text-text-secondary'
    : 'text-accent-from';
  const justify = className.includes('text-right') ? 'justify-end' : '';
  return (
    <th className={`group px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${className}`}>
      <div ref={ref} className={`flex items-center gap-1.5 ${justify}`}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSort(); }}
          className="flex items-center gap-1 hover:text-text-primary"
        >
          <span>{children}</span>
          <span className={`text-[11px] transition ${arrowClass}`}>{arrow}</span>
        </button>
        {hasFilter && <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-gradient shadow-accent-glow" />}
        {onFilter && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (ref.current) onFilter(ref.current); }}
            className="-my-1 ml-0.5 rounded px-1.5 py-0.5 text-[14px] leading-none text-text-muted transition hover:bg-bg-base hover:text-text-primary"
            aria-label="Filter column"
          >▾</button>
        )}
      </div>
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | undefined }) {
  return <td className={`px-4 py-3 ${align === 'right' ? 'text-right' : ''}`}>{children}</td>;
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

function fullDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
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
  for (const t of state.type) {
    chips.push(<ActiveFilterChip key={`type-${t}`} label={`Type: ${t}`} onRemove={() => setState({ ...state, type: state.type.filter((x) => x !== t) })} />);
  }
  for (const y of state.year) {
    chips.push(<ActiveFilterChip key={`year-${y}`} label={`Year: ${y}`} onRemove={() => setState({ ...state, year: state.year.filter((x) => x !== y) })} />);
  }
  for (const c of state.color) {
    chips.push(<ActiveFilterChip key={`color-${c}`} label={`Color: ${c}`} onRemove={() => setState({ ...state, color: state.color.filter((x) => x !== c) })} />);
  }
  for (const sz of state.size) {
    chips.push(<ActiveFilterChip key={`size-${sz}`} label={`Size: ${sz}`} onRemove={() => setState({ ...state, size: state.size.filter((x) => x !== sz) })} />);
  }
  for (const src of state.source) {
    chips.push(<ActiveFilterChip key={`source-${src}`} label={`Source: ${src}`} onRemove={() => setState({ ...state, source: state.source.filter((x) => x !== src) })} />);
  }
  for (const em of state.entryMethod) {
    chips.push(<ActiveFilterChip key={`em-${em}`} label={`Entry: ${em}`} onRemove={() => setState({ ...state, entryMethod: state.entryMethod.filter((x) => x !== em) })} />);
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
