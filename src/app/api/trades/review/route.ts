import { NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebaseAdmin';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { TradeReviewEngine, type TradeStatus } from '@/lib/tradeReviewEngine';
import { z } from 'zod';
import type { Player } from '@/types/players';

// Define proper types for trade review data
interface TradeReviewData {
  state?: TradeState;
  auditLog?: TradeAuditEntry[];
  notifications?: string[];
  teamPlayers?: Player[];
  vetoThreshold?: number;
  reviewWindowMs?: number;
  tradeName?: string;
  leagueId?: string;
  fromUserId?: string;
  toUserId?: string;
  participants?: Array<string | { userId: string }>;
  archived?: boolean;
  summary?: TradeSummary;
}

// Define interfaces for the trade state and related types
interface TradeState {
  status: string;
  [key: string]: unknown;
}

interface TradeAuditEntry {
  timestamp: number;
  action: string;
  userId?: string;
  [key: string]: unknown;
}

interface TradeSummary {
  tradeId: string;
  tradeName: string;
  status: string;
  teamCount: number;
  playerNames: string[];
  lastUpdated: number;
  [key: string]: unknown;
}

interface DecodedToken {
  uid?: string;
  roles?: string[];
  admin?: boolean;
}



class BadRequestError extends Error {
  constructor(message: string) {
    super(`bad_request:${message}`);
    this.name = 'BadRequestError';
  }
}

function getTradeIdOrThrow(url: string, body?: unknown): string {
  const { searchParams } = new URL(url);
  const fromQuery = searchParams.get('tradeId');
  const fromBody = typeof body === 'object' && body !== null && 'tradeId' in body ? (body as Record<string, unknown>).tradeId : undefined;
  const raw = (fromQuery ?? (typeof fromBody === 'string' ? fromBody : undefined)) ?? '';
  const tradeId = String(raw).trim();
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const safeId = /^[A-Za-z0-9_-]{4,128}$/;
  if (!tradeId || !(uuidV4.test(tradeId) || safeId.test(tradeId))) {
    throw new BadRequestError('Missing or invalid tradeId');
  }
  return tradeId;
}

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const tradeId = getTradeIdOrThrow(request.url);

    // Require auth for reading trade review state
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.slice('Bearer '.length);
    let decoded: DecodedToken;
    try {
      decoded = await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const roles: string[] = Array.isArray(decoded?.roles) ? decoded.roles : [];
    const isAdmin = decoded?.admin === true || roles.includes('admin');

    const doc = await adminDb.collection('tradeReviews').doc(tradeId).get();
    const data: TradeReviewData = doc.exists && doc.data() ? doc.data() as TradeReviewData : {};

    // If document exists and user is not admin, enforce participant or league membership
    if (doc.exists && !isAdmin) {
      const userId: string | undefined = typeof decoded?.uid === 'string' ? decoded.uid : undefined;
      const leagueId: string | undefined = typeof data?.leagueId === 'string' ? data.leagueId : undefined;

      // Derive participants
      const participantUserIds: string[] = [];
      if (Array.isArray(data?.participants)) {
        for (const p of data.participants) {
          if (typeof p === 'string') participantUserIds.push(p);
          else if (p && typeof p.userId === 'string') participantUserIds.push(p.userId);
        }
      } else {
        if (typeof data?.fromUserId === 'string') participantUserIds.push(data.fromUserId);
        if (typeof data?.toUserId === 'string') participantUserIds.push(data.toUserId);
      }

      const isParticipant = !!userId && participantUserIds.includes(userId);
      let isMember = false;
      if (!isParticipant && userId && leagueId) {
        try {
          const membership = await verifyLeagueMembership(leagueId, userId);
          isMember = membership.isMember;
        } catch {
          isMember = false;
        }
      }

      if (!isParticipant && !isMember) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    return NextResponse.json(
      { success: true, data: { state: data?.state ?? null, auditLog: data?.auditLog ?? [], notifications: data?.notifications ?? [] } },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.startsWith('bad_request:') ? 400 : 500;
    return NextResponse.json({ success: false, error: 'Failed to get trade review' }, { status });
  }
}

export async function POST(request: Request) {
  try {
    // Ensure JSON and required fields
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json({ success: false, error: 'Bad Request: expected application/json' }, { status: 400 });
    }
    let bodyUnknown: unknown;
    try {
      bodyUnknown = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Bad Request: invalid JSON' }, { status: 400 });
    }
    const BodySchema = z.object({
      action: z.string().optional(),
      vetoThreshold: z.number().int().nonnegative().optional(),
      reviewWindowMs: z.number().int().nonnegative().optional(),
      players: z.array(z.any()).optional(),
      tradeName: z.string().optional(),
      overrideStatus: z.string().optional(),
      tradeId: z.string().optional(),
      leagueId: z.string().optional(),
    }).passthrough();
    const bodyParse = BodySchema.safeParse(bodyUnknown);
    if (!bodyParse.success) {
      return NextResponse.json({ success: false, error: 'Bad Request: invalid payload' }, { status: 400 });
    }
    const body = bodyParse.data;
    const tradeId = getTradeIdOrThrow(request.url, body);

    // AuthN + RBAC using Firebase ID token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.slice('Bearer '.length);
    let decoded: DecodedToken;
    try {
      decoded = await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const roles: string[] = Array.isArray(decoded?.roles) ? decoded.roles : [];
    const isAdmin = decoded?.admin === true || roles.includes('admin');

    const doc = await adminDb.collection('tradeReviews').doc(tradeId).get();
    const data: TradeReviewData = doc.exists && doc.data() ? doc.data() as TradeReviewData : {};

    // Authorization: Only allow trade participants or league members (admin bypass)
    const action = body?.action;
    if (action === 'accept' || action === 'veto' || action === 'process') {
      if (!isAdmin) {
        const userId: string | undefined = typeof decoded?.uid === 'string' ? decoded.uid : undefined;
        // Determine leagueId from stored doc first, then payload as fallback
        const leagueId: string | undefined =
          (typeof data?.leagueId === 'string' && data.leagueId) ||
          (typeof body?.leagueId === 'string' ? body.leagueId : undefined);

        // Check if user is a direct participant on this trade (if available on doc)
        const participantUserIds: string[] = [];
        if (Array.isArray(data?.participants)) {
          for (const p of data.participants) {
            if (typeof p === 'string') participantUserIds.push(p);
            else if (p && typeof p.userId === 'string') participantUserIds.push(p.userId);
          }
        } else {
          if (typeof data?.fromUserId === 'string') participantUserIds.push(data.fromUserId);
          if (typeof data?.toUserId === 'string') participantUserIds.push(data.toUserId);
        }

        const isParticipant = !!userId && participantUserIds.includes(userId);
        let isMember = false;
        if (!isParticipant && userId && leagueId) {
          try {
            const membership = await verifyLeagueMembership(leagueId, userId);
            isMember = membership.isMember;
          } catch {
            isMember = false;
          }
        }

        if (!isParticipant && !isMember) {
          return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }
      }
    }

    let localTeamPlayers: Player[] = [];
    let localNotifications: string[] = [];

    const localTradeEngine = new TradeReviewEngine(
      {
        vetoThreshold: body?.vetoThreshold ?? data?.vetoThreshold ?? 3,
        reviewWindowMs: body?.reviewWindowMs ?? data?.reviewWindowMs ?? 24 * 60 * 60 * 1000,
        validateRoster: (teamPlayers: Player[]) => teamPlayers.length <= 30,
      },
      (action, state) => {
        localNotifications.push(`Action: ${action}, Status: ${state.status}`);
      }
    );
    localTeamPlayers = body?.players ?? data?.teamPlayers ?? [];
    localNotifications = data?.notifications ?? [];
    const name = body?.tradeName ?? data?.tradeName ?? '';

    switch (body?.action) {
      case 'accept':
        localTradeEngine.acceptTrade();
        break;
      case 'veto':
        localTradeEngine.vetoTrade();
        break;
      case 'process':
        localTradeEngine.processTrade(localTeamPlayers);
        break;
      case 'adminOverride': {
        if (!isAdmin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        if (body?.overrideStatus) localTradeEngine.adminOverride(body.overrideStatus as TradeStatus);
        break;
      }
      case 'archive': {
        if (!isAdmin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        await adminDb.collection('tradeReviews').doc(tradeId).set({ ...(data || {}), archived: true }, { merge: true });
        return NextResponse.json({ success: true, data: { archived: true } }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } });
      }
      case 'reset': {
        if (!isAdmin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        await adminDb.collection('tradeReviews').doc(tradeId).delete();
        return NextResponse.json({ success: true, data: { state: null, auditLog: [], notifications: [] } }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } });
      }
      default:
        break;
    }

    const summary = {
      tradeId,
      tradeName: name,
      status: localTradeEngine.getState().status,
      teamCount: localTeamPlayers.length,
      playerNames: Array.isArray(localTeamPlayers) ? localTeamPlayers.map((p: Player) => p.name).slice(0, 5) : [],
      lastUpdated: Date.now(),
    };

    const effectiveVetoThreshold = body?.vetoThreshold ?? data?.vetoThreshold ?? 3;
    const effectiveReviewWindowMs = body?.reviewWindowMs ?? data?.reviewWindowMs ?? 24 * 60 * 60 * 1000;

    await adminDb.collection('tradeReviews').doc(tradeId).set({
      state: localTradeEngine.getState(),
      auditLog: localTradeEngine.getAuditLog(),
      notifications: localNotifications,
      teamPlayers: localTeamPlayers,
      vetoThreshold: effectiveVetoThreshold,
      reviewWindowMs: effectiveReviewWindowMs,
      tradeName: name,
      summary,
    }, { merge: true });

    return NextResponse.json(
      { success: true, data: { state: localTradeEngine.getState(), auditLog: localTradeEngine.getAuditLog(), notifications: localNotifications } },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.startsWith('bad_request:') ? 400 : 500;
    console.error('Failed to update trade review', { message: msg, stack: e instanceof Error ? e.stack : undefined });
    return NextResponse.json({ success: false, error: 'Failed to update trade review' }, { status });
  }
}


