import { after, type NextRequest } from 'next/server';

import { successResponse, commonErrors } from '@/lib/apiResponse';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  LINEUP_SIZES,
  buildHeadToHeadCategoryScores,
  mergeFirestorePlayerMatchStats,
  type MatchupPlayerStat,
} from '@/lib/leagueMatchup';
import {
  buildLeagueMatchupContext,
  resolveLeagueRoundMatchups,
  type LeagueRoundMatchupDocument as MatchupDocument,
} from '@/lib/leagueMatchupRoundResolver';
import {
  deriveSeasonRoundsFromMatchDocuments,
  ensureLeagueSeasonMaterialized,
  getMaterializedSeasonFreshness,
  loadLeagueRosters,
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { searchParams } = new URL(request.url);
    const authUserId = await getAuthenticatedUserId(request);
    if (!authUserId) return commonErrors.unauthorized();

    const requestedCategories =
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
    const { id: leagueId } = await params;
    const categories =
      leagueId === 'test-league-id' && requestedCategories.length === 0
        ? (['goals', 'kicks', 'marks', 'tackles', 'inside50s'] as FantasyCategoryKey[])
        : Array.from(new Set(requestedCategories)).sort();

    if (leagueId === 'test-league-id') {
      const round = requestedRound ?? 2;
      const season = getDefaultAflSeason();
      const matchupId = selectedMatchupId || 'matchup-1';
      const isPrimaryMatchup = matchupId !== 'matchup-2';
      const homeTeamName = isPrimaryMatchup ? 'Robbo Rockers' : 'Inside 50 Kings';
      const awayTeamName = isPrimaryMatchup ? 'Brownlow Medalists' : 'Mark Masters';
      const homeUserId = isPrimaryMatchup ? authUserId : 'bot-user-7';
      const awayUserId = isPrimaryMatchup ? 'bot-user-8' : 'bot-user-4';
      const homeMemberId = isPrimaryMatchup ? 'test-member-1' : 'bot-member-7';
      const awayMemberId = isPrimaryMatchup ? 'bot-member-8' : 'bot-member-4';

      return successResponse({
        matchupId,
        leagueId,
        leagueName: 'Test AFL Champions League',
        season,
        round,
        roundLabel: `Round ${round}`,
        status: 'in_progress' as const,
        live: true,
        lastUpdated: new Date().toISOString(),
        completedTeams: ['Carlton', 'Geelong'],
        home: {
          userId: homeUserId,
          memberId: homeMemberId,
          teamName: homeTeamName,
          starters: [
            {
              id: 'player-1',
              name: 'Marcus Bontempelli',
              team: 'Western Bulldogs',
              position: 'MID',
              stats: { goals: 1, kicks: 18, marks: 6, tackles: 5, inside50s: 7 },
            },
            {
              id: 'player-2',
              name: 'Jordan Dawson',
              team: 'Adelaide',
              position: 'MID',
              stats: { goals: 0, kicks: 21, marks: 5, tackles: 4, inside50s: 6 },
            },
            {
              id: 'player-3',
              name: 'Tom Stewart',
              team: 'Geelong',
              position: 'DEF',
              stats: { goals: 0, kicks: 16, marks: 8, tackles: 2, inside50s: 1 },
            },
            {
              id: 'player-4',
              name: 'Errol Gulden',
              team: 'Sydney',
              position: 'MID',
              stats: { goals: 1, kicks: 17, marks: 4, tackles: 3, inside50s: 8 },
            },
          ],
          summary: isPrimaryMatchup
            ? { wins: 3, losses: 1, ties: 1 }
            : { wins: 2, losses: 2, ties: 1 },
        },
        away: {
          userId: awayUserId,
          memberId: awayMemberId,
          teamName: awayTeamName,
          starters: [
            {
              id: 'player-5',
              name: 'Zach Merrett',
              team: 'Essendon',
              position: 'MID',
              stats: { goals: 0, kicks: 20, marks: 4, tackles: 6, inside50s: 5 },
            },
            {
              id: 'player-6',
              name: 'Sam Walsh',
              team: 'Carlton',
              position: 'MID',
              stats: { goals: 1, kicks: 19, marks: 5, tackles: 5, inside50s: 4 },
            },
            {
              id: 'player-7',
              name: 'Jack Sinclair',
              team: 'St Kilda',
              position: 'DEF',
              stats: { goals: 0, kicks: 22, marks: 7, tackles: 3, inside50s: 2 },
            },
            {
              id: 'player-8',
              name: 'Connor Rozee',
              team: 'Port Adelaide',
              position: 'MID',
              stats: { goals: 2, kicks: 15, marks: 3, tackles: 4, inside50s: 7 },
            },
          ],
          summary: isPrimaryMatchup
            ? { wins: 1, losses: 3, ties: 1 }
            : { wins: 2, losses: 2, ties: 1 },
        },
        categories: categories.map((categoryKey) => {
          const label = FANTASY_CATEGORIES[categoryKey].label;
          const values: Record<
            FantasyCategoryKey,
            { home: number; away: number; winner: 'home' | 'away' | 'tie' }
          > = {
            goals: { home: isPrimaryMatchup ? 4 : 3, away: 3, winner: 'home' },
            kicks: { home: isPrimaryMatchup ? 72 : 65, away: 76, winner: 'away' },
            handballs: { home: 38, away: 35, winner: 'home' },
            marks: { home: 23, away: 19, winner: 'home' },
            tackles: {
              home: 14,
              away: isPrimaryMatchup ? 18 : 14,
              winner: isPrimaryMatchup ? 'away' : 'tie',
            },
            hitouts: { home: 21, away: 29, winner: 'away' },
            clearances: { home: 17, away: 15, winner: 'home' },
            inside50s: { home: isPrimaryMatchup ? 22 : 18, away: 18, winner: 'home' },
            rebound50s: { home: 11, away: 14, winner: 'away' },
            clangers: { home: 9, away: 11, winner: 'home' },
            contestedPossessions: { home: 27, away: 24, winner: 'home' },
            uncontestedPossessions: { home: 41, away: 43, winner: 'away' },
            freesFor: { home: 8, away: 7, winner: 'home' },
            freesAgainst: { home: 7, away: 8, winner: 'home' },
            onePercenters: { home: 10, away: 9, winner: 'home' },
            goalAssists: { home: 3, away: 2, winner: 'home' },
            timeOnGroundPct: { home: 82.4, away: 81.2, winner: 'home' },
            effectiveDisposals: { home: 54, away: 56, winner: 'away' },
            scoreInvolvements: { home: 18, away: 16, winner: 'home' },
            turnovers: { home: 12, away: 10, winner: 'away' },
            intercepts: { home: 13, away: 15, winner: 'away' },
            metresGained: { home: 1480, away: 1432, winner: 'home' },
            contestedMarks: { home: 5, away: 4, winner: 'home' },
            disposalEffPct: { home: 74.8, away: 76.1, winner: 'away' },
          };
          const stat = values[categoryKey];
          return {
            key: categoryKey,
            label,
            home: stat.home,
            away: stat.away,
            winner: stat.winner,
          };
        }),
        otherMatchups: [
          {
            matchupId: 'matchup-1',
            homeTeamName: 'Robbo Rockers',
            awayTeamName: 'Brownlow Medalists',
            homeScore: 3,
            awayScore: 1,
            leaderText: 'Robbo Rockers lead 3-1-1',
            isSelected: isPrimaryMatchup,
          },
          {
            matchupId: 'matchup-2',
            homeTeamName: 'Inside 50 Kings',
            awayTeamName: 'Mark Masters',
            homeScore: 2,
            awayScore: 2,
            leaderText: 'All square at 2-2-1',
            isSelected: !isPrimaryMatchup,
          },
        ],
      });
    }

    if (categories.length === 0) {
      return commonErrors.badRequest('At least one scoring category is required');
    }
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
    let resolvedRoundMatchups = await resolveLeagueRoundMatchups({
      leagueId,
      season,
      requestedRound,
    });
    if (resolvedRoundMatchups.roundMatchups.length === 0) {
      await ensureLeagueSeasonMaterialized({ leagueId, season }).catch((error) => {
        logger.warn('Failed to materialize league season before reading matchup slate', {
          leagueId,
          season,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      resolvedRoundMatchups = await resolveLeagueRoundMatchups({
        leagueId,
        season,
        requestedRound,
      });
    }
    const { round: computedRound, roundMatchups } = resolvedRoundMatchups;
    if (computedRound == null) {
      return commonErrors.notFound('No current AFL round found');
    }
    if (roundMatchups.length === 0) {
      return commonErrors.notFound(
        requestedRound != null
          ? `No matchup found for Round ${requestedRound}`
          : 'No current matchup found'
      );
    }

    const matchupContext = buildLeagueMatchupContext({
      authUserId,
      selectedMatchupId,
      round: computedRound,
      roundMatchups,
    });
    const myRoundMatchup = matchupContext?.myCurrentMatchup;
    if (!myRoundMatchup) {
      return commonErrors.forbidden(
        requestedRound != null
          ? `You are not part of the Round ${requestedRound} matchup slate`
          : 'You are not part of the current matchup slate'
      );
    }

    const selectedMatchup = matchupContext.selectedMatchup;

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

    const cacheKey = buildSlateCacheKey(leagueId, season, round, categories);
    const cachedSlate = await getCachedSlate(cacheKey);
    if (cachedSlate) {
      const cachedSelected = cachedSlate.matchups.find(
        (matchup) => matchup.matchupId === selectedMatchup.id
      );
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

    const rosterSnapshot = await loadLeagueRosters(
      leagueId,
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

    const allPlayerIds = Array.from(
      new Set(Array.from(rosterSnapshot.rostersByUserId.values()).flat().map(String))
    );
    const players =
      allPlayerIds.length > 0
        ? await prisma.player.findMany({
            where: { id: { in: allPlayerIds } },
            select: { id: true, name: true, club: true, position: true },
          })
        : [];
    const playerMap = new Map(players.map((player) => [String(player.id), player]));
    const playerNameById = new Map(rosterSnapshot.playerNameById);
    players.forEach((player) => {
      playerNameById.set(String(player.id), player.name);
    });
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

    after(async () => {
      await refreshLiveStatsIfNeeded({
        minIntervalMs: 30_000,
        trigger: 'league-matchup',
        season,
      }).catch((error) => {
        logger.warn('Live matchup refresh failed after responding with matchup slate', {
          leagueId,
          season,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      const freshness = await getMaterializedSeasonFreshness({ leagueId, season }).catch(
        (error) => {
          logger.warn(
            'Failed to check league season freshness after responding with matchup slate',
            {
              leagueId,
              season,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          return null;
        }
      );
      if (!freshness?.stale) return;

      await ensureLeagueSeasonMaterialized({ leagueId, season }).catch((error) => {
        logger.warn('Failed to re-materialize league season after responding with matchup slate', {
          leagueId,
          season,
          reason: freshness.reason,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

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
