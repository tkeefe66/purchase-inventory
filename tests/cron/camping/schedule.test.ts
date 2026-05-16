import { describe, test, expect } from 'vitest';
import {
  shouldRunIndexRefresh,
  shouldRunMetadataRefresh,
  shouldRunNudgeTick,
  shouldCheckReleaseTick,
} from '../../../apps/cron/camping/schedule.js';

describe('shouldRunIndexRefresh — Sunday 4am MT', () => {
  test('Sunday 10:00 UTC during MDT (4:00 MT) → true', () => {
    expect(shouldRunIndexRefresh(new Date('2026-05-17T10:00:00Z'))).toBe(true);
  });
  test('Sunday 11:00 UTC during MST (4:00 MT) → true', () => {
    expect(shouldRunIndexRefresh(new Date('2026-01-18T11:00:00Z'))).toBe(true);
  });
  test('Saturday 4am MT → false', () => {
    expect(shouldRunIndexRefresh(new Date('2026-05-16T10:00:00Z'))).toBe(false);
  });
  test('Sunday 3am MT → false', () => {
    expect(shouldRunIndexRefresh(new Date('2026-05-17T09:00:00Z'))).toBe(false);
  });
});

describe('shouldRunMetadataRefresh — 1st of month 4am MT', () => {
  test('May 1 4am MT (10:00 UTC during DST) → true', () => {
    expect(shouldRunMetadataRefresh(new Date('2026-05-01T10:00:00Z'))).toBe(true);
  });
  test('May 2 4am MT → false', () => {
    expect(shouldRunMetadataRefresh(new Date('2026-05-02T10:00:00Z'))).toBe(false);
  });
});

describe('shouldRunNudgeTick — daily 7am MT', () => {
  test('any day at 13:00 UTC during DST (= 7am MT) → true', () => {
    expect(shouldRunNudgeTick(new Date('2026-05-15T13:00:00Z'))).toBe(true);
  });
  test('6am MT → false', () => {
    expect(shouldRunNudgeTick(new Date('2026-05-15T12:00:00Z'))).toBe(false);
  });
});

describe('shouldCheckReleaseTick', () => {
  test('always true — release-tick runs every minute and self-gates', () => {
    expect(shouldCheckReleaseTick(new Date('2026-05-15T13:42:00Z'))).toBe(true);
  });
});
