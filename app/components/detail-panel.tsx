'use client';
import { useEffect } from 'react';
import type { MasterRow, Status } from '../../lib/types.js';
import { StatusPill } from './status-pill.js';

interface Props {
  row: MasterRow | null;
  onClose: () => void;
}

export function DetailPanel({ row, onClose }: Props) {
  useEffect(() => {
    if (!row) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;

  return (
    <>
      {/* Mobile backdrop — taps close the sheet. Hidden on desktop. */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
      />

      <aside
        className="fixed inset-x-0 bottom-0 top-[16px] z-50 overflow-y-auto rounded-t-[14px] border border-border-subtle bg-bg-surface shadow-popover md:sticky md:top-6 md:inset-auto md:h-[calc(100vh-3rem)] md:w-[320px] md:flex-shrink-0 md:rounded-card md:shadow-card"
      >
        <PanelBody row={row} onClose={onClose} />
      </aside>
    </>
  );
}

function PanelBody({ row, onClose }: { row: MasterRow; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-border-subtle p-4">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">{row.brand || 'Unknown'}</div>
          <div className="mt-1 text-[17px] font-semibold leading-tight text-text-primary">{row.itemName}</div>
          {(row.subCategory || row.category) && (
            <div className="mt-1 text-[12px] text-text-secondary">
              {[row.subCategory, row.category].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="text-[18px] leading-none text-text-muted hover:text-text-primary"
        >
          ×
        </button>
      </div>

      <div className="px-4 pt-3.5">
        <div className="text-[22px] font-bold tabular-nums text-text-primary">${row.price.toFixed(2)}</div>
        <div className="mt-1.5"><StatusPill status={row.status as Status} /></div>
      </div>

      {row.productUrl && (
        <a
          href={row.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-4 mt-3.5 inline-flex items-center justify-center gap-1.5 rounded-input border border-border-subtle bg-bg-surface-raised px-3 py-2 text-[12px] text-accent-from transition hover:bg-bg-base hover:text-text-primary"
        >
          ↗ Open product page
        </a>
      )}

      <div className="space-y-1 px-4 pb-6 pt-1">
        <Section label="Purchase">
          <Field label="Date" value={row.date} />
          <Field label="Year" value={row.year} />
          <Field label="Source" value={row.source} />
          <Field label="Order ID" value={row.orderId} mono />
          <Field label="Quantity" value={String(row.qty)} />
        </Section>

        <Section label="Domain">
          <Field label="Domain" value={row.domain} />
          <Field label="Type" value={row.type} />
        </Section>

        <Section label="Variant">
          <Field label="Color" value={row.color} />
          <Field label="Size" value={row.size} />
        </Section>

        {row.reasoning && (
          <div className="mt-4">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Classifier reasoning</div>
            <div className="rounded-input border border-border-subtle bg-bg-base p-3 text-[12px] leading-relaxed text-text-secondary">
              {row.reasoning}
            </div>
          </div>
        )}

        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Notes</div>
          <div className="rounded-input border border-border-subtle bg-bg-base p-3 text-[12px] leading-relaxed text-text-secondary">
            {row.notes || <span className="italic text-text-muted">No notes yet</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pt-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</div>
      {children}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-divider py-1.5 text-[12px]">
      <span className="text-text-muted">{label}</span>
      <span className={`max-w-[60%] text-right text-text-primary ${value ? '' : 'italic text-text-muted'} ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value || '—'}
      </span>
    </div>
  );
}
