import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => {
  const scope = { setTag: vi.fn(), setContext: vi.fn() };
  return {
    scope,
    init: vi.fn(),
    captureException: vi.fn(),
    withScope: vi.fn((callback: (s: typeof scope) => void) => callback(scope)),
  };
});
vi.mock('@sentry/nextjs', () => sentry);

const { initProcessSentry, reportJobFailure } = await import('./processSentry');
const { privateSentryDataCollection } = await import('@/lib/sentry/dataCollection');

describe('initProcessSentry', () => {
  beforeEach(() => {
    sentry.init.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('initialises Sentry for a socket or worker process with the private data collection', () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1');
    vi.stubEnv('SENTRY_ENVIRONMENT', 'production');

    expect(initProcessSentry('socket-server')).toBe(true);

    expect(sentry.init).toHaveBeenCalledTimes(1);
    const options = sentry.init.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      dsn: 'https://key@o1.ingest.sentry.io/1',
      enabled: true,
      environment: 'production',
      dataCollection: privateSentryDataCollection,
      initialScope: { tags: { service: 'socket-server' } },
    });
    // Errors only: no tracing, so no spans carrying queue or query data.
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.sendDefaultPii).toBeUndefined();
  });

  it('does nothing without a DSN, or when Sentry is disabled', () => {
    vi.stubEnv('SENTRY_DSN', '');
    expect(initProcessSentry('draft-worker')).toBe(false);

    vi.stubEnv('SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1');
    vi.stubEnv('SENTRY_DISABLED', 'true');
    expect(initProcessSentry('draft-worker')).toBe(false);

    expect(sentry.init).not.toHaveBeenCalled();
  });
});

describe('reportJobFailure', () => {
  beforeEach(() => {
    sentry.captureException.mockClear();
    sentry.scope.setTag.mockClear();
    sentry.scope.setContext.mockClear();
  });

  it('reports a failed job tagged with its queue, league and season, without the job data', () => {
    const error = new Error('pick expiry failed');

    reportJobFailure(
      'draftQueue',
      {
        id: 'job-1',
        name: 'draft:pick-expiry',
        attemptsMade: 3,
        data: { leagueId: 'league-1', seasonId: 'season-2026', draftId: 'draft-1', secret: 'x' },
      },
      error
    );

    expect(sentry.scope.setTag).toHaveBeenCalledWith('queue', 'draftQueue');
    expect(sentry.scope.setTag).toHaveBeenCalledWith('job_name', 'draft:pick-expiry');
    expect(sentry.scope.setTag).toHaveBeenCalledWith('league_id', 'league-1');
    expect(sentry.scope.setTag).toHaveBeenCalledWith('season_id', 'season-2026');
    expect(sentry.scope.setTag).toHaveBeenCalledWith('draft_id', 'draft-1');
    expect(sentry.scope.setContext).toHaveBeenCalledWith('job', { id: 'job-1', attemptsMade: 3 });
    expect(JSON.stringify(sentry.scope.setContext.mock.calls)).not.toContain('secret');
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('reports a failure whose job BullMQ could not load, with only the queue tag', () => {
    const error = new Error('stalled');

    reportJobFailure('web-vitals', undefined, error);

    expect(sentry.scope.setTag).toHaveBeenCalledTimes(1);
    expect(sentry.scope.setTag).toHaveBeenCalledWith('queue', 'web-vitals');
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('ignores ids that are not strings', () => {
    reportJobFailure(
      'draftQueue',
      { id: 'job-2', name: 'x', data: { leagueId: 42 } },
      new Error('e')
    );

    expect(sentry.scope.setTag).not.toHaveBeenCalledWith('league_id', expect.anything());
  });
});
