import { describe, test, expect } from 'vitest';
import { shouldRunMaintenanceNudge } from '../../apps/cron/maintenance-schedule.js';

describe('shouldRunMaintenanceNudge', () => {
  test('fires on the 1st of the month at 9 AM Mountain', () => {
    // 2026-06-01 09:00 MT = 15:00 UTC (MDT, UTC-6).
    expect(shouldRunMaintenanceNudge(new Date('2026-06-01T15:00:00Z'))).toBe(true);
  });
  test('does not fire at 8 AM or 10 AM on the 1st', () => {
    expect(shouldRunMaintenanceNudge(new Date('2026-06-01T14:00:00Z'))).toBe(false);
    expect(shouldRunMaintenanceNudge(new Date('2026-06-01T16:00:00Z'))).toBe(false);
  });
  test('does not fire on the 2nd of the month at 9 AM', () => {
    expect(shouldRunMaintenanceNudge(new Date('2026-06-02T15:00:00Z'))).toBe(false);
  });
  test('handles MST (Nov–Mar) offset correctly', () => {
    // 2026-12-01 09:00 MT = 16:00 UTC (MST, UTC-7).
    expect(shouldRunMaintenanceNudge(new Date('2026-12-01T16:00:00Z'))).toBe(true);
  });
});
