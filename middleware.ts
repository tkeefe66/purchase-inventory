import { auth } from './auth';

export default auth((req) => {
  const { pathname } = req.nextUrl;
  // Auth endpoints and the login page must be reachable unauthenticated.
  if (pathname.startsWith('/api/auth') || pathname === '/login') return;
  if (!req.auth) {
    const url = new URL('/login', req.nextUrl.origin);
    return Response.redirect(url);
  }
  return;
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
