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
      <label className="mb-3 inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
        />
        Show resolved
      </label>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-900 text-left text-zinc-400">
            <tr>
              <Th>Detected</Th>
              <Th>Source</Th>
              <Th>Subject</Th>
              <Th>Reason</Th>
              <Th>Excerpt</Th>
              <Th>Resolved</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {visible.map((r) => (
              <tr key={r.gmailMessageId || `${r.dateDetected}-${r.emailSubject}`}
                  className={`hover:bg-zinc-900/50 ${r.resolved ? 'opacity-50' : ''}`}>
                <Td className="whitespace-nowrap text-zinc-400">{shortDate(r.dateDetected)}</Td>
                <Td>{r.source}</Td>
                <Td className="max-w-md truncate" title={r.emailSubject}>{r.emailSubject}</Td>
                <Td><ReasonPill reason={r.reason} /></Td>
                <Td className="max-w-md truncate text-zinc-400" title={r.rawExcerpt}>{r.rawExcerpt}</Td>
                <Td>{r.resolved ? '✓' : '—'}</Td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-zinc-500">
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
  return <th className="px-3 py-2 text-xs font-medium uppercase tracking-wider">{children}</th>;
}
function Td({ children, className = '', title }: { children: React.ReactNode; className?: string; title?: string }) {
  const props = title ? { title } : {};
  return <td className={`px-3 py-2 ${className}`} {...props}>{children}</td>;
}

function shortDate(iso: string): string {
  // Cron writes ISO 8601 timestamps. Show first 10 chars (YYYY-MM-DD).
  return iso.slice(0, 10);
}

function ReasonPill({ reason }: { reason: string }) {
  const styles = reason.includes('parse')
    ? 'bg-red-500/15 text-red-300 ring-red-500/30'
    : reason.includes('low')
      ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30'
      : 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${styles}`}>
      {reason || 'unknown'}
    </span>
  );
}
