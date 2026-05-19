import Link from 'next/link';
import { getPhotographyAssignments } from '../../lib/photography-data';
import { getTopicById } from '../../../domains/photography/skillTree.js';
import type { AssignmentRow, AssignmentStatus } from '../../../lib/photographySheets.js';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { status?: string };
}

const STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',             label: 'All' },
  { value: 'active',       label: 'Active' },
  { value: 'submitted',    label: 'Submitted' },
  { value: 'passed',       label: 'Passed' },
  { value: 'did_not_pass', label: 'Did not pass' },
  { value: 'skipped',      label: 'Skipped' },
];

export default async function AssignmentsPage({ searchParams }: PageProps) {
  const allAssignments = await getPhotographyAssignments();
  const filter = (searchParams.status ?? '') as AssignmentStatus | '';
  const rows = filter
    ? allAssignments.filter((a) => a.status === filter)
    : allAssignments;

  // Sort newest first by graded > submitted > issued
  const sorted = [...rows].sort((a, b) => {
    const ad = a.dateGraded || a.dateSubmitted || a.dateIssued || '';
    const bd = b.dateGraded || b.dateSubmitted || b.dateIssued || '';
    return bd.localeCompare(ad);
  });

  const counts: Record<AssignmentStatus, number> = {
    proposed:    allAssignments.filter((a) => a.status === 'proposed').length,
    active:      allAssignments.filter((a) => a.status === 'active').length,
    submitted:   allAssignments.filter((a) => a.status === 'submitted').length,
    passed:      allAssignments.filter((a) => a.status === 'passed').length,
    did_not_pass: allAssignments.filter((a) => a.status === 'did_not_pass').length,
    skipped:     allAssignments.filter((a) => a.status === 'skipped').length,
  };

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />
      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">
          <Link href="/photography" className="hover:text-text-secondary">Photography</Link>
        </div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">Assignments</h1>
        <p className="text-[13px] text-text-secondary">
          {allAssignments.length} total ·{' '}
          {counts.passed} passed · {counts.did_not_pass} did not pass · {counts.active + counts.submitted} open · {counts.skipped} skipped
        </p>

        {/* Status filter chips */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {STATUS_FILTER_OPTIONS.map((opt) => {
            const isActive = filter === opt.value;
            const count = opt.value === '' ? allAssignments.length : counts[opt.value as AssignmentStatus] ?? 0;
            return (
              <Link
                key={opt.value || 'all'}
                href={opt.value ? `/photography/assignments?status=${opt.value}` : '/photography/assignments'}
                className={`rounded-chip border px-2.5 py-1 text-[12px] transition ${
                  isActive
                    ? 'border-border-subtle bg-chip-active font-semibold text-text-primary'
                    : 'border-border-subtle bg-bg-surface text-text-secondary hover:text-text-primary'
                }`}
              >
                {opt.label} <span className="ml-1 tabular-nums text-text-muted">{count}</span>
              </Link>
            );
          })}
        </div>

        {/* Assignment list */}
        <div className="mt-6 space-y-3">
          {sorted.length === 0 ? (
            <div className="rounded-kpi border border-dashed border-border-subtle bg-bg-surface p-6 text-center text-[13px] text-text-muted">
              No assignments yet. Run <code className="rounded-chip bg-bg-base px-1.5 py-0.5">/start &lt;topic-id&gt;</code> in Telegram.
            </div>
          ) : (
            sorted.map((a) => <AssignmentCard key={a.id} assignment={a} />)
          )}
        </div>
      </div>
    </div>
  );
}

function AssignmentCard({ assignment }: { assignment: AssignmentRow }) {
  const topic = getTopicById(assignment.topicId);
  const date = assignment.dateGraded || assignment.dateSubmitted || assignment.dateIssued;
  const dateLabel = date
    ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'date unknown';

  return (
    <article className="rounded-kpi border border-border-subtle bg-bg-surface p-4 shadow-card">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <StatusBadge status={assignment.status} />
            <span className="text-[11px] text-text-muted">{dateLabel}</span>
            {assignment.retryCount > 0 && (
              <span className="rounded-chip bg-bg-base px-1.5 py-0.5 text-[10px] text-text-muted">
                retry {assignment.retryCount}
              </span>
            )}
          </div>
          <h3 className="mt-1 text-[15px] font-semibold tracking-[-0.01em] text-text-primary">
            {topic ? (
              <Link href={`/photography/${assignment.topicId}`} className="hover:text-text-secondary">
                {topic.name}
              </Link>
            ) : (
              <span>{assignment.topicId}</span>
            )}
          </h3>
        </div>
      </header>

      <details className="group">
        <summary className="cursor-pointer list-none text-[12px] text-text-secondary hover:text-text-primary">
          {assignment.assignmentText ? trim(assignment.assignmentText, 160) : '(no assignment text)'}
          <span className="ml-1 text-text-muted group-open:hidden">… expand</span>
        </summary>
        <div className="mt-3 space-y-3 text-[13px]">
          <Section title="Assignment">
            <p className="whitespace-pre-wrap text-text-secondary">{assignment.assignmentText}</p>
          </Section>
          {assignment.userNotes && (
            <Section title="Your caption">
              <p className="whitespace-pre-wrap text-text-secondary">{assignment.userNotes}</p>
            </Section>
          )}
          {(assignment.camera || assignment.lens) && (
            <Section title="Gear used">
              <p className="text-text-secondary">{[assignment.camera, assignment.lens].filter(Boolean).join(' · ')}</p>
            </Section>
          )}
          {assignment.aiCritique && (
            <Section title="Critique">
              <p className="whitespace-pre-wrap text-text-secondary">{assignment.aiCritique}</p>
            </Section>
          )}
          {assignment.perCriterionJson && <PerCriterionList json={assignment.perCriterionJson} />}
        </div>
      </details>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{title}</div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: AssignmentStatus }) {
  const map: Record<AssignmentStatus, { label: string; cls: string }> = {
    proposed:     { label: 'Proposed',     cls: 'bg-bg-base text-text-muted border border-border-subtle' },
    active:       { label: 'Active',       cls: 'bg-chip-active text-text-primary' },
    submitted:    { label: 'Submitted',    cls: 'bg-chip-active text-text-primary' },
    passed:       { label: '✓ Passed',     cls: 'bg-delta-up/15 text-delta-up' },
    did_not_pass: { label: '✗ Did not pass', cls: 'bg-delta-down/15 text-delta-down' },
    skipped:      { label: '⊘ Skipped',    cls: 'bg-bg-base text-text-muted border border-border-subtle' },
  };
  const entry = map[status];
  return <span className={`rounded-chip px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${entry.cls}`}>{entry.label}</span>;
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
    <Section title="Per criterion">
      <ul className="space-y-1">
        {items.map((c, i) => {
          const glyph = c.result === 'pass' ? '✓' : c.result === 'partial' ? '~' : '✗';
          const cls = c.result === 'pass' ? 'text-delta-up' : c.result === 'partial' ? 'text-text-secondary' : 'text-delta-down';
          return (
            <li key={i} className="flex gap-2">
              <span className={`w-3 text-center ${cls}`}>{glyph}</span>
              <span className="text-text-secondary"><strong>{c.criterion}</strong>{c.reason ? ` — ${c.reason}` : ''}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
