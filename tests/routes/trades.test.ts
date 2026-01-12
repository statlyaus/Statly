import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@prisma/client', () => ({
  TradeErrorCode: {
    TRADE_WINDOW_CLOSED: 'TRADE_WINDOW_CLOSED',
    TRADE_NOT_FOUND: 'TRADE_NOT_FOUND',
    TRADE_FORBIDDEN: 'TRADE_FORBIDDEN',
    TRADE_INVALID_TRANSITION: 'TRADE_INVALID_TRANSITION',
    TRADE_PLAYER_NOT_OWNED: 'TRADE_PLAYER_NOT_OWNED',
    TRADE_ROSTER_INVALID: 'TRADE_ROSTER_INVALID',
    TRADE_PLAYER_LOCKED: 'TRADE_PLAYER_LOCKED',
    TRADE_IDEMPOTENCY_CONFLICT: 'TRADE_IDEMPOTENCY_CONFLICT',
  },
  TradeStatus: {
    PROPOSED: 'PROPOSED',
    DECLINED: 'DECLINED',
    CANCELLED: 'CANCELLED',
    SUPERSEDED: 'SUPERSEDED',
    EXPIRED: 'EXPIRED',
    EXECUTED: 'EXECUTED',
  },
  TradeActionType: {
    ACCEPT: 'ACCEPT',
    DECLINE: 'DECLINE',
    CANCEL: 'CANCEL',
  },
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {
    verifyIdToken: vi.fn(),
  },
}));

vi.mock('@/services/tradeService', () => ({
  tradeService: {
    proposeTrade: vi.fn(),
    acceptTrade: vi.fn(),
    declineTrade: vi.fn(),
    cancelTrade: vi.fn(),
  },
  TradeServiceError: class TradeServiceError extends Error {
    code: string;
    context?: Record<string, unknown>;
    constructor(code: string, message: string, context?: Record<string, unknown>) {
      super(message);
      this.code = code;
      this.context = context;
    }
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(),
    },
    trade: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const { adminAuth } = await import('@/lib/firebaseAdmin');
const { tradeService } = await import('@/services/tradeService');
const { prisma } = await import('@/lib/prisma');
const { registerTradeRoutes } = await import('@/server/routes/trades');

function createTestApp() {
  const app = express();
  app.use(express.json());
  registerTradeRoutes(app);
  return app;
}

const validRequestId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('Trade routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.resetAllMocks();
    (adminAuth.verifyIdToken as ReturnType<typeof vi.fn>).mockResolvedValue({ uid: 'user_1' });
    (prisma.league.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'league_1',
      settings: { locked: false, tradesLocked: false },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when auth header is missing', async () => {
    const res = await request(app).post('/api/trades').send({});
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_UNAUTHENTICATED');
  });

  it('returns 401 when token is invalid', async () => {
    (adminAuth.verifyIdToken as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('bad token'));

    const res = await request(app)
      .post('/api/trades')
      .set('Authorization', 'Bearer bad')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_UNAUTHENTICATED');
  });

  it('returns 409 when trade window is closed', async () => {
    (prisma.league.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'league_1',
      settings: { locked: true },
    });

    const res = await request(app)
      .post('/api/trades')
      .set('Authorization', 'Bearer token')
      .send({
        requestId: validRequestId,
        leagueId: 'league_1',
        recipientUserId: 'user_2',
        items: [{ fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' }],
      });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('TRADE_WINDOW_CLOSED');
  });

  it('returns 400 for invalid requestId', async () => {
    const res = await request(app)
      .post('/api/trades')
      .set('Authorization', 'Bearer token')
      .send({
        requestId: 'invalid',
        leagueId: 'league_1',
        recipientUserId: 'user_2',
        items: [{ fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' }],
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for empty items', async () => {
    const res = await request(app)
      .post('/api/trades')
      .set('Authorization', 'Bearer token')
      .send({
        requestId: validRequestId,
        leagueId: 'league_1',
        recipientUserId: 'user_2',
        items: [],
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for duplicate playerId in items', async () => {
    const res = await request(app)
      .post('/api/trades')
      .set('Authorization', 'Bearer token')
      .send({
        requestId: validRequestId,
        leagueId: 'league_1',
        recipientUserId: 'user_2',
        items: [
          { fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' },
          { fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' },
        ],
      });

    expect(res.status).toBe(400);
  });

  it('returns data wrapper on proposal success', async () => {
    (tradeService.proposeTrade as ReturnType<typeof vi.fn>).mockResolvedValue({
      tradeId: 'trade_1',
      status: 'PROPOSED',
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/trades')
      .set('Authorization', 'Bearer token')
      .send({
        requestId: validRequestId,
        leagueId: 'league_1',
        recipientUserId: 'user_2',
        items: [{ fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        tradeId: 'trade_1',
        status: 'PROPOSED',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    });
  });

  it('returns same response for idempotent proposal replay', async () => {
    (tradeService.proposeTrade as ReturnType<typeof vi.fn>).mockResolvedValue({
      tradeId: 'trade_1',
      status: 'PROPOSED',
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    const payload = {
      requestId: validRequestId,
      leagueId: 'league_1',
      recipientUserId: 'user_2',
      items: [{ fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' }],
    };

    const first = await request(app)
      .post('/api/trades')
      .set('Authorization', 'Bearer token')
      .send(payload);

    const second = await request(app)
      .post('/api/trades')
      .set('Authorization', 'Bearer token')
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual({
      data: {
        tradeId: 'trade_1',
        status: 'PROPOSED',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    });
    expect(second.body).toEqual(first.body);
  });

  it('maps TRADE_PLAYER_LOCKED to 409 on accept', async () => {
    (tradeService.acceptTrade as ReturnType<typeof vi.fn>).mockRejectedValue(
      new (await import('@/services/tradeService')).TradeServiceError('TRADE_PLAYER_LOCKED', 'Locked')
    );

    (prisma.trade.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'trade_1',
      leagueId: 'league_1',
    });

    const res = await request(app)
      .post('/api/trades/trade_1/accept')
      .set('Authorization', 'Bearer token')
      .send({ requestId: validRequestId });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('TRADE_PLAYER_LOCKED');
  });

  it('returns 403 when authenticated user is not a trade participant', async () => {
    (prisma.trade.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'trade_1',
      leagueId: 'league_1',
      proposerUserId: 'user_2',
      recipientUserId: 'user_3',
      items: [],
      audit: [],
    });

    const res = await request(app)
      .get('/api/trades/trade_1')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('TRADE_FORBIDDEN');
  });
});
