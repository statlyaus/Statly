import { type NextRequest, NextResponse } from 'next/server';
import { commonErrors } from '@/lib/apiResponse';
import { rateLimitConfigs, withRateLimit } from '@/lib/rateLimit';
import { withRequestTracing, PerformanceTimer } from '@/lib/requestTracing';
import { adminDb } from '@/lib/firebaseAdmin';
import { calculateTotalValue } from '@/types/fantasyCategories';
import type { PlayerStats } from '@/types/fantasyCategories';

export const runtime = 'nodejs';
const CACHE_SECONDS = 600;

interface PlayerWithMeta extends PlayerStats {
  id: string;
  name: string;
  team?: string;
  position?: string;
}

type RankingsResponse = {
  players: Array<{
    id: string;
    name: string;
    team?: string;
    position?: string;
    totalValue: number;
    rank: number;
  }>;
  generatedAt: string;
  meta: {
    playerCount: number;
    calculationMethod: 'weighted';
  };
};

/* ──────────────────────────────────────────────────────────────────────
   Helper functions to safely extract data from Firestore documents
   ──────────────────────────────────────────────────────────────────── */
function getProp(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

function asString(u: unknown): string | undefined {
  return typeof u === 'string' ? u : undefined;
}

function asFiniteNumber(u: unknown): number | undefined {
  return typeof u === 'number' && Number.isFinite(u) ? u : undefined;
}

function toPlayerWithMeta(id: string, data: Record<string, unknown>): PlayerWithMeta | null {
  const name = asString(getProp(data, 'name')) ?? asString(getProp(data, 'playerName')) ?? id;
  const team = asString(getProp(data, 'team'));
  const position = asString(getProp(data, 'position'));
  
  // Extract all the stats we need for calculateTotalValue
  const games = asFiniteNumber(getProp(data, 'games')) ?? 0;
  const kicks = asFiniteNumber(getProp(data, 'kicks')) ?? 0;
  const handballs = asFiniteNumber(getProp(data, 'handballs')) ?? 0;
  const marks = asFiniteNumber(getProp(data, 'marks')) ?? 0;
  const tackles = asFiniteNumber(getProp(data, 'tackles')) ?? 0;
  const goals = asFiniteNumber(getProp(data, 'goals')) ?? 0;
  const hitouts = asFiniteNumber(getProp(data, 'hitouts')) ?? 0;
  const clearances = asFiniteNumber(getProp(data, 'clearances')) ?? 0;
  const inside50s = asFiniteNumber(getProp(data, 'inside50s')) ?? 0;
  const rebound50s = asFiniteNumber(getProp(data, 'rebound50s')) ?? 0;
  const clangers = asFiniteNumber(getProp(data, 'clangers')) ?? 0;
  const contestedPossessions = asFiniteNumber(getProp(data, 'contestedPossessions')) ?? 0;
  const uncontestedPossessions = asFiniteNumber(getProp(data, 'uncontestedPossessions')) ?? 0;
  const freesFor = asFiniteNumber(getProp(data, 'freesFor')) ?? 0;
  const freesAgainst = asFiniteNumber(getProp(data, 'freesAgainst')) ?? 0;
  const onePercenters = asFiniteNumber(getProp(data, 'onePercenters')) ?? 0;
  const goalAssists = asFiniteNumber(getProp(data, 'goalAssists')) ?? 0;
  const timeOnGroundPct = asFiniteNumber(getProp(data, 'timeOnGroundPct')) ?? 80;
  const disposalEffPct = asFiniteNumber(getProp(data, 'disposalEffPct')) ?? 75;
  const turnovers = asFiniteNumber(getProp(data, 'turnovers')) ?? 0;
  const intercepts = asFiniteNumber(getProp(data, 'intercepts')) ?? 0;
  const metresGained = asFiniteNumber(getProp(data, 'metresGained')) ?? 0;
  const contestedMarks = asFiniteNumber(getProp(data, 'contestedMarks')) ?? 0;
  const effectiveDisposals = asFiniteNumber(getProp(data, 'effectiveDisposals')) ?? 0;
  const scoreInvolvements = asFiniteNumber(getProp(data, 'scoreInvolvements')) ?? 0;

  // Skip players with no games or very minimal stats
  if (games === 0 || (kicks + handballs + marks + tackles + goals) < 5) {
    console.log('DEBUG: Skipping player', name, 'games:', games, 'basic stats sum:', kicks + handballs + marks + tackles + goals);
    return null;
  }

  console.log('DEBUG: Including player', name, 'games:', games, 'goals:', goals, 'tackles:', tackles);

  return {
    id,
    name,
    team,
    position,
    games,
    kicks,
    handballs,
    marks,
    tackles,
    goals,
    hitouts,
    clearances,
    inside50s,
    rebound50s,
    clangers,
    contestedPossessions,
    uncontestedPossessions,
    freesFor,
    freesAgainst,
    onePercenters,
    goalAssists,
    timeOnGroundPct,
    disposalEffPct,
    turnovers,
    intercepts,
    metresGained,
    contestedMarks,
    effectiveDisposals,
    scoreInvolvements,
    // Add placeholders for missing fields
    seasonTotal: 0,
    avgFantasyPoints: 0,
    lastGameFantasyPoints: 0
  };
}

/* ──────────────────────────────────────────────────────────────────────
   GET /api/rankings
   ──────────────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  // Initialize request tracing
  const tracer = withRequestTracing(req, { 
    endpoint: 'rankings',
    cached: true,
    cacheTtl: CACHE_SECONDS 
  });
  const timer = new PerformanceTimer(tracer);

  // Apply rate limiting
  const rateLimitResult = withRateLimit(rateLimitConfigs.public)(req);
  if (!rateLimitResult.success) {
    tracer.error('Rate limit exceeded', 429, { rateLimitExceeded: true });
    return NextResponse.json(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: { ...rateLimitResult.headers, ...tracer.getTraceHeaders() },
    });
  }

  try {
    // Load players with timing
    const snap = await timer.measure('firebase-query', () => 
      adminDb.collection('players').get()
    );
    
    console.log('DEBUG: Firebase snapshot size:', snap.size);
    
    const playerStats: PlayerWithMeta[] = [];
    snap.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const stats = toPlayerWithMeta(doc.id, data);
      if (stats) {
        playerStats.push(stats);
      }
    });

    console.log('DEBUG: Processed players:', playerStats.length);
    console.log('DEBUG: First few players:', playerStats.slice(0, 3).map(p => ({ name: p.name, games: p.games, goals: p.goals })));

    tracer.addMetadata({ playerCount: playerStats.length });

    // Calculate total values and rank players
    const playersWithValues = await timer.measure('compute-rankings', () => 
      Promise.resolve(playerStats.map(stats => ({
        id: stats.id,
        name: stats.name,
        team: stats.team,
        position: stats.position,
        totalValue: calculateTotalValue(stats)
      })).sort((a, b) => b.totalValue - a.totalValue))
    );

    // Assign ranks (handle ties)
    let currentRank = 1;
    let lastValue: number | null = null;
    const rankedPlayers = playersWithValues.map((player, index) => {
      if (lastValue === null || player.totalValue !== lastValue) {
        currentRank = index + 1;
        lastValue = player.totalValue;
      }
      
      return {
        id: player.id,
        name: player.name,
        team: player.team,
        position: player.position,
        totalValue: player.totalValue,
        rank: currentRank
      };
    });

    const payload: RankingsResponse = {
      players: rankedPlayers,
      generatedAt: new Date().toISOString(),
      meta: {
        playerCount: rankedPlayers.length,
        calculationMethod: 'weighted'
      }
    };

    rateLimitResult.limiter?.recordResult(req, true);
    tracer.complete(200, { resultCount: payload.players.length });
    
    return NextResponse.json(
      {
        success: true,
        data: payload,
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
          ...tracer.getTraceHeaders(),
        },
      }
    );
  } catch (err: unknown) {
    rateLimitResult.limiter?.recordResult(req, false);
    const message = err instanceof Error ? err.message : String(err);
    tracer.error(err instanceof Error ? err : new Error(message), 500);
    return commonErrors.internalServerError('Failed to compute rankings', { details: message });
  }
}