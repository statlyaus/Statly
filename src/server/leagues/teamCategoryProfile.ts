import { prisma } from '@/lib/prisma';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';

import { isActivePrismaMembership } from './membership';
import { parseCategoryDirectionsJson } from './categoryDirections';
import { parseLeagueCategories } from './defaultLineups';
import { parseStoredCategoryRows } from './matchupReadModel';
import type { CategoryDirection } from './scoringTypes';

export interface TeamCategoryStanding {
  key: FantasyCategoryKey;
  label: string;
  /** The viewer's per-round average across finalized regular-season rounds. */
  average: number;
  leagueAverage: number;
  /** 1 is best in the league, honouring low-wins categories. */
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
  finalizedScores: ReadonlyArray<{ memberId: string; categoriesJson: string | null }>;
}

const roundToTenth = (value: number) => Math.round(value * 10) / 10;

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

  const averagesFor = (category: FantasyCategoryKey) =>
    [...roundsByMember.entries()].map(([memberId, rounds]) => ({
      memberId,
      average: (totalsByMember.get(memberId)?.get(category) ?? 0) / rounds,
    }));

  return {
    ...base,
    categories: input.categories.map((category) => {
      const lowWins = input.categoryDirections[category] === 'LOW_WINS';
      const averages = averagesFor(category);
      const average = averages.find((entry) => entry.memberId === viewer.id)?.average ?? 0;
      const better = averages.filter((entry) =>
        lowWins ? entry.average < average : entry.average > average
      ).length;
      return {
        key: category,
        label: FANTASY_CATEGORIES[category]?.label ?? category,
        average: roundToTenth(average),
        leagueAverage: roundToTenth(
          averages.reduce((sum, entry) => sum + entry.average, 0) / averages.length
        ),
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
      status: 'FINAL',
      matchup: { fixtureVersion: league.settings.competitionRulesVersion, phase: 'REGULAR' },
    },
    select: { memberId: true, categoriesJson: true },
  });

  return buildTeamCategoryProfile({
    viewerMemberId: viewer.id,
    members,
    categories,
    categoryDirections: parseCategoryDirectionsJson(
      categories,
      league.settings.categoryDirectionsJson
    ),
    finalizedScores,
  });
}
