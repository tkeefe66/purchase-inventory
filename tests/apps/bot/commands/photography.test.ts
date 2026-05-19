import { describe, test, expect, vi } from 'vitest';
import {
  handlePhotographyCommand,
  handleSubmission,
  checkSubmissionGate,
  formatGateRejection,
  formatSkills,
  formatTrack,
  formatNext,
  formatActive,
  formatSkip,
  formatPlan,
  formatLearn,
  formatStart,
  parseDurationToTopicCount,
  type PhotographyDeps,
  type SubmissionInput,
} from '../../../../apps/bot/commands/photography.js';
import { getTopicById } from '../../../../domains/photography/skillTree.js';
import type { ProgressEntry } from '../../../../domains/photography/curriculum.js';
import type { AssignmentRow, ProgressRow } from '../../../../lib/photographySheets.js';

const NOW = '2026-05-19T15:00:00Z';

function makeDeps(overrides: Partial<PhotographyDeps> = {}): PhotographyDeps {
  return {
    readProgress: vi.fn(async () => []),
    upsertProgress: vi.fn(async () => undefined),
    getActiveAssignment: vi.fn(async () => null),
    appendAssignment: vi.fn(async () => 42),
    updateAssignment: vi.fn(async () => undefined),
    expandAssignment: vi.fn(async () => ({
      assignmentText: 'Expanded assignment body — take three frames at golden hour.',
      rubric: [
        { criterion: 'frames visibly shot at golden hour', description: '', is_core: true },
        { criterion: 'three-layer composition', description: '', is_core: true },
        { criterion: 'EXIF preserved', description: '', is_core: false },
      ],
    })),
    expandLesson: vi.fn(async () => 'Expanded lesson body explaining the topic in 300 words.'),
    gradePhoto: vi.fn(async () => ({
      verdict: 'pass' as const,
      perCriterion: [{ criterion: 'x', result: 'pass' as const, reason: '' }],
      overallCritique: 'Solid work.',
      suggestedNextStep: 'Try f/4 next time.',
    })),
    now: () => NOW,
    ...overrides,
  };
}

function progRow(topicId: string, status: ProgressRow['status']): ProgressRow {
  return {
    rowIndex: 1,
    topicId,
    status,
    lastActivityAt: NOW,
    assignmentsPassed: status === 'completed' ? 1 : 0,
    assignmentsFailed: 0,
    theoryLastReadAt: '',
  };
}

function activeRow(topicId: string): AssignmentRow {
  return {
    rowIndex: 5,
    id: 'asgn-123',
    dateIssued: NOW,
    dateSubmitted: '',
    dateGraded: '',
    topicId,
    assignmentText: 'Take three exposure-triangle frames.',
    rubricJson: JSON.stringify([
      { criterion: 'correct exposure across all three', description: '', is_core: true },
      { criterion: 'three visibly different stylistic choices', description: '', is_core: true },
      { criterion: 'clear reasoning per image', description: '', is_core: false },
    ]),
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
  };
}

// ─── parseDurationToTopicCount ─────────────────────────────────────────────
describe('parseDurationToTopicCount', () => {
  test.each([
    ['', 8, '2-Week'],
    ['2 weeks', 8, '2-Week'],
    ['1 week', 4, '1-Week'],
    ['next month', 16, '1-Month'],
    ['1 month', 16, '1-Month'],
    ['4 weeks', 16, '1-Month'],
    ['10 topics', 10, '10-Topic'],
    ['100 topics', 50, '50-Topic'],  // clamped
    ['gibberish', 8, '2-Week'],
  ])('parses %p → %i topics, label %p', (raw, expectedCount, expectedLabel) => {
    const { count, label } = parseDurationToTopicCount(raw);
    expect(count).toBe(expectedCount);
    expect(label).toBe(expectedLabel);
  });
});

// ─── formatSkills ──────────────────────────────────────────────────────────
describe('formatSkills', () => {
  test('shows 0 / 58 done on an empty progress', () => {
    const out = formatSkills(new Map(), null);
    expect(out).toMatch(/0 \/ 58 done/);
    expect(out).toContain('Operating Camera');
    expect(out).toContain('Seeing');
    expect(out).toContain('Editing');
    expect(out).toContain('Printing');
  });

  test('shows active assignment when one exists', () => {
    const out = formatSkills(new Map(), 'operating-camera.exposure-triangle');
    expect(out).toMatch(/Active.*Exposure Triangle/);
  });

  test('suggests next topic when nothing active', () => {
    const out = formatSkills(new Map(), null);
    expect(out).toMatch(/Next.*\/start/);
  });
});

// ─── formatTrack ───────────────────────────────────────────────────────────
describe('formatTrack', () => {
  test('renders all tiers + topics for the branch', () => {
    const out = formatTrack('operating-camera', new Map());
    expect(out).toContain('Operating Camera');
    expect(out).toContain('Tier 1');
    expect(out).toContain('Tier 4');
    expect(out).toContain('Exposure Triangle');
    expect(out).toContain('a6700 IBIS in Practice');
  });

  test('shows completed / available / locked glyphs distinctly', () => {
    const prog: Map<string, ProgressEntry> = new Map([
      ['operating-camera.exposure-triangle', { topicId: 'operating-camera.exposure-triangle', status: 'completed', lastActivityAt: NOW, assignmentsPassed: 1, assignmentsFailed: 0, theoryLastReadAt: '' }],
    ]);
    const out = formatTrack('operating-camera', prog);
    expect(out).toMatch(/✓ Exposure Triangle/);
    expect(out).toMatch(/○ ISO Behavior/); // unlocked by exposure-triangle
    expect(out).toMatch(/🔒 Camera Shake/); // motion-control, locked behind shutter-priority
  });
});

// ─── formatNext / formatActive / formatSkip / formatPlan / formatLearn ────
describe('formatters', () => {
  test('formatNext("next") shows the topic + start hint', () => {
    const topic = getTopicById('operating-camera.exposure-triangle');
    const out = formatNext(topic, 'next');
    expect(out).toContain('Exposure Triangle');
    expect(out).toContain('/start operating-camera.exposure-triangle');
    expect(out).toContain('/learn operating-camera.exposure-triangle');
  });

  test('formatNext("in-progress") uses the "picking up" prefix', () => {
    const topic = getTopicById('operating-camera.exposure-triangle');
    const out = formatNext(topic, 'in-progress');
    expect(out).toContain('Picking up where you left off');
  });

  test('formatNext returns "nothing left" when topic is null', () => {
    const out = formatNext(null, 'next');
    expect(out).toMatch(/nothing left/i);
  });

  test('formatActive renders the assignment text + rubric criteria', () => {
    const out = formatActive(activeRow('operating-camera.exposure-triangle'));
    expect(out).toContain('Take three exposure-triangle frames');
    expect(out).toContain('correct exposure across all three');
    expect(out).toContain('(core)');
    expect(out).toContain('Submit a photo');
  });

  test('formatActive on null returns "no active" message', () => {
    const out = formatActive(null);
    expect(out).toMatch(/No active assignment/);
  });

  test('formatSkip on null returns "nothing to skip"', () => {
    expect(formatSkip(null)).toMatch(/Nothing active to skip/);
  });

  test('formatSkip on a real assignment names the topic', () => {
    const out = formatSkip(activeRow('operating-camera.exposure-triangle'));
    expect(out).toMatch(/Skipped \*Exposure Triangle\*/);
  });

  test('formatPlan groups by week (4 per week)', () => {
    const topics = [
      getTopicById('operating-camera.exposure-triangle')!,
      getTopicById('operating-camera.aperture-priority')!,
      getTopicById('operating-camera.iso-behavior')!,
      getTopicById('operating-camera.evf-live-view')!,
      getTopicById('operating-camera.raw-vs-jpeg')!,
    ];
    const out = formatPlan(topics, '2-Week');
    expect(out).toContain('2-Week Plan');
    expect(out).toContain('Week 1');
    expect(out).toContain('Week 2');
    expect(out).toMatch(/1\. Exposure Triangle/);
    expect(out).toMatch(/5\. RAW vs JPEG/);
  });

  test('formatPlan with empty array returns "nothing to plan"', () => {
    expect(formatPlan([], '2-Week')).toMatch(/Nothing to plan/);
  });

  test('formatLearn with expanded text shows the expanded body', () => {
    const topic = getTopicById('operating-camera.exposure-triangle');
    const out = formatLearn(topic, 'Three controls determine exposure on the a6700: aperture, shutter, ISO. ...');
    expect(out).toContain('Exposure Triangle');
    expect(out).toContain('Three controls determine exposure on the a6700');
  });

  test('formatLearn falls back to seed text when expanded is null', () => {
    const topic = getTopicById('operating-camera.exposure-triangle');
    const out = formatLearn(topic, null);
    // Seed text starts with "Three controls determine exposure: ..."
    expect(out).toContain('Three controls determine exposure');
  });

  test('formatLearn on null topic returns helpful error', () => {
    expect(formatLearn(null, null)).toMatch(/No such topic/);
  });

  test('formatStart renders assignment text + rubric with core markers', () => {
    const topic = getTopicById('operating-camera.exposure-triangle')!;
    const out = formatStart(topic, {
      assignmentText: 'Take three frames demonstrating each corner of the exposure triangle.',
      rubric: [
        { criterion: 'three visibly different stylistic choices', description: 'one per corner', is_core: true },
        { criterion: 'exposure correct across all three', description: '', is_core: true },
        { criterion: 'caption explains the trade-off for each', description: '', is_core: false },
      ],
    });
    expect(out).toContain('Started');
    expect(out).toContain('Take three frames');
    expect(out).toContain('three visibly different stylistic choices');
    expect(out).toContain('(core)');
    expect(out).toContain('one per corner'); // description renders too
    expect(out).toContain('Submit a photo');
  });
});

// ─── handlePhotographyCommand (I/O integration) ───────────────────────────
describe('handlePhotographyCommand', () => {
  test('/skills reads progress + active and renders', async () => {
    const deps = makeDeps({
      readProgress: vi.fn(async () => [progRow('operating-camera.exposure-triangle', 'completed')]),
      getActiveAssignment: vi.fn(async () => null),
    });
    const out = await handlePhotographyCommand({ name: 'skills', args: '' }, deps);
    expect(out).toMatch(/1 \/ 58 done/);
    expect(deps.readProgress).toHaveBeenCalledTimes(1);
    expect(deps.getActiveAssignment).toHaveBeenCalledTimes(1);
  });

  test('/track operating-camera renders that branch', async () => {
    const out = await handlePhotographyCommand({ name: 'track', args: 'operating-camera' }, makeDeps());
    expect(out).toContain('Operating Camera');
    expect(out).toContain('Tier 1');
  });

  test('/track <unknown> returns a helpful error', async () => {
    const out = await handlePhotographyCommand({ name: 'track', args: 'bogus' }, makeDeps());
    expect(out).toMatch(/Unknown branch/);
  });

  test('/next on empty progress returns a Tier 1 rootless topic', async () => {
    const out = await handlePhotographyCommand({ name: 'next', args: '' }, makeDeps());
    expect(out).toMatch(/Exposure Triangle|Composition Fundamentals|Lightroom Classic Setup|Color Management Basics/);
  });

  test('/next picks up an in-progress topic', async () => {
    const deps = makeDeps({
      readProgress: vi.fn(async () => [progRow('operating-camera.aperture-priority', 'in-progress')]),
    });
    const out = await handlePhotographyCommand({ name: 'next', args: '' }, deps);
    expect(out).toMatch(/Picking up where you left off/);
    expect(out).toContain('Aperture Priority');
  });

  test('/active shows the active assignment', async () => {
    const deps = makeDeps({
      getActiveAssignment: vi.fn(async () => activeRow('operating-camera.exposure-triangle')),
    });
    const out = await handlePhotographyCommand({ name: 'active', args: '' }, deps);
    expect(out).toContain('Exposure Triangle');
    expect(out).toContain('Submit a photo');
  });

  test('/skip flips an active assignment to skipped and mirrors to progress', async () => {
    const updateAssignment = vi.fn(async () => undefined);
    const upsertProgress = vi.fn(async () => undefined);
    const deps = makeDeps({
      getActiveAssignment: vi.fn(async () => activeRow('operating-camera.exposure-triangle')),
      updateAssignment,
      upsertProgress,
      readProgress: vi.fn(async () => []),
    });
    const out = await handlePhotographyCommand({ name: 'skip', args: '' }, deps);
    expect(out).toMatch(/Skipped \*Exposure Triangle\*/);
    expect(updateAssignment).toHaveBeenCalledWith(5, expect.objectContaining({ status: 'skipped' }));
    expect(upsertProgress).toHaveBeenCalledWith('operating-camera.exposure-triangle', expect.objectContaining({ status: 'skipped' }));
  });

  test('/skip with no active assignment returns "nothing to skip"', async () => {
    const deps = makeDeps({ getActiveAssignment: vi.fn(async () => null) });
    const out = await handlePhotographyCommand({ name: 'skip', args: '' }, deps);
    expect(out).toMatch(/Nothing active to skip/);
  });

  test('/plan 2 weeks returns an 8-topic plan in week groups', async () => {
    const out = await handlePhotographyCommand({ name: 'plan', args: '2 weeks' }, makeDeps());
    expect(out).toContain('2-Week Plan');
    expect(out).toContain('Week 1');
    expect(out).toContain('Week 2');
  });

  test('/learn <id> calls expandLesson + writes theoryLastReadAt + returns expanded lesson', async () => {
    const upsertProgress = vi.fn(async () => undefined);
    const expandLesson = vi.fn(async () => 'A polished 300-word lesson about exposure triangle on the a6700.');
    const deps = makeDeps({ upsertProgress, expandLesson });
    const out = await handlePhotographyCommand(
      { name: 'learn', args: 'operating-camera.exposure-triangle' }, deps,
    );
    expect(out).toContain('Exposure Triangle');
    expect(out).toContain('polished 300-word lesson');
    expect(expandLesson).toHaveBeenCalledTimes(1);
    expect(upsertProgress).toHaveBeenCalledWith(
      'operating-camera.exposure-triangle',
      expect.objectContaining({ theoryLastReadAt: NOW }),
    );
  });

  test('/learn falls back to seed text when expandLesson throws', async () => {
    const upsertProgress = vi.fn(async () => undefined);
    const expandLesson = vi.fn(async () => { throw new Error('anthropic timeout'); });
    const deps = makeDeps({ upsertProgress, expandLesson });
    const out = await handlePhotographyCommand(
      { name: 'learn', args: 'operating-camera.exposure-triangle' }, deps,
    );
    expect(out).toMatch(/Couldn't generate/);
    expect(out).toContain('Three controls determine exposure'); // seed verbatim
    expect(upsertProgress).not.toHaveBeenCalled(); // don't mark as read on failure
  });

  test('/learn with no arg returns usage help', async () => {
    const out = await handlePhotographyCommand({ name: 'learn', args: '' }, makeDeps());
    expect(out).toMatch(/Usage: `\/learn/);
  });

  test('/learn with unknown topic returns helpful error', async () => {
    const out = await handlePhotographyCommand({ name: 'learn', args: 'does.not.exist' }, makeDeps());
    expect(out).toMatch(/No topic/);
  });

  test('returns null for unknown command', async () => {
    expect(await handlePhotographyCommand({ name: 'unknown', args: '' }, makeDeps())).toBeNull();
  });
});

// ─── /start integration ───────────────────────────────────────────────────
describe('handlePhotographyCommand: /start', () => {
  test('/start <id> expands assignment, appends row, upserts progress=in-progress', async () => {
    const appendAssignment = vi.fn(async () => 42);
    const upsertProgress = vi.fn(async () => undefined);
    const expandAssignment = vi.fn(async () => ({
      assignmentText: 'Take three frames demonstrating exposure trade-offs.',
      rubric: [
        { criterion: 'three different stylistic choices', description: '', is_core: true },
        { criterion: 'exposure correct across all three', description: '', is_core: false },
      ],
    }));
    const deps = makeDeps({ appendAssignment, upsertProgress, expandAssignment });
    const out = await handlePhotographyCommand(
      { name: 'start', args: 'operating-camera.exposure-triangle' }, deps,
    );
    expect(expandAssignment).toHaveBeenCalledTimes(1);
    expect(appendAssignment).toHaveBeenCalledTimes(1);
    const call = appendAssignment.mock.calls[0] as unknown as [Omit<AssignmentRow, 'rowIndex'>];
    const row = call[0];
    expect(row.topicId).toBe('operating-camera.exposure-triangle');
    expect(row.status).toBe('active');
    expect(row.assignmentText).toBe('Take three frames demonstrating exposure trade-offs.');
    expect(JSON.parse(row.rubricJson)).toHaveLength(2);
    expect(row.dateIssued).toBe(NOW);
    expect(upsertProgress).toHaveBeenCalledWith(
      'operating-camera.exposure-triangle',
      expect.objectContaining({ status: 'in-progress', lastActivityAt: NOW }),
    );
    expect(out).toContain('Started');
    expect(out).toContain('Take three frames');
  });

  test('/start refuses when another assignment is active', async () => {
    const deps = makeDeps({
      getActiveAssignment: vi.fn(async () => activeRow('operating-camera.aperture-priority')),
      appendAssignment: vi.fn(async () => 99),
    });
    const out = await handlePhotographyCommand(
      { name: 'start', args: 'operating-camera.exposure-triangle' }, deps,
    );
    expect(out).toMatch(/already have an active assignment/i);
    expect(deps.appendAssignment).not.toHaveBeenCalled();
    expect(deps.expandAssignment).not.toHaveBeenCalled();
  });

  test('/start with no arg returns usage help', async () => {
    const deps = makeDeps();
    const out = await handlePhotographyCommand({ name: 'start', args: '' }, deps);
    expect(out).toMatch(/Usage: `\/start/);
    expect(deps.expandAssignment).not.toHaveBeenCalled();
  });

  test('/start with unknown topic returns helpful error', async () => {
    const deps = makeDeps();
    const out = await handlePhotographyCommand({ name: 'start', args: 'does.not.exist' }, deps);
    expect(out).toMatch(/No topic/);
    expect(deps.expandAssignment).not.toHaveBeenCalled();
  });

  test('/start falls through when expander throws — no sheet writes happen', async () => {
    const appendAssignment = vi.fn(async () => 42);
    const upsertProgress = vi.fn(async () => undefined);
    const expandAssignment = vi.fn(async () => { throw new Error('anthropic 529'); });
    const deps = makeDeps({ appendAssignment, upsertProgress, expandAssignment });
    const out = await handlePhotographyCommand(
      { name: 'start', args: 'operating-camera.exposure-triangle' }, deps,
    );
    expect(out).toMatch(/Couldn't generate the assignment/);
    expect(appendAssignment).not.toHaveBeenCalled();
    expect(upsertProgress).not.toHaveBeenCalled();
  });
});

// ─── Submission flow ──────────────────────────────────────────────────────

function makeSubmission(overrides: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    mimeType: 'image/jpeg',
    fileName: 'IMG_2024.jpg',
    telegramFileId: 'tg-file-xyz',
    caption: '',
    compressed: false,
    ...overrides,
  };
}

describe('checkSubmissionGate', () => {
  test('passes a valid JPEG with active assignment', () => {
    expect(checkSubmissionGate(makeSubmission(), activeRow('x.y'))).toEqual({ kind: 'ok' });
  });
  test('rejects ARW by mime', () => {
    expect(checkSubmissionGate(makeSubmission({ mimeType: 'image/x-sony-arw' }), activeRow('x.y')))
      .toEqual({ kind: 'arw-rejected' });
  });
  test('rejects ARW by extension when mime is generic', () => {
    expect(checkSubmissionGate(makeSubmission({ mimeType: 'application/octet-stream', fileName: 'DSC04738.ARW' }), activeRow('x.y')))
      .toEqual({ kind: 'arw-rejected' });
  });
  test('rejects unsupported mime', () => {
    expect(checkSubmissionGate(makeSubmission({ mimeType: 'application/pdf' }), activeRow('x.y')))
      .toEqual({ kind: 'unsupported-mime', mime: 'application/pdf' });
  });
  test('reports no-active-assignment when none', () => {
    expect(checkSubmissionGate(makeSubmission(), null)).toEqual({ kind: 'no-active-assignment' });
  });
});

describe('formatGateRejection', () => {
  test('ARW gets a JPEG hint', () => {
    expect(formatGateRejection({ kind: 'arw-rejected' })).toMatch(/JPEG export/);
  });
  test('unsupported mime mentions the mime', () => {
    expect(formatGateRejection({ kind: 'unsupported-mime', mime: 'application/pdf' })).toMatch(/application\/pdf/);
  });
  test('no-active points to /next', () => {
    expect(formatGateRejection({ kind: 'no-active-assignment' })).toMatch(/\/next/);
  });
});

describe('handleSubmission', () => {
  test('happy path: grades a JPEG, updates sheet row twice (submitted then passed), bumps progress', async () => {
    const updateAssignment = vi.fn(async () => undefined);
    const upsertProgress = vi.fn(async () => undefined);
    const gradePhoto = vi.fn(async () => ({
      verdict: 'pass' as const,
      perCriterion: [{ criterion: 'frames at golden hour', result: 'pass' as const, reason: 'warm light visible' }],
      overallCritique: 'Beautiful frame.',
      suggestedNextStep: 'Try one with foreground anchor next time.',
    }));
    const deps = makeDeps({
      getActiveAssignment: vi.fn(async () => activeRow('operating-camera.exposure-triangle')),
      updateAssignment,
      upsertProgress,
      gradePhoto,
      readProgress: vi.fn(async () => []),
    });
    const out = await handleSubmission(makeSubmission({ caption: 'Shot at Chautauqua sunset.' }), deps);

    expect(gradePhoto).toHaveBeenCalledTimes(1);
    // Two updateAssignment calls: once to mark submitted, once with verdict
    expect(updateAssignment).toHaveBeenCalledTimes(2);
    const calls = updateAssignment.mock.calls as unknown as Array<[number, Record<string, unknown>]>;
    expect(calls[0]![1].status).toBe('submitted');
    expect(calls[0]![1].submittedPhotoTelegramFileId).toBe('tg-file-xyz');
    expect(calls[1]![1].status).toBe('passed');
    expect(calls[1]![1].aiVerdict).toBe('pass');
    // Progress bumped to completed
    expect(upsertProgress).toHaveBeenCalledWith(
      'operating-camera.exposure-triangle',
      expect.objectContaining({ status: 'completed', assignmentsPassed: 1 }),
    );
    expect(out).toContain('PASS');
    expect(out).toContain('Beautiful frame');
  });

  test('did_not_pass keeps progress in-progress and bumps fail count', async () => {
    const updateAssignment = vi.fn(async () => undefined);
    const upsertProgress = vi.fn(async () => undefined);
    const gradePhoto = vi.fn(async () => ({
      verdict: 'did_not_pass' as const,
      perCriterion: [{ criterion: 'frames at golden hour', result: 'fail' as const, reason: 'midday light' }],
      overallCritique: 'Light is wrong.',
      suggestedNextStep: 'Reshoot at sunset.',
    }));
    const deps = makeDeps({
      getActiveAssignment: vi.fn(async () => activeRow('operating-camera.exposure-triangle')),
      updateAssignment,
      upsertProgress,
      gradePhoto,
      readProgress: vi.fn(async () => []),
    });
    const out = await handleSubmission(makeSubmission(), deps);
    expect(out).toContain('DID NOT PASS');
    expect(upsertProgress).toHaveBeenCalledWith(
      'operating-camera.exposure-triangle',
      expect.objectContaining({ status: 'in-progress', assignmentsFailed: 1 }),
    );
  });

  test('rejects ARW with a useful message and doesn\'t call grading', async () => {
    const gradePhoto = vi.fn();
    const deps = makeDeps({
      getActiveAssignment: vi.fn(async () => activeRow('operating-camera.exposure-triangle')),
      gradePhoto,
    });
    const out = await handleSubmission(makeSubmission({ mimeType: 'image/x-sony-arw', fileName: 'DSC.ARW' }), deps);
    expect(out).toMatch(/RAW/i);
    expect(gradePhoto).not.toHaveBeenCalled();
  });

  test('refuses when no active assignment + doesn\'t grade', async () => {
    const gradePhoto = vi.fn();
    const deps = makeDeps({
      getActiveAssignment: vi.fn(async () => null),
      gradePhoto,
    });
    const out = await handleSubmission(makeSubmission(), deps);
    expect(out).toMatch(/No active assignment/);
    expect(gradePhoto).not.toHaveBeenCalled();
  });

  test('compressed Photo path appends "send as Document next time" note', async () => {
    const deps = makeDeps({
      getActiveAssignment: vi.fn(async () => activeRow('operating-camera.exposure-triangle')),
      readProgress: vi.fn(async () => []),
    });
    const out = await handleSubmission(makeSubmission({ compressed: true }), deps);
    expect(out).toMatch(/Send as Document\/File next time/);
  });

  test('grader failure leaves assignment in "submitted" status (no verdict overwrite)', async () => {
    const updateAssignment = vi.fn(async () => undefined);
    const upsertProgress = vi.fn(async () => undefined);
    const gradePhoto = vi.fn(async () => { throw new Error('claude 529'); });
    const deps = makeDeps({
      getActiveAssignment: vi.fn(async () => activeRow('operating-camera.exposure-triangle')),
      updateAssignment,
      upsertProgress,
      gradePhoto,
      readProgress: vi.fn(async () => []),
    });
    const out = await handleSubmission(makeSubmission(), deps);
    expect(out).toMatch(/Couldn't grade/);
    expect(updateAssignment).toHaveBeenCalledTimes(1); // only the "submitted" update
    expect(upsertProgress).not.toHaveBeenCalled();
  });
});
