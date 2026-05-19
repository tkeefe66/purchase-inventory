import { describe, test, expect, vi } from 'vitest';
import { PhotographyReadCache } from '../../../apps/bot/photographyCache.js';
import type { ProgressRow, AssignmentRow } from '../../../lib/photographySheets.js';

function progRow(): ProgressRow {
  return {
    rowIndex: 1, topicId: 'x', status: 'completed',
    lastActivityAt: '', assignmentsPassed: 1, assignmentsFailed: 0, theoryLastReadAt: '',
  };
}

function activeRow(id: string): AssignmentRow {
  return {
    rowIndex: 5, id, dateIssued: '', dateSubmitted: '', dateGraded: '',
    topicId: 't', assignmentText: '', rubricJson: '[]', status: 'active',
    submittedPhotoTelegramFileId: '', camera: '', lens: '', settingsExtracted: '',
    aiVerdict: '', aiCritique: '', perCriterionJson: '', retryCount: 0,
    userNotes: '', skippedReason: '',
  };
}

describe('PhotographyReadCache', () => {
  test('dedupes readProgress calls within TTL', async () => {
    const readProgress = vi.fn(async () => [progRow()]);
    const cache = new PhotographyReadCache({
      readProgress,
      getActiveAssignment: vi.fn(async () => null),
      ttlMs: 1000,
    });
    await cache.readProgress();
    await cache.readProgress();
    await cache.readProgress();
    expect(readProgress).toHaveBeenCalledTimes(1);
  });

  test('dedupes getActiveAssignment calls within TTL', async () => {
    const getActive = vi.fn(async () => activeRow('a1'));
    const cache = new PhotographyReadCache({
      readProgress: vi.fn(async () => []),
      getActiveAssignment: getActive,
      ttlMs: 1000,
    });
    await cache.getActiveAssignment();
    await cache.getActiveAssignment();
    expect(getActive).toHaveBeenCalledTimes(1);
  });

  test('re-fetches after TTL expires', async () => {
    let now = 1000;
    const readProgress = vi.fn(async () => [progRow()]);
    const cache = new PhotographyReadCache({
      readProgress,
      getActiveAssignment: vi.fn(async () => null),
      ttlMs: 100,
      now: () => now,
    });
    await cache.readProgress();
    now += 50;
    await cache.readProgress();
    expect(readProgress).toHaveBeenCalledTimes(1);
    now += 101; // past TTL
    await cache.readProgress();
    expect(readProgress).toHaveBeenCalledTimes(2);
  });

  test('invalidate() forces re-fetch on next call for both reads', async () => {
    const readProgress = vi.fn(async () => [progRow()]);
    const getActive = vi.fn(async () => null);
    const cache = new PhotographyReadCache({
      readProgress,
      getActiveAssignment: getActive,
      ttlMs: 10_000,
    });
    await cache.readProgress();
    await cache.getActiveAssignment();
    cache.invalidate();
    await cache.readProgress();
    await cache.getActiveAssignment();
    expect(readProgress).toHaveBeenCalledTimes(2);
    expect(getActive).toHaveBeenCalledTimes(2);
  });

  test('drops promise on rejection so next call re-fetches', async () => {
    let shouldFail = true;
    const readProgress = vi.fn(async () => {
      if (shouldFail) throw new Error('sheets 503');
      return [progRow()];
    });
    const cache = new PhotographyReadCache({
      readProgress,
      getActiveAssignment: vi.fn(async () => null),
      ttlMs: 10_000,
    });
    await expect(cache.readProgress()).rejects.toThrow(/503/);
    shouldFail = false;
    const result = await cache.readProgress();
    expect(result).toHaveLength(1);
    expect(readProgress).toHaveBeenCalledTimes(2);
  });

  test('concurrent reads share the in-flight promise (no thundering herd)', async () => {
    let resolveProgress: ((rows: ProgressRow[]) => void) | null = null;
    const readProgress = vi.fn(() =>
      new Promise<ProgressRow[]>((res) => { resolveProgress = res; }),
    );
    const cache = new PhotographyReadCache({
      readProgress,
      getActiveAssignment: vi.fn(async () => null),
      ttlMs: 1000,
    });
    // Two concurrent calls before the first resolves
    const a = cache.readProgress();
    const b = cache.readProgress();
    expect(readProgress).toHaveBeenCalledTimes(1);
    resolveProgress!([progRow()]);
    expect(await a).toEqual(await b);
  });
});
