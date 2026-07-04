import 'server-only';

import { getLivePlayerStats, getRoundMatches } from '@/lib/etlIntegration';
import { prisma } from '@/lib/prisma';
import { REAL_DATA_NINE_CATEGORY_PRESET, type FantasyCategoryKey } from '@/types/fantasyCategories';

import { parseCategoryDirectionsJson } from './categoryDirections';
import { generateRoundRobinFixtures } from './fixtureGenerator';
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
import { parseLineupSlotsJson } from './lineupSettings';
import type { LeagueScoringMode } from './scoringTypes';

export interface LeagueMatchupReadModel {
  leagueId: string;
  round: number;
  scoringMode: LeagueScoringMode;
  categories: FantasyCategoryKey[];
  lineupSlots: ReturnType<typeof parseLineupSlotsJson>;
  categoryDirections: ReturnType<typeof parseCategoryDirectionsJson>;
  matchups: unknown[];
  standings: unknown[];
  permissions: {
    canManage: boolean;
  };
}

export function toMatchupStatusFromRoundStatus(
  status: Pick<NormalizedRoundMatchStatus, 'anyLive' | 'allFinal'>
) {
  if (status.allFinal) return 'FINAL' as const;
  if (status.anyLive) return 'LIVE' as const;
  return 'SCHEDULED' as const;
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
  const [statsRows, roundMatches] = await Promise.all([
    getLivePlayerStats(season),
    getRoundMatches(season, round),
  ]);
  const normalizedStats = normalizeLiveStatRows(statsRows as unknown as RawLiveStatRow[]).filter(
    (row) => row.round === round
  );
  const totalsByPlayerId = new Map<string, CategoryTotals>();

  for (const stat of normalizedStats) {
    totalsByPlayerId.set(stat.playerId, stat.totals);
  }

  return {
    totalsByPlayerId,
    roundStatus: normalizeRoundMatchStatus(roundMatches as unknown as RawRoundMatch[]),
  };
}

async function loadLeagueCompetitionSettings(leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });

  if (!league?.settings) return null;

  const categories = normalizeLeagueCategories(league.categoriesJson);
  return {
    league,
    categories,
    scoringMode: league.settings.scoringMode as LeagueScoringMode,
    lineupSlots: parseLineupSlotsJson(league.settings.lineupSlotsJson),
    categoryDirections: parseCategoryDirectionsJson(
      categories,
      league.settings.categoryDirectionsJson
    ),
  };
}

export async function loadLeagueMatchupReadModel({
  leagueId,
  round,
  canManage,
}: {
  leagueId: string;
  round?: number;
  canManage: boolean;
}): Promise<LeagueMatchupReadModel | null> {
  const settings = await loadLeagueCompetitionSettings(leagueId);
  if (!settings) return null;

  const activeRound = round ?? 1;
  const [matchups, standings] = await Promise.all([
    prisma.leagueMatchup.findMany({
      where: { leagueId, round: activeRound },
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
  ]);

  return {
    leagueId,
    round: activeRound,
    scoringMode: settings.scoringMode,
    categories: settings.categories,
    lineupSlots: settings.lineupSlots,
    categoryDirections: settings.categoryDirections,
    matchups,
    standings,
    permissions: { canManage },
  };
}

export async function generateLeagueFixtures({ leagueId }: { leagueId: string }) {
  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
    select: { id: true },
  });
  const fixtures = generateRoundRobinFixtures(members.map((member) => member.id));
  if (fixtures.length === 0) return { created: 0 };

  const year = new Date().getFullYear();
  const startsByRound = new Map<number, Date | null>();
  for (const fixture of fixtures) {
    if (startsByRound.has(fixture.round)) continue;
    const roundStatus = normalizeRoundMatchStatus(
      (await getRoundMatches(year, fixture.round)) as unknown as RawRoundMatch[]
    );
    startsByRound.set(fixture.round, roundStatus.earliestStartAt);
  }

  await prisma.$transaction([
    prisma.leagueMatchup.deleteMany({ where: { leagueId } }),
    prisma.leagueMatchup.createMany({
      data: fixtures.map((fixture) => ({
        leagueId,
        round: fixture.round,
        homeMemberId: fixture.homeMemberId,
        awayMemberId: fixture.awayMemberId,
        byeMemberId: fixture.byeMemberId,
        startsAt: startsByRound.get(fixture.round) ?? undefined,
      })),
    }),
  ]);

  return { created: fixtures.length };
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

  const [matchups, lineups, members] = await Promise.all([
    prisma.leagueMatchup.findMany({ where: { leagueId, round } }),
    prisma.leagueLineup.findMany({ where: { leagueId, round }, include: { players: true } }),
    prisma.leagueMember.findMany({ where: { leagueId }, select: { id: true } }),
  ]);
  const { totalsByPlayerId, roundStatus } = await loadLivePlayerTotalsForRound(
    new Date().getFullYear(),
    round
  );
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
