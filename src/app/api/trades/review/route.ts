import { NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebaseAdmin';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { TradeReviewEngine, type TradeStatus } from '@/lib/tradeReviewEngine';
import { z } from 'zod';
import type { Player } from '@/types/players';

// Default constants for trade review configuration
const DEFAULT_VETO_THRESHOLD = 3;
const DEFAULT_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Helper functions to get effective values with fallback logic
function getEffectiveVetoThreshold(body?: { vetoThreshold?: number }, data?: { vetoThreshold?: number }): number {
  return body?.vetoThreshold ?? data?.vetoThreshold ?? DEFAULT_VETO_THRESHOLD;
}

function getEffectiveReviewWindowMs(body?: { reviewWindowMs?: number }, data?: { reviewWindowMs?: number }): number {
  return body?.reviewWindowMs ?? data?.reviewWindowMs ?? DEFAULT_REVIEW_WINDOW_MS;
}

// Define Zod schema for runtime validation
const TradeReviewDataSchema = z.object({
  state: z.object({
    status: z.string(),
  }).passthrough().optional(),
  auditLog: z.array(z.object({
    timestamp: z.number(),
    action: z.string(),
    userId: z.string().optional(),
  }).passthrough()).optional(),
  notifications: z.array(z.string()).optional(),
  teamPlayers: z.array(z.any()).optional(), // Player type validation would go here
  vetoThreshold: z.number().int().nonnegative().optional(),
  reviewWindowMs: z.number().int().nonnegative().optional(),
  tradeName: z.string().optional(),
  leagueId: z.string().optional(),
  fromUserId: z.string().optional(),
  toUserId: z.string().optional(),
  participants: z.array(z.union([z.string(), z.object({ userId: z.string() }).passthrough()])).optional(),
  archived: z.boolean().optional(),
  summary: z.object({
    tradeId: z.string(),
    tradeName: z.string(),
    status: z.string(),
    teamCount: z.number(),
    playerNames: z.array(z.string()),
    lastUpdated: z.number(),
  }).passthrough().optional(),
});

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
  email?: string;
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

// Validation function to safely validate Firestore data
function validateTradeReviewData(rawData: unknown): TradeReviewData {
  const validationResult = TradeReviewDataSchema.safeParse(rawData);
  if (!validationResult.success) {
    console.error('Trade review data validation failed:', {
      errors: validationResult.error.format(),
      data: rawData
    });
    throw new BadRequestError('Invalid trade review data structure');
  }
  return validationResult.data;
}

/**
 * Validates a team roster according to AFL Fantasy rules
 * @param teamPlayers Array of players to validate
 * @returns true if roster is valid, false otherwise
 */
function validateRoster(teamPlayers: Player[]): boolean {
  // Check minimum roster size (18 players)
  if (teamPlayers.length < 18) {
    return false;
  }
  
  // Check maximum roster size (30 players)
  if (teamPlayers.length > 30) {
    return false;
  }
  
  // Validate each player object
  for (const player of teamPlayers) {
    // Check for null/undefined entries
    if (!player) {
      return false;
    }
    
    // Check required fields exist and have correct types
    if (!player.id || typeof player.id !== 'string') {
      return false;
    }
    
    if (!player.name || typeof player.name !== 'string') {
      return false;
    }
    
    if (!player.position || typeof player.position !== 'string') {
      return false;
    }
    
    // Validate position is valid
    const validPositions = ['DEF', 'MID', 'FWD', 'RUC'];
    if (!validPositions.includes(player.position)) {
      return false;
    }
  }
  
  // Check for duplicate player IDs
  const playerIds = teamPlayers.map(p => p.id);
  const uniqueIds = new Set(playerIds);
  if (uniqueIds.size !== playerIds.length) {
    return false;
  }
  
  return true;
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
    } catch (error) {
      console.error('Failed to verify ID token', { error });
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // Auth OK (debug)
    console.debug('TradeReview auth OK', {
      uid: decoded?.uid,
      roles: Array.isArray(decoded?.roles) ? decoded.roles : [],
      isAdmin:
        decoded?.admin === true ||
        (Array.isArray(decoded?.roles) && decoded.roles.includes('admin')),
    });
    
    const roles: string[] = Array.isArray(decoded?.roles) ? decoded.roles : [];
    const isAdmin = decoded?.admin === true || roles.includes('admin');

    const doc = await adminDb.collection('tradeReviews').doc(tradeId).get();
    let data: TradeReviewData = {};
    if (doc.exists && doc.data()) {
      try {
        data = validateTradeReviewData(doc.data());
      } catch (validationError) {
        console.error('Trade review data validation failed for tradeId:', tradeId, validationError);
        return NextResponse.json({ success: false, error: 'Invalid trade review data' }, { status: 400 });
      }
    }

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
        } catch (error) {
          console.error('Failed to verify league membership', { error, leagueId, userId });
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
    } catch (error) {
      console.error('Failed to parse request JSON', { error });
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
    } catch (error) {
      console.error('Failed to verify ID token', { error });
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // Log user info for audit purposes (safely handling optional fields)
    console.log('User authentication successful', { 
      uid: decoded?.uid, 
      email: decoded?.email, 
      roles: decoded?.roles,
      isAdmin: decoded?.admin === true || (Array.isArray(decoded?.roles) && decoded.roles.includes('admin'))
    });
    
    const roles: string[] = Array.isArray(decoded?.roles) ? decoded.roles : [];
    const isAdmin = decoded?.admin === true || roles.includes('admin');

    const doc = await adminDb.collection('tradeReviews').doc(tradeId).get();
    let data: TradeReviewData = {};
    if (doc.exists && doc.data()) {
      try {
        data = validateTradeReviewData(doc.data());
      } catch (validationError) {
        console.error('Trade review data validation failed for tradeId:', tradeId, validationError);
        return NextResponse.json({ success: false, error: 'Invalid trade review data' }, { status: 400 });
      }
    }

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
          } catch (error) {
            console.error('Failed to verify league membership', { error, leagueId, userId });
            isMember = false;
          }
        }

        if (!isParticipant && !isMember) {
          return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }
      }
    }

    // Initialize variables before creating the engine so the callback captures correct values
    let localTeamPlayers: Player[] = body?.players ?? data?.teamPlayers ?? [];
    let localNotifications: string[] = data?.notifications ?? [];
    const name = body?.tradeName ?? data?.tradeName ?? '';

    const localTradeEngine = new TradeReviewEngine(
      {
        vetoThreshold: getEffectiveVetoThreshold(body, data),
        reviewWindowMs: getEffectiveReviewWindowMs(body, data),
        validateRoster: validateRoster,
      },
      (action, state) => {
        localNotifications.push(`Action: ${action}, Status: ${state.status}`);
      }
    );

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
        if (body?.overrideStatus) {
          // Validate overrideStatus is a valid TradeStatus before casting
          const validTradeStatuses: TradeStatus[] = ['offered', 'accepted', 'underReview', 'processed', 'vetoed'];
          if (!validTradeStatuses.includes(body.overrideStatus as TradeStatus)) {
            return NextResponse.json({ 
              success: false, 
              error: `Invalid overrideStatus: ${body.overrideStatus}. Must be one of: ${validTradeStatuses.join(', ')}` 
            }, { status: 400 });
          }
          // Now we can safely cast since we've validated it
          localTradeEngine.adminOverride(body.overrideStatus as TradeStatus);
        }
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

    await adminDb.collection('tradeReviews').doc(tradeId).set({
      state: localTradeEngine.getState(),
      auditLog: localTradeEngine.getAuditLog(),
      notifications: localNotifications,
      teamPlayers: localTeamPlayers,
      vetoThreshold: getEffectiveVetoThreshold(body, data),
      reviewWindowMs: getEffectiveReviewWindowMs(body, data),
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


