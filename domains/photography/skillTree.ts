/**
 * Photography curriculum — the static, hand-curated list of topics Tom can
 * learn. Each topic is metadata (name, prereqs, short seeds); Claude fills in
 * the actual prose lesson and assignment at runtime from `theorySeed` and
 * `assignmentSeed`.
 *
 * The tree is organised into 4 branches × 4 tiers each:
 *
 *   1. operating-camera — confident control of the a6700 in any situation
 *   2. seeing           — making photos that are about something
 *   3. editing          — taking a flat RAW to a finished image (Lightroom Classic)
 *   4. printing         — putting prints on the wall (Epson ET-8550)
 *
 * Branches run in parallel; you don't have to finish one to start another.
 * Within a branch, tiers enforce a soft order — Tier N topics typically
 * require Tier N-1 completions as prereqs.
 *
 * Source of truth — referenced by curriculum.ts, the agent's tools, and the
 * web UI Skills page. See docs/superpowers/specs/2026-05-18-phase-7-photography-domain-design.md.
 */

import { OPERATING_CAMERA_TOPICS } from './tracks/operating-camera.js';
import { SEEING_TOPICS } from './tracks/seeing.js';
import { EDITING_TOPICS } from './tracks/editing.js';
import { PRINTING_TOPICS } from './tracks/printing.js';

export type BranchId = 'operating-camera' | 'seeing' | 'editing' | 'printing';

export type Tier = 1 | 2 | 3 | 4;

export interface Topic {
  /** Stable identifier, namespaced by branch: e.g. 'operating-camera.exposure-triangle'. */
  id: string;
  branch: BranchId;
  /** 1-4 within the branch. Higher tiers are roughly more advanced; cross-tier
   *  prereqs are encoded explicitly via `prereqs`. The tier exists so the
   *  Skills web UI can render the branch as a column of tiers. */
  tier: Tier;
  /** Display name shown in `/skills` and the web UI. */
  name: string;
  /** Topic IDs that must be `completed` before this topic becomes `available`. */
  prereqs: string[];
  /** 1-2 sentence summary; shown in `/skills`, the topic detail page, and as
   *  the agent's high-level orientation when proposing this topic. */
  description: string;
  /** ~80-120 word scaffold Claude expands into the `/learn <topic-id>` explainer. */
  theorySeed: string;
  /** ~80-120 word scaffold Claude expands into a concrete assignment + rubric. */
  assignmentSeed: string;
}

/** All topics across every branch. */
export const ALL_TOPICS: readonly Topic[] = [
  ...OPERATING_CAMERA_TOPICS,
  ...SEEING_TOPICS,
  ...EDITING_TOPICS,
  ...PRINTING_TOPICS,
];

const BY_ID: ReadonlyMap<string, Topic> = new Map(ALL_TOPICS.map((t) => [t.id, t]));

export function getTopicById(id: string): Topic | null {
  return BY_ID.get(id) ?? null;
}

export function listByBranch(branch: BranchId): Topic[] {
  return ALL_TOPICS.filter((t) => t.branch === branch);
}

export function listByTier(branch: BranchId, tier: Tier): Topic[] {
  return ALL_TOPICS.filter((t) => t.branch === branch && t.tier === tier);
}

export interface SkillTreeIssue {
  topicId: string;
  kind: 'unknown-prereq' | 'cycle' | 'self-prereq' | 'duplicate-id' | 'cross-branch-prereq' | 'tier-violation';
  detail: string;
}

/**
 * Static integrity check on the skill tree. Runs at startup (and in tests)
 * to catch authoring mistakes before they confuse Tom. Returns a list of
 * issues — empty when everything is valid.
 *
 * Rules:
 *   - All prereq IDs must reference defined topics.
 *   - A topic cannot list itself as a prereq.
 *   - No prereq cycles.
 *   - Topic IDs must be unique.
 *   - Branches are intentionally independent — a topic in branch X should not
 *     depend on a topic in branch Y (kept as a soft warning, not an error;
 *     cross-branch prereqs are flagged but allowed if a future use case demands).
 *   - A topic's prereqs must all be in the same branch and in an equal-or-lower tier.
 */
export function validateSkillTree(topics: readonly Topic[] = ALL_TOPICS): SkillTreeIssue[] {
  const issues: SkillTreeIssue[] = [];
  const ids = new Set<string>();
  for (const t of topics) {
    if (ids.has(t.id)) {
      issues.push({ topicId: t.id, kind: 'duplicate-id', detail: `Topic id "${t.id}" appears more than once.` });
    }
    ids.add(t.id);
  }
  const byId = new Map(topics.map((t) => [t.id, t]));
  for (const t of topics) {
    for (const p of t.prereqs) {
      if (p === t.id) {
        issues.push({ topicId: t.id, kind: 'self-prereq', detail: `Topic "${t.id}" lists itself as a prereq.` });
        continue;
      }
      const prereq = byId.get(p);
      if (!prereq) {
        issues.push({ topicId: t.id, kind: 'unknown-prereq', detail: `Topic "${t.id}" has prereq "${p}" which is not defined.` });
        continue;
      }
      if (prereq.branch !== t.branch) {
        issues.push({
          topicId: t.id,
          kind: 'cross-branch-prereq',
          detail: `Topic "${t.id}" (branch=${t.branch}) depends on "${p}" in a different branch (${prereq.branch}).`,
        });
      }
      if (prereq.tier > t.tier) {
        issues.push({
          topicId: t.id,
          kind: 'tier-violation',
          detail: `Topic "${t.id}" (tier ${t.tier}) depends on higher-tier "${p}" (tier ${prereq.tier}).`,
        });
      }
    }
  }
  // Cycle detection via DFS with color marking (white=0, grey=1, black=2).
  const color = new Map<string, 0 | 1 | 2>();
  for (const t of topics) color.set(t.id, 0);
  const visit = (id: string, stack: string[]): void => {
    const c = color.get(id);
    if (c === 2) return;
    if (c === 1) {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(' → ');
      issues.push({ topicId: id, kind: 'cycle', detail: `Prereq cycle: ${cycle}` });
      return;
    }
    color.set(id, 1);
    const node = byId.get(id);
    if (node) {
      for (const p of node.prereqs) {
        if (byId.has(p)) visit(p, [...stack, id]);
      }
    }
    color.set(id, 2);
  };
  for (const t of topics) visit(t.id, []);

  return issues;
}
