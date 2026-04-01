import type { NextRequest } from 'next/server';

import { successResponse, commonErrors } from '@/lib/apiResponse';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  LINEUP_SIZES,
  buildHeadToHeadCategoryScores,
  type MatchupPlayerStat,
} from '@/lib/leagueMatchup';
import {
  deriveSeasonRoundsFromMatchDocuments,
  ensureLeagueSeasonMaterialized,
  getComputedLeagueRound,
  getComputedLeagueSeasonState,
  selectComputedLeagueRoundMatchups,
} from '@/lib/leagueSeason';
import {
  LIVE_MATCHUP_CACHE_TTL_SECONDS,
  STATIC_MATCHUP_CACHE_TTL_SECONDS,
  buildLeaderText,
  buildOtherMatchupSummaries,
  buildSlateCacheKey,
  getCachedSlate,
  orientCachedMatchup,
  setCachedSlate,
  type CachedMatchupPayload,
  type CachedMatchupSlate,
  type MatchupSummaryPayload as MatchupSummary,
} from '@/lib/leagueMatchupCache';
import { refreshLiveStatsIfNeeded } from '@/lib/liveStatsRefresh';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { normalizeTeamName } from '@/lib/teamLogos';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

export const runtime = 'nodejs';

type MatchupDocument = {
  id: string;
  leagueId: string;
  participants: string[];
  homeUserId?: string;
  awayUserId?: string;
  current: boolean;
  roundLabel?: string;
  aflRound?: number | string | null;
  status?: 'scheduled' | 'in_progress' | 'final' | string;
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

async function getRoundStatus(
  season: number,
  round: number
): Promise<'scheduled' | 'in_progress' | 'final'> {
  const snap = await adminDb
    .collection('matches')
    .where('season', '==', season)
    .where('round_number', '==', round)
    .get();

  if (snap.empty) {
    return 'scheduled';
  }

  const rounds = deriveSeasonRoundsFromMatchDocuments(
    snap.docs.map((doc) => doc.data() as Record<string, unknown>)
  );
  return rounds[0]?.status ?? 'scheduled';
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
  const snap = await adminDb
    .collection('player_match_stats')
    .where('season', '==', season)
    .where('round_number', '==', round)
    .get();

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const rawPlayerId = String(data.player_id ?? data.player_uid ?? '');
    const rawPlayerName = String(data.player_name ?? '');
    const matchedPlayerId =
      (rawPlayerId && targetIds.has(rawPlayerId) ? rawPlayerId : null) ??
      targetNames.get(normalizePlayerName(rawPlayerName)) ??
      null;
    if (!matchedPlayerId) continue;

    const stats = (data.stats as Record<string, number | undefined> | undefined) ?? {};
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { searchParams } = new URL(request.url);
    const authUserId = await getAuthenticatedUserId(request);
    if (!authUserId) return commonErrors.unauthorized();

    const categories =
      searchParams
        .get('categories')
        ?.split(',')
        .map((value) => value.trim())
        .filter((value): value is FantasyCategoryKey => value in FANTASY_CATEGORIES) ?? [];
    const selectedMatchupId = searchParams.get('matchupId')?.trim() || null;
    const requestedRoundParam = searchParams.get('round');
    const requestedRound =
      requestedRoundParam && Number.isFinite(Number(requestedRoundParam))
        ? Number(requestedRoundParam)
        : null;
    if (categories.length === 0) {
      return commonErrors.badRequest('At least one scoring category is required');
    }

    const { id: leagueId } = await params;
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true },
    });
    if (!league) return commonErrors.notFound('League not found');

    const myMember = await prisma.leagueMember.findFirst({
      where: { leagueId, userId: authUserId },
      select: { id: true, userId: true, teamName: true },
    });
    if (!myMember) return commonErrors.forbidden('You are not a member of this league');

    const season = getDefaultAflSeason();
    await ensureLeagueSeasonMaterialized({ leagueId, season }).catch((error) => {
      logger.warn('Failed to auto-materialize league season before reading matchup slate', {
        leagueId,
        season,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    const seasonState = await getComputedLeagueSeasonState({ leagueId, season });
    const computedRound = getComputedLeagueRound({
      state: seasonState,
      requestedRound,
    });
    if (computedRound == null) {
      return commonErrors.notFound('No current AFL round found');
    }

    const roundMatchups = selectComputedLeagueRoundMatchups({
      state: seasonState,
      round: computedRound,
    });
    if (roundMatchups.length === 0) {
      return commonErrors.notFound(
        requestedRound != null ? `No matchup found for Round ${requestedRound}` : 'No current matchup found'
      );
    }

    const myRoundMatchup = roundMatchups.find((matchup) =>
      matchup.participants.includes(authUserId)
    );
    if (!myRoundMatchup) {
      return commonErrors.forbidden(
        requestedRound != null
          ? `You are not part of the Round ${requestedRound} matchup slate`
          : 'You are not part of the current matchup slate'
      );
    }

    const selectedMatchup =
      (selectedMatchupId
        ? roundMatchups.find((matchup) => matchup.id === selectedMatchupId)
        : undefined) ?? myRoundMatchup;

    const { homeUserId, awayUserId } = getMatchupParticipantIds(selectedMatchup);
    if (!homeUserId || !awayUserId) {
      return commonErrors.notFound('Selected matchup participants are incomplete');
    }

    const allMatchupUserIds = Array.from(
      new Set(roundMatchups.flatMap((matchup) => matchup.participants))
    );
    const leagueMembers = await prisma.leagueMember.findMany({
      where: { leagueId, userId: { in: allMatchupUserIds } },
      select: { id: true, userId: true, teamName: true },
    });
    const memberByUserId = new Map(
      leagueMembers.map((member) => [member.userId, member as LeagueMemberLite])
    );

    const selectedHomeMember = memberByUserId.get(homeUserId);
    const selectedAwayMember = memberByUserId.get(awayUserId);
    if (!selectedHomeMember || !selectedAwayMember) {
      return commonErrors.notFound('Selected matchup league members not found');
    }

    const matchupRound =
      typeof selectedMatchup.aflRound === 'number'
        ? selectedMatchup.aflRound
        : typeof selectedMatchup.aflRound === 'string'
          ? Number(selectedMatchup.aflRound)
          : null;
    const round =
      matchupRound != null && Number.isFinite(matchupRound) && matchupRound >= 0
        ? Number(matchupRound)
        : computedRound;

    const effectiveStatus = await getRoundStatus(season, round);

    if (effectiveStatus === 'in_progress') {
      await refreshLiveStatsIfNeeded({
        minIntervalMs: 30_000,
        trigger: 'league-matchup',
        season,
      }).catch((error) => {
        logger.warn('Live matchup refresh failed before scoring', {
          leagueId,
          season,
          round,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const cacheKey = buildSlateCacheKey(leagueId, season, round, categories);
    const cachedSlate = await getCachedSlate(cacheKey);
    if (cachedSlate) {
      const cachedSelected = cachedSlate.matchups.find((matchup) => matchup.matchupId === selectedMatchup.id);
      if (cachedSelected) {
        const oriented = orientCachedMatchup(cachedSelected, authUserId, myRoundMatchup.id);
        return successResponse({
          matchupId: oriented.matchupId,
          leagueId: cachedSlate.leagueId,
          leagueName: cachedSlate.leagueName,
          season: cachedSlate.season,
          round: cachedSlate.round,
          roundLabel: cachedSlate.roundLabel,
          status: cachedSlate.status,
          live: cachedSlate.live,
          lastUpdated: cachedSlate.lastUpdated,
          completedTeams: cachedSlate.completedTeams ?? [],
          home: oriented.home,
          away: oriented.away,
          categories: oriented.categories,
          otherMatchups: buildOtherMatchupSummaries(cachedSlate, oriented.matchupId),
        });
      }
    }

    const allMemberIds = leagueMembers.map((member) => member.id);
    const allRosterRows = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId, memberId: { in: allMemberIds } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { memberId: true, playerId: true },
    });

    const rosterPlayerIdsByMemberId = new Map<string, string[]>();
    for (const row of allRosterRows) {
      const existing = rosterPlayerIdsByMemberId.get(row.memberId) ?? [];
      existing.push(String(row.playerId));
      rosterPlayerIdsByMemberId.set(row.memberId, existing);
    }

    const allPlayerIds = Array.from(new Set(allRosterRows.map((row) => String(row.playerId))));
    const players = await prisma.player.findMany({
      where: { id: { in: allPlayerIds } },
      select: { id: true, name: true, club: true, position: true },
    });
    const playerMap = new Map(players.map((player) => [String(player.id), player]));
    const playerNameById = new Map(players.map((player) => [String(player.id), player.name]));
    const { statsByPlayerId, lastUpdated } = await fetchPlayerStatsForRound(
      season,
      round,
      allPlayerIds,
      playerNameById
    );

    const enrichLineup = (playerIds: string[]) =>
      playerIds.map((playerId) => {
        const player = playerMap.get(playerId);
        const stat = statsByPlayerId.get(playerId);
        return {
          id: playerId,
          name: player?.name ?? stat?.playerName ?? playerId,
          team: stat?.team ?? player?.club ?? '',
          position: player?.position ?? stat?.position ?? '',
          stats: stat?.stats ?? {},
        };
      });

    const completedTeams = await getCompletedTeamsForRound(season, round);

    const cachedMatchups: CachedMatchupPayload[] = roundMatchups.flatMap((matchup) => {
      const participants = getMatchupParticipantIds(matchup);
      if (!participants.homeUserId || !participants.awayUserId) return [];

      const homeMember = memberByUserId.get(participants.homeUserId);
      const awayMember = memberByUserId.get(participants.awayUserId);
      if (!homeMember || !awayMember) return [];

      const matchupScore = buildHeadToHeadCategoryScores({
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
            starters: enrichLineup(matchupScore.home.activePlayerIds),
            summary: matchupScore.home.summary,
          },
          away: {
            userId: awayMember.userId,
            memberId: awayMember.id,
            teamName: awayMember.teamName,
            starters: enrichLineup(matchupScore.away.activePlayerIds),
            summary: matchupScore.away.summary,
          },
          categories: matchupScore.categories,
        },
      ];
    });

    const slate: CachedMatchupSlate = {
      leagueId,
      leagueName: league.name,
      season,
      round,
      roundLabel: String(selectedMatchup.roundLabel ?? `Round ${round}`),
      status: effectiveStatus,
      live: effectiveStatus === 'in_progress',
      lastUpdated,
      completedTeams,
      matchups: cachedMatchups,
    };

    void setCachedSlate(
      cacheKey,
      slate,
      effectiveStatus === 'in_progress'
        ? LIVE_MATCHUP_CACHE_TTL_SECONDS
        : STATIC_MATCHUP_CACHE_TTL_SECONDS
    );

    const selectedCachedMatchup = cachedMatchups.find(
      (matchup) => matchup.matchupId === selectedMatchup.id
    );
    if (!selectedCachedMatchup) {
      return commonErrors.notFound('Selected matchup payload not found');
    }

    const orientedSelected = orientCachedMatchup(
      selectedCachedMatchup,
      authUserId,
      myRoundMatchup.id
    );
    const otherMatchups = buildOtherMatchupSummaries(slate, orientedSelected.matchupId);

    return successResponse({
      matchupId: orientedSelected.matchupId,
      leagueId,
      leagueName: league.name,
      season,
      round,
      roundLabel: String(selectedMatchup.roundLabel ?? `Round ${round}`),
      status: effectiveStatus,
      live: effectiveStatus === 'in_progress',
      lastUpdated,
      completedTeams,
      home: orientedSelected.home,
      away: orientedSelected.away,
      categories: orientedSelected.categories,
      otherMatchups,
    });
  } catch (error) {
    logger.error('Failed to load league matchup', {
      error: error instanceof Error ? error.message : String(error),
    });
    return commonErrors.internalServerError('Failed to load league matchup');
  }
}
