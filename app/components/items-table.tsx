'use client';
import { useMemo, useState } from 'react';
import type { MasterRow, Status } from '../../lib/types.js';

type SortKey = 'date' | 'brand' | 'itemName' | 'price' | 'category' | 'status';
type SortDir = 'asc' | 'desc';

const STATUS_STYLES: Record<Status, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  retired: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
  returned: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  lost: 'bg-red-500/15 text-red-300 ring-red-500/30',
  broken: 'bg-red-500/15 text-red-300 ring-red-500/30',
  sold: 'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  donated: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  excluded: 'bg-zinc-700/30 text-zinc-500 ring-zinc-700/40',
};

export function ItemsTable({ rows }: { rows: MasterRow[] }) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<string>('all');
  const [status, setStatus] = useState<string>('active');
  const [type, setType] = useState<string>('all');
  const [year, setYear] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Build dropdown options from the data itself so they stay in sync.
  const domains = useMemo(() => uniqueSorted(rows.map((r) => r.domain)), [rows]);
  const statuses = useMemo(() => uniqueSorted(rows.map((r) => r.status)), [rows]);
  const types = useMemo(() => uniqueSorted(rows.map((r) => r.type)), [rows]);
  const years = useMemo(() => uniqueSorted(rows.map((r) => r.year)).sort((a, b) => b.localeCompare(a)), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (domain !== 'all' && r.domain !== domain) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (type !== 'all' && r.type !== type) return false;
      if (year !== 'all' && r.year !== year) return false;
      if (q && !`${r.brand} ${r.itemName} ${r.category} ${r.subCategory} ${r.notes}`.toLowerCase().includes(q)) return false;
      return true;
    });
    out = [...out].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'price': return (a.price - b.price) * dir;
        case 'date': return a.date.localeCompare(b.date) * dir;
        case 'brand': return a.brand.localeCompare(b.brand) * dir;
        case 'itemName': return a.itemName.localeCompare(b.itemName) * dir;
        case 'category': return a.category.localeCompare(b.category) * dir;
        case 'status': return a.status.localeCompare(b.status) * dir;
      }
    });
    return out;
  }, [rows, query, domain, status, type, year, sortKey, sortDir]);

  const totalSpend = useMemo(() => filtered.reduce((sum, r) => sum + (r.price || 0), 0), [filtered]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'price' || key === 'date' ? 'desc' : 'asc'); }
  }
  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <input
          type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)}
          className="w-60 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        <Select label="Domain" value={domain} onChange={setDomain} options={['all', ...domains]} />
        <Select label="Status" value={status} onChange={setStatus} options={['all', ...statuses]} />
        <Select label="Type" value={type} onChange={setType} options={['all', ...types]} />
        <Select label="Year" value={year} onChange={setYear} options={['all', ...years]} />
        <div className="ml-auto text-zinc-400">
          {filtered.length} rows · ${totalSpend.toFixed(2)}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-900 text-left text-zinc-400">
            <tr>
              <Th onClick={() => toggleSort('date')} indicator={sortIndicator('date')}>Date</Th>
              <Th onClick={() => toggleSort('brand')} indicator={sortIndicator('brand')}>Brand</Th>
              <Th onClick={() => toggleSort('itemName')} indicator={sortIndicator('itemName')}>Item</Th>
              <Th onClick={() => toggleSort('category')} indicator={sortIndicator('category')}>Category</Th>
              <Th>Sub-Cat</Th>
              <Th onClick={() => toggleSort('price')} indicator={sortIndicator('price')} className="text-right">Price</Th>
              <Th onClick={() => toggleSort('status')} indicator={sortIndicator('status')}>Status</Th>
              <Th>Domain</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {filtered.map((r, i) => (
              <tr key={`${r.orderId}-${r.itemName}-${i}`} className="hover:bg-zinc-900/50">
                <Td>{r.date}</Td>
                <Td>{r.brand}</Td>
                <Td>
                  {r.productUrl ? (
                    <a className="text-zinc-100 hover:text-white hover:underline"
                       href={r.productUrl} target="_blank" rel="noopener noreferrer">{r.itemName}</a>
                  ) : (
                    <span className="text-zinc-100">{r.itemName}</span>
                  )}
                </Td>
                <Td className="text-zinc-300">{r.category}</Td>
                <Td className="text-zinc-400">{r.subCategory}</Td>
                <Td className="text-right tabular-nums">${r.price.toFixed(2)}</Td>
                <Td><StatusPill status={r.status} /></Td>
                <Td className="text-zinc-400">{r.domain}</Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-zinc-500">No matching items.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  const set = new Set<string>();
  for (const v of values) if (v) set.add(v);
  return Array.from(set).sort();
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: readonly string[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-zinc-400">
      <span className="text-xs uppercase tracking-wider">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-zinc-100 focus:border-zinc-600 focus:outline-none">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Th({ children, onClick, indicator = '', className = '' }: {
  children: React.ReactNode; onClick?: () => void; indicator?: string; className?: string;
}) {
  return (
    <th className={`px-3 py-2 text-xs font-medium uppercase tracking-wider ${onClick ? 'cursor-pointer select-none hover:text-zinc-200' : ''} ${className}`}
      onClick={onClick}>
      {children}{indicator}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}
