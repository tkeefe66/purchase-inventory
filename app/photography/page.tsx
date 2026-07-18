import Link from 'next/link';
import { getPhotographyProgress, getPhotographyAssignments } from '../lib/photography-data';
import {
  ALL_TOPICS,
  getTopicById,
  type BranchId,
  type Topic,
} from '../../domains/photography/skillTree.js';
import {
  computeStatuses,
  pickNextTopic,
  type ProgressEntry,
} from '../../domains/photography/curriculum.js';
import type { AssignmentRow, ProgressRow, ProgressStatus } from '../../lib/photographySheets.js';
import { BranchSection } from '../components/branch-section';
import { StatusGlyph, STATUS_LABEL } from '../components/status-glyph';
import { CameraIcon, EyeIcon, EditIcon, PrinterIcon, PlayIcon, CheckIcon } from '../components/icons';

export const dynamic = 'force-dynamic';

const BRANCH_LABELS: Record<BranchId, { icon: React.ReactNode; name: string; subtitle: string }> = {
  'operating-camera': { icon: <CameraIcon size={16} />, name: 'Operating Camera', subtitle: 'Confident control of the a6700' },
  'seeing':           { icon: <EyeIcon size={16} />,    name: 'Seeing',           subtitle: 'Make photos that are about something' },
  'editing':          { icon: <EditIcon size={16} />,   name: 'Editing',          subtitle: 'Lightroom Classic, RAW → finished' },
  'printing':         { icon: <PrinterIcon size={16} />, name: 'Printing',        subtitle: 'Epson ET-8550 to wall prints' },
};

const STATUS_LEGEND: ProgressStatus[] = ['completed', 'in-progress', 'available', 'locked', 'skipped'];

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
  const activeTopic = active ? getTopicById(active.topicId) : null;
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
    <div className="px-4 py-6 md:px-7">
      <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">Photography</div>
      <h1 className="mt-1 text-balance text-[26px] font-bold tracking-[-0.02em] text-text-primary">Skills</h1>

      <NextMoveCard
        active={active ?? null}
        activeTopic={activeTopic ?? null}
        next={next}
        isFirstRun={isFirstRun}
      />
      <p className="mt-2.5 text-[13px] text-text-secondary">
        {totalDone} of {ALL_TOPICS.length} topics completed · {totalInProg} in progress
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-text-muted">
        {STATUS_LEGEND.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <StatusGlyph status={s} />
            {STATUS_LABEL[s]}
          </span>
        ))}
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
  );
}

function NextMoveCard({
  active,
  activeTopic,
  next,
  isFirstRun,
}: {
  active: AssignmentRow | null;
  activeTopic: Topic | null;
  next: Topic | null;
  isFirstRun: boolean;
}) {
  if (active && activeTopic) {
    return (
      <NextMoveCardShell
        href={`/photography/${activeTopic.id}`}
        icon={<PlayIcon size={20} className="text-text-primary" />}
        eyebrow="Finish what you started"
        topicName={activeTopic.name}
        reason={`${BRANCH_LABELS[activeTopic.branch].name} · assignment in progress`}
      />
    );
  }
  if (next) {
    return (
      <NextMoveCardShell
        href={`/photography/${next.id}`}
        icon={BRANCH_LABELS[next.branch].icon}
        eyebrow={isFirstRun ? 'Start here' : 'Up next'}
        topicName={next.name}
        reason={isFirstRun ? 'Your first assignment — the rest unlocks as you go.' : 'Picks up where you left off.'}
      />
    );
  }
  return (
    <div className="mt-3 flex items-center gap-3 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-input bg-delta-up/15 text-delta-up">
        <CheckIcon size={20} />
      </span>
      <p className="text-[13px] text-text-secondary">
        Every unlocked topic is complete. Check back once new topics open up, or revisit one for a fresh assignment.
      </p>
    </div>
  );
}

function NextMoveCardShell({
  href,
  icon,
  eyebrow,
  topicName,
  reason,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  topicName: string;
  reason: string;
}) {
  return (
    <Link
      href={href}
      className="group mt-3 flex items-center gap-3.5 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card transition hover:border-accent-from/50"
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-input bg-chip-active text-accent-from" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-text-secondary">{eyebrow}</div>
        <div className="truncate text-[18px] font-bold tracking-[-0.01em] text-text-primary" title={topicName}>
          {topicName}
        </div>
        <div className="truncate text-[12px] text-text-muted">{reason}</div>
      </div>
      <span
        className="flex-none text-text-muted transition group-hover:translate-x-0.5 group-hover:text-text-primary motion-reduce:group-hover:translate-x-0"
        aria-hidden="true"
      >
        →
      </span>
    </Link>
  );
}
