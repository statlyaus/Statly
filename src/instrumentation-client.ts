import {
  captureRouterTransitionStart,
  initializeSentryClient,
} from '@/lib/sentry/clientInstrumentation';

function readSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === 'production';
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const sentryDebugEnabled =
  !isProduction &&
  (process.env.NEXT_PUBLIC_SENTRY_DEBUG === 'true' || process.env.NEXT_PUBLIC_SENTRY_DEBUG === '1');

if (sentryDsn) {
  initializeSentryClient({
    dsn: sentryDsn,
    enabled: true,
    sendDefaultPii: process.env.NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII === 'true',
    tracesSampleRate: readSampleRate(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      isProduction ? 0.1 : 1
    ),
    replaysSessionSampleRate: readSampleRate(
      process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
      isProduction ? 0.01 : 0.1
    ),
    replaysOnErrorSampleRate: readSampleRate(
      process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ERROR_SAMPLE_RATE,
      1
    ),
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',
    debug: sentryDebugEnabled,
  });
}

export { captureRouterTransitionStart as onRouterTransitionStart };
