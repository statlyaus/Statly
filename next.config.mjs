import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
  poweredByHeader: false,
  generateEtags: false,

  // Experimental features
  experimental: {
    // Enable if you want to use experimental features
  },
};

// Wrap the config with Sentry
const sentryWebpackPluginOptions = {
  // Additional config options for the Sentry Webpack plugin
  silent: true, // Suppresses source map upload logs during build
  org: 'your-org-name', // Replace with your Sentry organization name
  project: 'your-project-name', // Replace with your Sentry project name
};

// Export the wrapped config
export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
