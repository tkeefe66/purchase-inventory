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
import { StatusGlyph } from './status-glyph';

const TIER_LABELS: Record<Tier, string> = {
  1: 'Foundation',
  2: 'Control / Workflow / Refinement',
  3: 'Refinement / Recipes / Craft',
  4: 'Mastery / Output / Display',
};

interface Props {
  branch: BranchId;
  label: { icon: React.ReactNode; name: string; subtitle: string };
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
          <div className="flex items-center gap-2 text-[16px] font-bold tracking-[-0.01em] text-text-primary">
            <span
              className="flex h-7 w-7 flex-none items-center justify-center rounded-input bg-chip-active text-accent-from"
              aria-hidden="true"
            >
              {label.icon}
            </span>
            {label.name}
            <span className="text-text-muted text-[12px]" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
          </div>
          <div className="ml-9 text-[11px] text-text-muted">{label.subtitle}</div>
        </div>
        <div className="text-[12px] tabular-nums text-text-secondary">
          {done} / {topics.length}
          {inProg > 0 && <span className="ml-1 text-text-muted">· {inProg} active</span>}
        </div>
      </button>

      {open && (
        <div className="mt-3 animate-fade-rise">
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
        <StatusGlyph status={status} label />
        <span className="truncate">{topic.name}</span>
      </Link>
    </li>
  );
}
