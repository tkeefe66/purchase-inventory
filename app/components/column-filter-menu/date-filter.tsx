'use client';
import { useState, useMemo } from 'react';
import * as chrono from 'chrono-node';
import type { DateFilter } from '../../lib/filters.js';

interface Props {
  value: DateFilter | undefined;
  onChange: (next: DateFilter | undefined) => void;
  yearsInData: string[];
}

type PresetValue = 'last-30-days' | 'last-90-days' | 'ytd' | 'last-12-months';
const PRESETS: { value: PresetValue; label: string }[] = [
  { value: 'last-30-days', label: 'Last 30d' },
  { value: 'last-90-days', label: 'Last 90d' },
  { value: 'ytd', label: 'YTD' },
  { value: 'last-12-months', label: 'Last 12mo' },
];

export function DateFilterMenu({ value, onChange, yearsInData }: Props) {
  const [input, setInput] = useState('');

  // Try to interpret the user's text on every keystroke.
  const parsed = useMemo(() => interpret(input), [input]);

  return (
    <>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Date filter</div>
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && parsed) {
            onChange(parsed);
            setInput('');
          }
        }}
        placeholder="last 90 days, 2024, may 2025, between mar 1 and apr 30…"
        className="mb-1.5 w-full rounded-input border border-border-subtle bg-bg-base px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-from"
      />
      <div className="mb-2 text-[10px] text-text-muted">Press Enter to apply</div>

      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Or pick</div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const active = value?.kind === 'preset' && value.value === p.value;
          return (
            <button key={p.value} type="button" onClick={() => onChange({ kind: 'preset', value: p.value })}
              className={chip(active)}>
              {p.label}
            </button>
          );
        })}
        {yearsInData.slice(0, 4).map((y) => {
          const active = value?.kind === 'year' && value.value === Number(y);
          return (
            <button key={y} type="button" onClick={() => onChange({ kind: 'year', value: Number(y) })}
              className={chip(active)}>
              {y}
            </button>
          );
        })}
      </div>

      {value && (
        <div className="mb-2 text-[11px] text-text-secondary">
          Active: <span className="text-text-primary">{describe(value)}</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => onChange(undefined)}
        className="mt-2 w-full border-t border-border-divider pt-2 text-left text-[11px] text-text-muted hover:text-text-secondary"
      >
        Clear filter
      </button>
    </>
  );
}

function chip(active: boolean): string {
  return active
    ? 'rounded-chip border border-chip-active-border bg-chip-active px-2.5 py-1 text-[11px] text-chip-active-text'
    : 'rounded-chip border border-border-subtle bg-bg-base px-2.5 py-1 text-[11px] text-text-secondary hover:text-text-primary';
}

function describe(d: DateFilter): string {
  switch (d.kind) {
    case 'preset': return d.value.replace(/-/g, ' ');
    case 'year': return String(d.value);
    case 'month': return `${monthName(d.month)} ${d.year}`;
    case 'range': return `${d.start} → ${d.end}`;
  }
}

function monthName(m: number): string {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] ?? '';
}

function interpret(raw: string): DateFilter | undefined {
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;

  // YYYY (e.g. "2024")
  if (/^\d{4}$/.test(text)) return { kind: 'year', value: Number(text) };

  // YYYY-MM or "month YYYY" / "month YY"
  const ymd = chrono.parse(text);
  if (ymd.length === 0) return undefined;
  const res = ymd[0]!;

  // Range — e.g. "between mar 1 and apr 30" yields two start/end components
  if (res.end) {
    return { kind: 'range', start: toIso(res.start.date()), end: toIso(res.end.date()) };
  }

  const d = res.start.date();
  const hasDay = res.start.isCertain('day');
  const hasMonth = res.start.isCertain('month');

  if (hasMonth && !hasDay) {
    return { kind: 'month', year: d.getFullYear(), month: d.getMonth() + 1 };
  }
  // Single-day result — treat as a 1-day range
  return { kind: 'range', start: toIso(d), end: toIso(d) };
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
