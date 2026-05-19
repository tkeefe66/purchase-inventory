import {
  ALL_TOPICS,
  type BranchId,
  type Tier,
  type Topic,
  getTopicById,
  listByBranch,
  listByTier,
} from '../../../domains/photography/skillTree.js';
import {
  computeStatuses,
  pickNextTopic,
  generatePlan,
  applyProgressUpdate,
  type ProgressEntry,
} from '../../../domains/photography/curriculum.js';
import type {
  AssignmentRow,
  ProgressRow,
  ProgressStatus,
} from '../../../lib/photographySheets.js';

// ---------------------------------------------------------------------------
// Dependencies — sheet I/O injected by the bot wiring layer.
// ---------------------------------------------------------------------------

export interface PhotographyDeps {
  readProgress: () => Promise<ProgressRow[]>;
  upsertProgress: (
    topicId: string,
    patch: Partial<Omit<ProgressRow, 'rowIndex' | 'topicId'>>,
  ) => Promise<void>;
  getActiveAssignment: () => Promise<AssignmentRow | null>;
  updateAssignment: (
    rowIndex: number,
    patch: Partial<Omit<AssignmentRow, 'rowIndex'>>,
  ) => Promise<void>;
  /** ISO timestamp of "now" — injectable for tests. */
  now: () => string;
}

const BRANCH_LABELS: Record<BranchId, { emoji: string; name: string }> = {
  'operating-camera': { emoji: '🎥', name: 'Operating Camera' },
  'seeing': { emoji: '👁', name: 'Seeing' },
  'editing': { emoji: '✏️', name: 'Editing' },
  'printing': { emoji: '🖨', name: 'Printing' },
};

const TIER_LABELS: Record<Tier, string> = {
  1: 'Foundation',
  2: 'Control / Workflow / Refinement',
  3: 'Refinement / Recipes / Craft',
  4: 'Mastery / Output / Display',
};

const STATUS_GLYPH: Record<ProgressStatus, string> = {
  'locked':      '🔒',
  'available':   '○',
  'in-progress': '▶',
  'completed':   '✓',
  'skipped':     '⊘',
};

// ---------------------------------------------------------------------------
// Helpers — progress shape conversions
// ---------------------------------------------------------------------------

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

function tierLine(branch: BranchId, tier: Tier, statuses: ReadonlyMap<string, ProgressStatus>): string {
  const topics = listByTier(branch, tier);
  if (topics.length === 0) return '';
  const done = topics.filter((t) => statuses.get(t.id) === 'completed').length;
  const inProg = topics.filter((t) => statuses.get(t.id) === 'in-progress').length;
  const marker = inProg > 0 ? '▶' : done === topics.length ? '✓' : ' ';
  return `T${tier}: ${done}/${topics.length} ${marker}`;
}

function branchSummary(branch: BranchId, statuses: ReadonlyMap<string, ProgressStatus>): string {
  const all = listByBranch(branch);
  const done = all.filter((t) => statuses.get(t.id) === 'completed').length;
  const label = BRANCH_LABELS[branch];
  const tierLines = ([1, 2, 3, 4] as Tier[])
    .map((t) => tierLine(branch, t, statuses))
    .filter((s) => s !== '')
    .join('   ');
  return `${label.emoji} ${label.name.padEnd(18)}  ${done}/${all.length}   ${tierLines}`;
}

// ---------------------------------------------------------------------------
// Pure formatters — exported so tests don't need to mock the sheet
// ---------------------------------------------------------------------------

export function formatSkills(
  progress: ReadonlyMap<string, ProgressEntry>,
  activeAssignmentTopicId: string | null,
): string {
  const statuses = computeStatuses(progress);
  const totalDone = ALL_TOPICS.filter((t) => statuses.get(t.id) === 'completed').length;

  const lines: string[] = [];
  lines.push(`📚 *Photography Skills* — ${totalDone} / ${ALL_TOPICS.length} done`);
  lines.push('');
  for (const branch of ['operating-camera', 'seeing', 'editing', 'printing'] as BranchId[]) {
    lines.push(branchSummary(branch, statuses));
  }
  lines.push('');
  if (activeAssignmentTopicId) {
    const t = getTopicById(activeAssignmentTopicId);
    lines.push(`*Active:* ${t?.name ?? activeAssignmentTopicId} (in progress)`);
  } else {
    const next = pickNextTopic(progress);
    if (next) lines.push(`*Next:* ${next.name} — try \`/start ${next.id}\``);
  }
  lines.push('');
  lines.push('Browse a branch: `/track operating-camera | seeing | editing | printing`');
  return lines.join('\n');
}

export function formatTrack(
  branch: BranchId,
  progress: ReadonlyMap<string, ProgressEntry>,
): string {
  const label = BRANCH_LABELS[branch];
  const statuses = computeStatuses(progress);
  const topics = listByBranch(branch);
  const done = topics.filter((t) => statuses.get(t.id) === 'completed').length;

  const lines: string[] = [];
  lines.push(`${label.emoji} *${label.name}* (${done} / ${topics.length})`);
  for (const tier of [1, 2, 3, 4] as Tier[]) {
    const tierTopics = listByTier(branch, tier);
    if (tierTopics.length === 0) continue;
    lines.push('');
    lines.push(`*Tier ${tier} — ${TIER_LABELS[tier]}*`);
    for (const t of tierTopics) {
      const glyph = STATUS_GLYPH[statuses.get(t.id) ?? 'locked'];
      lines.push(`  ${glyph} ${t.name}  \`${t.id}\``);
    }
  }
  lines.push('');
  lines.push('Theory only: `/learn <topic-id>`   Start assignment: `/start <topic-id>`');
  return lines.join('\n');
}

export function formatNext(
  topic: Topic | null,
  context: 'next' | 'in-progress',
): string {
  if (!topic) {
    return [
      'Nothing left to suggest — every topic is completed or skipped.',
      'Use `/skills` to see the full tree.',
    ].join('\n');
  }
  const label = BRANCH_LABELS[topic.branch];
  const header = context === 'in-progress'
    ? `▶ *Picking up where you left off:* ${topic.name}`
    : `📚 *Next:* ${topic.name}`;
  return [
    header,
    `_${label.emoji} ${label.name}, Tier ${topic.tier}_`,
    '',
    topic.description,
    '',
    `→ \`/start ${topic.id}\` to begin (Claude-powered assignment generation coming soon)`,
    `→ \`/learn ${topic.id}\` for theory only`,
  ].join('\n');
}

export function formatActive(assignment: AssignmentRow | null): string {
  if (!assignment) return 'No active assignment. `/next` to pick one.';
  const topic = getTopicById(assignment.topicId);
  const heading = topic ? topic.name : assignment.topicId;
  const lines: string[] = [];
  lines.push(`📚 *Active:* ${heading}`);
  lines.push(`_Status: ${assignment.status}_`);
  lines.push('');
  lines.push(assignment.assignmentText || '_(no assignment text on row — was it created before Claude expansion shipped?)_');
  if (assignment.rubricJson) {
    lines.push('');
    lines.push('*Rubric:*');
    try {
      const rubric = JSON.parse(assignment.rubricJson) as Array<{ criterion: string; description?: string; is_core?: boolean }>;
      for (const r of rubric) {
        const core = r.is_core ? ' *(core)*' : '';
        lines.push(`  • ${r.criterion}${core}`);
      }
    } catch {
      lines.push('  _(could not parse rubric — see sheet)_');
    }
  }
  lines.push('');
  lines.push('Submit a photo as a Document to grade. `/skip` to move on.');
  return lines.join('\n');
}

export function formatSkip(skipped: AssignmentRow | null): string {
  if (!skipped) return 'Nothing active to skip.';
  const topic = getTopicById(skipped.topicId);
  const name = topic?.name ?? skipped.topicId;
  return `Skipped *${name}*. Use \`/next\` to pick something else, or \`/start <topic-id>\` to revisit later.`;
}

export function formatPlan(plan: readonly Topic[], durationLabel: string): string {
  if (plan.length === 0) {
    return 'Nothing to plan — every available topic is in-progress, completed, or skipped.';
  }
  const lines: string[] = [];
  lines.push(`📚 *${durationLabel} Plan* — ${plan.length} topic${plan.length === 1 ? '' : 's'}`);
  const perWeek = 4;
  const weeks = Math.ceil(plan.length / perWeek);
  let idx = 0;
  for (let w = 1; w <= weeks; w++) {
    lines.push('');
    lines.push(`*Week ${w}*`);
    for (let p = 0; p < perWeek && idx < plan.length; p++, idx++) {
      const t = plan[idx]!;
      const label = BRANCH_LABELS[t.branch];
      lines.push(`  ${idx + 1}. ${t.name}  _(${label.emoji} ${label.name}, T${t.tier})_`);
    }
  }
  lines.push('');
  lines.push('This plan is suggestive — `/next` always proposes the most-current next step.');
  return lines.join('\n');
}

export function formatLearn(topic: Topic | null): string {
  if (!topic) {
    return 'No such topic. Use `/skills` or `/track <branch>` to browse.';
  }
  const label = BRANCH_LABELS[topic.branch];
  return [
    `📖 *${topic.name}*`,
    `_${label.emoji} ${label.name}, Tier ${topic.tier}_`,
    '',
    topic.description,
    '',
    '*Theory*',
    topic.theorySeed,
    '',
    '_(Claude-expanded lessons coming soon — this is the seed text the lesson is built from.)_',
    '',
    `Ready to try this? \`/start ${topic.id}\``,
  ].join('\n');
}

/**
 * Parse a duration string like "2 weeks", "1 month", "next month", "10 topics"
 * into a topic count. Default = 8 topics (~2 weeks at 4/week).
 */
export function parseDurationToTopicCount(raw: string): { count: number; label: string } {
  const s = raw.trim().toLowerCase();
  if (!s) return { count: 8, label: '2-Week' };

  const topicMatch = s.match(/^(\d+)\s*topics?$/);
  if (topicMatch) {
    const n = Math.max(1, Math.min(50, parseInt(topicMatch[1]!, 10)));
    return { count: n, label: `${n}-Topic` };
  }

  if (s === 'next month' || s === 'this month' || s === '1 month' || s === '4 weeks') {
    return { count: 16, label: '1-Month' };
  }

  const weekMatch = s.match(/^(\d+)\s*weeks?$/);
  if (weekMatch) {
    const n = Math.max(1, Math.min(12, parseInt(weekMatch[1]!, 10)));
    return { count: n * 4, label: `${n}-Week` };
  }

  // Fall back: assume it's nonsense, give the default
  return { count: 8, label: '2-Week' };
}

// ---------------------------------------------------------------------------
// Handlers — sheet I/O + format
// ---------------------------------------------------------------------------

export async function handleSkills(deps: PhotographyDeps): Promise<string> {
  const [rows, active] = await Promise.all([deps.readProgress(), deps.getActiveAssignment()]);
  return formatSkills(toEntries(rows), active?.topicId ?? null);
}

export async function handleTrack(args: string, deps: PhotographyDeps): Promise<string> {
  const branch = args.trim() as BranchId;
  if (!Object.keys(BRANCH_LABELS).includes(branch)) {
    return `Unknown branch "${args}". Use one of: \`operating-camera\`, \`seeing\`, \`editing\`, \`printing\`.`;
  }
  const rows = await deps.readProgress();
  return formatTrack(branch, toEntries(rows));
}

export async function handleNext(deps: PhotographyDeps): Promise<string> {
  const rows = await deps.readProgress();
  const progress = toEntries(rows);
  // Detect in-progress topics so we can label "picking up" vs "next"
  const statuses = computeStatuses(progress);
  const inProgress = ALL_TOPICS.find((t) => statuses.get(t.id) === 'in-progress');
  if (inProgress) return formatNext(inProgress, 'in-progress');
  const next = pickNextTopic(progress);
  return formatNext(next, 'next');
}

export async function handleActive(deps: PhotographyDeps): Promise<string> {
  const active = await deps.getActiveAssignment();
  return formatActive(active);
}

export async function handleSkip(deps: PhotographyDeps): Promise<string> {
  const active = await deps.getActiveAssignment();
  if (!active) return formatSkip(null);

  await deps.updateAssignment(active.rowIndex, {
    status: 'skipped',
    skippedReason: 'user /skip',
    dateGraded: deps.now(),
  });
  // Mirror to Progress
  const prog = await deps.readProgress();
  const current = prog.find((r) => r.topicId === active.topicId);
  const entry: ProgressEntry | null = current
    ? {
        topicId: current.topicId,
        status: current.status,
        lastActivityAt: current.lastActivityAt,
        assignmentsPassed: current.assignmentsPassed,
        assignmentsFailed: current.assignmentsFailed,
        theoryLastReadAt: current.theoryLastReadAt,
      }
    : null;
  const next = applyProgressUpdate(entry, active.topicId, { kind: 'skipped' }, deps.now());
  await deps.upsertProgress(active.topicId, {
    status: next.status,
    lastActivityAt: next.lastActivityAt,
    assignmentsPassed: next.assignmentsPassed,
    assignmentsFailed: next.assignmentsFailed,
    theoryLastReadAt: next.theoryLastReadAt,
  });
  return formatSkip(active);
}

export async function handlePlan(args: string, deps: PhotographyDeps): Promise<string> {
  const { count, label } = parseDurationToTopicCount(args);
  const rows = await deps.readProgress();
  const plan = generatePlan(toEntries(rows), count);
  return formatPlan(plan, label);
}

export async function handleLearn(args: string, deps: PhotographyDeps): Promise<string> {
  const id = args.trim();
  if (!id) return 'Usage: `/learn <topic-id>`. Browse topic ids with `/skills` or `/track <branch>`.';
  const topic = getTopicById(id);
  if (!topic) return `No topic "${id}". Use \`/skills\` to browse.`;
  await deps.upsertProgress(topic.id, { theoryLastReadAt: deps.now() });
  return formatLearn(topic);
}

// ---------------------------------------------------------------------------
// Dispatch — single entry point for the bot's command router
// ---------------------------------------------------------------------------

export async function handlePhotographyCommand(
  cmd: { name: string; args: string },
  deps: PhotographyDeps,
): Promise<string | null> {
  switch (cmd.name) {
    case 'skills':  return handleSkills(deps);
    case 'track':   return handleTrack(cmd.args, deps);
    case 'next':    return handleNext(deps);
    case 'active':  return handleActive(deps);
    case 'skip':    return handleSkip(deps);
    case 'plan':    return handlePlan(cmd.args, deps);
    case 'learn':   return handleLearn(cmd.args, deps);
    default:        return null;
  }
}
