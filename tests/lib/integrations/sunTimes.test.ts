import { describe, it, expect } from 'vitest';
import { getSunTimes } from '../../../lib/integrations/sunTimes.js';

describe('getSunTimes', () => {
  it('returns golden + blue hour times for Denver on 2026-06-21 (summer solstice)', () => {
    const result = getSunTimes(39.7392, -104.9903, '2026-06-21');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sunrise + sunset (broad timezone-agnostic checks — UTC strings)
    expect(result.sunrise).toMatch(/^2026-06-21T1[12]/); // ~11:33 UTC = ~5:33 MDT
    expect(result.sunset).toMatch(/^2026-06-22T0[12]/);  // ~02:32 UTC next day = ~20:32 MDT
    expect(result.goldenHourEvening.start).toBeDefined();
    expect(result.blueHourMorning.end).toBeDefined();
  });

  it('returns bad_coords error for invalid lat/lng', () => {
    const result = getSunTimes(999, 999, '2026-06-21');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('bad_coords');
  });
});
