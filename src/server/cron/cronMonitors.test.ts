import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureCheckInMock = vi.fn((..._args: unknown[]) => 'check-in-1');
const flushMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock('@sentry/nextjs', () => ({
  captureCheckIn: (...args: unknown[]) => captureCheckInMock(...args),
  flush: (...args: unknown[]) => flushMock(...args),
}));

const { CRON_MONITORS, monitorCronRun } = await import('./cronMonitors');

function statuses(): string[] {
  return captureCheckInMock.mock.calls.map((call) => (call[0] as { status: string }).status);
}

describe('monitorCronRun', () => {
  beforeEach(() => {
    captureCheckInMock.mockClear();
    flushMock.mockClear();
  });

  it('checks in in_progress then ok, with the monitor schedule, for a successful run', async () => {
    const response = await monitorCronRun('cron-waivers', async () => new Response('{}'));

    expect(response.status).toBe(200);
    expect(statuses()).toEqual(['in_progress', 'ok']);
    expect(captureCheckInMock.mock.calls[0]).toEqual([
      { monitorSlug: 'cron-waivers', status: 'in_progress' },
      expect.objectContaining({
        schedule: { type: 'crontab', value: '0 * * * *' },
        checkinMargin: expect.any(Number),
        maxRuntime: expect.any(Number),
        timezone: 'UTC',
      }),
    ]);
    expect(captureCheckInMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        checkInId: 'check-in-1',
        monitorSlug: 'cron-waivers',
        status: 'ok',
        duration: expect.any(Number),
      })
    );
    expect(flushMock).toHaveBeenCalled();
  });

  it('checks in error when the route answers 500', async () => {
    const response = await monitorCronRun(
      'cron-scoring',
      async () => new Response('{}', { status: 500 })
    );

    expect(response.status).toBe(500);
    expect(statuses()).toEqual(['in_progress', 'error']);
  });

  it('checks in error when an NBA ingest is rejected with 422', async () => {
    await monitorCronRun('cron-nba-boxscores', async () => new Response('{}', { status: 422 }));

    expect(statuses()).toEqual(['in_progress', 'error']);
  });

  it('checks in error and rethrows when the run throws', async () => {
    await expect(
      monitorCronRun('cron-waivers', async () => {
        throw new Error('database down');
      })
    ).rejects.toThrow('database down');

    expect(statuses()).toEqual(['in_progress', 'error']);
    expect(flushMock).toHaveBeenCalled();
  });

  it('still returns the response when Sentry flushing fails', async () => {
    flushMock.mockRejectedValueOnce(new Error('network'));

    const response = await monitorCronRun('cron-waivers', async () => new Response('{}'));

    expect(response.status).toBe(200);
  });
});

describe('CRON_MONITORS', () => {
  // The Netlify function's `config.schedule` must be a literal, so the monitor keeps its own copy.
  // This keeps the two from drifting: a changed schedule must change the monitor too.
  it.each(Object.entries(CRON_MONITORS))(
    '%s matches its Netlify function schedule',
    (slug, monitor) => {
      const source = readFileSync(
        join(process.cwd(), 'netlify', 'functions', `${slug}.mts`),
        'utf8'
      );
      expect(source).toContain(`schedule: '${monitor.schedule.value}'`);
    }
  );
});
