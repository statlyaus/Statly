import 'server-only';

import { getRoundMatchesResult, getRoundPlayerStatsResult } from '@/lib/etlIntegration';
import { prisma } from '@/lib/prisma';
import {
  FANTASY_CATEGORIES,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';

import { parseCategoryDirectionsJson } from './categoryDirections';
import { parseCompetitionRulesJson } from './competitionRules';
import {
  normalizeLiveStatRows,
  normalizeRoundMatchStatus,
  type NormalizedRoundMatchStatus,
  type RawLiveStatRow,
  type RawRoundMatch,
} from './liveStatsAdapter';
import {
  aggregateLineupCategoryTotals,
  scoreHeadToHeadCategories,
  sumCategoryTotals,
  type CategoryTotals,
} from './matchupScoringEngine';
import { calculateStandingsRows } from './standingsService';
import { buildLeagueStandings, type LeagueStandingReadRow } from './standingsReadModel';
import { parseLineupSlotsJson } from './lineupSettings';
import type { LeagueScoringMode } from './scoringTypes';

type MatchupTeamSide = 'home' | 'away' | 'draw';

export interface LeagueMatchupTeamSummary {
  id: string;
  teamName: string;
  teamLogoUrl: string | null;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  pointsFor: number;
  pointsAgainst: number;
  matchupWin: boolean;
  matchupLoss: boolean;
  matchupDraw: boolean;
  players: LeagueMatchupPlayerContribution[];
}

export interface LeagueMatchupCategoryRow {
  category: FantasyCategoryKey;
  label: string;
  shortLabel: string;
  homeValue: number;
  awayValue: number;
  direction: 'HIGH_WINS' | 'LOW_WINS';
  winner: MatchupTeamSide;
}

export interface LeagueMatchupPlayerContribution {
  playerId: string;
  name: string;
  position: string;
  slot: string;
  slotIndex: number;
  total: number;
  categories: Array<{
    category: FantasyCategoryKey;
    shortLabel: string;
    value: number;
  }>;
}

export interface LeagueMatchupCard {
  id: string;
  round: number;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL';
  startsAt: string | null;
  endsAt: string | null;
  finalizedAt: string | null;
  winnerMemberId: string | null;
  homeMember: LeagueMatchupTeamSummary | null;
  awayMember: LeagueMatchupTeamSummary | null;
  byeMember: {
    id: string;
    teamName: string;
    teamLogoUrl: string | null;
  } | null;
  homeCategoryWins: number;
  awayCategoryWins: number;
  drawnCategories: number;
  categoryRows: LeagueMatchupCategoryRow[];
}

export interface LeagueMatchupReadModel {
  leagueId: string;
  round: number;
  competitionStatus: 'SETUP' | 'PUBLISHED' | 'PENDING' | 'ACTIVE' | 'COMPLETE';
  scoringMode: LeagueScoringMode;
  fixtureGenerationMode: 'AUTOMATIC' | 'MANUAL';
  categories: FantasyCategoryKey[];
  lineupSlots: ReturnType<typeof parseLineupSlotsJson>;
  categoryDirections: ReturnType<typeof parseCategoryDirectionsJson>;
  availableRounds: number[];
  roundContext: {
    round: number;
    aflRound: number | null;
    phase: 'REGULAR' | 'FINALS';
    status: 'SCHEDULED' | 'NO_MATCHUP' | 'PENDING' | 'LOCKED' | 'FINAL';
    startsAt: string | null;
    endsAt: string | null;
    fallbackLockAt: string | null;
  } | null;
  matchups: LeagueMatchupCard[];
  standings: LeagueStandingReadRow[];
  permissions: {
    canManage: boolean;
  };
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function parseStoredCategoryRows(categoriesJson: string | null | undefined): Array<{
  category: FantasyCategoryKey;
  homeValue: number;
  awayValue: number;
  direction: 'HIGH_WINS' | 'LOW_WINS';
  winner: MatchupTeamSide;
}> {
  if (!categoriesJson) return [];

  try {
    const parsed = JSON.parse(categoriesJson);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const source = row as Record<string, unknown>;
      const category = source.category;
      if (typeof category !== 'string') return [];
      const categoryKey = category as FantasyCategoryKey;
      const homeValue = Number(source.homeValue ?? 0);
      const awayValue = Number(source.awayValue ?? 0);
      const winner = source.winner;
      const direction = source.direction;

      return [
        {
          category: categoryKey,
          homeValue: Number.isFinite(homeValue) ? homeValue : 0,
          awayValue: Number.isFinite(awayValue) ? awayValue : 0,
          direction: direction === 'LOW_WINS' ? 'LOW_WINS' : 'HIGH_WINS',
          winner: winner === 'home' || winner === 'away' || winner === 'draw' ? winner : 'draw',
        },
      ];
    });
  } catch {
    return [];
  }
}

function countTieBreakCategoryWins(
  categoriesJson: string | null | undefined,
  category: FantasyCategoryKey
) {
  return parseStoredCategoryRows(categoriesJson).filter(
    (row) => row.category === category && row.winner === 'home'
  ).length;
}

function buildCategoryRows({
  categories,
  categoryDirections,
  categoriesJson,
}: {
  categories: FantasyCategoryKey[];
  categoryDirections: ReturnType<typeof parseCategoryDirectionsJson>;
  categoriesJson: string | null | undefined;
}): LeagueMatchupCategoryRow[] {
  const storedRowsByCategory = new Map(
    parseStoredCategoryRows(categoriesJson).map((row) => [row.category, row])
  );

  return categories.map((category) => {
    const storedRow = storedRowsByCategory.get(category);
    const meta = FANTASY_CATEGORIES[category];

    return {
      category,
      label: meta?.label ?? category,
      shortLabel: meta?.shortLabel ?? meta?.abbrev ?? category,
      homeValue: storedRow?.homeValue ?? 0,
      awayValue: storedRow?.awayValue ?? 0,
      direction: storedRow?.direction ?? categoryDirections[category] ?? 'HIGH_WINS',
      winner: storedRow?.winner ?? 'draw',
    };
  });
}

function buildTeamSummary({
  member,
  score,
  players,
}: {
  member: { id: string; teamName: string; teamLogoUrl: string | null } | null;
  score:
    | {
        categoryWins: number;
        categoryLosses: number;
        categoryDraws: number;
        pointsFor: number;
        pointsAgainst: number;
        matchupWin: boolean;
        matchupLoss: boolean;
        matchupDraw: boolean;
      }
    | undefined;
  players: LeagueMatchupPlayerContribution[];
}): LeagueMatchupTeamSummary | null {
  if (!member) return null;

  return {
    id: member.id,
    teamName: member.teamName,
    teamLogoUrl: member.teamLogoUrl,
    categoryWins: score?.categoryWins ?? 0,
    categoryLosses: score?.categoryLosses ?? 0,
    categoryDraws: score?.categoryDraws ?? 0,
    pointsFor: score?.pointsFor ?? 0,
    pointsAgainst: score?.pointsAgainst ?? 0,
    matchupWin: score?.matchupWin ?? false,
    matchupLoss: score?.matchupLoss ?? false,
    matchupDraw: score?.matchupDraw ?? false,
    players,
  };
}

function buildPlayerContributions({
  lineup,
  categories,
  totalsByPlayerId,
}: {
  lineup:
    | {
        players: Array<{
          playerId: string;
          slot: string;
          slotIndex: number;
          player: { name: string; position: string };
        }>;
      }
    | undefined;
  categories: FantasyCategoryKey[];
  totalsByPlayerId: Map<string, CategoryTotals>;
}): LeagueMatchupPlayerContribution[] {
  return (
    lineup?.players
      .filter((lineupPlayer) => lineupPlayer.slot !== 'BENCH')
      .map((lineupPlayer) => {
        const totals = totalsByPlayerId.get(lineupPlayer.playerId) ?? {};
        const categoryValues = categories.map((category) => ({
          category,
          shortLabel:
            FANTASY_CATEGORIES[category]?.shortLabel ??
            FANTASY_CATEGORIES[category]?.abbrev ??
            category,
          value: totals[category] ?? 0,
        }));

        return {
          playerId: lineupPlayer.playerId,
          name: lineupPlayer.player.name,
          position: lineupPlayer.player.position,
          slot: lineupPlayer.slot,
          slotIndex: lineupPlayer.slotIndex,
          total: sumCategoryTotals(totals, categories),
          categories: categoryValues,
        };
      })
      .sort((a, b) => a.slot.localeCompare(b.slot) || a.slotIndex - b.slotIndex) ?? []
  );
}

function buildMatchupCard({
  matchup,
  categories,
  categoryDirections,
  lineupsByMemberId,
  totalsByPlayerId,
}: {
  matchup: Awaited<ReturnType<typeof prisma.leagueMatchup.findMany>>[number] & {
    homeMember: { id: string; teamName: string; teamLogoUrl: string | null } | null;
    awayMember: { id: string; teamName: string; teamLogoUrl: string | null } | null;
    byeMember: { id: string; teamName: string; teamLogoUrl: string | null } | null;
    scores: Array<{
      memberId: string;
      categoriesJson: string;
      categoryWins: number;
      categoryLosses: number;
      categoryDraws: number;
      pointsFor: number;
      pointsAgainst: number;
      matchupWin: boolean;
      matchupLoss: boolean;
      matchupDraw: boolean;
    }>;
  };
  categories: FantasyCategoryKey[];
  categoryDirections: ReturnType<typeof parseCategoryDirectionsJson>;
  lineupsByMemberId: Map<
    string,
    {
      players: Array<{
        playerId: string;
        slot: string;
        slotIndex: number;
        player: { name: string; position: string };
      }>;
    }
  >;
  totalsByPlayerId: Map<string, CategoryTotals>;
}): LeagueMatchupCard {
  const homeScore = matchup.scores.find((score) => score.memberId === matchup.homeMemberId);
  const awayScore = matchup.scores.find((score) => score.memberId === matchup.awayMemberId);
  const homePlayers = matchup.homeMemberId
    ? buildPlayerContributions({
        lineup: lineupsByMemberId.get(matchup.homeMemberId),
        categories,
        totalsByPlayerId,
      })
    : [];
  const awayPlayers = matchup.awayMemberId
    ? buildPlayerContributions({
        lineup: lineupsByMemberId.get(matchup.awayMemberId),
        categories,
        totalsByPlayerId,
      })
    : [];

  return {
    id: matchup.id,
    round: matchup.round,
    status: matchup.status,
    startsAt: toIsoString(matchup.startsAt),
    endsAt: toIsoString(matchup.endsAt),
    finalizedAt: toIsoString(matchup.finalizedAt),
    winnerMemberId: matchup.winnerMemberId,
    homeMember: buildTeamSummary({
      member: matchup.homeMember,
      score: homeScore,
      players: homePlayers,
    }),
    awayMember: buildTeamSummary({
      member: matchup.awayMember,
      score: awayScore,
      players: awayPlayers,
    }),
    byeMember: matchup.byeMember
      ? {
          id: matchup.byeMember.id,
          teamName: matchup.byeMember.teamName,
          teamLogoUrl: matchup.byeMember.teamLogoUrl,
        }
      : null,
    homeCategoryWins: matchup.homeCategoryWins,
    awayCategoryWins: matchup.awayCategoryWins,
    drawnCategories: matchup.drawnCategories,
    categoryRows: buildCategoryRows({
      categories,
      categoryDirections,
      categoriesJson: homeScore?.categoriesJson,
    }),
  };
}

export function toMatchupStatusFromRoundStatus(
  status: Pick<NormalizedRoundMatchStatus, 'anyLive' | 'allFinal'>
) {
  if (status.allFinal) return 'FINAL' as const;
  if (status.anyLive) return 'LIVE' as const;
  return 'SCHEDULED' as const;
}

export function resolveAflRoundForScoring({
  fixtureVersion,
  fantasyRound,
  competitionRoundAflRound,
}: {
  fixtureVersion: number;
  fantasyRound: number;
  competitionRoundAflRound: number | null;
}): number | null {
  return fixtureVersion === 0 ? fantasyRound : competitionRoundAflRound;
}

function normalizeLeagueCategories(value: string | null | undefined): FantasyCategoryKey[] {
  const realDataCategoryKeys = new Set<FantasyCategoryKey>(REAL_DATA_NINE_CATEGORY_PRESET);
  if (!value) return [...REAL_DATA_NINE_CATEGORY_PRESET];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length
      ? parsed.filter((category): category is FantasyCategoryKey =>
          realDataCategoryKeys.has(category as FantasyCategoryKey)
        )
      : [...REAL_DATA_NINE_CATEGORY_PRESET];
  } catch {
    return [...REAL_DATA_NINE_CATEGORY_PRESET];
  }
}

async function loadLivePlayerTotalsForRound(season: number, round: number) {
  const [statsResult, matchesResult] = await Promise.all([
    getRoundPlayerStatsResult(season, round),
    getRoundMatchesResult(season, round),
  ]);
  const available = statsResult.ok && matchesResult.ok;
  const normalizedStats = normalizeLiveStatRows(
    (statsResult.ok ? statsResult.stats : []) as unknown as RawLiveStatRow[]
  ).filter((row) => row.round === round);
  const totalsByPlayerId = new Map<string, CategoryTotals>();

  for (const stat of normalizedStats) {
    totalsByPlayerId.set(stat.playerId, stat.totals);
  }

  return {
    available,
    totalsByPlayerId,
    roundStatus: normalizeRoundMatchStatus(
      (matchesResult.ok ? matchesResult.matches : []) as unknown as RawRoundMatch[]
    ),
  };
}

async function loadLeagueCompetitionSettings(leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });

  if (!league?.settings) return null;

  const categories = normalizeLeagueCategories(league.categoriesJson);
  const fixtureGenerationMode: 'AUTOMATIC' | 'MANUAL' =
    league.settings.fixtureGenerationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC';
  return {
    league,
    categories,
    scoringMode: league.settings.scoringMode as LeagueScoringMode,
    fixtureGenerationMode,
    lineupSlots: parseLineupSlotsJson(league.settings.lineupSlotsJson),
    categoryDirections: parseCategoryDirectionsJson(
      categories,
      league.settings.categoryDirectionsJson
    ),
    competitionStatus: league.settings.competitionStatus,
    competitionRules: parseCompetitionRulesJson(
      league.settings.competitionRulesJson,
      categories[0] ?? 'goals'
    ),
  };
}

function resolveCurrentCompetitionRound<
  TRound extends {
    round: number;
    status: string;
    startsAt: Date | null;
    endsAt: Date | null;
  },
>(rounds: readonly TRound[], now = new Date()): TRound | null {
  const playableRounds = rounds.filter(
    (competitionRound) => competitionRound.status !== 'NO_MATCHUP'
  );
  if (!playableRounds.length) return rounds[0] ?? null;

  return (
    playableRounds.find(
      (competitionRound) =>
        competitionRound.startsAt &&
        competitionRound.startsAt <= now &&
        (!competitionRound.endsAt || competitionRound.endsAt >= now)
    ) ??
    playableRounds.find(
      (competitionRound) => !competitionRound.startsAt || competitionRound.startsAt > now
    ) ??
    playableRounds.at(-1) ??
    null
  );
}

export async function loadLeagueMatchupReadModel({
  leagueId,
  userId,
  round,
  canManage,
}: {
  leagueId: string;
  userId: string;
  round?: number;
  canManage: boolean;
}): Promise<LeagueMatchupReadModel | null> {
  const settings = await loadLeagueCompetitionSettings(leagueId);
  if (!settings) return null;

  const viewerMember = await prisma.leagueMember.findFirst({
    where: { leagueId, userId },
    select: { id: true },
    orderBy: { joinedAt: 'asc' },
  });
  if (!viewerMember) return null;

  const viewerMatchupWhere = {
    leagueId,
    fixtureVersion: settings.league.settings.competitionRulesVersion,
    OR: [
      { homeMemberId: viewerMember.id },
      { awayMemberId: viewerMember.id },
      { byeMemberId: viewerMember.id },
    ],
  };
  const competitionRounds =
    settings.competitionStatus === 'SETUP'
      ? []
      : await prisma.leagueCompetitionRound.findMany({
          where: {
            leagueId,
            fixtureVersion: settings.league.settings.competitionRulesVersion,
          },
          orderBy: { round: 'asc' },
        });
  const availableRounds = competitionRounds.map((competitionRound) => competitionRound.round);
  const resolvedRound = resolveCurrentCompetitionRound(competitionRounds);
  const activeRound =
    round && availableRounds.includes(round) ? round : (resolvedRound?.round ?? 1);
  const activeCompetitionRound =
    competitionRounds.find((competitionRound) => competitionRound.round === activeRound) ?? null;
  const [matchups, persistedStandings, finalizedScores, members] = await Promise.all([
    prisma.leagueMatchup.findMany({
      where: { ...viewerMatchupWhere, round: activeRound },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        homeMember: true,
        awayMember: true,
        byeMember: true,
        scores: true,
      },
    }),
    prisma.leagueStanding.findMany({
      where: { leagueId },
      orderBy: [{ wins: 'desc' }, { categoryWins: 'desc' }],
    }),
    prisma.leagueMatchupScore.findMany({
      where: {
        leagueId,
        status: 'FINAL',
        matchup: { fixtureVersion: settings.league.settings.competitionRulesVersion },
      },
      select: { memberId: true, categoriesJson: true },
    }),
    prisma.leagueMember.findMany({
      where: { leagueId },
      select: { id: true, teamName: true, teamLogoUrl: true, draftSlot: true },
    }),
  ]);
  const liveTotals = activeCompetitionRound?.aflRound
    ? await loadLivePlayerTotalsForRound(new Date().getFullYear(), activeCompetitionRound.aflRound)
    : {
        available: false,
        totalsByPlayerId: new Map<string, CategoryTotals>(),
        roundStatus: {
          earliestStartAt: null,
          latestEndAt: null,
          anyLive: false,
          allFinal: false,
          hasUnavailableStatus: true,
          matches: [],
        },
      };
  const visibleMemberIds = [
    ...new Set(
      matchups.flatMap((matchup) =>
        [matchup.homeMemberId, matchup.awayMemberId].filter((memberId): memberId is string =>
          Boolean(memberId)
        )
      )
    ),
  ];
  const lineups =
    visibleMemberIds.length > 0
      ? await prisma.leagueLineup.findMany({
          where: { leagueId, round: activeRound, memberId: { in: visibleMemberIds } },
          include: {
            players: {
              include: { player: true },
              orderBy: [{ slot: 'asc' }, { slotIndex: 'asc' }],
            },
          },
        })
      : [];
  const lineupsByMemberId = new Map(lineups.map((lineup) => [lineup.memberId, lineup]));
  const tieBreakCategoryWinsByMemberId = new Map<string, number>();
  for (const score of finalizedScores) {
    tieBreakCategoryWinsByMemberId.set(
      score.memberId,
      (tieBreakCategoryWinsByMemberId.get(score.memberId) ?? 0) +
        countTieBreakCategoryWins(
          score.categoriesJson,
          settings.competitionRules.standingsTieBreakCategory
        )
    );
  }

  return {
    leagueId,
    round: activeRound,
    competitionStatus: settings.competitionStatus,
    scoringMode: settings.scoringMode,
    fixtureGenerationMode: settings.fixtureGenerationMode,
    categories: settings.categories,
    lineupSlots: settings.lineupSlots,
    categoryDirections: settings.categoryDirections,
    availableRounds,
    roundContext: activeCompetitionRound
      ? {
          round: activeCompetitionRound.round,
          aflRound: activeCompetitionRound.aflRound,
          phase: activeCompetitionRound.phase,
          status: activeCompetitionRound.status,
          startsAt: toIsoString(activeCompetitionRound.startsAt),
          endsAt: toIsoString(activeCompetitionRound.endsAt),
          fallbackLockAt: toIsoString(activeCompetitionRound.fallbackLockAt),
        }
      : null,
    matchups: matchups.map((matchup) =>
      buildMatchupCard({
        matchup,
        categories: settings.categories,
        categoryDirections: settings.categoryDirections,
        lineupsByMemberId,
        totalsByPlayerId: liveTotals.totalsByPlayerId,
      })
    ),
    standings: buildLeagueStandings({
      members,
      standings: persistedStandings,
      tieBreakCategoryWinsByMemberId,
    }),
    permissions: { canManage },
  };
}

export async function recalculateLeagueRoundMatchups({
  leagueId,
  round,
  finalize,
}: {
  leagueId: string;
  round: number;
  finalize?: boolean;
}) {
  const settings = await loadLeagueCompetitionSettings(leagueId);
  if (!settings) return null;

  const fixtureVersion = settings.league.settings.competitionRulesVersion;
  const [competitionRound, matchups, lineups, members] = await Promise.all([
    fixtureVersion > 0
      ? prisma.leagueCompetitionRound.findUnique({
          where: { leagueId_fixtureVersion_round: { leagueId, fixtureVersion, round } },
          select: { aflRound: true },
        })
      : Promise.resolve(null),
    prisma.leagueMatchup.findMany({ where: { leagueId, round, fixtureVersion } }),
    prisma.leagueLineup.findMany({ where: { leagueId, round }, include: { players: true } }),
    prisma.leagueMember.findMany({ where: { leagueId }, select: { id: true } }),
  ]);
  const aflRound = resolveAflRoundForScoring({
    fixtureVersion,
    fantasyRound: round,
    competitionRoundAflRound: competitionRound?.aflRound ?? null,
  });
  if (aflRound === null) {
    return {
      round,
      status: 'SCHEDULED' as const,
      recalculated: 0,
      scores: [],
      roundStatus: {
        earliestStartAt: null,
        latestEndAt: null,
        anyLive: false,
        allFinal: false,
        hasUnavailableStatus: true,
        matches: [],
      },
    };
  }
  const { available, totalsByPlayerId, roundStatus } = await loadLivePlayerTotalsForRound(
    new Date().getFullYear(),
    aflRound
  );
  if (!available) {
    return {
      round,
      status: 'SCHEDULED' as const,
      recalculated: 0,
      scores: [],
      roundStatus: { ...roundStatus, hasUnavailableStatus: true },
    };
  }
  const status =
    finalize || roundStatus.allFinal ? 'FINAL' : toMatchupStatusFromRoundStatus(roundStatus);
  const lineupsByMemberId = new Map(lineups.map((lineup) => [lineup.memberId, lineup]));
  const calculatedScores = [];

  for (const matchup of matchups) {
    if (!matchup.homeMemberId || !matchup.awayMemberId) {
      continue;
    }

    const homeLineup = lineupsByMemberId.get(matchup.homeMemberId);
    const awayLineup = lineupsByMemberId.get(matchup.awayMemberId);
    const homeTotals = aggregateLineupCategoryTotals({
      categories: settings.categories,
      players:
        homeLineup?.players.map((player) => ({
          playerId: player.playerId,
          slot: player.slot,
          totals: totalsByPlayerId.get(player.playerId) ?? {},
        })) ?? [],
    });
    const awayTotals = aggregateLineupCategoryTotals({
      categories: settings.categories,
      players:
        awayLineup?.players.map((player) => ({
          playerId: player.playerId,
          slot: player.slot,
          totals: totalsByPlayerId.get(player.playerId) ?? {},
        })) ?? [],
    });
    const result = scoreHeadToHeadCategories({
      categories: settings.categories,
      categoryDirections: settings.categoryDirections,
      homeTotals,
      awayTotals,
      scoringMode: settings.scoringMode,
    });
    const homePointsFor = sumCategoryTotals(homeTotals, settings.categories);
    const awayPointsFor = sumCategoryTotals(awayTotals, settings.categories);
    const finalizedAt = status === 'FINAL' ? new Date() : null;

    await prisma.$transaction([
      prisma.leagueMatchup.update({
        where: { id: matchup.id },
        data: {
          status,
          finalizedAt,
          winnerMemberId: result.matchupDraw
            ? null
            : result.homeMatchupWin
              ? matchup.homeMemberId
              : matchup.awayMemberId,
          homeCategoryWins: result.homeCategoryWins,
          awayCategoryWins: result.awayCategoryWins,
          drawnCategories: result.drawnCategories,
        },
      }),
      prisma.leagueMatchupScore.upsert({
        where: { matchupId_memberId: { matchupId: matchup.id, memberId: matchup.homeMemberId } },
        create: {
          leagueId,
          matchupId: matchup.id,
          memberId: matchup.homeMemberId,
          round,
          categoriesJson: JSON.stringify(result.categories),
          categoryWins: result.homeCategoryWins,
          categoryLosses: result.awayCategoryWins,
          categoryDraws: result.drawnCategories,
          pointsFor: homePointsFor,
          pointsAgainst: awayPointsFor,
          matchupWin: result.homeMatchupWin,
          matchupLoss: result.awayMatchupWin,
          matchupDraw: result.matchupDraw,
          status,
          finalizedAt,
        },
        update: {
          categoriesJson: JSON.stringify(result.categories),
          categoryWins: result.homeCategoryWins,
          categoryLosses: result.awayCategoryWins,
          categoryDraws: result.drawnCategories,
          pointsFor: homePointsFor,
          pointsAgainst: awayPointsFor,
          matchupWin: result.homeMatchupWin,
          matchupLoss: result.awayMatchupWin,
          matchupDraw: result.matchupDraw,
          status,
          finalizedAt,
        },
      }),
      prisma.leagueMatchupScore.upsert({
        where: { matchupId_memberId: { matchupId: matchup.id, memberId: matchup.awayMemberId } },
        create: {
          leagueId,
          matchupId: matchup.id,
          memberId: matchup.awayMemberId,
          round,
          categoriesJson: JSON.stringify(
            result.categories.map((category) => ({
              ...category,
              homeValue: category.awayValue,
              awayValue: category.homeValue,
              winner:
                category.winner === 'home' ? 'away' : category.winner === 'away' ? 'home' : 'draw',
            }))
          ),
          categoryWins: result.awayCategoryWins,
          categoryLosses: result.homeCategoryWins,
          categoryDraws: result.drawnCategories,
          pointsFor: awayPointsFor,
          pointsAgainst: homePointsFor,
          matchupWin: result.awayMatchupWin,
          matchupLoss: result.homeMatchupWin,
          matchupDraw: result.matchupDraw,
          status,
          finalizedAt,
        },
        update: {
          categoriesJson: JSON.stringify(
            result.categories.map((category) => ({
              ...category,
              homeValue: category.awayValue,
              awayValue: category.homeValue,
              winner:
                category.winner === 'home' ? 'away' : category.winner === 'away' ? 'home' : 'draw',
            }))
          ),
          categoryWins: result.awayCategoryWins,
          categoryLosses: result.homeCategoryWins,
          categoryDraws: result.drawnCategories,
          pointsFor: awayPointsFor,
          pointsAgainst: homePointsFor,
          matchupWin: result.awayMatchupWin,
          matchupLoss: result.homeMatchupWin,
          matchupDraw: result.matchupDraw,
          status,
          finalizedAt,
        },
      }),
    ]);

    calculatedScores.push({ matchupId: matchup.id, result });
  }

  if (status === 'FINAL') {
    const finalizedScores = await prisma.leagueMatchupScore.findMany({
      where: { leagueId, status: 'FINAL' },
    });
    const standings = calculateStandingsRows({
      scoringMode: settings.scoringMode,
      memberIds: members.map((member) => member.id),
      finalizedScores,
    });

    for (const standing of standings) {
      await prisma.leagueStanding.upsert({
        where: { leagueId_memberId: { leagueId, memberId: standing.memberId } },
        create: { leagueId, ...standing },
        update: standing,
      });
    }
  }

  return {
    round,
    status,
    recalculated: calculatedScores.length,
    scores: calculatedScores,
    roundStatus,
  };
}
