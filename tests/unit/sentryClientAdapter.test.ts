import { afterEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  init: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => sentry);

describe('Sentry client adapter boundary', () => {
  afterEach(() => {
    sentry.captureException.mockReset();
    sentry.captureRouterTransitionStart.mockReset();
    sentry.init.mockReset();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('initializes the production SDK before invoking the router transition hook', async () => {
    const adapter = await import('@/lib/sentry/clientInstrumentation');
    const callOrder: string[] = [];
    sentry.init.mockImplementation(() => callOrder.push('init'));
    sentry.captureRouterTransitionStart.mockImplementation(() => callOrder.push('transition'));

    adapter.initializeSentryClient({ dsn: 'https://public@example.invalid/1' });
    adapter.captureRouterTransitionStart('/players', 'push');

    expect(callOrder).toEqual(['init', 'transition']);
    expect(adapter.getSentryClient()?.init).toBe(sentry.init);
  });

  it('keeps ordinary development synchronous and SDK-free when opt-in is disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEVELOPMENT_SENTRY', 'false');
    const adapter = await import('@/lib/sentry/clientInstrumentation.dev');

    adapter.initializeSentryClient({ dsn: 'https://public@example.invalid/1' });
    adapter.captureRouterTransitionStart('/players', 'push');

    expect(adapter.getSentryClient()).toBeNull();
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureRouterTransitionStart).not.toHaveBeenCalled();
  });
});
