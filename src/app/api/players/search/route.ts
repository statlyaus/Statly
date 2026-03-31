import { type NextRequest, NextResponse } from 'next/server';

import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import { getPlayers } from '@/lib/data';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';
import type { Player as PlayerDirectoryEntry, PlayerSearchResult } from '@/types/players';
export const runtime = 'nodejs';

type PlayerLookup = Pick<PlayerDirectoryEntry, 'id' | 'name' | 'team' | 'position'>;

interface PlayerAggregationData {
  id: string;
  name: string;
  team: string;
  position: string;
  totalGames: number;
  latestRound: number;
  // Accumulated stats
  totalGoals: number;
  totalKicks: number;
  totalHandballs: number;
  totalMarks: number;
  totalTackles: number;
  totalHitouts: number;
  totalClearances: number;
  totalInside50s: number;
  totalRebound50s: number;
  totalClangers: number;
  totalContested: number;
  totalUncontested: number;
  totalFreesFor: number;
  totalFreesAgainst: number;
  totalOnePercenters: number;
  totalGoalAssists: number;
  totalTurnovers: number;
  totalIntercepts: number;
  totalMetresGained: number;
  totalContestedMarks: number;
  totalEffectiveDisposals: number;
  totalScoreInvolvements: number;
  totalTimeOnGround: number;
  totalDisposalEfficiency: number;
}

function normalizeLookupPart(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function readNumberField(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' ? value : undefined;
}

function buildPlayerLookup(players: PlayerDirectoryEntry[]) {
  const byNameAndTeam = new Map<string, PlayerLookup>();
  const byName = new Map<string, PlayerLookup>();
  const ambiguousNames = new Set<string>();

  players.forEach((player) => {
    const normalizedName = normalizeLookupPart(player.name);
    if (!normalizedName) return;

    const normalizedTeam = normalizeLookupPart(player.team);
    if (normalizedTeam) {
      byNameAndTeam.set(`${normalizedName}|${normalizedTeam}`, player);
    }

    if (ambiguousNames.has(normalizedName)) {
      return;
    }

    if (!byName.has(normalizedName)) {
      byName.set(normalizedName, player);
      return;
    }

    byName.delete(normalizedName);
    ambiguousNames.add(normalizedName);
  });

  return { byNameAndTeam, byName, ambiguousNames };
}

function resolvePlayerLookup(
  playerLookup: ReturnType<typeof buildPlayerLookup>,
  name: string,
  team?: string
): PlayerLookup {
  const normalizedName = normalizeLookupPart(name);
  const normalizedTeam = normalizeLookupPart(team);

  const exactTeamMatch = normalizedTeam
    ? playerLookup.byNameAndTeam.get(`${normalizedName}|${normalizedTeam}`)
    : undefined;
  const matchedPlayer = exactTeamMatch ?? playerLookup.byName.get(normalizedName);

  if (matchedPlayer) {
    return matchedPlayer;
  }

  return {
    id: buildCanonicalPlayerId(team ? `${name} ${team}` : name),
    name,
    team: team ?? '',
    position: '',
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ players: [] });
    }

    const knownPlayers = await getPlayers();
    const playerLookup = buildPlayerLookup(knownPlayers);

    // Try to get data from Firestore first
    let snapshot;
    let useFirestore = true;
    try {
      snapshot = await adminDb.collection('player_match_stats').get();
      
      // Log collection status for debugging
      logger.debug('Player search query', {
        query,
        collectionSize: snapshot.size,
        isEmpty: snapshot.empty,
      });

      // If collection is empty, fall back to JSON file data
      if (snapshot.empty) {
        logger.warn('player_match_stats collection is empty - falling back to JSON file data');
        useFirestore = false;
      }
    } catch (error) {
      logger.warn('Firestore query failed, falling back to JSON file data', {
        error: error instanceof Error ? error.message : String(error),
      });
      useFirestore = false;
    }

    const playersMap = new Map<string, PlayerAggregationData>();

    // Use Firestore data if available
    if (useFirestore && snapshot) {
      snapshot.forEach((doc) => {
        const data = doc.data();

        // Handle different document structures (processFootywireData vs ingestFootywire)
        const playerName = typeof data.player_name === 'string' ? data.player_name : '';
        if (!playerName) {
          return; // Skip documents without player_name
        }

        const resolvedPlayer = resolvePlayerLookup(
          playerLookup,
          playerName,
          typeof data.team === 'string' ? data.team : undefined
        );

        // Stats can be nested in data.stats or at top level
        const stats = (data.stats as Record<string, number | undefined> | undefined) ?? {};

        // Handle round field (can be 'round' or 'round_number')
        const round =
          typeof data.round === 'number'
            ? data.round
            : typeof data.round_number === 'number'
              ? data.round_number
              : 0;

        if (!playersMap.has(resolvedPlayer.id)) {
          playersMap.set(resolvedPlayer.id, {
            id: resolvedPlayer.id,
            name: resolvedPlayer.name,
            team:
              (typeof data.team === 'string' && data.team) ||
              resolvedPlayer.team ||
              '',
            position:
              (typeof data.position === 'string' && data.position) ||
              resolvedPlayer.position ||
              '',
            totalGames: 0,
            latestRound: 0,
            totalGoals: 0,
            totalKicks: 0,
            totalHandballs: 0,
            totalMarks: 0,
            totalTackles: 0,
            totalHitouts: 0,
            totalClearances: 0,
            totalInside50s: 0,
            totalRebound50s: 0,
            totalClangers: 0,
            totalContested: 0,
            totalUncontested: 0,
            totalFreesFor: 0,
            totalFreesAgainst: 0,
            totalOnePercenters: 0,
            totalGoalAssists: 0,
            totalTurnovers: 0,
            totalIntercepts: 0,
            totalMetresGained: 0,
            totalContestedMarks: 0,
            totalEffectiveDisposals: 0,
            totalScoreInvolvements: 0,
            totalTimeOnGround: 0,
            totalDisposalEfficiency: 0,
          });
        }

        const player = playersMap.get(resolvedPlayer.id);
        if (player) {
          player.totalGames++;
          player.latestRound = Math.max(player.latestRound, round);

          // Accumulate all stats from nested stats object or top level
          player.totalGoals += stats.goals ?? (typeof data.goals === 'number' ? data.goals : 0);
          player.totalKicks += stats.kicks ?? (typeof data.kicks === 'number' ? data.kicks : 0);
          player.totalHandballs +=
            stats.handballs ?? (typeof data.handballs === 'number' ? data.handballs : 0);
          player.totalMarks += stats.marks ?? (typeof data.marks === 'number' ? data.marks : 0);
          player.totalTackles += stats.tackles ?? (typeof data.tackles === 'number' ? data.tackles : 0);
          player.totalHitouts +=
            stats.hitouts ??
            stats.hit_outs ??
            readNumberField(data, 'hitouts') ??
            readNumberField(data, 'hit_outs') ??
            0;
          player.totalClearances +=
            stats.clearances ?? (typeof data.clearances === 'number' ? data.clearances : 0);
          player.totalInside50s +=
            stats.inside50s ??
            stats.inside_50s ??
            readNumberField(data, 'inside50s') ??
            readNumberField(data, 'inside_50s') ??
            0;
          player.totalRebound50s +=
            stats.rebound50s ??
            stats.rebound_50s ??
            readNumberField(data, 'rebound50s') ??
            readNumberField(data, 'rebound_50s') ??
            0;
          player.totalClangers += stats.clangers ?? (typeof data.clangers === 'number' ? data.clangers : 0);
          player.totalContested +=
            stats.contested_possessions ??
            (typeof data.contested_possessions === 'number' ? data.contested_possessions : 0);
          player.totalUncontested +=
            stats.uncontested_possessions ??
            (typeof data.uncontested_possessions === 'number' ? data.uncontested_possessions : 0);
          player.totalFreesFor += stats.frees_for ?? (typeof data.frees_for === 'number' ? data.frees_for : 0);
          player.totalFreesAgainst +=
            stats.frees_against ?? (typeof data.frees_against === 'number' ? data.frees_against : 0);
          player.totalOnePercenters +=
            stats.one_percenters ?? (typeof data.one_percenters === 'number' ? data.one_percenters : 0);
          player.totalGoalAssists +=
            stats.goal_assists ?? (typeof data.goal_assists === 'number' ? data.goal_assists : 0);
          player.totalTurnovers += stats.turnovers ?? (typeof data.turnovers === 'number' ? data.turnovers : 0);
          player.totalIntercepts += stats.intercepts ?? (typeof data.intercepts === 'number' ? data.intercepts : 0);
          player.totalMetresGained +=
            stats.metres_gained ?? (typeof data.metres_gained === 'number' ? data.metres_gained : 0);
          player.totalContestedMarks +=
            stats.contested_marks ?? (typeof data.contested_marks === 'number' ? data.contested_marks : 0);
          player.totalEffectiveDisposals +=
            stats.effective_disposals ??
            (typeof data.effective_disposals === 'number' ? data.effective_disposals : 0);
          player.totalScoreInvolvements +=
            stats.score_involvements ?? (typeof data.score_involvements === 'number' ? data.score_involvements : 0);
          player.totalTimeOnGround +=
            stats.tog_pct ??
            stats.time_on_ground_percentage ??
            readNumberField(data, 'tog_pct') ??
            readNumberField(data, 'time_on_ground_percentage') ??
            85;
          player.totalDisposalEfficiency +=
            stats.disposal_efficiency ??
            readNumberField(data, 'disposal_efficiency') ??
            75;

          // Use most recent team/position if available
          if (typeof data.team === 'string' && data.team) player.team = data.team;
          if (typeof data.position === 'string' && data.position) player.position = data.position;
        }
      });
    } else {
      // Fallback to JSON file data
      logger.info('Using JSON file data for player search');
      const jsonPlayers = knownPlayers;
      
      jsonPlayers.forEach((player) => {
        if (!playersMap.has(player.id)) {
          // Calculate stats from player data
          const goals = typeof player.goals === 'number' ? player.goals : typeof player.stats?.goals === 'number' ? player.stats.goals : 0;
          const kicks = typeof player.kicks === 'number' ? player.kicks : typeof player.stats?.kicks === 'number' ? player.stats.kicks : 0;
          const handballs = typeof player.handballs === 'number' ? player.handballs : typeof player.stats?.handballs === 'number' ? player.stats.handballs : 0;
          const marks = typeof player.marks === 'number' ? player.marks : typeof player.stats?.marks === 'number' ? player.stats.marks : 0;
          const tackles = typeof player.tackles === 'number' ? player.tackles : typeof player.stats?.tackles === 'number' ? player.stats.tackles : 0;
          const hitouts = typeof player.hitouts === 'number' ? player.hitouts : typeof player.stats?.hitouts === 'number' ? player.stats.hitouts : 0;
          const clearances = typeof player.clearances === 'number' ? player.clearances : typeof player.stats?.clearances === 'number' ? player.stats.clearances : 0;
          const inside50s = typeof player.inside50s === 'number' ? player.inside50s : typeof player.stats?.inside50s === 'number' ? player.stats.inside50s : 0;
          const rebound50s = typeof player.rebound50s === 'number' ? player.rebound50s : typeof player.stats?.rebound50s === 'number' ? player.stats.rebound50s : 0;
          const contestedPossessions = typeof player.contestedPossessions === 'number' ? player.contestedPossessions : typeof player.stats?.contestedPossessions === 'number' ? player.stats.contestedPossessions : 0;
          const effectiveDisposals = typeof player.stats?.effectiveDisposals === 'number' ? player.stats.effectiveDisposals : 0;
          const scoreInvolvements = typeof player.stats?.scoreInvolvements === 'number' ? player.stats.scoreInvolvements : 0;
          const intercepts = typeof player.stats?.intercepts === 'number' ? player.stats.intercepts : 0;
          const contestedMarks = typeof player.stats?.contestedMarks === 'number' ? player.stats.contestedMarks : 0;
          const metresGained = typeof player.stats?.metresGained === 'number' ? player.stats.metresGained : 0;

          playersMap.set(player.id, {
            id: player.id,
            name: player.name,
            team: player.team || '',
            position: player.position || '',
            totalGames: typeof player.games === 'number' ? player.games : 1,
            latestRound: 0,
            totalGoals: goals,
            totalKicks: kicks,
            totalHandballs: handballs,
            totalMarks: marks,
            totalTackles: tackles,
            totalHitouts: hitouts,
            totalClearances: clearances,
            totalInside50s: inside50s,
            totalRebound50s: rebound50s,
            totalClangers: 0,
            totalContested: contestedPossessions,
            totalUncontested: 0,
            totalFreesFor: 0,
            totalFreesAgainst: 0,
            totalOnePercenters: 0,
            totalGoalAssists: 0,
            totalTurnovers: 0,
            totalIntercepts: intercepts,
            totalMetresGained: metresGained,
            totalContestedMarks: contestedMarks,
            totalEffectiveDisposals: effectiveDisposals,
            totalScoreInvolvements: scoreInvolvements,
            totalTimeOnGround: 85,
            totalDisposalEfficiency: 75,
          });
        }
      });
    }

    // Calculate custom fantasy scores and create results
    const players: PlayerSearchResult[] = Array.from(playersMap.values()).map((player) => {
      // Create PlayerStats object for custom scoring calculation
      const playerStats: PlayerStats = {
        games: player.totalGames,
        kicks: player.totalKicks,
        handballs: player.totalHandballs,
        marks: player.totalMarks,
        tackles: player.totalTackles,
        goals: player.totalGoals,
        hitouts: player.totalHitouts,
        clearances: player.totalClearances,
        inside50s: player.totalInside50s,
        rebound50s: player.totalRebound50s,
        clangers: player.totalClangers,
        contestedPossessions: player.totalContested,
        uncontestedPossessions: player.totalUncontested,
        freesFor: player.totalFreesFor,
        freesAgainst: player.totalFreesAgainst,
        onePercenters: player.totalOnePercenters,
        goalAssists: player.totalGoalAssists,
        timeOnGroundPct: player.totalGames > 0 ? player.totalTimeOnGround / player.totalGames : 85,
        disposalEffPct:
          player.totalGames > 0 ? player.totalDisposalEfficiency / player.totalGames : 75,
        turnovers: player.totalTurnovers,
        intercepts: player.totalIntercepts,
        metresGained: player.totalMetresGained,
        contestedMarks: player.totalContestedMarks,
        effectiveDisposals: player.totalEffectiveDisposals,
        scoreInvolvements: player.totalScoreInvolvements,
      };

      // Calculate custom fantasy score using your algorithm
      const customTotalScore = calculateTotalValue(playerStats);
      const customAverageScore =
        player.totalGames > 0 ? Math.round(customTotalScore / player.totalGames) : 0;

      return {
        id: player.id,
        name: player.name,
        team: player.team ?? '',
        position: player.position ?? '',
        totalGames: player.totalGames,
        totalScore: customTotalScore,
        averageScore: customAverageScore,
        latestRound: player.latestRound,
      };
    });

    // Filter players by search query (case insensitive, search name, team, and position)
    const queryLower = query.toLowerCase().trim();
    const filteredPlayers = players
      .filter(
        (player) =>
          player.name.toLowerCase().includes(queryLower) ||
          (player.team ?? '').toLowerCase().includes(queryLower) ||
          (player.position ?? '').toLowerCase().includes(queryLower) ||
          // Also check if any part of the name matches (e.g., "naughton" matches "Aaron Naughton")
          player.name.toLowerCase().split(' ').some((part) => part.includes(queryLower))
      )
      .sort((a, b) => {
        // Sort by relevance: exact match first, then starts with, then by average score
        const aExact = a.name.toLowerCase() === queryLower ? 2 : a.name.toLowerCase().startsWith(queryLower) ? 1 : 0;
        const bExact = b.name.toLowerCase() === queryLower ? 2 : b.name.toLowerCase().startsWith(queryLower) ? 1 : 0;

        if (aExact !== bExact) return bExact - aExact;
        return b.averageScore - a.averageScore;
      })
      .slice(0, 20); // Limit to 20 results

    return NextResponse.json({ players: filteredPlayers });
  } catch (error) {
    logger.error('Error searching players', error instanceof Error ? error : new Error(String(error)), {
      query: new URL(request.url).searchParams.get('q'),
    });
    return NextResponse.json({ error: 'Failed to search players' }, { status: 500 });
  }
}
