'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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
      <ImageBlock row={row} />
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

function ImageBlock({ row }: { row: MasterRow }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'url'>('idle');
  const [urlValue, setUrlValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemId = `${row.orderId}|${row.productUrl || row.itemName}`;

  async function postForm(fd: FormData) {
    setUploading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/items/${encodeURIComponent(itemId)}/image`, {
        method: 'POST',
        body: fd,
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      setMode('idle');
      setUrlValue('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleFile(file: File) {
    const fd = new FormData();
    fd.append('image', file);
    await postForm(fd);
  }

  async function handleUrl() {
    if (!urlValue.trim()) return;
    const fd = new FormData();
    fd.append('url', urlValue.trim());
    await postForm(fd);
  }

  async function handleReject() {
    setRejecting(true);
    setError(null);
    try {
      const resp = await fetch(`/api/items/${encodeURIComponent(itemId)}/image/reject`, {
        method: 'POST',
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reject failed');
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div
      className="relative aspect-[4/3] w-full flex-shrink-0 overflow-hidden border-b border-border-subtle bg-bg-base group"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) void handleFile(f);
      }}
    >
      {row.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.image} alt={row.itemName} className="h-full w-full object-contain" />
      ) : mode === 'url' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleUrl();
          }}
          className="flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-border-subtle px-4"
        >
          <input
            type="url"
            autoFocus
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            placeholder="https://…/image.jpg"
            className="w-full rounded-input border border-border-subtle bg-bg-base px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:border-accent-from focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={uploading || urlValue.trim().length === 0}
              className="rounded-input bg-accent-from px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('idle');
                setUrlValue('');
                setError(null);
              }}
              className="rounded-input border border-border-subtle px-3 py-1 text-[11px] text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 border-2 border-dashed border-border-subtle">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-[13px] text-text-muted hover:text-text-primary"
          >
            + Add image
          </button>
          <button
            type="button"
            onClick={() => setMode('url')}
            className="text-[11px] text-text-muted underline hover:text-text-primary"
          >
            or paste a URL
          </button>
        </div>
      )}
      {row.image && (
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={rejecting}
            className="rounded-input bg-bg-surface/80 px-2 py-1 text-[11px] text-text-secondary disabled:opacity-50"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => void handleReject()}
            disabled={rejecting}
            className="rounded-input bg-bg-surface/80 px-2 py-1 text-[11px] text-text-secondary hover:text-red-400 disabled:opacity-50"
          >
            ⚠ Wrong image
          </button>
        </div>
      )}
      {(uploading || rejecting) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[12px] text-white">
          {rejecting ? 'Marking…' : mode === 'url' ? 'Fetching…' : 'Uploading…'}
        </div>
      )}
      {error && (
        <div className="absolute bottom-2 left-2 right-2 rounded-input bg-red-900/80 px-2 py-1 text-[11px] text-white">
          {error}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
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
