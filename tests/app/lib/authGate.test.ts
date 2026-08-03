import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateAuth, __resetAuthGateForTest } from '../../../app/lib/authGate.js';

const base = { ip: '1.2.3.4', user: 'u', password: 'p' } as const;
const okHeader = `Basic ${btoa('u:p')}`;

describe('evaluateAuth', () => {
  beforeEach(() => __resetAuthGateForTest());

  it('fails CLOSED (500) in production when creds are unset', () => {
    const d = evaluateAuth({ authHeader: null, ip: '1.2.3.4', nodeEnv: 'production', user: '', password: '' });
    expect(d).toEqual({ action: 'reject', status: 500 });
  });

  it('falls open outside production for local dev', () => {
    const d = evaluateAuth({ authHeader: null, ip: '1.2.3.4', nodeEnv: 'development', user: '', password: '' });
    expect(d).toEqual({ action: 'pass' });
  });

  it('rejects 401 when creds are set but header is wrong', () => {
    const d = evaluateAuth({ ...base, authHeader: 'Basic wrong', nodeEnv: 'production' });
    expect(d.action).toBe('reject');
    if (d.action === 'reject') expect(d.status).toBe(401);
  });

  it('passes when the header matches', () => {
    const d = evaluateAuth({ ...base, authHeader: okHeader, nodeEnv: 'production' });
    expect(d).toEqual({ action: 'pass' });
  });
});
