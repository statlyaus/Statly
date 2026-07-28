function readSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SENTRY_DISABLED !== 'true') {
    const Sentry = await import('@sentry/node');
    const isProduction = process.env.NODE_ENV === 'production';
    const dsn = process.env.SENTRY_DSN;

    Sentry.init({
      dsn,
      enabled: Boolean(dsn),
      tracesSampleRate: readSampleRate(
        process.env.SENTRY_TRACES_SAMPLE_RATE,
        isProduction ? 0.1 : 1
      ),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
      debug: false,
    });
  }
}

export const onRequestError = async (error: Error) => {
  if (process.env.SENTRY_DISABLED === 'true') return;

  const Sentry = await import('@sentry/node');
  Sentry.captureException(error);
};
