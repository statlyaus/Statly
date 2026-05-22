type RouterTransitionHandler = (href: string, navigationType: string) => void;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') {
    const Sentry = await import('@sentry/nextjs');

    Sentry.init({
      dsn: 'https://6ffbb0f42b9432dc3e0ef0aff3c60f94@o4509945105481728.ingest.us.sentry.io/4509945108299776',

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
