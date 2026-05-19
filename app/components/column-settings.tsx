'use client';
import { useEffect, useRef, useState } from 'react';
import { COLUMN_DEFS, type ColumnId, type ColumnPrefs } from '../lib/columns.js';

interface Props {
  prefs: ColumnPrefs;
  onChange: (next: ColumnPrefs) => void;
  onReset: () => void;
}

export function ColumnSettings({ prefs, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragSrc = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visibleCount = prefs.columns.filter((c) => c.visible).length;

  function toggle(id: ColumnId) {
    const next: ColumnPrefs = {
      columns: prefs.columns.map((c) =>
        c.id === id ? { ...c, visible: !c.visible } : c,
      ),
    };
    // Guard: at least one column must stay visible
    if (next.columns.filter((c) => c.visible).length === 0) return;
    onChange(next);
  }

  function reorder(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const updated = [...prefs.columns];
    const [item] = updated.splice(fromIdx, 1);
    if (!item) return;
    updated.splice(toIdx, 0, item);
    onChange({ columns: updated });
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Column settings"
        title="Columns"
        className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-border-subtle text-[15px] transition ${
          open ? 'bg-bg-surface-raised text-text-primary' : 'bg-bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-surface-raised'
        }`}
      >
        ⚙
      </button>

      {open && (
        <div className="absolute right-0 top-[36px] z-50 w-[240px] rounded-[10px] border border-border-subtle bg-bg-surface p-2.5 shadow-popover">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Columns</div>
          <div className="max-h-[360px] overflow-y-auto">
            {prefs.columns.map((c, idx) => {
              const def = COLUMN_DEFS[c.id];
              const canUncheck = !(c.visible && visibleCount === 1);
              return (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => { dragSrc.current = idx; }}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragSrc.current !== null) reorder(dragSrc.current, idx);
                    dragSrc.current = null;
                  }}
                  onDragEnd={() => { dragSrc.current = null; }}
                  className="flex items-center gap-2 rounded-[5px] px-1.5 py-1 text-[12px] text-text-body hover:bg-bg-surface-raised"
                >
                  <input
                    type="checkbox"
                    checked={c.visible}
                    disabled={!canUncheck}
                    onChange={() => toggle(c.id)}
                    className="accent-accent-from disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="flex-1">{def.label}</span>
                  <span
                    className="cursor-grab select-none text-text-muted opacity-50 hover:opacity-100"
                    title="Drag to reorder"
                  >
                    ⋮⋮
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t border-border-divider pt-2 text-[11px]">
            <button type="button" onClick={onReset} className="text-text-muted hover:text-text-secondary">
              Reset defaults
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-text-muted hover:text-text-secondary">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
