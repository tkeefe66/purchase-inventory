'use client';
import { useState, useMemo } from 'react';

interface Props {
  label: string;
  selected: string[];
  options: string[];
  onChange: (next: string[]) => void;
}

export function TextFilter({ label, selected, options, onChange }: Props) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const lq = q.trim().toLowerCase();
    return lq ? options.filter((o) => o.toLowerCase().includes(lq)) : options;
  }, [options, q]);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]);
  }

  return (
    <>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label} filter</div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Filter ${label.toLowerCase()}…`}
        className="mb-2 w-full rounded-input border border-border-subtle bg-bg-base px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-from"
      />
      <div className="max-h-56 overflow-y-auto">
        {filtered.length === 0 && <div className="px-2 py-3 text-center text-[11px] text-text-muted">No matches</div>}
        {filtered.map((opt) => (
          <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-text-body hover:bg-bg-surface-raised">
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-accent-from" />
            <span className="truncate">{opt}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([])}
        className="mt-2 w-full border-t border-border-divider pt-2 text-left text-[11px] text-text-muted hover:text-text-secondary"
      >
        Clear filter
      </button>
    </>
  );
}
