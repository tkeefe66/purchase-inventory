'use client';
import { useState, useMemo } from 'react';
import type { NeedsReviewRow } from '../lib/data';

export function NeedsReviewTable({ rows }: { rows: NeedsReviewRow[] }) {
  const [showResolved, setShowResolved] = useState(false);
  const visible = useMemo(
    () => showResolved ? rows : rows.filter((r) => !r.resolved),
    [rows, showResolved],
  );
  return (
    <div>
      <label className="mb-3 inline-flex cursor-pointer items-center gap-2 text-[13px] text-text-secondary">
        <input
          type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)}
          className="accent-accent-from"
        />
        Show resolved
      </label>
      <div className="overflow-hidden rounded-card border border-border-subtle bg-bg-surface shadow-card">
        <table className="min-w-full text-[13px]">
          <thead className="bg-bg-surface-raised text-left text-text-muted">
            <tr>
              <Th>Detected</Th>
              <Th>Source</Th>
              <Th>Subject</Th>
              <Th>Reason</Th>
              <Th>Excerpt</Th>
              <Th>Resolved</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.gmailMessageId || `${r.dateDetected}-${r.emailSubject}`}
                  className={`border-t border-border-divider hover:bg-bg-surface-raised ${r.resolved ? 'opacity-50' : ''}`}>
                <Td className="whitespace-nowrap text-text-secondary">{shortDate(r.dateDetected)}</Td>
                <Td className="text-text-secondary">{r.source}</Td>
                <Td className="max-w-md truncate text-text-primary" title={r.emailSubject}>{r.emailSubject}</Td>
                <Td><ReasonPill reason={r.reason} /></Td>
                <Td className="max-w-md truncate text-text-secondary" title={r.rawExcerpt}>{r.rawExcerpt}</Td>
                <Td>{r.resolved ? '✓' : '—'}</Td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                {rows.length === 0 ? 'Needs Review tab is empty.' : 'No unresolved rows.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em]">{children}</th>;
}
function Td({ children, className = '', title }: { children: React.ReactNode; className?: string; title?: string }) {
  const props = title ? { title } : {};
  return <td className={`px-4 py-3 ${className}`} {...props}>{children}</td>;
}
function shortDate(iso: string): string { return iso.slice(0, 10); }
function ReasonPill({ reason }: { reason: string }) {
  const styles = reason.includes('parse')
    ? 'text-status-broken-fg bg-status-broken-bg'
    : reason.includes('low')
      ? 'text-status-returned-fg bg-status-returned-bg'
      : 'text-text-secondary bg-bg-surface-raised';
  return (
    <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[10px] font-semibold ${styles}`}>
      {reason || 'unknown'}
    </span>
  );
}
