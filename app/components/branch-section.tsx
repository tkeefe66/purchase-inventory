'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  listByBranch,
  listByTier,
  type BranchId,
  type Tier,
  type Topic,
} from '../../domains/photography/skillTree.js';
import type { ProgressStatus } from '../../lib/photographySheets.js';

const TIER_LABELS: Record<Tier, string> = {
  1: 'Foundation',
  2: 'Control / Workflow / Refinement',
  3: 'Refinement / Recipes / Craft',
  4: 'Mastery / Output / Display',
};

interface Props {
  branch: BranchId;
  label: { emoji: string; name: string; subtitle: string };
  /** Plain object instead of Map — Maps don't survive server→client serialization. */
  statuses: Record<string, ProgressStatus>;
  defaultOpen?: boolean;
}

export function BranchSection({ branch, label, statuses, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const topics = listByBranch(branch);
  const done = topics.filter((t) => statuses[t.id] === 'completed').length;
  const inProg = topics.filter((t) => statuses[t.id] === 'in-progress').length;

  return (
    <section className="rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="text-[16px] font-bold tracking-[-0.01em] text-text-primary">
            <span className="mr-1">{label.emoji}</span>
            {label.name}
            <span className="ml-2 inline-block text-text-muted text-[12px]" aria-hidden>
              {open ? '▾' : '▸'}
            </span>
          </div>
          <div className="text-[11px] text-text-muted">{label.subtitle}</div>
        </div>
        <div className="text-[12px] tabular-nums text-text-secondary">
          {done} / {topics.length}
          {inProg > 0 && <span className="ml-1 text-text-muted">· {inProg} active</span>}
        </div>
      </button>

      {open && (
        <div className="mt-3">
          {([1, 2, 3, 4] as Tier[]).map((tier) => {
            const tierTopics = listByTier(branch, tier);
            if (tierTopics.length === 0) return null;
            const tierDone = tierTopics.filter((t) => statuses[t.id] === 'completed').length;
            return (
              <div key={tier} className="mt-3 first:mt-0">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                    Tier {tier} · {TIER_LABELS[tier]}
                  </div>
                  <div className="text-[10px] tabular-nums text-text-muted">
                    {tierDone}/{tierTopics.length}
                  </div>
                </div>
                <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {tierTopics.map((t) => (
                    <TopicChip key={t.id} topic={t} status={statuses[t.id] ?? 'locked'} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TopicChip({ topic, status }: { topic: Topic; status: ProgressStatus }) {
  const locked = status === 'locked';
  return (
    <li>
      <Link
        href={`/photography/${topic.id}`}
        className={`flex items-center gap-2 rounded-chip border border-border-subtle px-2.5 py-1.5 text-[13px] transition ${
          locked
            ? 'border-dashed text-text-muted hover:text-text-secondary'
            : 'text-text-secondary hover:bg-chip-active hover:text-text-primary'
        }`}
      >
        <StatusGlyph status={status} />
        <span className="truncate">{topic.name}</span>
      </Link>
    </li>
  );
}

function StatusGlyph({ status }: { status: ProgressStatus }) {
  const map: Record<ProgressStatus, { glyph: string; cls: string }> = {
    completed:     { glyph: '✓', cls: 'text-delta-up' },
    'in-progress': { glyph: '▶', cls: 'text-text-primary' },
    available:     { glyph: '○', cls: 'text-text-secondary' },
    locked:        { glyph: '🔒', cls: 'opacity-60' },
    skipped:       { glyph: '⊘', cls: 'text-text-muted line-through' },
  };
  const entry = map[status];
  return <span className={`inline-block w-3 text-center text-[12px] ${entry.cls}`}>{entry.glyph}</span>;
}
