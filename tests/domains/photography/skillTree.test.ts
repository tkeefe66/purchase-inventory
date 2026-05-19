import { describe, test, expect } from 'vitest';
import {
  ALL_TOPICS,
  getTopicById,
  listByBranch,
  listByTier,
  validateSkillTree,
  type Topic,
  type BranchId,
} from '../../../domains/photography/skillTree.js';

describe('skillTree — Operating Camera branch (Branch 1)', () => {
  test('has 23 topics in operating-camera branch', () => {
    expect(listByBranch('operating-camera')).toHaveLength(23);
  });

  test('every topic has non-empty name, description, theorySeed, assignmentSeed', () => {
    for (const t of ALL_TOPICS) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.theorySeed.length).toBeGreaterThan(50);
      expect(t.assignmentSeed.length).toBeGreaterThan(50);
    }
  });

  test('every topic id starts with its branch namespace', () => {
    for (const t of ALL_TOPICS) {
      expect(t.id).toMatch(new RegExp(`^${t.branch}\\.`));
    }
  });

  test('Tier counts match the outline (5/6/6/6 across operating-camera)', () => {
    expect(listByTier('operating-camera', 1)).toHaveLength(5);
    expect(listByTier('operating-camera', 2)).toHaveLength(6);
    expect(listByTier('operating-camera', 3)).toHaveLength(6);
    expect(listByTier('operating-camera', 4)).toHaveLength(6);
  });

  test('Tier 1 is the entry point — only exposure-triangle is rootless', () => {
    const tier1 = listByTier('operating-camera', 1);
    const rootless = tier1.filter((t) => t.prereqs.length === 0);
    expect(rootless.map((t) => t.id)).toEqual(['operating-camera.exposure-triangle']);
  });

  test('all Tier 1 topics depend on exposure-triangle (directly or by being the root)', () => {
    for (const t of listByTier('operating-camera', 1)) {
      if (t.id === 'operating-camera.exposure-triangle') continue;
      expect(t.prereqs).toContain('operating-camera.exposure-triangle');
    }
  });
});

describe('skillTree — integrity', () => {
  test('every prereq references a defined topic', () => {
    const ids = new Set(ALL_TOPICS.map((t) => t.id));
    for (const t of ALL_TOPICS) {
      for (const p of t.prereqs) {
        expect(ids, `${t.id} has unknown prereq "${p}"`).toContain(p);
      }
    }
  });

  test('validateSkillTree returns no issues for the live tree', () => {
    expect(validateSkillTree()).toEqual([]);
  });

  test('detects cycles', () => {
    const bad: Topic[] = [
      { id: 'operating-camera.a', branch: 'operating-camera', tier: 1, name: 'A', prereqs: ['operating-camera.b'], description: 'd', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
      { id: 'operating-camera.b', branch: 'operating-camera', tier: 1, name: 'B', prereqs: ['operating-camera.a'], description: 'd', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
    ];
    const issues = validateSkillTree(bad);
    expect(issues.some((i) => i.kind === 'cycle')).toBe(true);
  });

  test('detects unknown prereq', () => {
    const bad: Topic[] = [
      { id: 'operating-camera.a', branch: 'operating-camera', tier: 1, name: 'A', prereqs: ['operating-camera.does-not-exist'], description: 'd', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
    ];
    const issues = validateSkillTree(bad);
    expect(issues.some((i) => i.kind === 'unknown-prereq')).toBe(true);
  });

  test('detects self-prereq', () => {
    const bad: Topic[] = [
      { id: 'operating-camera.a', branch: 'operating-camera', tier: 1, name: 'A', prereqs: ['operating-camera.a'], description: 'd', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
    ];
    const issues = validateSkillTree(bad);
    expect(issues.some((i) => i.kind === 'self-prereq')).toBe(true);
  });

  test('detects duplicate ids', () => {
    const t: Topic = { id: 'operating-camera.a', branch: 'operating-camera', tier: 1, name: 'A', prereqs: [], description: 'd', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) };
    const issues = validateSkillTree([t, { ...t }]);
    expect(issues.some((i) => i.kind === 'duplicate-id')).toBe(true);
  });

  test('detects cross-branch prereqs (branches should be independent)', () => {
    const bad: Topic[] = [
      { id: 'operating-camera.a', branch: 'operating-camera', tier: 1, name: 'A', prereqs: [], description: 'd', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
      { id: 'seeing.b', branch: 'seeing', tier: 1, name: 'B', prereqs: ['operating-camera.a'], description: 'd', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
    ];
    const issues = validateSkillTree(bad);
    expect(issues.some((i) => i.kind === 'cross-branch-prereq')).toBe(true);
  });

  test('detects tier violations (lower tier depending on higher)', () => {
    const bad: Topic[] = [
      { id: 'operating-camera.a', branch: 'operating-camera', tier: 1, name: 'A', prereqs: ['operating-camera.b'], description: 'd', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
      { id: 'operating-camera.b', branch: 'operating-camera', tier: 2, name: 'B', prereqs: [], description: 'd', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
    ];
    const issues = validateSkillTree(bad);
    expect(issues.some((i) => i.kind === 'tier-violation')).toBe(true);
  });
});

describe('skillTree — Seeing branch (Branch 2)', () => {
  test('has 11 topics in seeing branch', () => {
    expect(listByBranch('seeing')).toHaveLength(11);
  });

  test('Tier counts match the outline (3/3/5 across seeing)', () => {
    expect(listByTier('seeing', 1)).toHaveLength(3);
    expect(listByTier('seeing', 2)).toHaveLength(3);
    expect(listByTier('seeing', 3)).toHaveLength(5);
  });

  test('all Tier 1 seeing topics are rootless (parallel entry points)', () => {
    for (const t of listByTier('seeing', 1)) {
      expect(t.prereqs).toEqual([]);
    }
  });

  test('Tier 3 genre recipes have at least 2 prereqs each', () => {
    const recipes = listByTier('seeing', 3);
    expect(recipes).toHaveLength(5);
    for (const r of recipes) {
      expect(r.prereqs.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('skillTree — Editing branch (Branch 3)', () => {
  test('has 12 topics in editing branch', () => {
    expect(listByBranch('editing')).toHaveLength(12);
  });

  test('Tier counts match the outline (4/3/3/2 across editing)', () => {
    expect(listByTier('editing', 1)).toHaveLength(4);
    expect(listByTier('editing', 2)).toHaveLength(3);
    expect(listByTier('editing', 3)).toHaveLength(3);
    expect(listByTier('editing', 4)).toHaveLength(2);
  });

  test('Tier 1 entry point is lightroom-classic-setup (only rootless)', () => {
    const tier1 = listByTier('editing', 1);
    const rootless = tier1.filter((t) => t.prereqs.length === 0);
    expect(rootless.map((t) => t.id)).toEqual(['editing.lightroom-classic-setup']);
  });
});

describe('skillTree — Printing branch (Branch 4)', () => {
  test('has 12 topics in printing branch', () => {
    expect(listByBranch('printing')).toHaveLength(12);
  });

  test('Tier counts match the outline (3/3/3/3 across printing)', () => {
    expect(listByTier('printing', 1)).toHaveLength(3);
    expect(listByTier('printing', 2)).toHaveLength(3);
    expect(listByTier('printing', 3)).toHaveLength(3);
    expect(listByTier('printing', 4)).toHaveLength(3);
  });

  test('Tier 1 entry point is color-management-basics (only rootless)', () => {
    const tier1 = listByTier('printing', 1);
    const rootless = tier1.filter((t) => t.prereqs.length === 0);
    expect(rootless.map((t) => t.id)).toEqual(['printing.color-management-basics']);
  });
});

describe('skillTree — total + per-branch totals', () => {
  test('total topic count across all four branches', () => {
    expect(ALL_TOPICS.length).toBe(58);
  });

  test('every branch is non-empty', () => {
    const branches: BranchId[] = ['operating-camera', 'seeing', 'editing', 'printing'];
    for (const b of branches) {
      expect(listByBranch(b).length, `branch ${b} should have topics`).toBeGreaterThan(0);
    }
  });
});

describe('getTopicById + listByBranch + listByTier', () => {
  test('getTopicById returns the topic by exact id', () => {
    const t = getTopicById('operating-camera.exposure-triangle');
    expect(t?.name).toBe('Exposure Triangle');
  });
  test('getTopicById returns null for unknown id', () => {
    expect(getTopicById('does.not.exist')).toBeNull();
  });
});
