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

export const dynamic = 'force-dynamic';

const BRANCH_LABELS: Record<BranchId, { emoji: string; name: string }> = {
  'operating-camera': { emoji: '🎥', name: 'Operating Camera' },
  'seeing':           { emoji: '👁',  name: 'Seeing' },
  'editing':          { emoji: '✏️', name: 'Editing' },
  'printing':         { emoji: '🖨', name: 'Printing' },
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

  // Telegram deep-link via universal link (tg://msg?text=… works on iOS/Android)
  const tgEncode = (s: string) => encodeURIComponent(s);

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />
      <div className="relative max-w-4xl">
        <Link
          href="/photography"
          className="inline-flex items-center gap-1 rounded-chip border border-border-subtle bg-bg-surface px-2.5 py-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          ← Skills
        </Link>
        <div className="mt-3 text-[11px] uppercase tracking-[0.05em] text-text-muted">
          {branchLabel.emoji} {branchLabel.name}{' · '}Tier {topic.tier}
        </div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">{topic.name}</h1>
        <p className="text-[13px] text-text-secondary">{topic.description}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          <code className="rounded-chip bg-bg-surface px-2 py-1 text-[11px] text-text-muted">{topic.id}</code>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <a
            href={`tg://msg?text=${tgEncode(`/learn ${topic.id}`)}`}
            className="rounded-input bg-bg-surface border border-border-subtle px-3 py-2 text-[13px] text-text-primary hover:bg-chip-active"
          >
            📖 Read theory in Telegram
          </a>
          {activeOnThisTopic ? (
            <a
              href={`tg://msg?text=${tgEncode('/skip')}`}
              className="rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] text-text-secondary hover:bg-chip-active hover:text-text-primary"
              title="Skip the active assignment for this topic"
            >
              ⊘ Skip assignment
            </a>
          ) : allPrereqsMet ? (
            <a
              href={`tg://msg?text=${tgEncode(`/start ${topic.id}`)}`}
              className="rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110"
            >
              🚀 Start assignment
            </a>
          ) : (
            <span
              title="Prereqs not yet completed"
              className="cursor-not-allowed rounded-input border border-dashed border-border-subtle px-3 py-2 text-[13px] text-text-muted"
            >
              🔒 Start assignment
            </span>
          )}
        </div>

        {/* Prereqs section */}
        {topic.prereqs.length > 0 && (
          <section className="mt-6 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              Prereqs ({prereqStatuses.filter((p) => p.completed).length} of {prereqStatuses.length} complete)
            </h2>
            <ul className="space-y-1">
              {prereqStatuses.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-[13px]">
                  <StatusGlyph status={p.status} />
                  <Link href={`/photography/${p.id}`} className="text-text-secondary hover:text-text-primary">
                    {p.name}
                  </Link>
                  <code className="ml-1 text-[10px] text-text-muted">{p.id}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Theory seed (read-only preview; full lesson via /learn in Telegram) */}
        <section className="mt-4 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Theory seed
          </h2>
          <Markdown text={topic.theorySeed} />
          <p className="mt-3 text-[11px] text-text-muted">
            This is the scaffold the lesson is built from. Run <code className="rounded bg-bg-base px-1 py-0.5">/learn {topic.id}</code> in Telegram for the
            Claude-expanded version grounded in your gear.
          </p>
        </section>

        {/* Assignment seed */}
        <section className="mt-4 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Assignment seed
          </h2>
          <Markdown text={topic.assignmentSeed} />
          <p className="mt-3 text-[11px] text-text-muted">
            <code className="rounded bg-bg-base px-1 py-0.5">/start {topic.id}</code> generates the actual assignment + rubric from this scaffold using Claude.
          </p>
        </section>

        {/* Assignment history for this topic */}
        <section className="mt-4 rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Assignment history ({myAssignments.length})
          </h2>
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

function StatusPill({ status }: { status: ProgressEntry['status'] }) {
  const map: Record<ProgressEntry['status'], { label: string; cls: string }> = {
    completed:     { label: '✓ Completed',  cls: 'bg-delta-up/15 text-delta-up' },
    'in-progress': { label: '▶ In progress', cls: 'bg-chip-active text-text-primary' },
    available:     { label: '○ Available',   cls: 'bg-bg-surface text-text-secondary border border-border-subtle' },
    locked:        { label: '🔒 Locked',     cls: 'bg-bg-surface text-text-muted border border-dashed border-border-subtle' },
    skipped:       { label: '⊘ Skipped',     cls: 'bg-bg-surface text-text-muted border border-border-subtle' },
  };
  const entry = map[status];
  return <span className={`rounded-chip px-2 py-1 text-[11px] font-semibold ${entry.cls}`}>{entry.label}</span>;
}

function StatusGlyph({ status }: { status: ProgressEntry['status'] }) {
  const map: Record<ProgressEntry['status'], { glyph: string; cls: string }> = {
    completed:     { glyph: '✓', cls: 'text-delta-up' },
    'in-progress': { glyph: '▶', cls: 'text-text-primary' },
    available:     { glyph: '○', cls: 'text-text-secondary' },
    locked:        { glyph: '🔒', cls: 'opacity-60' },
    skipped:       { glyph: '⊘', cls: 'text-text-muted' },
  };
  const entry = map[status];
  return <span className={`inline-block w-3 text-center text-[12px] ${entry.cls}`}>{entry.glyph}</span>;
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
          <span className={`font-semibold uppercase tracking-wide ${verdictColor}`}>
            {assignment.aiVerdict || assignment.status}
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
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Assignment</div>
            <p className="whitespace-pre-wrap">{assignment.assignmentText}</p>
          </div>
        )}
        {assignment.aiCritique && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Critique</div>
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
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Per criterion</div>
      <ul className="mt-1 space-y-1">
        {items.map((c, i) => {
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
