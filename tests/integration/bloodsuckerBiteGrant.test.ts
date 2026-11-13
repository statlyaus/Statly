/**
 * Bloodsucker 6/9 (#1283): a bite right is granted, cancelled, reactivated or noted inside the
 * scoring transaction that writes the matchup's result (BR-17 to BR-19, BR-27, BR-33, E4). Runs
 * against PostgreSQL because idempotency rests on the (roundId, matchupId) unique key.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const provider = vi.hoisted(() => ({ goals: [0, 0], status: 'final' }));
vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundMatches: vi.fn().mockResolvedValue([]),
  getRoundMatchesResult: vi.fn(() =>
    Promise.resolve({
      ok: true,
      matches: [
        { match_uid: 'afl-1', status: provider.status, home_team: 'GWS', away_team: 'Geelong' },
      ],
    })
  ),
  getRoundPlayerStatsResult: vi.fn(() =>
    Promise.resolve({
      ok: true,
      stats: PLAYERS.map((playerId, index) => ({
        player_uid: playerId,
        round_number: 5,
        status: provider.status,
        stats: { minutes: 80, goals: provider.goals[index] },
      })),
    })
  ),
}));

import type { LeagueScoringMode } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { recalculateLeagueRoundMatchups } from '@/server/leagues/matchupReadModel';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-bite-grant-league';
const SETTINGS = 'int-bite-grant-settings';
const USERS = ['int-bite-grant-u1', 'int-bite-grant-u2'];
const SEASON = 'int-bite-grant-2026';
// MEMBERS[0] is the Bloodsucker, MEMBERS[1] its opponent.
const MEMBERS = ['int-bite-grant-bs', 'int-bite-grant-victim'];
const [BLOODSUCKER, VICTIM] = MEMBERS as [string, string];
const PLAYERS = ['int-bite-grant-p1', 'int-bite-grant-p2'];
const ROUND = 1;
const HOUR = 60 * 60 * 1000;

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: USERS,
  });

async function seedLeague(options: {
  scoringMode?: LeagueScoringMode;
  phase?: 'REGULAR' | 'FINALS';
  nextRoundStartsAt?: Date | null;
}) {
  await removeFixture();
  for (const id of USERS) {
    await prisma.user.create({
      data: { id, email: `${id}@statly.local`, passwordHash: 'x', displayName: id },
    });
  }
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 1,
      benchSize: 0,
      maxTeams: 2,
      pickSeconds: 120,
      draftType: 'SNAKE',
      waiverRule: 'ROLLING',
      competitionRulesVersion: 1,
      competitionStatus: 'ACTIVE',
      leagueFormat: 'BLOODSUCKER',
      scoringMode: options.scoringMode ?? 'H2H_EACH_CATEGORY',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Bite grant',
      inviteCode: 'INTBITEG',
      ownerId: USERS[0]!,
      settingsId: SETTINGS,
      categoriesJson: ['goals'],
    },
  });
  await prisma.leagueSeason.create({
    data: { id: SEASON, leagueId: LEAGUE, label: '2026 season', year: 2026 },
  });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON } });
  for (const [index, id] of MEMBERS.entries()) {
    await prisma.leagueMember.create({
      data: {
        id,
        leagueId: LEAGUE,
        userId: USERS[index]!,
        role: index === 0 ? 'OWNER' : 'MANAGER',
        teamName: id,
      },
    });
    await prisma.player.create({
      data: { id: PLAYERS[index]!, name: PLAYERS[index]!, club: 'GWS', position: 'MID' },
    });
    await prisma.leagueLineup.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        memberId: id,
        round: ROUND,
        players: { create: { playerId: PLAYERS[index]!, slot: 'MID', slotIndex: 0 } },
      },
    });
  }
  await prisma.leagueSettings.update({
    where: { id: SETTINGS },
    data: { bloodsuckerMemberId: BLOODSUCKER },
  });
  const phase = options.phase ?? 'REGULAR';
  const competitionRound = await prisma.leagueCompetitionRound.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      fixtureVersion: 1,
      round: ROUND,
      aflRound: 5,
      phase,
      status: 'LOCKED',
      publishedAt: new Date('2026-02-01T00:00:00.000Z'),
    },
  });
  if (options.nextRoundStartsAt !== undefined) {
    await prisma.leagueCompetitionRound.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        fixtureVersion: 1,
        round: ROUND + 1,
        aflRound: 6,
        startsAt: options.nextRoundStartsAt,
        publishedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
  }
  const matchup = await prisma.leagueMatchup.create({
    data: {
      leagueId: LEAGUE,
      round: ROUND,
      fixtureVersion: 1,
      phase,
      competitionRoundId: competitionRound.id,
      homeMemberId: BLOODSUCKER,
      awayMemberId: VICTIM,
    },
  });
  return { matchupId: matchup.id, roundId: competitionRound.id };
}

const score = (actorMemberId?: string) =>
  recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round: ROUND, actorMemberId });
const bites = () => prisma.leagueBite.findMany({ where: { leagueId: LEAGUE } });
const biteAudits = () =>
  prisma.leagueCompetitionAudit.findMany({
    where: {
      leagueId: LEAGUE,
      eventType: { in: ['BITE_GRANTED', 'BITE_CANCELLED', 'BITE_RESULT_CHANGED'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { eventType: true, actorMemberId: true, payloadJson: true },
  });

describe.sequential('Bloodsucker bite grant on FINAL', () => {
  beforeEach(() => {
    provider.status = 'final';
  });
  afterAll(removeFixture);

  it.each(['H2H_EACH_CATEGORY', 'H2H_MOST_CATEGORIES'] as const)(
    'grants exactly one bite for a win in %s, and re-running FINAL grants no duplicate',
    async (scoringMode) => {
      const { matchupId, roundId } = await seedLeague({ scoringMode, nextRoundStartsAt: null });
      provider.goals = [3, 1];

      const before = Date.now();
      await expect(score()).resolves.toMatchObject({ status: 'FINAL' });
      await score();

      const rows = await bites();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        roundId,
        matchupId,
        seasonId: SEASON,
        round: ROUND,
        bloodsuckerMemberId: BLOODSUCKER,
        victimMemberId: VICTIM,
        grantedWinnerMemberId: BLOODSUCKER,
        grantedScoreVersion: 1,
        status: 'OPEN',
      });
      // No next regular round: the deadline is 48 hours after the grant.
      const deadlineAfterGrant = rows[0]!.deadlineAt.getTime() - rows[0]!.opensAt.getTime();
      expect(deadlineAfterGrant).toBe(48 * HOUR);
      expect(rows[0]!.opensAt.getTime()).toBeGreaterThanOrEqual(before);
      const audits = await biteAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        eventType: 'BITE_GRANTED',
        actorMemberId: null,
        payloadJson: { biteId: rows[0]!.id, reason: 'FINAL', actor: 'system', matchupId },
      });
    }
  );

  it('sets the deadline 2 hours before the next regular round when that is sooner', async () => {
    const nextRoundStartsAt = new Date(Date.now() + 30 * HOUR);
    await seedLeague({ nextRoundStartsAt });
    provider.goals = [3, 1];

    await score();

    const [bite] = await bites();
    expect(bite!.deadlineAt).toEqual(new Date(nextRoundStartsAt.getTime() - 2 * HOUR));
  });

  it('grants nothing for a draw, a loss, a round that is not final, or a finals win', async () => {
    await seedLeague({});
    provider.goals = [2, 2];
    await score();
    provider.goals = [1, 2];
    await score();
    expect(await bites()).toEqual([]);

    await seedLeague({});
    provider.status = 'live';
    provider.goals = [3, 1];
    await score();
    expect(await bites()).toEqual([]);

    await seedLeague({ phase: 'FINALS' });
    provider.status = 'final';
    await score();
    expect(await bites()).toEqual([]);
  });

  it('cancels an open bite when a re-score loses the win, and win-loss-win reactivates the same row', async () => {
    await seedLeague({});
    provider.goals = [3, 1];
    await score();
    const [granted] = await bites();

    provider.goals = [1, 3];
    await score(BLOODSUCKER);
    expect(await bites()).toEqual([
      expect.objectContaining({
        id: granted!.id,
        status: 'CANCELLED',
        cancelledBy: 'RESULT_CHANGED',
      }),
    ]);

    provider.goals = [3, 1];
    await score();
    const [reactivated] = await bites();
    expect(reactivated).toMatchObject({
      id: granted!.id,
      status: 'OPEN',
      grantedScoreVersion: 2,
      cancelledBy: null,
    });
    expect((await biteAudits()).map((row) => row.eventType)).toEqual([
      'BITE_GRANTED',
      'BITE_CANCELLED',
      'BITE_GRANTED',
    ]);
    const audits = await biteAudits();
    expect(audits[1]).toMatchObject({
      actorMemberId: BLOODSUCKER,
      payloadJson: {
        reason: 'RESULT_CHANGED',
        result: { before: { winnerMemberId: BLOODSUCKER }, after: { winnerMemberId: VICTIM } },
      },
    });
    expect(audits[2]).toMatchObject({ payloadJson: { reason: 'GRANTED_ON_RESCORE' } });
  });

  it('grants on a re-score that turns a loss into a win', async () => {
    await seedLeague({});
    provider.goals = [1, 3];
    await score();
    expect(await bites()).toEqual([]);

    provider.goals = [3, 1];
    await score();

    expect(await bites()).toEqual([expect.objectContaining({ status: 'OPEN' })]);
    expect((await biteAudits())[0]).toMatchObject({
      payloadJson: { reason: 'GRANTED_ON_RESCORE' },
    });
  });

  it('keeps an executed bite when a re-score flips the result, and records the change', async () => {
    await seedLeague({});
    provider.goals = [3, 1];
    await score();
    const [granted] = await bites();
    await prisma.leagueBite.update({
      where: { id: granted!.id },
      data: { status: 'EXECUTED', takenPlayerId: PLAYERS[1], returnedPlayerId: PLAYERS[0] },
    });

    provider.goals = [1, 3];
    await score();
    provider.goals = [3, 1];
    await score();

    expect(await bites()).toEqual([
      expect.objectContaining({ id: granted!.id, status: 'EXECUTED', grantedScoreVersion: 1 }),
    ]);
    expect((await biteAudits()).map((row) => row.eventType)).toEqual([
      'BITE_GRANTED',
      'BITE_RESULT_CHANGED',
    ]);
  });
});
