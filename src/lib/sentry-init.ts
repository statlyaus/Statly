import * as Sentry from '@sentry/react';

const sentryDebugEnabled =
  process.env.NEXT_PUBLIC_SENTRY_DEBUG === 'true' || process.env.NEXT_PUBLIC_SENTRY_DEBUG === '1';
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (typeof window !== 'undefined' && sentryDsn) {
  // Initialize browser Sentry as early as possible without running browser SDK setup on SSR.
  Sentry.init({
    dsn: sentryDsn,
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
}

export default Sentry;
