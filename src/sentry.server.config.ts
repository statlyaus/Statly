import * as Sentry from '@sentry/nextjs';

function readSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

const dsn = process.env.SENTRY_DSN;
const isProduction = process.env.NODE_ENV === 'production';

Sentry.init({
  dsn,
  enabled: Boolean(dsn) && process.env.SENTRY_DISABLED !== 'true',
  tracesSampleRate: readSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, isProduction ? 0.1 : 1),
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
  debug: false,
});
