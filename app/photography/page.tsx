import Link from 'next/link';
import { getPhotographyProgress, getPhotographyAssignments } from '../lib/photography-data';
import {
  ALL_TOPICS,
  listByBranch,
  listByTier,
  type BranchId,
  type Tier,
} from '../../domains/photography/skillTree.js';
import {
  computeStatuses,
  pickNextTopic,
  type ProgressEntry,
} from '../../domains/photography/curriculum.js';
import type { ProgressRow } from '../../lib/photographySheets.js';
import { KpiCard } from '../components/kpi-card';

export const dynamic = 'force-dynamic';

const BRANCH_LABELS: Record<BranchId, { emoji: string; name: string; subtitle: string }> = {
  'operating-camera': { emoji: '🎥', name: 'Operating Camera', subtitle: 'Confident control of the a6700' },
  'seeing':           { emoji: '👁',  name: 'Seeing',           subtitle: 'Make photos that are about something' },
  'editing':          { emoji: '✏️', name: 'Editing',          subtitle: 'Lightroom Classic, RAW → finished' },
  'printing':         { emoji: '🖨', name: 'Printing',         subtitle: 'Epson ET-8550 to wall prints' },
};

const TIER_LABELS: Record<Tier, string> = {
  1: 'Foundation',
  2: 'Control / Workflow / Refinement',
  3: 'Refinement / Recipes / Craft',
  4: 'Mastery / Output / Display',
};

function toEntries(rows: readonly ProgressRow[]): Map<string, ProgressEntry> {
  const m = new Map<string, ProgressEntry>();
  for (const r of rows) {
    m.set(r.topicId, {
      topicId: r.topicId,
      status: r.status,
      lastActivityAt: r.lastActivityAt,
      assignmentsPassed: r.assignmentsPassed,
      assignmentsFailed: r.assignmentsFailed,
      theoryLastReadAt: r.theoryLastReadAt,
    });
  }
  return m;
}

export default async function PhotographyPage() {
  const [progress, assignments] = await Promise.all([
    getPhotographyProgress(),
    getPhotographyAssignments(),
  ]);
  const entries = toEntries(progress);
  const statuses = computeStatuses(entries);
  const totalDone = ALL_TOPICS.filter((t) => statuses.get(t.id) === 'completed').length;
  const totalInProg = ALL_TOPICS.filter((t) => statuses.get(t.id) === 'in-progress').length;
  const active = assignments.find((a) => a.status === 'active' || a.status === 'submitted');
  const next = pickNextTopic(entries);

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />

      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">Photography</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">Skills</h1>
        <p className="text-[13px] text-text-secondary">
          {totalDone} of {ALL_TOPICS.length} topics completed · {totalInProg} in progress
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <KpiCard label="Completed" value={`${totalDone} / ${ALL_TOPICS.length}`} />
          <KpiCard
            label="Active"
            value={active ? 'In progress' : 'None'}
            {...(active ? { href: `/photography/${active.topicId}` } : {})}
          />
          <KpiCard
            label="Suggested next"
            value={next?.name ?? '—'}
            {...(next ? { href: `/photography/${next.id}` } : {})}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/photography/assignments"
            className="rounded-chip border border-border-subtle bg-bg-surface px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
          >
            Assignment history →
          </Link>
          <div className="text-[12px] text-text-muted">
            <Glyph status="completed" /> completed&nbsp;&nbsp;
            <Glyph status="in-progress" /> in progress&nbsp;&nbsp;
            <Glyph status="available" /> available&nbsp;&nbsp;
            <Glyph status="locked" /> locked&nbsp;&nbsp;
            <Glyph status="skipped" /> skipped
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {(['operating-camera', 'seeing', 'editing', 'printing'] as BranchId[]).map((branch) => (
            <BranchSection
              key={branch}
              branch={branch}
              statuses={statuses}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BranchSection({
  branch,
  statuses,
}: {
  branch: BranchId;
  statuses: ReadonlyMap<string, ProgressEntry['status']>;
}) {
  const label = BRANCH_LABELS[branch];
  const topics = listByBranch(branch);
  const done = topics.filter((t) => statuses.get(t.id) === 'completed').length;

  return (
    <section className="rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-bold tracking-[-0.01em] text-text-primary">
            <span className="mr-1">{label.emoji}</span>
            {label.name}
          </div>
          <div className="text-[11px] text-text-muted">{label.subtitle}</div>
        </div>
        <div className="text-[12px] tabular-nums text-text-secondary">{done} / {topics.length}</div>
      </header>

      {([1, 2, 3, 4] as Tier[]).map((tier) => {
        const tierTopics = listByTier(branch, tier);
        if (tierTopics.length === 0) return null;
        const tierDone = tierTopics.filter((t) => statuses.get(t.id) === 'completed').length;
        return (
          <div key={tier} className="mt-3 first:mt-0">
            <div className="mb-1.5 flex items-baseline justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                Tier {tier} · {TIER_LABELS[tier]}
              </div>
              <div className="text-[10px] tabular-nums text-text-muted">{tierDone}/{tierTopics.length}</div>
            </div>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {tierTopics.map((t) => {
                const status = statuses.get(t.id) ?? 'locked';
                const locked = status === 'locked';
                return (
                  <li key={t.id}>
                    <Link
                      href={`/photography/${t.id}`}
                      className={`flex items-center gap-2 rounded-chip border border-border-subtle px-2.5 py-1.5 text-[13px] transition ${
                        locked
                          ? 'border-dashed text-text-muted hover:text-text-secondary'
                          : 'text-text-secondary hover:bg-chip-active hover:text-text-primary'
                      }`}
                    >
                      <Glyph status={status} />
                      <span className="truncate">{t.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function Glyph({ status }: { status: ProgressEntry['status'] }) {
  const map: Record<ProgressEntry['status'], { glyph: string; cls: string }> = {
    completed:     { glyph: '✓', cls: 'text-delta-up' },
    'in-progress': { glyph: '▶', cls: 'text-text-primary' },
    available:     { glyph: '○', cls: 'text-text-secondary' },
    locked:        { glyph: '🔒', cls: 'opacity-60' },
    skipped:       { glyph: '⊘', cls: 'text-text-muted line-through' },
  };
  const entry = map[status];
  return <span className={`inline-block w-3 text-center text-[12px] ${entry.cls}`}>{entry.glyph}</span>;
}
