'use client';
import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import type { MasterRow } from '../../lib/types.js';

const PALETTE = ['#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#fb923c', '#c4b5fd', '#fda4af'];

export function SpendingCharts({ rows }: { rows: MasterRow[] }) {
  const byYear = useMemo(() => aggregateBy(rows, (r) => r.year), [rows]);
  const byDomain = useMemo(() => aggregateBy(rows, (r) => r.domain || 'Other'), [rows]);
  const byCategory = useMemo(() => aggregateBy(rows, (r) => r.category || 'Uncategorized').slice(0, 10), [rows]);
  const byBrand = useMemo(() => aggregateBy(rows, (r) => r.brand || 'Unknown').slice(0, 10), [rows]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartCard title="Total spend by year">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={byYear}>
            <CartesianGrid strokeDasharray="3 3" stroke="#211e3a" />
            <XAxis dataKey="name" stroke="#a09cb8" tick={{ fontSize: 12 }} />
            <YAxis stroke="#a09cb8" tick={{ fontSize: 12 }} tickFormatter={fmtUsdShort} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Bar dataKey="value" fill="url(#barGradient)" radius={[6, 6, 0, 0]} />
            <defs>
              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f472b6" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Spend by domain">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={byDomain} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
              {byDomain.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#a09cb8' }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top 10 categories">
        <ResponsiveContainer width="100%" height={Math.max(220, byCategory.length * 28)}>
          <BarChart data={byCategory} layout="vertical" margin={{ left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#211e3a" />
            <XAxis type="number" stroke="#a09cb8" tick={{ fontSize: 12 }} tickFormatter={fmtUsdShort} />
            <YAxis type="category" dataKey="name" stroke="#a09cb8" tick={{ fontSize: 12 }} width={110} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Bar dataKey="value" fill="#a78bfa" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top 10 brands">
        <ResponsiveContainer width="100%" height={Math.max(220, byBrand.length * 28)}>
          <BarChart data={byBrand} layout="vertical" margin={{ left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#211e3a" />
            <XAxis type="number" stroke="#a09cb8" tick={{ fontSize: 12 }} tickFormatter={fmtUsdShort} />
            <YAxis type="category" dataKey="name" stroke="#a09cb8" tick={{ fontSize: 12 }} width={110} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Bar dataKey="value" fill="#f472b6" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border-subtle bg-bg-surface p-4 shadow-card">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{title}</h2>
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

function fmtUsd(v: number): string { return `$${v.toFixed(2)}`; }
function fmtUsdShort(v: number): string { if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`; return `$${v}`; }

const tooltipStyle = {
  contentStyle: { backgroundColor: '#16142a', border: '1px solid #211e3a', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#fafafa' },
  itemStyle: { color: '#e2e0eb' },
};
