import { NextResponse, type NextRequest } from 'next/server';

/**
 * HTTP Basic Auth gate for the read-only dashboard. Required env vars:
 *
 *   WEB_USER       — username
 *   WEB_PASSWORD   — password
 *
 * Falls open (no auth) if either is unset — useful for local development.
 * In production both should be set in Railway.
 *
 * Runs on Edge runtime so we use `btoa` instead of Buffer.
 */
export function middleware(req: NextRequest): NextResponse | undefined {
  const user = process.env['WEB_USER'];
  const password = process.env['WEB_PASSWORD'];
  if (!user || !password) return undefined;

  const auth = req.headers.get('authorization');
  const expected = `Basic ${btoa(`${user}:${password}`)}`;
  if (auth === expected) return undefined;

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Outdoor Inventory Dashboard"' },
  });
}

export const config = {
  // Apply to everything except Next.js internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
