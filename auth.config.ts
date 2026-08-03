import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { isAllowedEmail } from './lib/authAllowlist.js';

export const authConfig = {
  providers: [
    Google({
      // exactOptionalPropertyTypes: omit the keys entirely when unset rather
      // than assigning `undefined` (OAuthUserConfig types them as `string`,
      // not `string | undefined`). Missing creds still fail closed at
      // runtime — Auth.js throws when the provider is used without them.
      ...(process.env['AUTH_GOOGLE_ID'] ? { clientId: process.env['AUTH_GOOGLE_ID'] } : {}),
      ...(process.env['AUTH_GOOGLE_SECRET']
        ? { clientSecret: process.env['AUTH_GOOGLE_SECRET'] }
        : {}),
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    // Runs at sign-in: reject any email not on the allowlist.
    signIn({ profile }) {
      return (
        !!profile?.email_verified && isAllowedEmail(profile?.email, process.env['AUTH_ALLOWED_EMAILS'])
      );
    },
    // Runs in middleware for every gated request: require a session.
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
