/**
 * Curriculum runtime — pure functions that operate on (progress, skillTree) to
 * answer the questions the bot and agent need:
 *
 *   - what is the status of every topic right now? (computeStatuses)
 *   - are this topic's prereqs satisfied? (checkPrereqs)
 *   - what should Tom work on next? (pickNextTopic)
 *   - give me an N-topic plan from here. (generatePlan)
 *   - how do I update a topic's progress after a given event? (applyProgressUpdate)
 *
 * No sheet I/O lives here — that\'s in lib/photographySheets.ts. This file
 * stays pure so it can be unit-tested without touching Google.
 */

import {
  ALL_TOPICS,
  type BranchId,
  type Topic,
} from './skillTree.js';
import type { ProgressStatus } from '../../lib/photographySheets.js';

/** In-memory shape used by curriculum logic — same as the sheet ProgressRow
 *  minus the sheet-specific rowIndex. */
export interface ProgressEntry {
  topicId: string;
  status: ProgressStatus;
  lastActivityAt: string;
  assignmentsPassed: number;
  assignmentsFailed: number;
  theoryLastReadAt: string;
}

export type ProgressEvent =
  | { kind: 'theory-read' }
  | { kind: 'assignment-started' }
  | { kind: 'assignment-passed' }
  | { kind: 'assignment-failed' }
  | { kind: 'skipped'; reason?: string };

export type PrereqCheck = { ok: true } | { ok: false; missing: string[] };

interface PickOptions {
  branch?: BranchId;
  topics?: readonly Topic[];
}

/**
 * Compute the user-facing status for every topic in the tree.
 *
 * Status precedence: an explicit entry in `progress` (in-progress / completed /
 * skipped) wins. Otherwise: 'available' if all prereqs are 'completed';
 * 'locked' otherwise. 'available' from a sheet entry is treated the same as
 * derived 'available' (i.e. the entry is opportunistic, not authoritative).
 */
export function computeStatuses(
  progress: ReadonlyMap<string, ProgressEntry>,
  topics: readonly Topic[] = ALL_TOPICS,
): Map<string, ProgressStatus> {
  const out = new Map<string, ProgressStatus>();
  for (const t of topics) {
    const entry = progress.get(t.id);
    if (entry && (entry.status === 'in-progress' || entry.status === 'completed' || entry.status === 'skipped')) {
      out.set(t.id, entry.status);
      continue;
    }
    const allPrereqsComplete = t.prereqs.every((p) => {
      const pe = progress.get(p);
      return pe?.status === 'completed';
    });
    out.set(t.id, allPrereqsComplete ? 'available' : 'locked');
  }
  return out;
}

/**
 * Check whether a topic's prereqs are all completed. Returns the missing
 * prereq IDs if not. Unknown topic IDs return ok=false with an empty
 * missing list (caller should treat that as a programming error).
 */
export function checkPrereqs(
  topicId: string,
  progress: ReadonlyMap<string, ProgressEntry>,
  topics: readonly Topic[] = ALL_TOPICS,
): PrereqCheck {
  const topic = topics.find((t) => t.id === topicId);
  if (!topic) return { ok: false, missing: [] };
  const missing = topic.prereqs.filter((p) => {
    const pe = progress.get(p);
    return pe?.status !== 'completed';
  });
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * Pick the next topic Tom should work on.
 *
 * Strategy:
 *   1. If any topic is in-progress (optionally filtered to a branch), return it
 *      — finish what you started.
 *   2. Else: among 'available' topics, pick the one with the lowest tier first
 *      so the user doesn't accidentally skip foundational work.
 *   3. Within the same tier, deterministic tiebreak by topic id so behaviour
 *      is stable across calls.
 *
 * Returns null when there's nothing left to do (everything completed or
 * skipped, or the branch filter has no available topics).
 */
export function pickNextTopic(
  progress: ReadonlyMap<string, ProgressEntry>,
  options: PickOptions = {},
): Topic | null {
  const topics = options.topics ?? ALL_TOPICS;
  const branchFilter = options.branch;
  const scoped = branchFilter ? topics.filter((t) => t.branch === branchFilter) : [...topics];
  const statuses = computeStatuses(progress, topics);

  // 1) In-progress first (within scope)
  const inProgress = scoped.find((t) => statuses.get(t.id) === 'in-progress');
  if (inProgress) return inProgress;

  // 2) Available, lowest tier first, deterministic tiebreak by id
  const available = scoped
    .filter((t) => statuses.get(t.id) === 'available')
    .sort((a, b) => (a.tier - b.tier) || a.id.localeCompare(b.id));
  return available[0] ?? null;
}

/**
 * Build an N-topic plan starting from current progress. Walks pickNextTopic
 * iteratively, simulating "Tom completes the suggested topic" between each
 * call. Stops early if no more topics are available.
 *
 * The plan is suggestive, not prescriptive — the agent uses it to answer
 * "give me a 2-week plan" by listing the next N likely topics.
 */
export function generatePlan(
  progress: ReadonlyMap<string, ProgressEntry>,
  count: number,
  options: PickOptions = {},
): Topic[] {
  if (count <= 0) return [];
  const sim = new Map(progress);
  const plan: Topic[] = [];
  for (let i = 0; i < count; i++) {
    const next = pickNextTopic(sim, options);
    if (!next) break;
    plan.push(next);
    // Simulate completion so the next iteration sees this topic done
    sim.set(next.id, {
      topicId: next.id,
      status: 'completed',
      lastActivityAt: '',
      assignmentsPassed: 0,
      assignmentsFailed: 0,
      theoryLastReadAt: '',
    });
  }
  return plan;
}

/**
 * Compute the next progress entry for a topic given an event. Pure — takes the
 * current entry (or null if none exists) and an event, returns the next entry.
 * Caller is responsible for persisting via lib/photographySheets.ts.
 */
export function applyProgressUpdate(
  current: ProgressEntry | null,
  topicId: string,
  event: ProgressEvent,
  now: string,
): ProgressEntry {
  const base: ProgressEntry = current ?? {
    topicId,
    status: 'available',
    lastActivityAt: '',
    assignmentsPassed: 0,
    assignmentsFailed: 0,
    theoryLastReadAt: '',
  };
  switch (event.kind) {
    case 'theory-read':
      return { ...base, theoryLastReadAt: now };
    case 'assignment-started':
      return { ...base, status: 'in-progress', lastActivityAt: now };
    case 'assignment-passed':
      return {
        ...base,
        status: 'completed',
        lastActivityAt: now,
        assignmentsPassed: base.assignmentsPassed + 1,
      };
    case 'assignment-failed':
      return {
        ...base,
        status: 'in-progress',
        lastActivityAt: now,
        assignmentsFailed: base.assignmentsFailed + 1,
      };
    case 'skipped':
      return { ...base, status: 'skipped', lastActivityAt: now };
  }
}
