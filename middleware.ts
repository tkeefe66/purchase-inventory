import { NextResponse, type NextRequest } from 'next/server';
import { evaluateAuth } from './app/lib/authGate';

// Rightmost x-forwarded-for entry = the IP Railway's edge proxy appended for
// this hop, which the client cannot forge past. The leftmost entry is
// client-supplied and trivially spoofable.
function trustedClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

export function middleware(req: NextRequest): NextResponse | undefined {
  const decision = evaluateAuth({
    authHeader: req.headers.get('authorization'),
    ip: trustedClientIp(req),
    nodeEnv: process.env['NODE_ENV'],
    user: process.env['WEB_USER'],
    password: process.env['WEB_PASSWORD'],
  });
  if (decision.action === 'pass') return undefined;
  if (decision.action === 'reject') {
    const ip = trustedClientIp(req);
    console.warn(`[auth] ${decision.status} ip=${ip} path=${req.nextUrl.pathname}`);
  }
  const body = decision.status === 500 ? 'Server misconfigured' : decision.status === 429 ? 'Too Many Requests' : 'Unauthorized';
  const init: ResponseInit = { status: decision.status };
  if (decision.headers) init.headers = decision.headers;
  return new NextResponse(body, init);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
