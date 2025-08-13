import { type NextRequest, NextResponse } from 'next/server';
import { commonErrors } from '@/lib/apiResponse';
import { rateLimitConfigs, withRateLimit } from '@/lib/rateLimit';
import { withRequestTracing, PerformanceTimer } from '@/lib/requestTracing';
import { getPlayers } from '@/lib/data';
import { calculateTotalValue } from '@/types/fantasyCategories';
import type { PlayerStats } from '@/types/fantasyCategories';
import type { Player } from '@/types/players';

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
   Helper function to safely extract numeric values
   ──────────────────────────────────────────────────────────────────── */
function asFiniteNumber(u: unknown): number | undefined {
  return typeof u === 'number' && Number.isFinite(u) ? u : undefined;
}

function toPlayerWithMeta(player: Player): PlayerWithMeta | null {
  const name = player.name;
  const team = player.team;
  const position = player.position;
  
  // Extract all the stats we need for calculateTotalValue from player stats
  const stats = player.stats as Record<string, unknown>;
  const games = asFiniteNumber(player.games) ?? asFiniteNumber(stats?.games) ?? 1; // Default to 1 to avoid division by zero
  const kicks = asFiniteNumber(stats?.kicks) ?? 0;
  const handballs = asFiniteNumber(stats?.handballs) ?? 0;
  const marks = asFiniteNumber(stats?.marks) ?? 0;
  const tackles = asFiniteNumber(stats?.tackles) ?? 0;
  const goals = asFiniteNumber(stats?.goals) ?? 0;
  const hitouts = asFiniteNumber(stats?.hitouts) ?? 0;
  const clearances = asFiniteNumber(stats?.clearances) ?? 0;
  const inside50s = asFiniteNumber(stats?.inside50s) ?? 0;
  const rebound50s = asFiniteNumber(stats?.rebound50s) ?? 0;
  const clangers = asFiniteNumber(stats?.clangers) ?? 0;
  const contestedPossessions = asFiniteNumber(stats?.contestedPossessions) ?? 0;
  const uncontestedPossessions = asFiniteNumber(stats?.uncontestedPossessions) ?? 0;
  const freesFor = asFiniteNumber(stats?.freesFor) ?? 0;
  const freesAgainst = asFiniteNumber(stats?.freesAgainst) ?? 0;
  const onePercenters = asFiniteNumber(stats?.onePercenters) ?? 0;
  const goalAssists = asFiniteNumber(stats?.goalAssists) ?? 0;
  const timeOnGroundPct = asFiniteNumber(stats?.timeOnGroundPct) ?? 80;
  const disposalEffPct = asFiniteNumber(stats?.disposalEfficiency) ?? 75;
  const turnovers = asFiniteNumber(stats?.turnovers) ?? 0;
  const intercepts = asFiniteNumber(stats?.intercepts) ?? 0;
  const metresGained = asFiniteNumber(stats?.metresGained) ?? 0;
  const contestedMarks = asFiniteNumber(stats?.contestedMarks) ?? 0;
  const effectiveDisposals = asFiniteNumber(stats?.effectiveDisposals) ?? 0;
  const scoreInvolvements = asFiniteNumber(stats?.scoreInvolvements) ?? 0;

  // Skip players with no meaningful stats
  if ((kicks + handballs + marks + tackles + goals) < 5) {
    console.log('DEBUG: Skipping player', name, 'basic stats sum:', kicks + handballs + marks + tackles + goals);
    return null;
  }

  console.log('DEBUG: Including player', name, 'games:', games, 'goals:', goals, 'tackles:', tackles);

  return {
    id: player.id,
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
    // Load players from JSON file with timing
    const allPlayers = await timer.measure('json-data-load', () => 
      getPlayers() // Get all players
    );
    
    console.log('DEBUG: Loaded players from JSON:', allPlayers.length);
    
    const playerStats: PlayerWithMeta[] = [];
    for (const player of allPlayers) {
      const stats = toPlayerWithMeta(player);
      if (stats) {
        playerStats.push(stats);
      }
    }

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