import { NextResponse, type NextRequest } from 'next/server';
import { evaluateAuth } from './app/lib/authGate';

export function middleware(req: NextRequest): NextResponse | undefined {
  const decision = evaluateAuth({
    authHeader: req.headers.get('authorization'),
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    nodeEnv: process.env['NODE_ENV'],
    user: process.env['WEB_USER'],
    password: process.env['WEB_PASSWORD'],
  });
  if (decision.action === 'pass') return undefined;
  if (decision.action === 'reject') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
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
