'use client';
import { useState, useEffect } from 'react';
import type { PriceFilter } from '../../lib/filters.js';

interface Props {
  value: PriceFilter | undefined;
  onChange: (next: PriceFilter | undefined) => void;
}

const PRESETS: { label: string; filter: PriceFilter }[] = [
  { label: 'Under $50',   filter: { kind: 'lte', value: 50 } },
  { label: '$50–$200',    filter: { kind: 'range', min: 50, max: 200 } },
  { label: '$200–$500',   filter: { kind: 'range', min: 200, max: 500 } },
  { label: 'Over $500',   filter: { kind: 'gte', value: 500 } },
];

export function PriceFilter({ value, onChange }: Props) {
  const [op, setOp] = useState<'gte' | 'lte' | 'range'>(value?.kind ?? 'gte');
  const [a, setA] = useState<string>(initialA(value));
  const [b, setB] = useState<string>(initialB(value));

  useEffect(() => {
    if (value) {
      setOp(value.kind);
      setA(initialA(value));
      setB(initialB(value));
    }
  }, [value]);

  function apply() {
    const an = Number(a); const bn = Number(b);
    if (op === 'gte' && Number.isFinite(an)) onChange({ kind: 'gte', value: an });
    else if (op === 'lte' && Number.isFinite(an)) onChange({ kind: 'lte', value: an });
    else if (op === 'range' && Number.isFinite(an) && Number.isFinite(bn)) onChange({ kind: 'range', min: an, max: bn });
  }

  return (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Price filter</div>
      <div className="mb-2 flex gap-1.5">
        <select
          value={op}
          onChange={(e) => setOp(e.target.value as 'gte' | 'lte' | 'range')}
          className="rounded-input border border-border-subtle bg-bg-base px-2 py-1.5 text-[12px] text-text-primary"
        >
          <option value="gte">≥</option>
          <option value="lte">≤</option>
          <option value="range">between</option>
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={a}
          onChange={(e) => setA(e.target.value)}
          placeholder="$"
          className="w-full rounded-input border border-border-subtle bg-bg-base px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted"
        />
        {op === 'range' && (
          <input
            type="number"
            inputMode="decimal"
            value={b}
            onChange={(e) => setB(e.target.value)}
            placeholder="$"
            className="w-full rounded-input border border-border-subtle bg-bg-base px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted"
          />
        )}
      </div>
      <button type="button" onClick={apply} className="mb-3 w-full rounded-input bg-accent-gradient py-1.5 text-[12px] font-semibold text-bg-base">
        Apply
      </button>

      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Or pick</div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const active = isSame(value, p.filter);
          return (
            <button key={p.label} type="button" onClick={() => onChange(p.filter)}
              className={active
                ? 'rounded-chip border border-chip-active-border bg-chip-active px-2.5 py-1 text-[11px] text-chip-active-text'
                : 'rounded-chip border border-border-subtle bg-bg-base px-2.5 py-1 text-[11px] text-text-secondary hover:text-text-primary'}>
              {p.label}
            </button>
          );
        })}
      </div>

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

function initialA(v: PriceFilter | undefined): string {
  if (!v) return '';
  if (v.kind === 'range') return String(v.min);
  return String(v.value);
}

function initialB(v: PriceFilter | undefined): string {
  if (v?.kind === 'range') return String(v.max);
  return '';
}

function isSame(a: PriceFilter | undefined, b: PriceFilter): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'range' && b.kind === 'range') return a.min === b.min && a.max === b.max;
  if (a.kind !== 'range' && b.kind !== 'range') return a.value === b.value;
  return false;
}
