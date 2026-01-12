import type { Request, Response } from 'express';
import express from 'express';
import { TradeErrorCode, TradeStatus } from '@prisma/client';

import { adminAuth } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';
import { tradeService, TradeServiceError } from '@/services/tradeService';

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

async function requireActorUserId(req: Request, res: Response): Promise<string | null> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ errorCode: 'AUTH_UNAUTHENTICATED', message: 'Missing auth token.' });
    return null;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    res
      .status(401)
      .json({ errorCode: 'AUTH_UNAUTHENTICATED', message: 'Invalid or expired token.' });
    return null;
  }
}

function errorStatus(code: TradeErrorCode): number {
  switch (code) {
    case TradeErrorCode.TRADE_NOT_FOUND:
      return 404;
    case TradeErrorCode.TRADE_FORBIDDEN:
      return 403;
    case TradeErrorCode.TRADE_INVALID_TRANSITION:
    case TradeErrorCode.TRADE_PLAYER_LOCKED:
    case TradeErrorCode.TRADE_IDEMPOTENCY_CONFLICT:
    case TradeErrorCode.TRADE_WINDOW_CLOSED:
      return 409;
    case TradeErrorCode.TRADE_PLAYER_NOT_OWNED:
    case TradeErrorCode.TRADE_ROSTER_INVALID:
      return 422;
    default:
      return 400;
  }
}

function handleTradeError(res: Response, error: unknown) {
  const domainError =
    error instanceof TradeServiceError
      ? error
      : error && typeof error === 'object' && 'code' in error && 'message' in error
        ? (error as TradeServiceError)
        : null;

  if (domainError) {
    return res.status(errorStatus(domainError.code)).json({
      errorCode: domainError.code,
      message: domainError.message,
      context: domainError.context ?? {},
    });
  }
  return res.status(500).json({
    errorCode: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'Unexpected error',
  });
}

async function assertTradeWindowOpen(leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });

  const tradesLocked = league?.settings?.tradesLocked ?? league?.settings?.locked ?? false;
  // TODO: replace boolean lockout with fixture-based lockout once fixtures are in Prisma.
  if (tradesLocked) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_WINDOW_CLOSED,
      'Trading is closed for this league.'
    );
  }
}

function isValidRequestId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const uuidV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const cuid = /^c[0-9a-z]{24}$/i;
  return uuidV4.test(trimmed) || cuid.test(trimmed);
}

function parseProposalItems(
  proposerUserId: string,
  recipientUserId: string,
  items: unknown,
  onError: (message: string, status?: number) => void
): TradeItemInput[] | null {
  if (!Array.isArray(items) || items.length === 0) {
    onError('items must be a non-empty array.');
    return null;
  }

  const allowedUserIds = new Set([proposerUserId, recipientUserId]);
  const seenPlayerIds = new Set<string>();
  const parsed: TradeItemInput[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      onError('Invalid trade item.');
      return null;
    }
    const { fromUserId, toUserId, playerId } = item as TradeItemInput;
    if (!fromUserId || !toUserId || !playerId) {
      onError('Invalid trade item.');
      return null;
    }
    if (!allowedUserIds.has(fromUserId) || !allowedUserIds.has(toUserId)) {
      onError('Trade items must be between proposer and recipient.', 400);
      return null;
    }
    if (fromUserId === toUserId) {
      onError('Trade items must move between teams.');
      return null;
    }
    if (seenPlayerIds.has(playerId)) {
      onError('Duplicate playerId in trade items.');
      return null;
    }
    seenPlayerIds.add(playerId);
    parsed.push({ fromUserId, toUserId, playerId });
  }

  return parsed;
}

export function registerTradeRoutes(app: express.Express) {
  const router = express.Router();

  router.post('/trades', async (req, res) => {
    try {
      const actorUserId = await requireActorUserId(req, res);
      if (!actorUserId) return;
      const {
        requestId,
        leagueId,
        roundId,
        recipientUserId,
        parentTradeId,
        note,
        items,
        ruleVersions,
      } = req.body ?? {};

      if (!isValidRequestId(requestId) || !leagueId || !recipientUserId) {
        return res.status(400).json({
          errorCode: 'BAD_REQUEST',
          message: 'requestId, leagueId, and recipientUserId are required.',
        });
      }

      await assertTradeWindowOpen(leagueId);

      const normalizedItems = parseProposalItems(
        actorUserId,
        recipientUserId,
        items,
        (message, status = 400) => {
          res.status(status).json({ errorCode: 'BAD_REQUEST', message });
        }
      );
      if (!normalizedItems) return;

      const result = await tradeService.proposeTrade({
        requestId,
        leagueId,
        roundId,
        proposerUserId: actorUserId,
        recipientUserId,
        parentTradeId,
        note,
        items: normalizedItems,
        ruleVersions,
      });

      return res.json({ data: result });
    } catch (error) {
      return handleTradeError(res, error);
    }
  });

  router.post('/trades/:id/accept', async (req, res) => {
    try {
      const actorUserId = await requireActorUserId(req, res);
      if (!actorUserId) return;
      const { requestId } = req.body ?? {};
      if (!isValidRequestId(requestId)) {
        return res.status(400).json({
          errorCode: 'BAD_REQUEST',
          message: 'requestId is required.',
        });
      }

      const trade = await prisma.trade.findUnique({
        where: { id: req.params.id },
        select: { leagueId: true },
      });
      if (!trade) {
        throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
      }

      await assertTradeWindowOpen(trade.leagueId);

      const result = await tradeService.acceptTrade({
        requestId,
        tradeId: req.params.id,
        actorUserId,
      });

      return res.json({ data: result });
    } catch (error) {
      return handleTradeError(res, error);
    }
  });

  router.post('/trades/:id/decline', async (req, res) => {
    try {
      const actorUserId = await requireActorUserId(req, res);
      if (!actorUserId) return;
      const { requestId } = req.body ?? {};
      if (!isValidRequestId(requestId)) {
        return res.status(400).json({
          errorCode: 'BAD_REQUEST',
          message: 'requestId is required.',
        });
      }

      const trade = await prisma.trade.findUnique({
        where: { id: req.params.id },
        select: { leagueId: true },
      });
      if (!trade) {
        throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
      }

      await assertTradeWindowOpen(trade.leagueId);

      const result = await tradeService.declineTrade({
        requestId,
        tradeId: req.params.id,
        actorUserId,
      });

      return res.json({ data: result });
    } catch (error) {
      return handleTradeError(res, error);
    }
  });

  router.post('/trades/:id/cancel', async (req, res) => {
    try {
      const actorUserId = await requireActorUserId(req, res);
      if (!actorUserId) return;
      const { requestId } = req.body ?? {};
      if (!isValidRequestId(requestId)) {
        return res.status(400).json({
          errorCode: 'BAD_REQUEST',
          message: 'requestId is required.',
        });
      }

      const trade = await prisma.trade.findUnique({
        where: { id: req.params.id },
        select: { leagueId: true },
      });
      if (!trade) {
        throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
      }

      await assertTradeWindowOpen(trade.leagueId);

      const result = await tradeService.cancelTrade({
        requestId,
        tradeId: req.params.id,
        actorUserId,
      });

      return res.json({ data: result });
    } catch (error) {
      return handleTradeError(res, error);
    }
  });

  router.get('/trades/:id', async (req, res) => {
    try {
      const actorUserId = await requireActorUserId(req, res);
      if (!actorUserId) return;
      const trade = await prisma.trade.findUnique({
        where: { id: req.params.id },
        include: {
          items: true,
          audit: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!trade) {
        throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
      }

      if (trade.proposerUserId !== actorUserId && trade.recipientUserId !== actorUserId) {
        throw new TradeServiceError(TradeErrorCode.TRADE_FORBIDDEN, 'Trade access denied.');
      }

      return res.json({ data: trade });
    } catch (error) {
      return handleTradeError(res, error);
    }
  });

  router.get('/trades', async (req, res) => {
    try {
      const actorUserId = await requireActorUserId(req, res);
      if (!actorUserId) return;
      const leagueId = typeof req.query.leagueId === 'string' ? req.query.leagueId : undefined;
      const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
      const status = statusRaw && Object.values(TradeStatus).includes(statusRaw as TradeStatus)
        ? (statusRaw as TradeStatus)
        : undefined;

      const trades = await prisma.trade.findMany({
        where: {
          ...(leagueId ? { leagueId } : {}),
          ...(status ? { status } : {}),
          OR: [{ proposerUserId: actorUserId }, { recipientUserId: actorUserId }],
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ data: { trades } });
    } catch (error) {
      return handleTradeError(res, error);
    }
  });

  app.use('/api', router);
}
