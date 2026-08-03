import { describe, it, expect } from 'vitest';
import { shouldRunDailyBackup } from '../../apps/cron/backup-schedule.js';

describe('shouldRunDailyBackup', () => {
  it('is true at 03:00 America/Denver and false otherwise', () => {
    // 2026-08-03 09:00Z == 03:00 MDT (UTC-6)
    expect(shouldRunDailyBackup(new Date('2026-08-03T09:00:00Z'))).toBe(true);
    // 2026-08-03 10:00Z == 04:00 MDT
    expect(shouldRunDailyBackup(new Date('2026-08-03T10:00:00Z'))).toBe(false);
  });
});
