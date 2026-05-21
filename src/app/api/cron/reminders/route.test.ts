import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const processPendingRemindersMock = vi.fn();

vi.mock('@/lib/reminders', () => ({
  processPendingReminders: processPendingRemindersMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('GET /api/cron/reminders', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
  });

  it('rejects requests without a configured cron secret outside explicit local runtime', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { GET } = await import('./route');

    const response = await GET(new NextRequest('http://localhost/api/cron/reminders'));

    expect(response.status).toBe(401);
    expect(processPendingRemindersMock).not.toHaveBeenCalled();
  });

  it('processes reminders for an authorized bearer token', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    processPendingRemindersMock.mockResolvedValue(undefined);
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/cron/reminders', {
        headers: {
          authorization: 'Bearer cron-secret',
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(processPendingRemindersMock).toHaveBeenCalledTimes(1);
    expect(body.success).toBe(true);
  });
});
