import { prisma } from '@/lib/prisma';
import { parseCategoryDirectionsJson } from '@/server/leagues/categoryDirections';
import { parseCompetitionRulesJson } from '@/server/leagues/competitionRules';
import { parseLeagueCategories } from '@/server/leagues/defaultLineups';
import { aggregateFinalizedCategoryTotals } from '@/server/leagues/matchupReadModel';
import { buildLeagueStandings } from '@/server/leagues/standingsReadModel';

import { buildStandingsHistory, type StandingsHistory } from './standingsHistory';

export interface LeagueStandingsHistory extends StandingsHistory {
  regularSeasonRounds: number;
}

/**
 * The league ladder (ordered exactly as the Overview and Matchups ladders) plus every round's
 * results, for the Standings page.
 */
export async function loadLeagueStandingsHistory(
  leagueId: string
): Promise<LeagueStandingsHistory | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });
  if (!league?.settings) return null;

  const categories = parseLeagueCategories(league.categoriesJson);
  const rules = parseCompetitionRulesJson(
    league.settings.competitionRulesJson,
    categories[0] ?? 'goals'
  );
  const categoryDirections = parseCategoryDirectionsJson(
    categories,
    league.settings.categoryDirectionsJson
  );
  const fixtureVersion = league.settings.competitionRulesVersion;

  const [members, standings, finalizedScores, matchups] = await Promise.all([
    prisma.leagueMember.findMany({
      where: { leagueId },
      select: { id: true, teamName: true, teamLogoUrl: true, draftSlot: true },
    }),
    prisma.leagueStanding.findMany({ where: { leagueId } }),
    prisma.leagueMatchupScore.findMany({
      where: {
        leagueId,
        status: 'FINAL',
        matchup: { fixtureVersion, phase: 'REGULAR' },
      },
      select: { memberId: true, categoriesJson: true },
    }),
    prisma.leagueMatchup.findMany({
      where: { leagueId, fixtureVersion },
      orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
      select: {
        round: true,
        phase: true,
        status: true,
        homeMemberId: true,
        awayMemberId: true,
        byeMemberId: true,
        homeCategoryWins: true,
        awayCategoryWins: true,
        drawnCategories: true,
        winnerMemberId: true,
      },
    }),
  ]);

  const ladder = buildLeagueStandings({
    members,
    standings,
    tieBreakCategoryTotalByMemberId: aggregateFinalizedCategoryTotals(
      finalizedScores,
      rules.standingsTieBreakCategory
    ),
    tieBreakDirection: categoryDirections[rules.standingsTieBreakCategory],
  });

  return {
    ...buildStandingsHistory({ ladder, matchups, finalsTeams: rules.finalsTeams }),
    regularSeasonRounds: rules.regularSeasonRounds,
  };
}
