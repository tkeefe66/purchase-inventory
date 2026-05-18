'use client';
import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import type { MasterRow } from '../../lib/types.js';

const DOMAIN_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#a3e635'];

export function SpendingCharts({ rows }: { rows: MasterRow[] }) {
  const byYear = useMemo(() => aggregateBy(rows, (r) => r.year), [rows]);
  const byDomain = useMemo(() => aggregateBy(rows, (r) => r.domain || 'Other'), [rows]);
  const byCategory = useMemo(() => aggregateBy(rows, (r) => r.category || 'Uncategorized').slice(0, 10), [rows]);
  const byBrand = useMemo(() => aggregateBy(rows, (r) => r.brand || 'Unknown').slice(0, 10), [rows]);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ChartCard title="Total spend by year">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={byYear}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 12 }} />
            <YAxis stroke="#a1a1aa" tick={{ fontSize: 12 }} tickFormatter={fmtUsdShort} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Bar dataKey="value" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Spend by domain">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={byDomain} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
              {byDomain.map((_, i) => <Cell key={i} fill={DOMAIN_COLORS[i % DOMAIN_COLORS.length]} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#a1a1aa' }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top 10 categories">
        <ResponsiveContainer width="100%" height={Math.max(220, byCategory.length * 28)}>
          <BarChart data={byCategory} layout="vertical" margin={{ left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis type="number" stroke="#a1a1aa" tick={{ fontSize: 12 }} tickFormatter={fmtUsdShort} />
            <YAxis type="category" dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 12 }} width={110} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Bar dataKey="value" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top 10 brands">
        <ResponsiveContainer width="100%" height={Math.max(220, byBrand.length * 28)}>
          <BarChart data={byBrand} layout="vertical" margin={{ left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis type="number" stroke="#a1a1aa" tick={{ fontSize: 12 }} tickFormatter={fmtUsdShort} />
            <YAxis type="category" dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 12 }} width={110} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Bar dataKey="value" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-300">{title}</h2>
      {children}
    </div>
  );
}

function aggregateBy(rows: MasterRow[], keyFn: (r: MasterRow) => string): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = keyFn(r);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + (r.price || 0));
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

function fmtUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}
function fmtUsdShort(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v}`;
}

const tooltipStyle = {
  contentStyle: { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: '#e4e4e7' },
  itemStyle: { color: '#e4e4e7' },
};
