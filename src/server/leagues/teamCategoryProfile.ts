import { prisma } from '@/lib/prisma';
import {
  FANTASY_CATEGORIES,
  categoryAggregation,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';

import { activeSeasonIdOf } from './activeSeason';
import { isActivePrismaMembership } from './membership';
import { normalizeCategoryDirections } from './categoryDirections';
import { parseLeagueCategories } from './defaultLineups';
import { aggregateFinalizedCategoryTotals, parseStoredCategoryRows } from './matchupReadModel';
import type { CategoryDirection } from './scoringTypes';

export interface TeamCategoryStanding {
  key: FantasyCategoryKey;
  label: string;
  /**
   * The viewer's per-round average across finalized regular-season rounds. A ratio category (DE%)
   * is the season ratio instead (season effective disposals / season disposals), null when the
   * team had no season disposals.
   */
  average: number | null;
  /** The mean of the teams' averages; for a ratio category, the league's pooled season ratio. */
  leagueAverage: number | null;
  /** 1 is best in the league, honouring low-wins categories. A team with no value ranks last. */
  rank: number;
  lowWins: boolean;
}

export interface TeamCategoryProfile {
  memberId: string;
  teamName: string;
  roundsPlayed: number;
  teamCount: number;
  categories: TeamCategoryStanding[];
}

interface BuildInput {
  viewerMemberId: string;
  members: ReadonlyArray<{ id: string; teamName: string }>;
  categories: readonly FantasyCategoryKey[];
  categoryDirections: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
  finalizedScores: ReadonlyArray<{ memberId: string; categoriesJson: unknown }>;
}

const roundToTenth = (value: number) => Math.round(value * 10) / 10;
// Pools every team's rows under one key to get the league's season ratio.
const POOLED_LEAGUE_KEY = '\u0000league';

/** Per-round category averages for every team, then the viewer's rank in each category. */
export function buildTeamCategoryProfile(input: BuildInput): TeamCategoryProfile | null {
  const viewer = input.members.find((member) => member.id === input.viewerMemberId);
  if (!viewer) return null;

  const memberIds = new Set(input.members.map((member) => member.id));
  const roundsByMember = new Map<string, number>();
  const totalsByMember = new Map<string, Map<FantasyCategoryKey, number>>();

  for (const score of input.finalizedScores) {
    if (!memberIds.has(score.memberId)) continue;
    roundsByMember.set(score.memberId, (roundsByMember.get(score.memberId) ?? 0) + 1);
    const totals = totalsByMember.get(score.memberId) ?? new Map<FantasyCategoryKey, number>();
    for (const row of parseStoredCategoryRows(score.categoriesJson)) {
      const category = row.category;
      totals.set(category, (totals.get(category) ?? 0) + (row.homeValue ?? 0));
    }
    totalsByMember.set(score.memberId, totals);
  }

  const roundsPlayed = roundsByMember.get(viewer.id) ?? 0;
  const base = {
    memberId: viewer.id,
    teamName: viewer.teamName,
    roundsPlayed,
    teamCount: input.members.length,
  };
  if (roundsPlayed === 0) return { ...base, categories: [] };

  const memberScores = input.finalizedScores.filter((score) => memberIds.has(score.memberId));
  const averagesFor = (
    category: FantasyCategoryKey
  ): Array<{ memberId: string; average: number | null }> => {
    if (categoryAggregation(category).kind === 'sum') {
      return [...roundsByMember.entries()].map(([memberId, rounds]) => ({
        memberId,
        average: (totalsByMember.get(memberId)?.get(category) ?? 0) / rounds,
      }));
    }
    const seasonValues = aggregateFinalizedCategoryTotals(memberScores, category);
    return [...roundsByMember.keys()].map((memberId) => ({
      memberId,
      average: seasonValues.get(memberId) ?? null,
    }));
  };
  const leagueAverageFor = (
    category: FantasyCategoryKey,
    averages: ReadonlyArray<{ average: number | null }>
  ): number | null => {
    if (categoryAggregation(category).kind !== 'sum') {
      const pooled = memberScores.map((score) => ({ ...score, memberId: POOLED_LEAGUE_KEY }));
      return aggregateFinalizedCategoryTotals(pooled, category).get(POOLED_LEAGUE_KEY) ?? null;
    }
    return averages.reduce((sum, entry) => sum + (entry.average ?? 0), 0) / averages.length;
  };

  return {
    ...base,
    categories: input.categories.map((category) => {
      const lowWins = input.categoryDirections[category] === 'LOW_WINS';
      const averages = averagesFor(category);
      const average = averages.find((entry) => entry.memberId === viewer.id)?.average ?? null;
      const valued = averages.flatMap((entry) => (entry.average === null ? [] : [entry.average]));
      const better =
        average === null
          ? valued.length
          : valued.filter((value) => (lowWins ? value < average : value > average)).length;
      const leagueAverage = leagueAverageFor(category, averages);
      return {
        key: category,
        label: FANTASY_CATEGORIES[category]?.label ?? category,
        average: average === null ? null : roundToTenth(average),
        leagueAverage: leagueAverage === null ? null : roundToTenth(leagueAverage),
        rank: better + 1,
        lowWins,
      };
    }),
  };
}

/**
 * The viewer's category profile in one league. Only an active member of the league gets a
 * profile; everyone else gets null, so the page cannot read another league's scores.
 */
export async function loadTeamCategoryProfile({
  leagueId,
  viewerUserId,
}: {
  leagueId: string;
  viewerUserId: string;
}): Promise<TeamCategoryProfile | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      categoriesJson: true,
      activeSeasonId: true,
      settings: { select: { categoryDirectionsJson: true, competitionRulesVersion: true } },
      members: { select: { id: true, userId: true, teamName: true, isActive: true, status: true } },
    },
  });
  if (!league?.settings) return null;

  const members = league.members.filter(isActivePrismaMembership);
  const viewer = members.find((member) => member.userId === viewerUserId);
  if (!viewer) return null;

  const categories = parseLeagueCategories(league.categoriesJson);
  const finalizedScores = await prisma.leagueMatchupScore.findMany({
    where: {
      leagueId,
      seasonId: activeSeasonIdOf({ id: leagueId, activeSeasonId: league.activeSeasonId }),
      status: 'FINAL',
      matchup: { fixtureVersion: league.settings.competitionRulesVersion, phase: 'REGULAR' },
    },
    select: { memberId: true, categoriesJson: true },
  });

  return buildTeamCategoryProfile({
    viewerMemberId: viewer.id,
    members,
    categories,
    categoryDirections: normalizeCategoryDirections(
      categories,
      league.settings.categoryDirectionsJson
    ),
    finalizedScores,
  });
}
