import { describe, it, expect } from 'vitest';
import { isAllowedEmail } from '../../lib/authAllowlist.js';

describe('isAllowedEmail', () => {
  const list = 'tkeefe66@gmail.com, Partner@Example.com';
  it('allows a listed email case-insensitively', () => {
    expect(isAllowedEmail('tkeefe66@gmail.com', list)).toBe(true);
    expect(isAllowedEmail('PARTNER@example.com', list)).toBe(true);
  });
  it('denies an unlisted email', () => {
    expect(isAllowedEmail('stranger@gmail.com', list)).toBe(false);
  });
  it('fails closed on empty/missing allowlist or email', () => {
    expect(isAllowedEmail('tkeefe66@gmail.com', '')).toBe(false);
    expect(isAllowedEmail('tkeefe66@gmail.com', undefined)).toBe(false);
    expect(isAllowedEmail(null, list)).toBe(false);
  });
});
