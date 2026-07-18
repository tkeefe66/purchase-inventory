import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPhotographyProgress, getPhotographyAssignments } from '../../lib/photography-data';
import {
  getTopicById,
  type BranchId,
  type Tier,
} from '../../../domains/photography/skillTree.js';
import { computeStatuses, type ProgressEntry } from '../../../domains/photography/curriculum.js';
import type { AssignmentRow, ProgressRow } from '../../../lib/photographySheets.js';
import { Markdown } from '../../components/markdown';
import { assignmentLabel, sortCriteriaPassFirst } from '../../lib/photography-verdicts';
import { StatusGlyph, STATUS_LABEL } from '../../components/status-glyph';
import { CameraIcon, EyeIcon, EditIcon, PrinterIcon, CheckIcon, PlayIcon, CircleIcon, LockIcon, SlashIcon } from '../../components/icons';
import { TopicActions } from './topic-actions';

export const dynamic = 'force-dynamic';

const BRANCH_LABELS: Record<BranchId, { icon: React.ReactNode; name: string }> = {
  'operating-camera': { icon: <CameraIcon size={14} />, name: 'Operating Camera' },
  'seeing':           { icon: <EyeIcon size={14} />,    name: 'Seeing' },
  'editing':          { icon: <EditIcon size={14} />,   name: 'Editing' },
  'printing':         { icon: <PrinterIcon size={14} />, name: 'Printing' },
};

const TIER_LABELS: Record<Tier, string> = {
  1: 'Foundation',
  2: 'Control / Workflow / Refinement',
  3: 'Refinement / Recipes / Craft',
  4: 'Mastery / Output / Display',
};

interface PageProps {
  params: { topicId: string };
}

// Shared treatment for the section headers below the fold — sentence case,
// medium weight, no eyebrow scaffolding. The page keeps exactly one true
// eyebrow ("Photography", above the title).
const SECTION_HEADING_CLASS = 'mb-2 text-[13px] font-medium text-text-secondary';

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

export default async function TopicPage({ params }: PageProps) {
  const topic = getTopicById(params.topicId);
  if (!topic) notFound();

  const [progress, allAssignments] = await Promise.all([
    getPhotographyProgress(),
    getPhotographyAssignments(),
  ]);
  const entries = toEntries(progress);
  const statuses = computeStatuses(entries);
  const status = statuses.get(topic.id) ?? 'locked';
  const branchLabel = BRANCH_LABELS[topic.branch];

  const myAssignments = allAssignments
    .filter((a) => a.topicId === topic.id)
    .sort((a, b) => (b.dateIssued || '').localeCompare(a.dateIssued || ''));
  const activeOnThisTopic = myAssignments.find(
    (a) => a.status === 'active' || a.status === 'submitted',
  );

  const prereqStatuses = topic.prereqs.map((p) => {
    const prereq = getTopicById(p);
    return {
      id: p,
      name: prereq?.name ?? p,
      status: statuses.get(p) ?? 'locked',
      completed: statuses.get(p) === 'completed',
    };
  });
  const allPrereqsMet = prereqStatuses.every((p) => p.completed);

  return (
    <div className="px-4 py-6 md:px-7">
      <div className="max-w-4xl">
        <Link
          href="/photography"
          className="inline-flex items-center gap-1 rounded-chip border border-border-subtle bg-bg-surface px-2.5 py-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          ← Skills
        </Link>
        <div className="mt-3 text-[11px] uppercase tracking-[0.05em] text-text-muted">Photography</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">{topic.name}</h1>
        <div className="mt-1 flex items-center gap-1.5 text-[13px] text-text-secondary">
          <span className="text-accent-from" aria-hidden="true">{branchLabel.icon}</span>
          {branchLabel.name} · Tier {topic.tier}
        </div>
        <p className="mt-2 text-[13px] text-text-secondary">{topic.description}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2" title={topic.id}>
          <StatusPill status={status} />
        </div>

        <TopicActions
          topicId={topic.id}
          topicName={topic.name}
          hasActiveAssignment={Boolean(activeOnThisTopic)}
          prereqsMet={allPrereqsMet}
          {...(activeOnThisTopic ? { activeAssignmentText: activeOnThisTopic.assignmentText } : {})}
          {...(activeOnThisTopic ? { activeAssignmentRubricJson: activeOnThisTopic.rubricJson } : {})}
        />

        {/* Prereqs section */}
        {topic.prereqs.length > 0 && (
          <section className="mt-6 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
            <h2 className={SECTION_HEADING_CLASS}>
              Prereqs ({prereqStatuses.filter((p) => p.completed).length} of {prereqStatuses.length} complete)
            </h2>
            <ul className="space-y-1">
              {prereqStatuses.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-[13px]">
                  <StatusGlyph status={p.status} label />
                  <Link href={`/photography/${p.id}`} title={p.id} className="text-text-secondary hover:text-text-primary">
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Theory preview (read-only; full lesson via Read theory) */}
        <section className="mt-4 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
          <h2 className={SECTION_HEADING_CLASS}>Theory preview</h2>
          <Markdown text={topic.theorySeed} />
          <p className="mt-3 text-[11px] text-text-muted">
            A preview only — <em>Read theory</em> above expands this into the full lesson, grounded in your gear.
          </p>
        </section>

        {/* Assignment preview */}
        <section className="mt-4 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
          <h2 className={SECTION_HEADING_CLASS}>Assignment preview</h2>
          <Markdown text={topic.assignmentSeed} />
          <p className="mt-3 text-[11px] text-text-muted">
            A preview only — <em>Start assignment</em> above turns this into a full rubric.
          </p>
        </section>

        {/* Assignment history for this topic */}
        <section className="mt-4 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
          <h2 className={SECTION_HEADING_CLASS}>Assignment history ({myAssignments.length})</h2>
          {myAssignments.length === 0 ? (
            <p className="text-[12px] text-text-muted">No assignments for this topic yet.</p>
          ) : (
            <ul className="space-y-2">
              {myAssignments.map((a) => (
                <li key={a.id} className="rounded-input border border-border-subtle bg-bg-base p-3">
                  <AssignmentSummary assignment={a} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

const STATUS_PILL_ICON: Record<ProgressEntry['status'], typeof CheckIcon> = {
  completed: CheckIcon,
  'in-progress': PlayIcon,
  available: CircleIcon,
  locked: LockIcon,
  skipped: SlashIcon,
};

const STATUS_PILL_CLASS: Record<ProgressEntry['status'], string> = {
  completed: 'bg-delta-up/15 text-delta-up',
  'in-progress': 'bg-chip-active text-text-primary',
  available: 'bg-bg-surface text-text-secondary border border-border-subtle',
  locked: 'bg-bg-surface text-text-muted border border-dashed border-border-subtle',
  skipped: 'bg-bg-surface text-text-muted border border-border-subtle',
};

function StatusPill({ status }: { status: ProgressEntry['status'] }) {
  const Icon = STATUS_PILL_ICON[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-chip px-2 py-1 text-[11px] font-semibold ${STATUS_PILL_CLASS[status]}`}>
      <Icon size={12} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function AssignmentSummary({ assignment }: { assignment: AssignmentRow }) {
  const verdictColor =
    assignment.aiVerdict === 'pass' ? 'text-delta-up'
    : assignment.aiVerdict === 'did_not_pass' ? 'text-delta-down'
    : 'text-text-muted';
  const date = assignment.dateGraded || assignment.dateSubmitted || assignment.dateIssued;
  const dateLabel = date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'date unknown';
  return (
    <details className="group">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center gap-2 text-[13px]">
          <span className={`font-semibold ${verdictColor}`}>
            {assignmentLabel(assignment.status, assignment.aiVerdict)}
          </span>
          <span className="text-text-muted">·</span>
          <span className="text-text-secondary">{dateLabel}</span>
          {assignment.retryCount > 0 && (
            <span className="ml-auto rounded-chip bg-bg-surface px-2 py-0.5 text-[10px] text-text-muted">
              retry {assignment.retryCount}
            </span>
          )}
        </div>
      </summary>
      <div className="mt-2 space-y-2 text-[12px] text-text-secondary">
        {assignment.assignmentText && (
          <div>
            <div className={SECTION_HEADING_CLASS}>Assignment</div>
            <p className="whitespace-pre-wrap">{assignment.assignmentText}</p>
          </div>
        )}
        {assignment.aiCritique && (
          <div>
            <div className={SECTION_HEADING_CLASS}>Critique</div>
            <p className="whitespace-pre-wrap">{assignment.aiCritique}</p>
          </div>
        )}
        {assignment.perCriterionJson && (
          <PerCriterionList json={assignment.perCriterionJson} />
        )}
      </div>
    </details>
  );
}

function PerCriterionList({ json }: { json: string }) {
  let items: Array<{ criterion: string; result: string; reason?: string }>;
  try {
    items = JSON.parse(json) as Array<{ criterion: string; result: string; reason?: string }>;
  } catch {
    return null;
  }
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <div className={SECTION_HEADING_CLASS}>Per criterion</div>
      <ul className="mt-1 space-y-1">
        {sortCriteriaPassFirst(items).map((c, i) => {
          const glyph = c.result === 'pass' ? '✓' : c.result === 'partial' ? '~' : '✗';
          const cls = c.result === 'pass' ? 'text-delta-up' : c.result === 'partial' ? 'text-text-secondary' : 'text-delta-down';
          return (
            <li key={i} className="flex gap-2">
              <span className={`w-3 text-center ${cls}`}>{glyph}</span>
              <span><strong>{c.criterion}</strong>{c.reason ? ` — ${c.reason}` : ''}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
