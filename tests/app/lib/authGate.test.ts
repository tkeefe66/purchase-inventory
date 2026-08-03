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

  it('rejects 429 after >10 failures from the same IP within the window', () => {
    __resetAuthGateForTest();
    let last;
    for (let i = 0; i < 12; i++) {
      last = evaluateAuth({ authHeader: 'Basic wrong', ip: '9.9.9.9', nodeEnv: 'production', user: 'u', password: 'p' });
    }
    expect(last?.action).toBe('reject');
    if (last?.action === 'reject') expect(last.status).toBe(429);
  });

  it('does not throttle a different IP', () => {
    __resetAuthGateForTest();
    for (let i = 0; i < 12; i++) evaluateAuth({ authHeader: 'Basic wrong', ip: '9.9.9.9', nodeEnv: 'production', user: 'u', password: 'p' });
    const other = evaluateAuth({ authHeader: 'Basic wrong', ip: '8.8.8.8', nodeEnv: 'production', user: 'u', password: 'p' });
    if (other.action === 'reject') expect(other.status).toBe(401);
  });

  it('still passes a correct header and rejects a same-length wrong one', () => {
    __resetAuthGateForTest();
    const ok = `Basic ${btoa('u:p')}`;
    expect(evaluateAuth({ authHeader: ok, ip: '1.2.3.4', nodeEnv: 'production', user: 'u', password: 'p' }).action).toBe('pass');
    const wrongSameLen = ok.slice(0, -1) + (ok.at(-1) === 'A' ? 'B' : 'A');
    expect(evaluateAuth({ authHeader: wrongSameLen, ip: '1.2.3.4', nodeEnv: 'production', user: 'u', password: 'p' }).action).toBe('reject');
  });
});
