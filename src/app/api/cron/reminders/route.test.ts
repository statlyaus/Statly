import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processPendingRemindersMock = vi.fn();
const warnMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: (...args: unknown[]) => warnMock(...args), error: vi.fn() },
}));

vi.mock('@/lib/reminders', () => ({
  processPendingReminders: (...args: unknown[]) => processPendingRemindersMock(...args),
}));

const { GET } = await import('./route');

const URL_BASE = 'http://localhost/api/cron/reminders';

describe('GET /api/cron/reminders authorization', () => {
  beforeEach(() => {
    processPendingRemindersMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects every request when CRON_SECRET is unset outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(new NextRequest(URL_BASE));

    expect(response.status).toBe(401);
    expect(processPendingRemindersMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret without logging the presented credential', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const response = await GET(
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer cron-secre' } })
    );

    expect(response.status).toBe(401);
    expect(processPendingRemindersMock).not.toHaveBeenCalled();
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain('cron-secre');
  });

  it('processes reminders with the correct bearer secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const response = await GET(
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer cron-secret' } })
    );

    expect(response.status).toBe(200);
    expect(processPendingRemindersMock).toHaveBeenCalledTimes(1);
  });
});
