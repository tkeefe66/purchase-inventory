/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Node.js cron + bot code lives in /apps and /lib next to the Next.js
  // /app dir. Tell Next not to scan those for pages.
  pageExtensions: ['tsx', 'ts'],
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
