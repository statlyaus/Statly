import type { Instrumentation } from 'next';

function isSentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN) && process.env.SENTRY_DISABLED !== 'true';
}

export async function register(): Promise<void> {
  if (!isSentryEnabled()) return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!isSentryEnabled()) return;

  const Sentry = await import('@sentry/nextjs');
  await Sentry.captureRequestError(...args);
};
