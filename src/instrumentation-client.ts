import * as Sentry from '@sentry/nextjs';

const sentryDebugEnabled =
  process.env.NEXT_PUBLIC_SENTRY_DEBUG === 'true' || process.env.NEXT_PUBLIC_SENTRY_DEBUG === '1';

Sentry.init({
  dsn: 'https://6ffbb0f42b9432dc3e0ef0aff3c60f94@o4509945105481728.ingest.us.sentry.io/4509945108299776',
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV || 'development',
  debug: sentryDebugEnabled,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
