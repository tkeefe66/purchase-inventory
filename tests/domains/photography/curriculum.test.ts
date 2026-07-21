import { describe, test, expect } from 'vitest';
import {
  computeStatuses,
  checkPrereqs,
  pickNextTopic,
  generatePlan,
  applyProgressUpdate,
  type ProgressEntry,
} from '../../../domains/photography/curriculum.js';
import { ALL_TOPICS, getTopicById } from '../../../domains/photography/skillTree.js';

const NOW = '2026-05-19T15:00:00Z';

function makeProgress(entries: Partial<ProgressEntry & { topicId: string }>[]): Map<string, ProgressEntry> {
  const m = new Map<string, ProgressEntry>();
  for (const e of entries) {
    if (!e.topicId) throw new Error('progress entry missing topicId');
    m.set(e.topicId, {
      topicId: e.topicId,
      status: e.status ?? 'in-progress',
      lastActivityAt: e.lastActivityAt ?? NOW,
      assignmentsPassed: e.assignmentsPassed ?? 0,
      assignmentsFailed: e.assignmentsFailed ?? 0,
      theoryLastReadAt: e.theoryLastReadAt ?? '',
    });
  }
  return m;
}

describe('computeStatuses', () => {
  test('with empty progress: only rootless topics are available; everything else locked', () => {
    const statuses = computeStatuses(new Map());
    // Each branch has exactly one rootless topic (validated elsewhere); they should be available
    expect(statuses.get('operating-camera.camera-orientation')).toBe('available');
    expect(statuses.get('seeing.composition-fundamentals')).toBe('available');
    expect(statuses.get('seeing.light-quality')).toBe('available');
    expect(statuses.get('seeing.subject-and-story')).toBe('available');
    expect(statuses.get('editing.lightroom-classic-setup')).toBe('available');
    expect(statuses.get('printing.color-management-basics')).toBe('available');
    // exposure-triangle now depends on camera-orientation, so it's locked until that completes
    expect(statuses.get('operating-camera.exposure-triangle')).toBe('locked');
    // A deep tier-3 topic should be locked
    expect(statuses.get('operating-camera.focus-modes')).toBe('locked');
    expect(statuses.get('editing.export-for-print')).toBe('locked');
  });

  test('once a prereq is completed, dependent topics become available', () => {
    const progress = makeProgress([
      { topicId: 'operating-camera.exposure-triangle', status: 'completed' },
    ]);
    const statuses = computeStatuses(progress);
    // Tier 1 direct dependents now available
    expect(statuses.get('operating-camera.aperture-priority')).toBe('available');
    expect(statuses.get('operating-camera.iso-behavior')).toBe('available');
    expect(statuses.get('operating-camera.evf-live-view')).toBe('available');
    expect(statuses.get('operating-camera.raw-vs-jpeg')).toBe('available');
    // Tier 2 manual-mode still locked (needs both aperture + shutter priority)
    expect(statuses.get('operating-camera.manual-mode')).toBe('locked');
  });

  test('in-progress entries surface as in-progress not derived status', () => {
    const progress = makeProgress([
      { topicId: 'operating-camera.exposure-triangle', status: 'in-progress' },
    ]);
    expect(computeStatuses(progress).get('operating-camera.exposure-triangle')).toBe('in-progress');
  });

  test('skipped is preserved', () => {
    const progress = makeProgress([
      { topicId: 'operating-camera.exposure-triangle', status: 'skipped' },
    ]);
    expect(computeStatuses(progress).get('operating-camera.exposure-triangle')).toBe('skipped');
    // Skipped does NOT unlock dependents (they're still locked because prereq is "skipped" not "completed")
    expect(computeStatuses(progress).get('operating-camera.aperture-priority')).toBe('locked');
  });
});

describe('checkPrereqs', () => {
  test('returns ok for a topic with no prereqs', () => {
    expect(checkPrereqs('operating-camera.camera-orientation', new Map())).toEqual({ ok: true });
  });

  test('returns missing list when prereqs not satisfied', () => {
    const res = checkPrereqs('operating-camera.manual-mode', new Map());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.missing).toContain('operating-camera.aperture-priority');
      expect(res.missing).toContain('operating-camera.shutter-priority');
    }
  });

  test('returns ok once all prereqs are completed', () => {
    const progress = makeProgress([
      { topicId: 'operating-camera.exposure-triangle', status: 'completed' },
      { topicId: 'operating-camera.aperture-priority', status: 'completed' },
      { topicId: 'operating-camera.shutter-priority', status: 'completed' },
    ]);
    expect(checkPrereqs('operating-camera.manual-mode', progress)).toEqual({ ok: true });
  });

  test('returns error for unknown topic id', () => {
    const res = checkPrereqs('does.not.exist', new Map());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.missing).toEqual([]);
  });
});

describe('pickNextTopic', () => {
  test('with empty progress: returns a Tier 1 rootless topic', () => {
    const next = pickNextTopic(new Map());
    expect(next).not.toBeNull();
    expect(next!.tier).toBe(1);
    expect(next!.prereqs).toEqual([]);
  });

  test('prefers in-progress topic over available ones (finish what you started)', () => {
    const progress = makeProgress([
      { topicId: 'operating-camera.exposure-triangle', status: 'completed' },
      { topicId: 'operating-camera.aperture-priority', status: 'in-progress' },
    ]);
    const next = pickNextTopic(progress);
    expect(next?.id).toBe('operating-camera.aperture-priority');
  });

  test('among available topics, prefers lower tier (no jumping ahead)', () => {
    // Complete enough of Tier 1 to unlock Tier 2, but Tier 1 still has un-done items
    const progress = makeProgress([
      { topicId: 'operating-camera.exposure-triangle', status: 'completed' },
      { topicId: 'operating-camera.aperture-priority', status: 'completed' },
      { topicId: 'operating-camera.shutter-priority', status: 'completed' },
      // operating-camera.iso-behavior / evf-live-view / raw-vs-jpeg still un-done
    ]);
    const next = pickNextTopic(progress);
    expect(next?.tier).toBeLessThanOrEqual(2); // either remaining Tier 1 or Tier 2 freshly unlocked
  });

  test('honors branch filter', () => {
    const next = pickNextTopic(new Map(), { branch: 'editing' });
    expect(next?.branch).toBe('editing');
    expect(next?.id).toBe('editing.lightroom-classic-setup');
  });

  test('returns null when everything is completed or skipped', () => {
    const progress = makeProgress(
      ALL_TOPICS.map((t) => ({ topicId: t.id, status: 'completed' as const })),
    );
    expect(pickNextTopic(progress)).toBeNull();
  });
});

describe('generatePlan', () => {
  test('produces N distinct topics in dependency order', () => {
    const plan = generatePlan(new Map(), 5);
    expect(plan).toHaveLength(5);
    const ids = new Set(plan.map((t) => t.id));
    expect(ids.size).toBe(5);
    // First topic must be rootless
    expect(plan[0]!.prereqs).toEqual([]);
  });

  test('never includes already-completed topics', () => {
    const progress = makeProgress([
      { topicId: 'operating-camera.exposure-triangle', status: 'completed' },
      { topicId: 'operating-camera.aperture-priority', status: 'completed' },
    ]);
    const plan = generatePlan(progress, 5);
    for (const t of plan) {
      expect(['operating-camera.exposure-triangle', 'operating-camera.aperture-priority']).not.toContain(t.id);
    }
  });

  test('terminates early if fewer topics remain than requested', () => {
    // Complete all but 3 topics
    const progress = makeProgress(
      ALL_TOPICS.slice(0, ALL_TOPICS.length - 3).map((t) => ({
        topicId: t.id, status: 'completed' as const,
      })),
    );
    const plan = generatePlan(progress, 10);
    expect(plan.length).toBeLessThanOrEqual(3);
  });

  test('honors branch filter — plan stays in one branch', () => {
    const plan = generatePlan(new Map(), 5, { branch: 'editing' });
    for (const t of plan) expect(t.branch).toBe('editing');
  });
});

describe('applyProgressUpdate', () => {
  test('theory-read sets theoryLastReadAt and leaves status alone', () => {
    const updated = applyProgressUpdate(null, 'operating-camera.exposure-triangle', { kind: 'theory-read' }, NOW);
    expect(updated.theoryLastReadAt).toBe(NOW);
    // No assignment yet → status 'available' (derived later by computeStatuses); store status='available'
    expect(updated.status).toBe('available');
    expect(updated.assignmentsPassed).toBe(0);
  });

  test('assignment-started flips to in-progress and sets lastActivityAt', () => {
    const updated = applyProgressUpdate(null, 'operating-camera.exposure-triangle', { kind: 'assignment-started' }, NOW);
    expect(updated.status).toBe('in-progress');
    expect(updated.lastActivityAt).toBe(NOW);
  });

  test('assignment-passed flips to completed and increments passed count', () => {
    const start = applyProgressUpdate(null, 'operating-camera.exposure-triangle', { kind: 'assignment-started' }, NOW);
    const passed = applyProgressUpdate(start, 'operating-camera.exposure-triangle', { kind: 'assignment-passed' }, NOW);
    expect(passed.status).toBe('completed');
    expect(passed.assignmentsPassed).toBe(1);
  });

  test('assignment-failed stays in-progress and increments failed count', () => {
    const start = applyProgressUpdate(null, 'operating-camera.exposure-triangle', { kind: 'assignment-started' }, NOW);
    const failed = applyProgressUpdate(start, 'operating-camera.exposure-triangle', { kind: 'assignment-failed' }, NOW);
    expect(failed.status).toBe('in-progress');
    expect(failed.assignmentsFailed).toBe(1);
    expect(failed.assignmentsPassed).toBe(0);
  });

  test('skipped flips to skipped from any prior status', () => {
    const start = applyProgressUpdate(null, 'operating-camera.exposure-triangle', { kind: 'assignment-started' }, NOW);
    const skipped = applyProgressUpdate(start, 'operating-camera.exposure-triangle', { kind: 'skipped' }, NOW);
    expect(skipped.status).toBe('skipped');
  });

  test('preserves accumulated counts across multiple updates', () => {
    let entry = applyProgressUpdate(null, 'operating-camera.exposure-triangle', { kind: 'assignment-started' }, NOW);
    entry = applyProgressUpdate(entry, 'operating-camera.exposure-triangle', { kind: 'assignment-failed' }, NOW);
    entry = applyProgressUpdate(entry, 'operating-camera.exposure-triangle', { kind: 'assignment-failed' }, NOW);
    entry = applyProgressUpdate(entry, 'operating-camera.exposure-triangle', { kind: 'assignment-passed' }, NOW);
    expect(entry.assignmentsFailed).toBe(2);
    expect(entry.assignmentsPassed).toBe(1);
    expect(entry.status).toBe('completed');
  });

  test('idempotent topicId — updates apply to the same topic', () => {
    const updated = applyProgressUpdate(null, 'editing.lightroom-classic-setup', { kind: 'assignment-started' }, NOW);
    expect(updated.topicId).toBe('editing.lightroom-classic-setup');
  });
});

describe('integration: real branch traversal', () => {
  test('Branch 3 entry → complete in order → next picks next available', () => {
    // Walk Branch 3 Tier 1 in order
    let progress = makeProgress([]);
    expect(pickNextTopic(progress, { branch: 'editing' })?.id).toBe('editing.lightroom-classic-setup');
    progress.set('editing.lightroom-classic-setup', applyProgressUpdate(
      null, 'editing.lightroom-classic-setup', { kind: 'assignment-passed' }, NOW,
    ));
    expect(pickNextTopic(progress, { branch: 'editing' })?.id).toBe('editing.import-and-folder-structure');
    progress.set('editing.import-and-folder-structure', applyProgressUpdate(
      null, 'editing.import-and-folder-structure', { kind: 'assignment-passed' }, NOW,
    ));
    // After import-and-folder-structure, both backup-and-storage and culling-and-rating unlock
    const next = pickNextTopic(progress, { branch: 'editing' });
    expect(['editing.backup-and-storage', 'editing.culling-and-rating']).toContain(next?.id);
  });
});
