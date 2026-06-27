type RouterTransitionHandler = (href: string, navigationType: string) => void;

export async function register(): Promise<void> {
  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (process.env.NEXT_RUNTIME === 'edge' && sentryDsn) {
    const Sentry = await import('@sentry/nextjs');

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

export const onRouterTransitionStart: RouterTransitionHandler = (href, navigationType) => {
  void import('@sentry/nextjs').then((Sentry) => {
    const captureRouterTransitionStart = (
      Sentry as {
        captureRouterTransitionStart?: RouterTransitionHandler;
      }
    ).captureRouterTransitionStart;

    captureRouterTransitionStart?.(href, navigationType);
  });
};
