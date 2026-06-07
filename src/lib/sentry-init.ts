import * as Sentry from '@sentry/react';

const sentryDebugEnabled =
  process.env.NEXT_PUBLIC_SENTRY_DEBUG === 'true' || process.env.NEXT_PUBLIC_SENTRY_DEBUG === '1';

// Initialize Sentry as early as possible in your application's lifecycle.
Sentry.init({
  dsn: 'https://6ffbb0f42b9432dc3e0ef0aff3c60f94@o4509945105481728.ingest.us.sentry.io/4509945108299776',
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
  // Performance monitoring
  tracesSampleRate: 1.0,
  // Session replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  // Environment
  environment: process.env.NODE_ENV || 'development',
  // Enable SDK debug logs only when troubleshooting Sentry transport locally.
  debug: sentryDebugEnabled,
});

export default Sentry;
