export type SentryClient = typeof import('@sentry/nextjs');
export type SentryClientOptions = Parameters<SentryClient['init']>[0];
export type RouterTransitionArguments = Parameters<
  SentryClient['captureRouterTransitionStart']
>;

let sentryClient: SentryClient | null = null;
let sentryClientPromise: Promise<SentryClient | null> | null = null;

function developmentSentryIsEnabled(options: SentryClientOptions): boolean {
  return (
    Boolean(options.dsn) &&
    process.env.NEXT_PUBLIC_ENABLE_DEVELOPMENT_SENTRY === 'true'
  );
}

export function initializeSentryClient(options: SentryClientOptions): void {
  if (!developmentSentryIsEnabled(options) || sentryClient || sentryClientPromise) return;

  sentryClientPromise = import('@sentry/nextjs')
    .then((client) => {
      client.init(options);
      sentryClient = client;
      return client;
    })
    .catch((error: unknown) => {
      sentryClientPromise = null;
      console.warn('Development Sentry initialization failed:', error);
      return null;
    });
}

export function captureRouterTransitionStart(...args: RouterTransitionArguments): void {
  sentryClient?.captureRouterTransitionStart(...args);
}

export function getSentryClient(): SentryClient | null {
  return sentryClient;
}
