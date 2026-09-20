import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logger, processDueLeagueTrades, processPendingReminders } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  processDueLeagueTrades: vi.fn(),
  processPendingReminders: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/server/leagues/trades/tradeService', () => ({ processDueLeagueTrades }));
vi.mock('@/lib/reminders', () => ({ processPendingReminders }));

import { GET as GET_DAILY } from '@/app/api/cron/daily/route';
import { GET as GET_PRUNE_LOBBY } from '@/app/api/cron/prune-lobby/route';
import { GET as GET_REMINDERS } from '@/app/api/cron/reminders/route';
import { GET as GET_TRADES } from '@/app/api/cron/trades/route';

const cronSecret = 'cron-secret';
const bearerHeaders = { authorization: `Bearer ${cronSecret}` };

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe('scheduled-job authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  it('fails closed with 503 when the scheduler credential is not configured', async () => {
    const responses = await Promise.all([
      GET_DAILY(request('/api/cron/daily')),
      GET_TRADES(request('/api/cron/trades')),
      GET_REMINDERS(request('/api/cron/reminders')),
      GET_PRUNE_LOBBY(request('/api/cron/prune-lobby')),
    ]);

    expect(responses.map((response) => response.status)).toEqual([503, 503, 503, 503]);
    expect(processDueLeagueTrades).not.toHaveBeenCalled();
    expect(processPendingReminders).not.toHaveBeenCalled();
  });

  it('rejects a missing or incorrect credential, including a query-string token', async () => {
    process.env.CRON_SECRET = cronSecret;

    const responses = await Promise.all([
      GET_DAILY(request('/api/cron/daily')),
      GET_DAILY(request(`/api/cron/daily?token=${cronSecret}`)),
      GET_PRUNE_LOBBY(request(`/api/cron/prune-lobby?token=${cronSecret}`)),
      GET_TRADES(request('/api/cron/trades', { headers: { authorization: 'Bearer wrong' } })),
      GET_REMINDERS(
        request('/api/cron/reminders', { headers: { authorization: `Bearer ${cronSecret}-extra` } })
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
    expect(processDueLeagueTrades).not.toHaveBeenCalled();
    expect(processPendingReminders).not.toHaveBeenCalled();
  });

  it('accepts the scheduler credential as a bearer token and performs the work', async () => {
    process.env.CRON_SECRET = cronSecret;
    processDueLeagueTrades.mockResolvedValue(3);
    processPendingReminders.mockResolvedValue(undefined);

    const [daily, trades, reminders, prune] = await Promise.all([
      GET_DAILY(request('/api/cron/daily', { headers: bearerHeaders })),
      GET_TRADES(request('/api/cron/trades', { headers: bearerHeaders })),
      GET_REMINDERS(request('/api/cron/reminders', { headers: bearerHeaders })),
      GET_PRUNE_LOBBY(request('/api/cron/prune-lobby', { headers: bearerHeaders })),
    ]);

    expect([daily.status, trades.status, reminders.status, prune.status]).toEqual([
      200, 200, 200, 200,
    ]);
    expect(await trades.json()).toMatchObject({ ok: true, processed: 3 });
    expect(processDueLeagueTrades).toHaveBeenCalledTimes(1);
    expect(processPendingReminders).toHaveBeenCalledTimes(1);
  });
});
