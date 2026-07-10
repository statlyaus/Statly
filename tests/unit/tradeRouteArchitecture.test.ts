import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { LeagueTradeService, TradeMutationError } from '@/server/trades/LeagueTradeService';

describe('LeagueTradeService', () => {
  it('rejects an empty proposal before it enters a transaction', async () => {
    const db = { $transaction: vi.fn() };
    const service = new LeagueTradeService(db as never);

    await expect(
      service.createProposal({
        leagueId: 'league-1',
        proposerUserId: 'user-1',
        recipientMemberId: 'member-2',
        playersOffered: [],
        playersRequested: [],
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).rejects.toMatchObject<Partial<TradeMutationError>>({ code: 'INVALID_TRADE' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses acceptance by anyone other than the receiving manager', async () => {
    const tx = {
      leagueTrade: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'trade-1',
          leagueId: 'league-1',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 60_000),
          recipient: { userId: 'user-2' },
          players: [],
        }),
      },
    };
    const service = new LeagueTradeService({ $transaction: vi.fn((work) => work(tx)) } as never);

    await expect(
      service.acceptProposal({
        leagueId: 'league-1',
        tradeId: 'trade-1',
        recipientUserId: 'user-1',
      })
    ).rejects.toMatchObject<Partial<TradeMutationError>>({ code: 'FORBIDDEN' });
  });

  it('transfers every asset and refreshes both canonical roster projections atomically', async () => {
    const moves = [
      { playerId: 'player-1', fromMemberId: 'member-1', toMemberId: 'member-2' },
      { playerId: 'player-2', fromMemberId: 'member-2', toMemberId: 'member-1' },
    ];
    const tx = {
      leagueTrade: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'trade-1',
          leagueId: 'league-1',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 60_000),
          recipient: { userId: 'user-2' },
          players: moves,
        }),
        update: vi.fn().mockResolvedValue({ id: 'trade-1', status: 'PROCESSED', players: moves }),
      },
      league: { findUnique: vi.fn().mockResolvedValue({ settings: { rosterSize: 2 } }) },
      leagueRosterPlayer: {
        findMany: vi.fn(async ({ where }) => {
          if (where.playerId?.in) {
            return [
              { playerId: 'player-1', memberId: 'member-1' },
              { playerId: 'player-2', memberId: 'member-2' },
            ];
          }
          return [{ playerId: 'player-1' }];
        }),
        groupBy: vi.fn().mockResolvedValue([
          { memberId: 'member-1', _count: { _all: 1 } },
          { memberId: 'member-2', _count: { _all: 1 } },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      leagueRoster: { upsert: vi.fn() },
    };
    const service = new LeagueTradeService({ $transaction: vi.fn((work) => work(tx)) } as never);

    await service.acceptProposal({
      leagueId: 'league-1',
      tradeId: 'trade-1',
      recipientUserId: 'user-2',
    });

    expect(tx.leagueRosterPlayer.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.leagueRoster.upsert).toHaveBeenCalledTimes(2);
    expect(tx.leagueTrade.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) })
    );
  });
});
