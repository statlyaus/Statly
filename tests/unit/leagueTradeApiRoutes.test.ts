import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as getTrades, POST as createTrade } from '@/app/api/leagues/[id]/trades/route';
import { POST as executeAction } from '@/app/api/leagues/[id]/trades/[tradeId]/actions/route';
import { GET as listTrades } from '@/app/api/trades/list/route';
import { TradeServiceError } from '@/server/leagues/trades/tradeContracts';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  loadAuthorizedLeagueTradeCentre: vi.fn(),
  createLeagueTrade: vi.fn(),
  executeLeagueTradeAction: vi.fn(),
  apiError: vi.fn(),
  firestoreCollection: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: mocks.getAuthenticatedUserId,
}));

vi.mock('@/lib/logger', () => ({
  logger: { apiError: mocks.apiError },
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: { collection: mocks.firestoreCollection },
}));

vi.mock('@/server/leagues/trades/tradeReadModel', () => ({
  loadAuthorizedLeagueTradeCentre: mocks.loadAuthorizedLeagueTradeCentre,
}));

vi.mock('@/server/leagues/trades/tradeService', () => ({
  createLeagueTrade: mocks.createLeagueTrade,
  executeLeagueTradeAction: mocks.executeLeagueTradeAction,
}));

const params = { params: Promise.resolve({ id: 'league-1' }) };
const actionParams = {
  params: Promise.resolve({ id: 'league-1', tradeId: 'trade-1' }),
};

describe('league Trade Centre API routes', () => {
  beforeEach(() => {
    mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    mocks.loadAuthorizedLeagueTradeCentre.mockResolvedValue({
      leagueId: 'league-1',
      viewerMemberId: 'member-1',
      activeView: 'sent',
      trades: [],
    });
    mocks.createLeagueTrade.mockResolvedValue({
      threadId: 'trade-1',
      offerId: 'offer-1',
      status: 'OPEN',
      version: 0,
    });
    mocks.executeLeagueTradeAction.mockResolvedValue({
      threadId: 'trade-1',
      offerId: 'offer-1',
      status: 'COMPLETED',
      version: 1,
    });
  });

  it('authenticates and forwards supported GET pagination without accepting actor identity', async () => {
    const response = await getTrades(
      new NextRequest(
        'http://localhost/api/leagues/league-1/trades?view=sent&cursor=cursor-1&pageSize=12'
      ),
      params
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.loadAuthorizedLeagueTradeCentre).toHaveBeenCalledWith({
      leagueId: 'league-1',
      userId: 'user-1',
      view: 'sent',
      cursor: 'cursor-1',
      pageSize: 12,
    });
    await expect(response.json()).resolves.toMatchObject({
      leagueId: 'league-1',
      activeView: 'sent',
    });
  });

  it('rejects unauthenticated and invalid GET requests before loading trade data', async () => {
    mocks.getAuthenticatedUserId.mockResolvedValueOnce(null);
    const unauthorized = await getTrades(
      new NextRequest('http://localhost/api/leagues/league-1/trades'),
      params
    );
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });

    const invalidView = await getTrades(
      new NextRequest('http://localhost/api/leagues/league-1/trades?view=all'),
      params
    );
    expect(invalidView.status).toBe(400);
    await expect(invalidView.json()).resolves.toMatchObject({ code: 'INVALID_INPUT' });
    expect(mocks.loadAuthorizedLeagueTradeCentre).not.toHaveBeenCalled();
    expect(mocks.apiError).not.toHaveBeenCalled();
  });

  it('creates a trade with the authenticated user and returns the command result', async () => {
    const body = {
      recipientMemberId: 'member-2',
      sendingPlayerIds: ['player-1'],
      receivingPlayerIds: ['player-2'],
      idempotencyKey: 'create-key-1',
    };
    const response = await createTrade(
      new NextRequest('http://localhost/api/leagues/league-1/trades', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      params
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.createLeagueTrade).toHaveBeenCalledWith('league-1', 'user-1', body);
    await expect(response.json()).resolves.toMatchObject({ threadId: 'trade-1', version: 0 });
  });

  it('executes an action with route and session identity and maps domain errors deliberately', async () => {
    const body = {
      action: 'accept',
      expectedVersion: 0,
      idempotencyKey: 'accept-key-1',
    };
    const response = await executeAction(
      new NextRequest('http://localhost/api/leagues/league-1/trades/trade-1/actions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      actionParams
    );

    expect(response.status).toBe(200);
    expect(mocks.executeLeagueTradeAction).toHaveBeenCalledWith(
      'league-1',
      'user-1',
      'trade-1',
      body
    );

    mocks.executeLeagueTradeAction.mockRejectedValueOnce(
      new TradeServiceError('STALE_VERSION', 'This trade changed.', 409)
    );
    const stale = await executeAction(
      new NextRequest('http://localhost/api/leagues/league-1/trades/trade-1/actions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      actionParams
    );
    expect(stale.status).toBe(409);
    expect(stale.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(stale.json()).resolves.toEqual({
      error: 'This trade changed.',
      code: 'STALE_VERSION',
    });
    expect(mocks.apiError).not.toHaveBeenCalled();
  });

  it('logs unexpected action failures without leaking details', async () => {
    mocks.executeLeagueTradeAction.mockRejectedValueOnce(new Error('database secret'));
    const response = await executeAction(
      new NextRequest('http://localhost/api/leagues/league-1/trades/trade-1/actions', {
        method: 'POST',
        body: JSON.stringify({ action: 'accept' }),
      }),
      actionParams
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    });
    expect(mocks.apiError).toHaveBeenCalledWith(
      'POST',
      '/api/leagues/[id]/trades/[tradeId]/actions',
      expect.any(Error)
    );
  });

  it('serves league-scoped legacy list requests from the Trade Centre read model', async () => {
    mocks.loadAuthorizedLeagueTradeCentre.mockResolvedValueOnce({
      leagueId: 'league-1',
      viewerMemberId: 'member-1',
      activeView: 'sent',
      nextCursor: 'next-1',
      trades: [
        {
          id: 'trade-1',
          status: 'open',
          updatedAt: '2026-07-21T18:00:00.000Z',
          currentOffer: {
            message: 'Midfield swap',
            players: [{ name: 'Player One' }, { name: 'Player Two' }],
          },
        },
      ],
    });

    const response = await listTrades(
      new NextRequest(
        'http://localhost/api/trades/list?leagueId=league-1&view=sent&pageSize=10'
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.loadAuthorizedLeagueTradeCentre).toHaveBeenCalledWith({
      leagueId: 'league-1',
      userId: 'user-1',
      view: 'sent',
      cursor: undefined,
      pageSize: 10,
    });
    expect(mocks.firestoreCollection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      trades: [
        {
          tradeId: 'trade-1',
          summary: {
            tradeName: 'Midfield swap',
            playerNames: ['Player One', 'Player Two'],
          },
        },
      ],
      pageInfo: { nextCursor: 'next-1' },
    });
  });
});
