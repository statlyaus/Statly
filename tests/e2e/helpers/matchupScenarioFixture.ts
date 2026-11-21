import { PrismaClient } from '@prisma/client';

import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../../src/types/fantasyCategories';
import {
  E2E_BOT_MEMBER_ID,
  E2E_HUMAN_MEMBER_ID,
  E2E_LEAGUE_ID,
  E2E_SEASON_ID,
} from '../global.setup';

/**
 * One finished round in the e2e AFL league, so the Matchups and Standings pages show a real result
 * and ladder: the development user's team beats the bot 5–4 in round 1. Removed again by
 * `removeFinishedRound`, so other specs keep the league they expect.
 */
const MATCHUP_ID = 'e2e-brand-matchup-round-1';

export async function seedFinishedRound(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await removeRows(prisma);
    const { settings } = await prisma.league.findUniqueOrThrow({
      where: { id: E2E_LEAGUE_ID },
      select: { settings: { select: { competitionRulesVersion: true } } },
    });
    const fixtureVersion = settings.competitionRulesVersion;
    const categories = REAL_DATA_NINE_CATEGORY_PRESET.map((category, index) => ({
      category,
      homeValue: 20 + index,
      awayValue: index < 5 ? 10 + index : 30 + index,
      direction: 'HIGH_WINS',
      winner: index < 5 ? 'home' : 'away',
    }));
    await prisma.$transaction(async (tx) => {
      await tx.leagueMatchup.create({
        data: {
          id: MATCHUP_ID,
          leagueId: E2E_LEAGUE_ID,
          round: 1,
          fixtureVersion,
          homeMemberId: E2E_HUMAN_MEMBER_ID,
          awayMemberId: E2E_BOT_MEMBER_ID,
          status: 'FINAL',
          finalizedAt: new Date(),
          winnerMemberId: E2E_HUMAN_MEMBER_ID,
          homeCategoryWins: 5,
          awayCategoryWins: 4,
        },
      });
      for (const [memberId, wins, won] of [
        [E2E_HUMAN_MEMBER_ID, 5, true],
        [E2E_BOT_MEMBER_ID, 4, false],
      ] as const) {
        await tx.leagueMatchupScore.create({
          data: {
            leagueId: E2E_LEAGUE_ID,
            seasonId: E2E_SEASON_ID,
            matchupId: MATCHUP_ID,
            memberId,
            round: 1,
            categoriesJson: categories,
            categoryWins: wins,
            categoryLosses: 9 - wins,
            matchupWin: won,
            matchupLoss: !won,
            status: 'FINAL',
            finalizedAt: new Date(),
          },
        });
        await tx.leagueStanding.create({
          data: {
            leagueId: E2E_LEAGUE_ID,
            seasonId: E2E_SEASON_ID,
            memberId,
            wins: won ? 1 : 0,
            losses: won ? 0 : 1,
            categoryWins: wins,
            categoryLosses: 9 - wins,
          },
        });
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

export async function removeFinishedRound(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await removeRows(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function removeRows(prisma: PrismaClient) {
  await prisma.leagueMatchupScore.deleteMany({ where: { matchupId: MATCHUP_ID } });
  await prisma.leagueMatchup.deleteMany({ where: { id: MATCHUP_ID } });
  await prisma.leagueStanding.deleteMany({
    where: { leagueId: E2E_LEAGUE_ID, seasonId: E2E_SEASON_ID },
  });
}
