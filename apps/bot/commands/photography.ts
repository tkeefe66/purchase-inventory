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
import type { ExpandedAssignment, RubricCriterion } from '../../../domains/photography/expander.js';
import {
  extractExif,
  isLikelyTomsA6700,
  hasUsableExif,
  formatSettingsLine,
  type PhotoExif,
} from '../../../domains/photography/exif.js';
import {
  formatGradingReply,
  type GradingInput,
  type GradingResult,
} from '../../../domains/photography/grading.js';
import { randomUUID } from 'node:crypto';

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
  appendAssignment: (row: Omit<AssignmentRow, 'rowIndex'>) => Promise<number>;
  updateAssignment: (
    rowIndex: number,
    patch: Partial<Omit<AssignmentRow, 'rowIndex'>>,
  ) => Promise<void>;
  /** Claude-powered expanders for /start and /learn. */
  expandAssignment: (topic: Topic) => Promise<ExpandedAssignment>;
  expandLesson: (topic: Topic) => Promise<string>;
  /** Claude vision grading — called by handleSubmission. */
  gradePhoto: (input: GradingInput) => Promise<GradingResult>;
  /** ISO timestamp of "now" — injectable for tests. */
  now: () => string;
}

export interface SubmissionInput {
  /** Raw image bytes (already downloaded). */
  bytes: Uint8Array | Buffer;
  /** MIME type as reported by Telegram (e.g. "image/jpeg", "image/x-sony-arw"). */
  mimeType: string;
  /** File name from Telegram (used for ARW detection when mime is missing). */
  fileName: string;
  /** Telegram file_id (persisted on the assignment row for audit). */
  telegramFileId: string;
  /** Tom's caption / context — used as user_notes + may carry manual settings. */
  caption: string;
  /** True when sent as compressed Photo (EXIF will be stripped). False for Document. */
  compressed: boolean;
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

export function formatLearn(topic: Topic | null, lessonText: string | null): string {
  if (!topic) {
    return 'No such topic. Use `/skills` or `/track <branch>` to browse.';
  }
  const label = BRANCH_LABELS[topic.branch];
  const body = lessonText ?? topic.theorySeed;
  return [
    `📖 *${topic.name}*`,
    `_${label.emoji} ${label.name}, Tier ${topic.tier}_`,
    '',
    body,
  ].join('\n');
}

export function formatStart(topic: Topic, expanded: ExpandedAssignment): string {
  const label = BRANCH_LABELS[topic.branch];
  const lines: string[] = [];
  lines.push(`📚 *Started:* ${topic.name}`);
  lines.push(`_${label.emoji} ${label.name}, Tier ${topic.tier}_`);
  lines.push('');
  lines.push(expanded.assignmentText);
  lines.push('');
  lines.push('*Rubric:*');
  for (const r of expanded.rubric) {
    const core = r.is_core ? ' *(core)*' : '';
    lines.push(`  • ${r.criterion}${core}`);
    if (r.description) lines.push(`    _${r.description}_`);
  }
  lines.push('');
  lines.push('Submit a photo as a Document when ready. `/active` to re-read, `/skip` to move on.');
  return lines.join('\n');
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
  let lesson: string | null;
  try {
    lesson = await deps.expandLesson(topic);
  } catch (err) {
    console.error(`[photography] expandLesson failed for ${id}:`, err instanceof Error ? err.message : err);
    return `Couldn't generate the lesson right now. The seed text is below — try again in a minute.\n\n${formatLearn(topic, null)}`;
  }
  await deps.upsertProgress(topic.id, { theoryLastReadAt: deps.now() });
  return formatLearn(topic, lesson);
}

export async function handleStart(args: string, deps: PhotographyDeps): Promise<string> {
  const id = args.trim();
  if (!id) return 'Usage: `/start <topic-id>`. Use `/next` or `/skills` to find a topic.';
  const topic = getTopicById(id);
  if (!topic) return `No topic "${id}". Use \`/skills\` to browse.`;

  // Enforce the "one active assignment at a time" invariant.
  const existing = await deps.getActiveAssignment();
  if (existing) {
    const existingTopic = getTopicById(existing.topicId);
    const name = existingTopic?.name ?? existing.topicId;
    return `You already have an active assignment: *${name}*. Use \`/active\` to re-read, \`/skip\` to move on, or submit a photo to grade it.`;
  }

  // Generate the assignment text + rubric via Claude.
  let expanded: ExpandedAssignment;
  try {
    expanded = await deps.expandAssignment(topic);
  } catch (err) {
    console.error(`[photography] expandAssignment failed for ${id}:`, err instanceof Error ? err.message : err);
    return `Couldn't generate the assignment right now. Try again in a minute, or use \`/learn ${id}\` to read the theory first.`;
  }

  const now = deps.now();
  await deps.appendAssignment({
    id: randomUUID(),
    dateIssued: now,
    dateSubmitted: '',
    dateGraded: '',
    topicId: topic.id,
    assignmentText: expanded.assignmentText,
    rubricJson: JSON.stringify(expanded.rubric),
    status: 'active',
    submittedPhotoTelegramFileId: '',
    camera: '',
    lens: '',
    settingsExtracted: '',
    aiVerdict: '',
    aiCritique: '',
    perCriterionJson: '',
    retryCount: 0,
    userNotes: '',
    skippedReason: '',
  });

  await deps.upsertProgress(topic.id, {
    status: 'in-progress',
    lastActivityAt: now,
  });

  return formatStart(topic, expanded);
}

// ---------------------------------------------------------------------------
// Submission flow (called from bot index when a photo arrives)
// ---------------------------------------------------------------------------

const ARW_MIME_RE = /image\/x-(sony-)?arw|image\/arw/i;
const ARW_EXT_RE = /\.arw$/i;

/**
 * Decide whether a photo can be graded as-is, refused, or needs a hint.
 * Pure for testability.
 */
export type SubmissionGate =
  | { kind: 'ok' }
  | { kind: 'arw-rejected' }
  | { kind: 'unsupported-mime'; mime: string }
  | { kind: 'no-active-assignment' };

export function checkSubmissionGate(
  submission: Pick<SubmissionInput, 'mimeType' | 'fileName'>,
  activeAssignment: AssignmentRow | null,
): SubmissionGate {
  if (ARW_MIME_RE.test(submission.mimeType) || ARW_EXT_RE.test(submission.fileName)) {
    return { kind: 'arw-rejected' };
  }
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(submission.mimeType)) {
    return { kind: 'unsupported-mime', mime: submission.mimeType };
  }
  if (!activeAssignment) return { kind: 'no-active-assignment' };
  return { kind: 'ok' };
}

export function formatGateRejection(gate: SubmissionGate): string {
  if (gate.kind === 'arw-rejected') {
    return "Can't grade RAW (.ARW) files — they're too large and not supported as vision input. Send a JPEG export from Lightroom (full res is fine; EXIF preserved is best).";
  }
  if (gate.kind === 'unsupported-mime') {
    return `Send a JPEG, PNG, WebP, or GIF. Got \`${gate.mime}\`.`;
  }
  if (gate.kind === 'no-active-assignment') {
    return 'No active assignment to grade against. `/next` to pick one, or `/start <topic-id>` for a specific topic.';
  }
  return '';
}

export async function handleSubmission(
  input: SubmissionInput,
  deps: PhotographyDeps,
): Promise<string> {
  const active = await deps.getActiveAssignment();
  const gate = checkSubmissionGate(input, active);
  if (gate.kind !== 'ok') return formatGateRejection(gate);
  const assignment = active!; // gate ensures non-null

  // Extract EXIF (returns empty shape on compressed Photo or any parse error).
  const exif: PhotoExif = await extractExif(input.bytes);
  const topic = getTopicById(assignment.topicId);
  const topicName = topic?.name ?? assignment.topicId;

  // Parse the assignment row's rubric back to RubricCriterion shape.
  let rubric: RubricCriterion[];
  try {
    const parsed = JSON.parse(assignment.rubricJson || '[]') as unknown;
    if (!Array.isArray(parsed)) throw new Error('rubric_json is not an array');
    rubric = parsed as RubricCriterion[];
  } catch (err) {
    console.error(`[photography] active assignment ${assignment.id} has invalid rubric_json:`, err);
    return `Can\'t grade — the active assignment\'s rubric is corrupted. \`/skip\` and start fresh with \`/start <topic-id>\`.`;
  }

  // Decide camera/lens for the grading prompt — prefer EXIF, fall back to existing row values.
  const camera = exif.camera || assignment.camera || '';
  const lens = exif.lens || assignment.lens || '';

  // Bump retry count if the user is re-submitting on an already-graded row
  // (status 'did_not_pass' kept open per spec — we re-grade).
  const isRetry = assignment.status === 'submitted' || assignment.status === 'did_not_pass';
  const now = deps.now();

  // Mark as submitted before grading so a slow/failed grade leaves an audit trail.
  await deps.updateAssignment(assignment.rowIndex, {
    status: 'submitted',
    dateSubmitted: now,
    submittedPhotoTelegramFileId: input.telegramFileId,
    camera,
    lens,
    settingsExtracted: JSON.stringify({
      aperture: exif.aperture,
      shutterSeconds: exif.shutterSeconds,
      iso: exif.iso,
      focalLengthMm: exif.focalLengthMm,
      focalLength35mmEq: exif.focalLength35mmEq,
      gpsLat: exif.gpsLat,
      gpsLng: exif.gpsLng,
      dateTimeOriginal: exif.dateTimeOriginal,
    }),
    userNotes: input.caption,
    retryCount: isRetry ? assignment.retryCount + 1 : assignment.retryCount,
  });

  // Grade.
  let result: GradingResult;
  try {
    result = await deps.gradePhoto({
      assignmentText: assignment.assignmentText,
      rubric,
      camera,
      lens,
      exif: hasUsableExif(exif) ? exif : null,
      manualSettings: input.caption,
      userNotes: input.caption,
      imageBytes: input.bytes,
      imageMimeType: input.mimeType,
    });
  } catch (err) {
    console.error(`[photography] gradePhoto failed for assignment ${assignment.id}:`, err instanceof Error ? err.message : err);
    // Leave the row in 'submitted' status — user can re-submit or /skip.
    return `Couldn\'t grade the photo right now (Claude error). The submission is on record — try again in a minute by re-sending the photo, or \`/active\` to see what you submitted.`;
  }

  // Persist verdict + critique + per-criterion JSON.
  await deps.updateAssignment(assignment.rowIndex, {
    status: result.verdict === 'pass' ? 'passed' : 'did_not_pass',
    dateGraded: now,
    aiVerdict: result.verdict === 'pass' ? 'pass' : 'did_not_pass',
    aiCritique: result.overallCritique,
    perCriterionJson: JSON.stringify(result.perCriterion),
  });

  // Update Progress tab: pass → completed; fail → in-progress + counter bump.
  const progRows = await deps.readProgress();
  const current = progRows.find((r) => r.topicId === assignment.topicId);
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
  const event = result.verdict === 'pass'
    ? { kind: 'assignment-passed' as const }
    : { kind: 'assignment-failed' as const };
  const nextEntry = applyProgressUpdate(entry, assignment.topicId, event, now);
  await deps.upsertProgress(assignment.topicId, {
    status: nextEntry.status,
    lastActivityAt: nextEntry.lastActivityAt,
    assignmentsPassed: nextEntry.assignmentsPassed,
    assignmentsFailed: nextEntry.assignmentsFailed,
    theoryLastReadAt: nextEntry.theoryLastReadAt,
  });

  // Build the user-facing reply. Prepend EXIF / gear notes when relevant.
  const noteLines: string[] = [];
  if (input.compressed) {
    noteLines.push(
      '_Note: photo was sent compressed (EXIF stripped). Send as Document/File next time so I can grade your settings too._',
    );
  } else if (!hasUsableExif(exif) && !input.caption.trim()) {
    noteLines.push(
      '_Note: no EXIF found in this file. Include settings in your caption next time (e.g. "a6700 / Sigma 18-50 / f/8 / 1/250 / ISO 200")._',
    );
  }
  const gearCheck = isLikelyTomsA6700(exif);
  if (gearCheck === false) {
    noteLines.push(
      `_Note: EXIF says this was shot on \`${exif.camera}\`, not your a6700. Grade still applies to the rubric, but assignments are for your a6700._`,
    );
  }

  const reply = formatGradingReply(result, topicName);
  return noteLines.length > 0 ? `${noteLines.join('\n')}\n\n${reply}` : reply;
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
    case 'start':   return handleStart(cmd.args, deps);
    default:        return null;
  }
}
