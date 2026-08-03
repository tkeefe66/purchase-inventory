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

const authFails = new Map<string, number[]>();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function evaluateAuth(input: AuthInput): AuthDecision {
  const { authHeader, nodeEnv, user, password } = input;
  if (!user || !password) {
    // Fail CLOSED in production; fall open only for local dev.
    if (nodeEnv === 'production') return { action: 'reject', status: 500 };
    return { action: 'pass' };
  }
  const expected = `Basic ${btoa(`${user}:${password}`)}`;
  if (authHeader !== null && timingSafeEqual(authHeader, expected)) return { action: 'pass' };

  const now = Date.now();
  const recent = (authFails.get(input.ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  authFails.set(input.ip, recent);
  if (recent.length > 10) {
    return { action: 'reject', status: 429, headers: { 'retry-after': '60' } };
  }
  return {
    action: 'reject',
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Outdoor Inventory Dashboard"' },
  };
}

export function __resetAuthGateForTest(): void {
  authFails.clear();
}
