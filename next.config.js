/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The Node.js cron + bot code lives in /apps and /lib next to the Next.js
  // /app dir. Tell Next not to scan those for pages.
  pageExtensions: ['tsx', 'ts'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  webpack(config) {
    // The shared lib/ code uses NodeNext-style `.js` suffix imports
    // (required for Node ESM). Webpack doesn't auto-rewrite to `.ts` —
    // tell it to try `.ts` / `.tsx` when a `.js` import isn't found.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
