import { adminDb } from '@/lib/firebaseAdmin';
import {
  LINEUP_SIZES,
  buildHeadToHeadCategoryScores,
  mergeFirestorePlayerMatchStats,
  type MatchupPlayerStat,
} from '@/lib/leagueMatchup';
import {
  LIVE_MATCHUP_CACHE_TTL_SECONDS,
  STATIC_MATCHUP_CACHE_TTL_SECONDS,
  buildSlateCacheKey,
  setCachedSlate,
  type CachedMatchupPayload,
  type CachedMatchupSlate,
} from '@/lib/leagueMatchupCache';
import {
  getComputedLeagueSeasonState,
  loadLeagueCategories,
  loadLeagueRosters,
  selectComputedLeagueRoundMatchups,
} from '@/lib/leagueSeason';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { normalizeTeamName } from '@/lib/teamLogos';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

type MatchupDocument = {
  id: string;
  leagueId: string;
  participants: string[];
  homeUserId?: string;
  awayUserId?: string;
  roundLabel?: string;
};

type LeagueMemberLite = {
  id: string;
  userId: string;
  teamName: string;
};

function normalizePlayerName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

function getMatchupParticipantIds(matchup: MatchupDocument): {
  homeUserId?: string;
  awayUserId?: string;
} {
  const homeUserId = matchup.homeUserId ?? matchup.participants[0];
  const awayUserId =
    matchup.awayUserId ?? matchup.participants.find((participant) => participant !== homeUserId);
  return { homeUserId, awayUserId };
}

async function fetchPlayerStatsForRound(
  season: number,
  round: number,
  playerIds: string[],
  playerNameById: Map<string, string>
): Promise<{
  statsByPlayerId: Map<string, MatchupPlayerStat>;
  lastUpdated: string | null;
}> {
  const map = new Map<string, MatchupPlayerStat>();
  const targetIds = new Set(playerIds.map(String));
  const targetNames = new Map<string, string>();
  playerNameById.forEach((name, id) => {
    const normalized = normalizePlayerName(name);
    if (normalized) {
      targetNames.set(normalized, id);
    }
  });
  let lastUpdatedMs = 0;
  const [snapByRoundNumber, snapByRound] = await Promise.all([
    adminDb
      .collection('player_match_stats')
      .where('season', '==', season)
      .where('round_number', '==', round)
      .get(),
    adminDb
      .collection('player_match_stats')
      .where('season', '==', season)
      .where('round', '==', round)
      .get(),
  ]);
  const docsById = new Map<string, (typeof snapByRoundNumber.docs)[0]>();
  for (const doc of snapByRoundNumber.docs) docsById.set(doc.id, doc);
  for (const doc of snapByRound.docs) docsById.set(doc.id, doc);

  for (const doc of docsById.values()) {
    const data = doc.data() as Record<string, unknown>;
    const rawPlayerId = String(data.player_id ?? data.player_uid ?? '');
    const rawPlayerName = String(data.player_name ?? '');
    const matchedPlayerId =
      (rawPlayerId && targetIds.has(rawPlayerId) ? rawPlayerId : null) ??
      targetNames.get(normalizePlayerName(rawPlayerName)) ??
      null;
    if (!matchedPlayerId) continue;

    const stats = mergeFirestorePlayerMatchStats(data);
    const updatedAtRaw =
      typeof data.updated_at === 'string'
        ? data.updated_at
        : typeof data.last_seen_at === 'string'
          ? data.last_seen_at
          : null;
    if (updatedAtRaw) {
      const parsed = Date.parse(updatedAtRaw);
      if (Number.isFinite(parsed)) {
        lastUpdatedMs = Math.max(lastUpdatedMs, parsed);
      }
    }
    map.set(matchedPlayerId, {
      playerId: matchedPlayerId,
      playerName: rawPlayerName || matchedPlayerId,
      team: typeof data.team === 'string' ? data.team : undefined,
      position: typeof data.position === 'string' ? data.position : undefined,
      stats,
    });
  }

  return {
    statsByPlayerId: map,
    lastUpdated: lastUpdatedMs > 0 ? new Date(lastUpdatedMs).toISOString() : null,
  };
}

function extractMatchTeams(match: Record<string, unknown>): string[] {
  const values = [
    match.homeTeam,
    match.awayTeam,
    match.home_team,
    match.away_team,
    match.homeTeamName,
    match.awayTeamName,
    match.home_team_name,
    match.away_team_name,
  ];

  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => normalizeTeamName(value))
    .filter(Boolean);
}

async function getCompletedTeamsForRound(season: number, round: number): Promise<string[]> {
  const snap = await adminDb
    .collection('matches')
    .where('season', '==', season)
    .where('round_number', '==', round)
    .get();

  const teams = new Set<string>();
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (String(data.status ?? '') !== 'final') continue;
    for (const team of extractMatchTeams(data)) {
      teams.add(team);
    }
  }

  return Array.from(teams);
}

async function primeLeagueSlate(input: {
  leagueId: string;
  season: number;
  round: number;
  matchups: MatchupDocument[];
  status: 'scheduled' | 'in_progress' | 'final';
}): Promise<boolean> {
  const categories = await loadLeagueCategories(input.leagueId);
  if (categories.length === 0) {
    return false;
  }

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { name: true },
  });
  const leagueName = String(league?.name ?? input.leagueId);

  const userIds = Array.from(new Set(input.matchups.flatMap((matchup) => matchup.participants)));
  const leagueMembers = await prisma.leagueMember.findMany({
    where: { leagueId: input.leagueId, userId: { in: userIds } },
    select: { id: true, userId: true, teamName: true },
  });
  const memberByUserId = new Map(
    leagueMembers.map((member) => [member.userId, member as LeagueMemberLite])
  );
  const rosterSnapshot = await loadLeagueRosters(
    input.leagueId,
    leagueMembers.map((member) => ({
      userId: member.userId,
      memberId: member.id,
      teamName: member.teamName,
    })),
    prisma
  );
  const rosterPlayerIdsByMemberId = new Map<string, string[]>();
  leagueMembers.forEach((member) => {
    rosterPlayerIdsByMemberId.set(
      member.id,
      rosterSnapshot.rostersByUserId.get(member.userId) ?? []
    );
  });

  const playerIds = Array.from(
    new Set(Array.from(rosterSnapshot.rostersByUserId.values()).flat().map(String))
  );
  const players =
    playerIds.length > 0
      ? await prisma.player.findMany({
          where: { id: { in: playerIds } },
          select: { id: true, name: true, club: true, position: true },
        })
      : [];
  const playerMap = new Map(players.map((player) => [String(player.id), player]));
  const playerNameById = new Map(rosterSnapshot.playerNameById);
  players.forEach((player) => {
    playerNameById.set(String(player.id), player.name);
  });
  const { statsByPlayerId, lastUpdated } = await fetchPlayerStatsForRound(
    input.season,
    input.round,
    playerIds,
    playerNameById
  );
  const completedTeams = await getCompletedTeamsForRound(input.season, input.round);

  const enrichLineup = (ids: string[]) =>
    ids.map((playerId) => {
      const player = playerMap.get(playerId);
      const stat = statsByPlayerId.get(playerId);
      return {
        id: playerId,
        name: player?.name ?? stat?.playerName ?? playerId,
        team: player?.club ?? stat?.team ?? '',
        position: player?.position ?? stat?.position ?? '',
        stats: stat?.stats ?? {},
      };
    });

  const cachedMatchups: CachedMatchupPayload[] = input.matchups.flatMap((matchup) => {
    const participants = getMatchupParticipantIds(matchup);
    if (!participants.homeUserId || !participants.awayUserId) return [];

    const homeMember = memberByUserId.get(participants.homeUserId);
    const awayMember = memberByUserId.get(participants.awayUserId);
    if (!homeMember || !awayMember) return [];

    const score = buildHeadToHeadCategoryScores({
      categories,
      homePlayerIds: rosterPlayerIdsByMemberId.get(homeMember.id) ?? [],
      awayPlayerIds: rosterPlayerIdsByMemberId.get(awayMember.id) ?? [],
      statsByPlayerId,
      activePlayerLimit: LINEUP_SIZES.starters + LINEUP_SIZES.interchange,
    });

    return [
      {
        matchupId: matchup.id,
        home: {
          userId: homeMember.userId,
          memberId: homeMember.id,
          teamName: homeMember.teamName,
          starters: enrichLineup(score.home.activePlayerIds),
          summary: score.home.summary,
        },
        away: {
          userId: awayMember.userId,
          memberId: awayMember.id,
          teamName: awayMember.teamName,
          starters: enrichLineup(score.away.activePlayerIds),
          summary: score.away.summary,
        },
        categories: score.categories,
      },
    ];
  });

  if (cachedMatchups.length === 0) {
    return false;
  }

  const slate: CachedMatchupSlate = {
    leagueId: input.leagueId,
    leagueName,
    season: input.season,
    round: input.round,
    roundLabel: input.matchups[0]?.roundLabel ?? `Round ${input.round}`,
    status: input.status,
    live: input.status === 'in_progress',
    lastUpdated,
    completedTeams,
    matchups: cachedMatchups,
  };

  await setCachedSlate(
    buildSlateCacheKey(input.leagueId, input.season, input.round, categories),
    slate,
    input.status === 'in_progress'
      ? LIVE_MATCHUP_CACHE_TTL_SECONDS
      : STATIC_MATCHUP_CACHE_TTL_SECONDS
  );

  return true;
}

export async function primeLeagueMatchupSlates(input: {
  season: number;
  round: number;
  status?: 'scheduled' | 'in_progress' | 'final';
}): Promise<{ leagueCount: number; primedCount: number; skippedCount: number }> {
  const leagues = await prisma.league.findMany({
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  let primedCount = 0;
  let skippedCount = 0;

  for (const league of leagues) {
    try {
      const state = await getComputedLeagueSeasonState({
        leagueId: league.id,
        season: input.season,
      });
      const matchups = selectComputedLeagueRoundMatchups({
        state,
        round: input.round,
      }).map((matchup) => ({
        id: matchup.id,
        leagueId: matchup.leagueId,
        participants: matchup.participants,
        homeUserId: matchup.homeUserId,
        awayUserId: matchup.awayUserId,
        roundLabel: matchup.roundLabel,
      }));
      if (matchups.length === 0) {
        skippedCount += 1;
        continue;
      }

      const primed = await primeLeagueSlate({
        leagueId: league.id,
        season: input.season,
        round: input.round,
        matchups,
        status: input.status ?? 'in_progress',
      });
      if (primed) {
        primedCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      skippedCount += 1;
      logger.warn('Failed to prime league matchup slate', {
        leagueId: league.id,
        season: input.season,
        round: input.round,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    leagueCount: leagues.length,
    primedCount,
    skippedCount,
  };
}
