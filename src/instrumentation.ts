export async function register() {
  const sentryDsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (process.env.NEXT_RUNTIME === 'nodejs' && sentryDsn) {
    const Sentry = await import('@sentry/node');

    Sentry.init({
      dsn: sentryDsn,

      // Performance monitoring
      tracesSampleRate: 1.0,

      // Environment
      environment: process.env.NODE_ENV || 'development',

      // Enable debug mode in development
      debug: process.env.NODE_ENV === 'development',
    });
  }
}

export const onRequestError = async (error: Error) => {
  const Sentry = await import('@sentry/node');
  Sentry.captureException(error);
};
