import * as Sentry from '@sentry/nextjs';

export type SentryClient = typeof import('@sentry/nextjs');
export type SentryClientOptions = Parameters<SentryClient['init']>[0];
export type RouterTransitionArguments = Parameters<
  SentryClient['captureRouterTransitionStart']
>;

let initialized = false;

export function initializeSentryClient(options: SentryClientOptions): void {
  if (initialized) return;

  Sentry.init(options);
  initialized = true;
}

export function captureRouterTransitionStart(...args: RouterTransitionArguments): void {
  if (!initialized) return;
  Sentry.captureRouterTransitionStart(...args);
}

export function getSentryClient(): SentryClient | null {
  return initialized ? Sentry : null;
}
