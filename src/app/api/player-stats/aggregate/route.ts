import { NextResponse, type NextRequest } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger, withTiming } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { redisClient } from '@/lib/redis';
import { calculateTotalValue } from '@/types/fantasyCategories';
import type { PlayerStats } from '@/types/fantasyCategories';

export const runtime = 'nodejs';

type AggregatedPlayerStat = {
  id: string;
  player_id: string;
  player_name: string;
  team: string;
  position: string;
  season: number;
  games: number;
  totalValue: number;
  fantasy_points: number;
  totals: PlayerStats;
  averages: PlayerStats;
  categories: {
    goals: number;
    tackles: number;
    inside50s: number;
    intercepts: number;
    contestedMarks: number;
    rebound50s: number;
    contestedPossessions: number;
    effectiveDisposals: number;
    scoreInvolvements: number;
  };
  tenthCell: {
    type: string;
    value: number;
    label: string;
  };
  lastRound?: number;
  lastUpdated: string;
};

type PlayerAggregate = {
  playerName: string;
  team: string;
  position?: string;
  games: number;
  totals: PlayerStats;
  sumTog: number;
  sumDe: number;
  lastRound?: number;
  lastUpdated: string;
};

const CACHE_TTL_SECONDS = 60 * 15;
const COLLECTION = 'player_season_stats';

function parseNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getStat(
  data: Record<string, unknown>,
  key: string,
  altKey?: string
): number {
  const stats = (data.stats as Record<string, unknown> | undefined) ?? {};
  const direct = parseNumber(stats[key]) || parseNumber(data[key]);
  if (direct) return direct;
  if (altKey) return parseNumber(stats[altKey]) || parseNumber(data[altKey]);
  return 0;
}

async function resolveSeason(): Promise<number> {
  const currentYear = new Date().getFullYear();
  try {
    const snap = await adminDb.collection('player_match_stats').limit(500).get();
    let maxSeason = 0;
    snap.forEach((doc) => {
      const season = parseNumber(doc.data().season);
      if (season > maxSeason) maxSeason = season;
    });
    return maxSeason || currentYear;
  } catch {
    return currentYear;
  }
}

async function getCached(key: string): Promise<AggregatedPlayerStat[] | null> {
  try {
    if (!redisClient.isConnected()) {
      await redisClient.connect();
    }
    const cached = await redisClient.get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as AggregatedPlayerStat[];
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    logger.warn('player-stats aggregate cache read failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function setCached(key: string, data: AggregatedPlayerStat[]): Promise<void> {
  try {
    if (!redisClient.isConnected()) {
      await redisClient.connect();
    }
    await redisClient.set(key, JSON.stringify(data), CACHE_TTL_SECONDS);
  } catch (error) {
    logger.warn('player-stats aggregate cache write failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readFromFirestore(season: number, limit: number | null): Promise<AggregatedPlayerStat[] | null> {
  try {
    let q = adminDb.collection(COLLECTION).where('season', '==', season).orderBy('totalValue', 'desc');
    if (limit) q = q.limit(limit);
    const snap = await q.get();
    if (snap.empty) return null;
    return snap.docs.map((doc) => doc.data() as AggregatedPlayerStat);
  } catch (error) {
    logger.warn('player-stats aggregate Firestore read failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeToFirestore(season: number, rows: AggregatedPlayerStat[]): Promise<void> {
  try {
    const chunks: AggregatedPlayerStat[][] = [];
    const batchSize = 400;
    for (let i = 0; i < rows.length; i += batchSize) {
      chunks.push(rows.slice(i, i + batchSize));
    }

    for (const chunk of chunks) {
      const batch = adminDb.batch();
      chunk.forEach((row) => {
        const docId = `${season}_${row.player_id || row.player_name.toLowerCase().replace(/\s+/g, '_')}`;
        batch.set(adminDb.collection(COLLECTION).doc(docId), row, { merge: true });
      });
      await batch.commit();
    }
  } catch (error) {
    logger.warn('player-stats aggregate Firestore write failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function computeAggregates(season: number, round: number | null): Promise<AggregatedPlayerStat[]> {
  const players = await prisma.player.findMany({
    select: { id: true, name: true, club: true, position: true },
  });
  const nameMap = new Map(
    players.map((p) => [p.name.toLowerCase(), p] as const)
  );

  const aggregates = new Map<string, PlayerAggregate>();
  let cursor: string | undefined;
  const pageSize = 1000;

  while (true) {
    let q = adminDb
      .collection('player_match_stats')
      .where('season', '==', season)
      .orderBy('__name__')
      .limit(pageSize);
    if (cursor) q = q.startAfter(cursor);

    const snap = await withTiming('player-stats.aggregate.page', async () => q.get());
    if (snap.empty) break;

    snap.docs.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const playerName = String(data.player_name || '').trim();
      if (!playerName) return;

      const key = playerName.toLowerCase();
      const existing = aggregates.get(key);

      const goals = getStat(data, 'goals');
      const tackles = getStat(data, 'tackles');
      const inside50s = getStat(data, 'inside_50s', 'inside50s');
      const intercepts = getStat(data, 'intercepts');
      const contestedMarks = getStat(data, 'contested_marks', 'contestedMarks');
      const rebound50s = getStat(data, 'rebound_50s', 'rebound50s');
      const contestedPossessions = getStat(data, 'contested_possessions', 'contestedPossessions');
      const effectiveDisposals = getStat(data, 'effective_disposals', 'effectiveDisposals');
      const scoreInvolvements = getStat(data, 'score_involvements', 'scoreInvolvements');

      const kicks = getStat(data, 'kicks');
      const handballs = getStat(data, 'handballs');
      const marks = getStat(data, 'marks');
      const hitouts = getStat(data, 'hitouts', 'hit_outs');
      const clangers = getStat(data, 'clangers');
      const uncontestedPossessions = getStat(data, 'uncontested_possessions', 'uncontestedPossessions');
      const freesFor = getStat(data, 'frees_for', 'freesFor');
      const freesAgainst = getStat(data, 'frees_against', 'freesAgainst');
      const turnovers = getStat(data, 'turnovers');
      const metresGained = getStat(data, 'metres_gained', 'metresGained');

      const tog = getStat(data, 'tog_pct', 'time_on_ground_percentage');
      const de = getStat(data, 'disposal_efficiency', 'disposalEffPct');

      const roundNumber = parseNumber(data.round || data.round_number);
      if (round !== null && roundNumber && roundNumber > round) {
        return;
      }
      const updatedAt = typeof data.updated_at === 'string' ? data.updated_at : undefined;

      if (!existing) {
        aggregates.set(key, {
          playerName,
          team: String(data.team || ''),
          position: typeof data.position === 'string' ? data.position : undefined,
          games: 1,
          totals: {
            games: 1,
            kicks,
            handballs,
            marks,
            tackles,
            goals,
            hitouts,
            clearances: inside50s,
            inside50s,
            rebound50s,
            clangers,
            contestedPossessions,
            uncontestedPossessions,
            freesFor,
            freesAgainst,
            onePercenters: effectiveDisposals,
            goalAssists: scoreInvolvements,
            turnovers,
            intercepts,
            metresGained,
            contestedMarks,
            effectiveDisposals,
            scoreInvolvements,
            timeOnGroundPct: tog,
            disposalEffPct: de,
            seasonTotal: 0,
            avgFantasyPoints: 0,
            lastGameFantasyPoints: 0,
          },
          sumTog: tog,
          sumDe: de,
          lastRound: roundNumber || undefined,
          lastUpdated: updatedAt || new Date().toISOString(),
        });
        return;
      }

      existing.games += 1;
      existing.totals.games += 1;
      existing.totals.kicks += kicks;
      existing.totals.handballs += handballs;
      existing.totals.marks += marks;
      existing.totals.tackles += tackles;
      existing.totals.goals += goals;
      existing.totals.hitouts += hitouts;
      existing.totals.clearances += inside50s;
      existing.totals.inside50s += inside50s;
      existing.totals.rebound50s += rebound50s;
      existing.totals.clangers += clangers;
      existing.totals.contestedPossessions += contestedPossessions;
      existing.totals.uncontestedPossessions += uncontestedPossessions;
      existing.totals.freesFor += freesFor;
      existing.totals.freesAgainst += freesAgainst;
      existing.totals.onePercenters += effectiveDisposals;
      existing.totals.goalAssists += scoreInvolvements;
      existing.totals.turnovers += turnovers;
      existing.totals.intercepts += intercepts;
      existing.totals.metresGained += metresGained;
      existing.totals.contestedMarks += contestedMarks;
      existing.totals.effectiveDisposals += effectiveDisposals;
      existing.totals.scoreInvolvements += scoreInvolvements;
      existing.sumTog += tog;
      existing.sumDe += de;
      if (roundNumber && (!existing.lastRound || roundNumber > existing.lastRound)) {
        existing.lastRound = roundNumber;
      }
      if (updatedAt) {
        existing.lastUpdated = updatedAt;
      }
    });

    const last = snap.docs[snap.docs.length - 1];
    cursor = last?.id;
    if (snap.size < pageSize) break;
  }

  const rows: AggregatedPlayerStat[] = [];
  aggregates.forEach((agg, key) => {
    const playerProfile = nameMap.get(key);
    const games = Math.max(1, agg.games);
    const avgTog = agg.sumTog / games;
    const avgDe = agg.sumDe / games;

    const totals = agg.totals;
    const averages: PlayerStats = {
      ...totals,
      games,
      kicks: totals.kicks / games,
      handballs: totals.handballs / games,
      marks: totals.marks / games,
      tackles: totals.tackles / games,
      goals: totals.goals / games,
      hitouts: totals.hitouts / games,
      clearances: totals.clearances / games,
      inside50s: totals.inside50s / games,
      rebound50s: totals.rebound50s / games,
      clangers: totals.clangers / games,
      contestedPossessions: totals.contestedPossessions / games,
      uncontestedPossessions: totals.uncontestedPossessions / games,
      freesFor: totals.freesFor / games,
      freesAgainst: totals.freesAgainst / games,
      onePercenters: totals.onePercenters / games,
      goalAssists: totals.goalAssists / games,
      turnovers: totals.turnovers / games,
      intercepts: totals.intercepts / games,
      metresGained: totals.metresGained / games,
      contestedMarks: totals.contestedMarks / games,
      effectiveDisposals: totals.effectiveDisposals / games,
      scoreInvolvements: totals.scoreInvolvements / games,
      timeOnGroundPct: avgTog,
      disposalEffPct: avgDe,
      seasonTotal: totals.seasonTotal,
      avgFantasyPoints: totals.avgFantasyPoints,
      lastGameFantasyPoints: totals.lastGameFantasyPoints,
    };

    const totalValue = calculateTotalValue({
      ...totals,
      games,
      timeOnGroundPct: avgTog,
      disposalEffPct: avgDe,
    });

    rows.push({
      id: playerProfile?.id ?? key,
      player_id: playerProfile?.id ?? key,
      player_name: agg.playerName,
      team: playerProfile?.club ?? agg.team,
      position: playerProfile?.position ?? agg.position ?? 'MID',
      season,
      games,
      totalValue,
      fantasy_points: totalValue,
      totals,
      averages,
      categories: {
        goals: averages.goals,
        tackles: averages.tackles,
        inside50s: averages.inside50s,
        intercepts: averages.intercepts,
        contestedMarks: averages.contestedMarks,
        rebound50s: averages.rebound50s,
        contestedPossessions: averages.contestedPossessions,
        effectiveDisposals: averages.effectiveDisposals,
        scoreInvolvements: averages.scoreInvolvements,
      },
      tenthCell: {
        type: 'efficiency',
        value: Math.round(avgDe || 0),
        label: 'DE%',
      },
      lastRound: agg.lastRound,
      lastUpdated: agg.lastUpdated,
    });
  });

  rows.sort((a, b) => b.totalValue - a.totalValue);
  return rows;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get('season');
  const roundParam = searchParams.get('round');
  const limitParam = searchParams.get('limit');
  const refresh = searchParams.get('refresh') === 'true';

  const season = seasonParam ? parseInt(seasonParam, 10) : await resolveSeason();
  const round = roundParam ? parseInt(roundParam, 10) : null;
  const limit = limitParam ? Math.max(1, Math.min(parseInt(limitParam, 10), 1000)) : null;

  const cacheKey = `player-stats:aggregate:${season}:${round ?? 'all'}`;
  if (!refresh) {
    const cached = await getCached(cacheKey);
    if (cached) {
      const sliced = limit ? cached.slice(0, limit) : cached;
      return NextResponse.json({ success: true, data: sliced, count: sliced.length, source: 'cache' });
    }
  }

  if (!refresh && round === null) {
    const stored = await readFromFirestore(season, limit);
    if (stored && stored.length > 0) {
      await setCached(cacheKey, stored);
      return NextResponse.json({ success: true, data: stored, count: stored.length, source: 'firestore' });
    }
  }

  try {
    const aggregates = await computeAggregates(season, round);
    const sliced = limit ? aggregates.slice(0, limit) : aggregates;
    await setCached(cacheKey, aggregates);
    if (round === null) {
      await writeToFirestore(season, aggregates);
    }
    return NextResponse.json({
      success: true,
      data: sliced,
      count: sliced.length,
      source: 'computed',
      query: { season, round, limit },
    });
  } catch (error) {
    logger.error('player-stats aggregate failed', error as Error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to aggregate player stats',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
