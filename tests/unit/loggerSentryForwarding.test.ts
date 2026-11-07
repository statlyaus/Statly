// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  isInitialized: vi.fn(() => true),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => sentry);

async function loadLogger() {
  vi.resetModules();
  const { logger } = await import('@/lib/logger');
  return logger;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('server logger.error reaches Sentry', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sentry.isInitialized.mockReturnValue(true);
    sentry.captureException.mockClear();
    sentry.captureMessage.mockClear();
  });

  it('captures a logged Error as an exception, without the free-form context', async () => {
    const logger = await loadLogger();
    const failure = new Error('waiver run failed');

    logger.error('Waiver cron failed', failure, { leagueId: 'league-1' });
    await settle();

    expect(sentry.captureException).toHaveBeenCalledWith(failure, {
      extra: { logMessage: 'Waiver cron failed' },
    });
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('captures a logged failure without an Error as an error message', async () => {
    const logger = await loadLogger();

    logger.error('Outbox event dead-lettered', 'timeout');
    await settle();

    expect(sentry.captureMessage).toHaveBeenCalledWith('Outbox event dead-lettered', 'error');
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('sends nothing while Sentry is not initialised', async () => {
    sentry.isInitialized.mockReturnValue(false);
    const logger = await loadLogger();

    logger.error('Waiver cron failed', new Error('boom'));
    await settle();

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('sends nothing under test', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const logger = await loadLogger();

    logger.error('Waiver cron failed', new Error('boom'));
    await settle();

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('leaves the browser path alone', async () => {
    vi.stubGlobal('window', {});
    const logger = await loadLogger();

    logger.error('Render failed', new Error('boom'));
    await settle();

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});
