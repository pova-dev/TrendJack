/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 'standalone' emits a self-contained server bundle under .next/standalone
  // — used by the Dockerfile to keep the runtime image small (~150MB).
  // Disabled in dev because `next dev` doesn't use it; only affects builds.
  output: process.env.NODE_ENV === 'production' || process.env.BUILD_STANDALONE
    ? 'standalone'
    : undefined,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
};
module.exports = nextConfig;
