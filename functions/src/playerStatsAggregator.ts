/**
 * Scheduled aggregation for player season stats.
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();
const REGION = 'australia-southeast1';
const COLLECTION = 'player_season_stats';

const AGGREGATOR_MEMORY = (process.env.PLAYER_STATS_AGGREGATOR_MEMORY ||
  process.env.FUNCTIONS_MEMORY ||
  '1GB') as any; // '256MB' | '512MB' | '1GB' | '2GB'
const AGGREGATOR_TIMEOUT_SECONDS = parseInt(
  process.env.PLAYER_STATS_AGGREGATOR_TIMEOUT_SECONDS || process.env.FUNCTIONS_TIMEOUT_SECONDS || '540',
  10
);

type PlayerStats = {
  games: number;
  kicks: number;
  handballs: number;
  marks: number;
  tackles: number;
  goals: number;
  hitouts: number;
  clearances: number;
  inside50s: number;
  rebound50s: number;
  clangers: number;
  contestedPossessions: number;
  uncontestedPossessions: number;
  freesFor: number;
  freesAgainst: number;
  onePercenters: number;
  goalAssists: number;
  timeOnGroundPct: number;
  disposalEffPct: number;
  turnovers: number;
  intercepts: number;
  metresGained: number;
  contestedMarks: number;
  effectiveDisposals: number;
  scoreInvolvements: number;
  seasonTotal?: number;
  avgFantasyPoints?: number;
  lastGameFantasyPoints?: number;
};

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

type PlayerProfile = {
  id: string;
  name: string;
  nameLC: string;
  team?: string;
  position?: string;
};

const WEIGHTS = {
  kicks: 1,
  handballs: 1,
  marks: 3,
  tackles: 4,
  goals: 6,
  hitouts: 1,
  clearances: 4,
  inside50s: 1,
  rebound50s: 1,
  clangers: -4,
  contestedPossessions: 3,
  uncontestedPossessions: 0.5,
  freesFor: 1,
  freesAgainst: -1,
  onePercenters: 3,
  goalAssists: 3,
  turnovers: -2,
  intercepts: 4,
  metresGained: 0.05,
  contestedMarks: 4,
  effectiveDisposals: 1,
  scoreInvolvements: 2,
};

function calculateTotalValue(s: PlayerStats): number {
  const gp = Math.max(1, s.games);
  const perGame = {
    kicks: s.kicks / gp,
    handballs: s.handballs / gp,
    marks: s.marks / gp,
    tackles: s.tackles / gp,
    goals: s.goals / gp,
    hitouts: s.hitouts / gp,
    clearances: s.clearances / gp,
    inside50s: s.inside50s / gp,
    rebound50s: s.rebound50s / gp,
    clangers: s.clangers / gp,
    contestedPossessions: s.contestedPossessions / gp,
    uncontestedPossessions: s.uncontestedPossessions / gp,
    freesFor: s.freesFor / gp,
    freesAgainst: s.freesAgainst / gp,
    onePercenters: s.onePercenters / gp,
    goalAssists: s.goalAssists / gp,
    turnovers: s.turnovers / gp,
    intercepts: s.intercepts / gp,
    metresGained: s.metresGained / gp,
    contestedMarks: s.contestedMarks / gp,
    effectiveDisposals: s.effectiveDisposals / gp,
    scoreInvolvements: s.scoreInvolvements / gp,
  };

  let base =
    perGame.kicks * WEIGHTS.kicks +
    perGame.handballs * WEIGHTS.handballs +
    perGame.marks * WEIGHTS.marks +
    perGame.tackles * WEIGHTS.tackles +
    perGame.goals * WEIGHTS.goals +
    perGame.hitouts * WEIGHTS.hitouts +
    perGame.clearances * WEIGHTS.clearances +
    perGame.inside50s * WEIGHTS.inside50s +
    perGame.rebound50s * WEIGHTS.rebound50s +
    perGame.clangers * WEIGHTS.clangers +
    perGame.contestedPossessions * WEIGHTS.contestedPossessions +
    perGame.uncontestedPossessions * WEIGHTS.uncontestedPossessions +
    perGame.freesFor * WEIGHTS.freesFor +
    perGame.freesAgainst * WEIGHTS.freesAgainst +
    perGame.onePercenters * WEIGHTS.onePercenters +
    perGame.goalAssists * WEIGHTS.goalAssists +
    perGame.turnovers * WEIGHTS.turnovers +
    perGame.intercepts * WEIGHTS.intercepts +
    perGame.metresGained * WEIGHTS.metresGained +
    perGame.contestedMarks * WEIGHTS.contestedMarks +
    perGame.effectiveDisposals * WEIGHTS.effectiveDisposals +
    perGame.scoreInvolvements * WEIGHTS.scoreInvolvements;

  const togFactor = Math.min(1.5, Math.max(0.7, (s.timeOnGroundPct - 60) / 40 + 1));
  const deFactor = Math.min(1.3, Math.max(0.8, (s.disposalEffPct - 70) / 30 + 1));

  return Math.round(base * togFactor * deFactor);
}

function parseNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getStat(data: Record<string, unknown>, key: string, altKey?: string): number {
  const stats = (data.stats as Record<string, unknown> | undefined) ?? {};
  const direct = parseNumber(stats[key]) || parseNumber(data[key]);
  if (direct) return direct;
  if (altKey) return parseNumber(stats[altKey]) || parseNumber(data[altKey]);
  return 0;
}

async function resolveSeason(): Promise<number> {
  const currentYear = new Date().getFullYear();
  try {
    const snap = await db.collection('player_match_stats').limit(500).get();
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

async function loadPlayers(): Promise<Map<string, PlayerProfile>> {
  const players = new Map<string, PlayerProfile>();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const pageSize = 1000;

  while (true) {
    let q = db.collection('players').orderBy('__name__').limit(pageSize);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    snap.docs.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const name = String(data.name || data.player_name || '').trim();
      if (!name) return;
      const nameLC =
        typeof data.nameLC === 'string' ? data.nameLC : name.toLowerCase();
      players.set(nameLC, {
        id: doc.id,
        name,
        nameLC,
        team: typeof data.team === 'string' ? data.team : typeof data.club === 'string' ? data.club : undefined,
        position: typeof data.position === 'string' ? data.position : undefined,
      });
    });

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  return players;
}

async function computeAggregates(season: number): Promise<AggregatedPlayerStat[]> {
  const playersByName = await loadPlayers();
  const aggregates = new Map<string, PlayerAggregate>();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const pageSize = 1000;

  while (true) {
    let q = db
      .collection('player_match_stats')
      .where('season', '==', season)
      .orderBy('__name__')
      .limit(pageSize);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
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

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  const rows: AggregatedPlayerStat[] = [];
  aggregates.forEach((agg, key) => {
    const playerProfile = playersByName.get(key);
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

    const playerId = playerProfile?.id ?? key;
    rows.push({
      id: playerId,
      player_id: playerId,
      player_name: agg.playerName,
      team: playerProfile?.team ?? agg.team,
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

async function writeToFirestore(season: number, rows: AggregatedPlayerStat[]): Promise<void> {
  const chunks: AggregatedPlayerStat[][] = [];
  const batchSize = 400;
  for (let i = 0; i < rows.length; i += batchSize) {
    chunks.push(rows.slice(i, i + batchSize));
  }

  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((row) => {
      const docId = `${season}_${row.player_id || row.player_name.toLowerCase().replace(/\s+/g, '_')}`;
      batch.set(db.collection(COLLECTION).doc(docId), row, { merge: true });
    });
    await batch.commit();
  }
}

export const refreshPlayerSeasonStats = functions
  .region(REGION)
  .runWith({
    timeoutSeconds: AGGREGATOR_TIMEOUT_SECONDS,
    memory: AGGREGATOR_MEMORY,
  })
  .pubsub.schedule('0 3 * * *')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    functions.logger.warn('playerStatsAggregator.disabled', {
      reason:
        'Writes to player_season_stats are retired in favor of Scripts/precompute-season-stats.ts.',
    });
    return null;
  });
