export type AuthDecision =
  | { action: 'pass' }
  | { action: 'reject'; status: 401 | 429 | 500; headers?: Record<string, string> };

export interface AuthInput {
  authHeader: string | null;
  ip: string;
  nodeEnv: string | undefined;
  user: string | undefined;
  password: string | undefined;
}

export function evaluateAuth(input: AuthInput): AuthDecision {
  const { authHeader, nodeEnv, user, password } = input;
  if (!user || !password) {
    // Fail CLOSED in production; fall open only for local dev.
    if (nodeEnv === 'production') return { action: 'reject', status: 500 };
    return { action: 'pass' };
  }
  const expected = `Basic ${btoa(`${user}:${password}`)}`;
  if (authHeader !== null && authHeader === expected) return { action: 'pass' };
  return {
    action: 'reject',
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Outdoor Inventory Dashboard"' },
  };
}

export function __resetAuthGateForTest(): void {
  // no state yet; Task 8 adds the failure-throttle Map cleared here.
}
