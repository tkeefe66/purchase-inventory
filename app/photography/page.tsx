import Link from 'next/link';
import { getPhotographyProgress, getPhotographyAssignments } from '../lib/photography-data';
import {
  ALL_TOPICS,
  type BranchId,
} from '../../domains/photography/skillTree.js';
import {
  computeStatuses,
  pickNextTopic,
  type ProgressEntry,
} from '../../domains/photography/curriculum.js';
import type { ProgressRow, ProgressStatus } from '../../lib/photographySheets.js';
import { KpiCard } from '../components/kpi-card';
import { BranchSection } from '../components/branch-section';

export const dynamic = 'force-dynamic';

const BRANCH_LABELS: Record<BranchId, { emoji: string; name: string; subtitle: string }> = {
  'operating-camera': { emoji: '🎥', name: 'Operating Camera', subtitle: 'Confident control of the a6700' },
  'seeing':           { emoji: '👁',  name: 'Seeing',           subtitle: 'Make photos that are about something' },
  'editing':          { emoji: '✏️', name: 'Editing',          subtitle: 'Lightroom Classic, RAW → finished' },
  'printing':         { emoji: '🖨', name: 'Printing',         subtitle: 'Epson ET-8550 to wall prints' },
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
  const statusesMap = computeStatuses(entries);
  const totalDone = ALL_TOPICS.filter((t) => statusesMap.get(t.id) === 'completed').length;
  const totalInProg = ALL_TOPICS.filter((t) => statusesMap.get(t.id) === 'in-progress').length;
  const active = assignments.find((a) => a.status === 'active' || a.status === 'submitted');
  const next = pickNextTopic(entries);
  const isFirstRun = totalDone === 0 && totalInProg === 0;

  // Convert Map → plain object so the client component can serialize it.
  const statusesObj: Record<string, ProgressStatus> = {};
  for (const [id, s] of statusesMap.entries()) statusesObj[id] = s;

  // Default-open the branch the user is most likely working in: prefer
  // the one with the active assignment, else the one with the next topic,
  // else operating-camera as the canonical starting point.
  const defaultOpenBranch: BranchId =
    (active && (statusesMap.get(active.topicId) ? (ALL_TOPICS.find((t) => t.id === active.topicId)?.branch as BranchId) : null))
    ?? (next?.branch ?? 'operating-camera');

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />

      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">Photography</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">Skills</h1>
        {isFirstRun ? (
          <div className="mt-3 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
            <p className="text-[13px] text-text-secondary">
              This is your photography curriculum — {ALL_TOPICS.length} topics across shooting, seeing, editing, and
              printing, built around your gear. Start with{' '}
              {next ? (
                <Link href={`/photography/${next.id}`} className="font-semibold text-text-primary hover:text-text-secondary">
                  {next.name}
                </Link>
              ) : (
                'a topic below'
              )}{' '}
              — the rest unlocks as you go.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-text-secondary">
            {totalDone} of {ALL_TOPICS.length} topics completed · {totalInProg} in progress
          </p>
        )}

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

        <div className="mt-6 text-[12px] text-text-muted">
          <Glyph status="completed" /> completed&nbsp;&nbsp;
          <Glyph status="in-progress" /> in progress&nbsp;&nbsp;
          <Glyph status="available" /> available&nbsp;&nbsp;
          <Glyph status="locked" /> locked&nbsp;&nbsp;
          <Glyph status="skipped" /> skipped
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {(['operating-camera', 'seeing', 'editing', 'printing'] as BranchId[]).map((branch) => (
            <BranchSection
              key={branch}
              branch={branch}
              label={BRANCH_LABELS[branch]}
              statuses={statusesObj}
              defaultOpen={branch === defaultOpenBranch}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Glyph({ status }: { status: ProgressStatus }) {
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
