/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // CI/build stability: don't fail the build on lint or type issues
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Ensure Turbopack uses the project root even when standalone output exists
  turbopack: {
    // Resolve current file directory in ESM context
    root: new URL('.', import.meta.url).pathname,
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Existing header
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          // Production security headers
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
  // Production optimizations
  // Only emit standalone output in production to avoid dev root confusion
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  poweredByHeader: false,
  generateEtags: false,
};

export default nextConfig;
