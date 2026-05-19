import { describe, test, expect, vi } from 'vitest';
import {
  handlePhotographyCommand,
  formatSkills,
  formatTrack,
  formatNext,
  formatActive,
  formatSkip,
  formatPlan,
  formatLearn,
  parseDurationToTopicCount,
  type PhotographyDeps,
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
    updateAssignment: vi.fn(async () => undefined),
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

  test('formatLearn shows description + theorySeed + start hint', () => {
    const topic = getTopicById('operating-camera.exposure-triangle');
    const out = formatLearn(topic);
    expect(out).toContain('Exposure Triangle');
    expect(out).toContain('How aperture, shutter speed, and ISO combine');
    expect(out).toContain('Theory');
    expect(out).toContain('Three controls determine exposure');
    expect(out).toContain('/start operating-camera.exposure-triangle');
  });

  test('formatLearn on null returns helpful error', () => {
    expect(formatLearn(null)).toMatch(/No such topic/);
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

  test('/learn <id> writes theoryLastReadAt + returns formatted theory', async () => {
    const upsertProgress = vi.fn(async () => undefined);
    const deps = makeDeps({ upsertProgress });
    const out = await handlePhotographyCommand(
      { name: 'learn', args: 'operating-camera.exposure-triangle' }, deps,
    );
    expect(out).toContain('Exposure Triangle');
    expect(upsertProgress).toHaveBeenCalledWith(
      'operating-camera.exposure-triangle',
      expect.objectContaining({ theoryLastReadAt: NOW }),
    );
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
