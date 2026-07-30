import path from 'node:path';

const sentryClientAdapterModule = '@/lib/sentry/clientInstrumentation';
const sentryClientAdapterPath =
  process.env.NODE_ENV === 'production'
    ? './src/lib/sentry/clientInstrumentation.ts'
    : './src/lib/sentry/clientInstrumentation.dev.ts';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  turbopack: {
    resolveAlias: {
      [sentryClientAdapterModule]: sentryClientAdapterPath,
    },
  },

  webpack(config) {
    config.resolve.alias[sentryClientAdapterModule] = path.resolve(
      process.cwd(),
      sentryClientAdapterPath
    );
    return config;
  },

  images: {
    localPatterns: [
      {
        pathname: '/Assets/statly-stadium-hero.png',
        search: '?v=20260705b',
      },
      {
        pathname: '/brand/**',
      },
    ],
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

  async redirects() {
    return [
      {
        source: '/leagues',
        destination: '/dashboard',
        permanent: false,
      },
    ];
  },

  // Production optimizations
  output: 'standalone',
  serverExternalPackages: ['bullmq'],
  poweredByHeader: false,
  generateEtags: false,

  // Experimental features
  experimental: {
    // Enable if you want to use experimental features
  },
};

const sentryWebpackPluginOptions = {
  silent: true, // Suppresses source map upload logs during build
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
};

// Source-map generation and upload are production build concerns. Keeping both
// the package and wrapper out of `next dev` avoids loading its build tooling for
// every local compilation while preserving the existing production behavior.
let exportedConfig = nextConfig;

if (process.env.NODE_ENV === 'production') {
  const { withSentryConfig } = await import('@sentry/nextjs');
  exportedConfig = withSentryConfig(nextConfig, sentryWebpackPluginOptions);
}

export default exportedConfig;
