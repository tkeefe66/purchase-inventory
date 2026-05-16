import { describe, test, expect } from 'vitest';
import { shouldSendDailyDigestAt } from '../../apps/cron/digest.js';

describe('shouldSendDailyDigestAt', () => {
  test('returns true at 19:00 Mountain (during DST = 01:00 UTC)', () => {
    // 2026-05-16 01:00 UTC === 2026-05-15 19:00 MT (MDT, UTC-6).
    expect(shouldSendDailyDigestAt(new Date('2026-05-16T01:00:00Z'))).toBe(true);
  });

  test('returns true at 19:00 Mountain in standard time (= 02:00 UTC)', () => {
    // 2026-01-16 02:00 UTC === 2026-01-15 19:00 MT (MST, UTC-7).
    expect(shouldSendDailyDigestAt(new Date('2026-01-16T02:00:00Z'))).toBe(true);
  });

  test('returns false at other hours', () => {
    expect(shouldSendDailyDigestAt(new Date('2026-05-16T00:00:00Z'))).toBe(false); // 18:00 MT
    expect(shouldSendDailyDigestAt(new Date('2026-05-16T02:00:00Z'))).toBe(false); // 20:00 MT
    expect(shouldSendDailyDigestAt(new Date('2026-05-15T12:00:00Z'))).toBe(false); // 06:00 MT
  });
});
