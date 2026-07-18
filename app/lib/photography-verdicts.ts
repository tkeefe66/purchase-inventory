import type { AssignmentStatus, AssignmentVerdict } from '../../lib/photographySheets.js';

/**
 * Single source of truth for assignment/verdict copy. Used on the topic
 * page, the assignments list, and the submit/grade result view so
 * "did_not_pass" never leaks as raw enum text and always reads as
 * encouragement ("Not yet") rather than a judgment.
 */
export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  proposed: 'Proposed',
  active: 'Active',
  submitted: 'Submitted',
  passed: 'Passed',
  did_not_pass: 'Not yet',
  skipped: 'Skipped',
};

export const VERDICT_LABELS: Record<'pass' | 'did_not_pass', string> = {
  pass: 'Passed',
  did_not_pass: 'Not yet',
};

/** Prefers the grading verdict when present, falls back to lifecycle status (e.g. "Active", "Skipped"). */
export function assignmentLabel(status: AssignmentStatus, verdict: AssignmentVerdict): string {
  if (verdict === 'pass' || verdict === 'did_not_pass') return VERDICT_LABELS[verdict];
  return ASSIGNMENT_STATUS_LABELS[status];
}

const CRITERION_RANK: Record<'pass' | 'partial' | 'fail', number> = { pass: 0, partial: 1, fail: 2 };

/** Leads with what passed before what didn't — coaching framing, not a judgment list. */
export function sortCriteriaPassFirst<T extends { result: string }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (CRITERION_RANK[a.result as 'pass' | 'partial' | 'fail'] ?? 3) -
      (CRITERION_RANK[b.result as 'pass' | 'partial' | 'fail'] ?? 3),
  );
}
