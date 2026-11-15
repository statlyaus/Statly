/**
 * Bloodsucker 7/9 (#1284): the 5-minute sweep auto-executes a bite at its deadline (BR-27, BR-28),
 * waits out a round in progress (BR-29 with owner decision E8) and runs bites oldest grant first
 * (E7). Runs against PostgreSQL for the League row lock and concurrent sweeps.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const stats = vi.hoisted(() => ({ goalsByPlayerId: new Map<string, number>() }));
vi.mock('@/server/draft/readModels/draftPlayerReadModel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/draft/readModels/draftPlayerReadModel')>()),
  loadDraftPlayerStatsLookup: async () => ({
    byId: new Map([...stats.goalsByPlayerId].map(([id, goals]) => [id, { stats: { goals } }])),
    byNameAndTeam: new Map(),
    byName: new Map(),
  }),
}));
vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: class {
    projectLeague = vi.fn().mockResolvedValue({ owned: 0, available: 0 });
  },
}));
vi.mock('@/lib/data', () => ({ getPlayers: async () => [] }));

import type { LeagueBite } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { hasPendingBite } from '@/server/leagues/bitePending';
import {
  AUTO_BITE_RULE_VERSION,
  autoBite,
  sweepDueBloodsuckerBites,
} from '@/server/leagues/bloodsuckerAutoBite';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const P = 'int-auto-bite';
const LEAGUE = `${P}-league`;
const SETTINGS = `${P}-settings`;
const SEASON = `${P}-2026`;
const USERS = { owner: `${P}-u-owner`, bs: `${P}-u-bs`, victim: `${P}-u-victim` };
const OWNER = `${P}-owner`;
const BS = `${P}-bs`;
const VICTIM = `${P}-victim`;
const PLAYERS = ['v1', 'v2', 'v3', 'b1', 'b2', 'b3'].map((key) => `${P}-${key}`);
const [V1, V2, V3, B1, B2, B3] = PLAYERS as [string, string, string, string, string, string];
const HOUR = 60 * 60 * 1000;
const NOW = new Date();

// A second league whose only bite always fails, to show one league never stops another.
const BROKEN = {
  league: `${P}-broken-league`,
  settings: `${P}-broken-settings`,
  season: `${P}-broken-2026`,
};

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE, BROKEN.league],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS, BROKEN.settings],
    userIds: Object.values(USERS),
  });

async function seedBrokenLeagueBite() {
  await prisma.leagueSettings.create({
    data: {
      id: BROKEN.settings,
      rosterSize: 3,
      benchSize: 0,
      maxTeams: 3,
      pickSeconds: 60,
      draftType: 'SNAKE',
      leagueFormat: 'BLOODSUCKER',
    },
  });
  await prisma.league.create({
    data: {
      id: BROKEN.league,
      name: 'Broken bite',
      inviteCode: 'INTAUTOX',
      ownerId: USERS.owner,
      settingsId: BROKEN.settings,
      categoriesJson: ['goals'],
    },
  });
  await prisma.leagueSeason.create({
    data: { id: BROKEN.season, leagueId: BROKEN.league, label: '2026 season', year: 2026 },
  });
  await prisma.league.update({
    where: { id: BROKEN.league },
    data: { activeSeasonId: BROKEN.season },
  });
  return prisma.leagueBite.create({
    data: {
      leagueId: BROKEN.league,
      seasonId: BROKEN.season,
      roundId: `${P}-broken-round`,
      round: 1,
      matchupId: `${P}-broken-matchup`,
      bloodsuckerMemberId: `${P}-broken-bs`,
      victimMemberId: `${P}-broken-victim`,
      grantedWinnerMemberId: `${P}-broken-bs`,
      ...overdue(),
    },
  });
}

/** The real auto-bite, except that the broken league's bite throws. */
const failingBrokenLeague: typeof autoBite = (bite, scores, now) =>
  bite.leagueId === BROKEN.league
    ? Promise.reject(new Error('swap exploded'))
    : autoBite(bite, scores, now);

const rounds: Record<number, { id: string; matchupId: string }> = {};

/**
 * Round 1 and 2 are FINAL wins for the Bloodsucker over the victim. Round 3 is in progress or
 * upcoming, as the test asks.
 */
async function seed(options: { roundThree: 'IN_PROGRESS' | 'UPCOMING' }) {
  await removeFixture();
  // Victim: V2 has the most goals (taken). Bloodsucker: B2 and B3 tie lowest; B2 has the lower id.
  stats.goalsByPlayerId = new Map([
    [V1, 20],
    [V2, 40],
    [V3, 10],
    [B1, 30],
    [B2, 5],
    [B3, 5],
  ]);
  await prisma.user.createMany({
    data: Object.values(USERS).map((id) => ({
      id,
      email: `${id}@statly.local`,
      passwordHash: 'x',
      displayName: id,
    })),
  });
  await prisma.player.createMany({
    data: PLAYERS.map((id) => ({ id, name: id, club: 'GWS', position: 'MID' })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 3,
      benchSize: 0,
      maxTeams: 3,
      pickSeconds: 60,
      draftType: 'SNAKE',
      waiverRule: 'ROLLING',
      competitionRulesVersion: 1,
      competitionStatus: 'ACTIVE',
      leagueFormat: 'BLOODSUCKER',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Auto bite',
      inviteCode: 'INTAUTOB',
      ownerId: USERS.owner,
      settingsId: SETTINGS,
      categoriesJson: ['goals'],
    },
  });
  await prisma.leagueSeason.create({
    data: { id: SEASON, leagueId: LEAGUE, label: '2026 season', year: 2026 },
  });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON } });
  await prisma.leagueMember.createMany({
    data: [
      { id: OWNER, leagueId: LEAGUE, userId: USERS.owner, role: 'OWNER', teamName: 'Owners' },
      { id: BS, leagueId: LEAGUE, userId: USERS.bs, role: 'MANAGER', teamName: 'Suckers' },
      { id: VICTIM, leagueId: LEAGUE, userId: USERS.victim, role: 'MANAGER', teamName: 'Victims' },
    ],
  });
  await prisma.leagueSettings.update({
    where: { id: SETTINGS },
    data: { bloodsuckerMemberId: BS },
  });
  await prisma.leagueRosterPlayer.createMany({
    data: [
      ...[V1, V2, V3].map((playerId) => ({ leagueId: LEAGUE, memberId: VICTIM, playerId })),
      ...[B1, B2, B3].map((playerId) => ({ leagueId: LEAGUE, memberId: BS, playerId })),
    ],
  });
  for (const round of [1, 2]) {
    const row = await prisma.leagueCompetitionRound.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        fixtureVersion: 1,
        round,
        status: 'FINAL',
        startsAt: new Date(NOW.getTime() - (200 - round * 50) * HOUR),
        endsAt: new Date(NOW.getTime() - (150 - round * 50) * HOUR),
      },
    });
    const matchup = await prisma.leagueMatchup.create({
      data: {
        leagueId: LEAGUE,
        round,
        fixtureVersion: 1,
        competitionRoundId: row.id,
        homeMemberId: BS,
        awayMemberId: VICTIM,
        status: 'FINAL',
        winnerMemberId: BS,
        homeCategoryWins: 5,
        awayCategoryWins: 4,
      },
    });
    rounds[round] = { id: row.id, matchupId: matchup.id };
  }
  const inProgress = options.roundThree === 'IN_PROGRESS';
  await prisma.leagueCompetitionRound.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      fixtureVersion: 1,
      round: 3,
      startsAt: new Date(NOW.getTime() + (inProgress ? -2 : 48) * HOUR),
      endsAt: new Date(NOW.getTime() + (inProgress ? 24 : 120) * HOUR),
    },
  });
}

function grant(round: 1 | 2, input: { opensAt: Date; deadlineAt: Date }) {
  return prisma.leagueBite.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      roundId: rounds[round]!.id,
      round,
      matchupId: rounds[round]!.matchupId,
      bloodsuckerMemberId: BS,
      victimMemberId: VICTIM,
      grantedWinnerMemberId: BS,
      ...input,
    },
  });
}

const overdue = () => ({
  opensAt: new Date(NOW.getTime() - 49 * HOUR),
  deadlineAt: new Date(NOW.getTime() - 60_000),
});

const ownerOf = async (playerId: string) =>
  (await prisma.leagueRosterPlayer.findFirst({ where: { leagueId: LEAGUE, playerId } }))?.memberId;

const auditRows = (eventType: 'BITE_AUTO' | 'BITE_WAITING_LOCK') =>
  prisma.leagueCompetitionAudit.findMany({
    where: { leagueId: LEAGUE, eventType },
    orderBy: { createdAt: 'asc' },
  });

const reload = (bite: LeagueBite) =>
  prisma.leagueBite.findUniqueOrThrow({ where: { id: bite.id } });

describe.sequential('Bloodsucker auto-bite sweep', () => {
  afterAll(removeFixture);

  describe('with no round in progress', () => {
    beforeEach(() => seed({ roundThree: 'UPCOMING' }));

    it('auto-executes an overdue bite by BR-28 and audits the system as the actor', async () => {
      const bite = await grant(1, overdue());

      const run = await sweepDueBloodsuckerBites(NOW);

      expect(run).toMatchObject({ autoExecutedBiteIds: [bite.id], failedLeagueIds: [] });
      expect(await ownerOf(V2)).toBe(BS);
      expect(await ownerOf(B2)).toBe(VICTIM);
      const stored = await reload(bite);
      expect(stored).toMatchObject({
        status: 'AUTO_EXECUTED',
        takenPlayerId: V2,
        returnedPlayerId: B2,
        executedByUserId: null,
        autoBiteRuleVersion: AUTO_BITE_RULE_VERSION,
      });
      expect(stored.executedAt).toEqual(NOW);
      const [audit, ...rest] = await auditRows('BITE_AUTO');
      expect(rest).toHaveLength(0);
      expect(audit).toMatchObject({ actorMemberId: null });
      expect(audit?.payloadJson).toMatchObject({
        biteId: bite.id,
        actor: 'system',
        reason: 'DEADLINE',
        takenPlayerId: V2,
        returnedPlayerId: B2,
      });
    });

    it('stores a snapshot from which the pick can be reproduced', async () => {
      const bite = await grant(1, overdue());

      await sweepDueBloodsuckerBites(NOW);

      const snapshot = (await reload(bite)).autoBiteSnapshotJson as {
        ruleVersion: number;
        computedAt: string;
        categories: string[];
        victim: Array<{ playerId: string; z: number | null }>;
        bloodsucker: Array<{ playerId: string; z: number | null }>;
      };
      expect(snapshot).toMatchObject({
        ruleVersion: AUTO_BITE_RULE_VERSION,
        computedAt: NOW.toISOString(),
        categories: ['goals'],
      });
      // Victim ranked best first, Bloodsucker worst first; the first of each is the pair.
      expect(snapshot.victim.map((row) => row.playerId)).toEqual([V2, V1, V3]);
      expect(snapshot.bloodsucker.map((row) => row.playerId)).toEqual([B2, B3, B1]);
      expect(snapshot.victim.every((row) => typeof row.z === 'number')).toBe(true);
    });

    it('executes one bite once when two sweeps run at the same time', async () => {
      const bite = await grant(1, overdue());

      const runs = await Promise.all([
        sweepDueBloodsuckerBites(NOW),
        sweepDueBloodsuckerBites(NOW),
      ]);

      expect(runs.flatMap((run) => run.autoExecutedBiteIds)).toEqual([bite.id]);
      expect(runs.flatMap((run) => run.failedLeagueIds)).toEqual([]);
      expect(await auditRows('BITE_AUTO')).toHaveLength(1);
      expect(await prisma.leagueRosterPlayer.count({ where: { leagueId: LEAGUE } })).toBe(6);
      expect(await ownerOf(V2)).toBe(BS);
    });

    it('leaves a bite before its deadline to the Bloodsucker', async () => {
      const bite = await grant(1, {
        opensAt: new Date(NOW.getTime() - HOUR),
        deadlineAt: new Date(NOW.getTime() + HOUR),
      });

      const run = await sweepDueBloodsuckerBites(NOW);

      expect(run.autoExecutedBiteIds).toEqual([]);
      expect(await reload(bite)).toMatchObject({ status: 'OPEN', version: 1 });
    });

    it('runs two overdue bites oldest grant first, each on the roster the first left (E7)', async () => {
      const older = await grant(1, overdue());
      const newer = await grant(2, {
        opensAt: new Date(NOW.getTime() - 30 * HOUR),
        deadlineAt: new Date(NOW.getTime() - 60_000),
      });

      const run = await sweepDueBloodsuckerBites(NOW);

      expect(run.autoExecutedBiteIds).toEqual([older.id, newer.id]);
      // First bite: V2 for B2. Second: the victim's best is now V1 (B2 scores 5); the Bloodsucker's
      // worst is B3 (tied 5 with nothing lower left).
      expect(await reload(older)).toMatchObject({ takenPlayerId: V2, returnedPlayerId: B2 });
      expect(await reload(newer)).toMatchObject({ takenPlayerId: V1, returnedPlayerId: B3 });
    });

    it('never expires a right: weeks past its deadline it still runs (BR-20)', async () => {
      const bite = await grant(1, {
        opensAt: new Date(NOW.getTime() - 40 * 24 * HOUR),
        deadlineAt: new Date(NOW.getTime() - 38 * 24 * HOUR),
      });

      const run = await sweepDueBloodsuckerBites(NOW);

      expect(run.autoExecutedBiteIds).toEqual([bite.id]);
      expect(await reload(bite)).toMatchObject({ status: 'AUTO_EXECUTED' });
    });

    it('ends a bite as CANCELLED / NO_PAIR when the Bloodsucker has no player to send back, audited, without failing the run (#1343)', async () => {
      const bite = await grant(1, overdue());
      await prisma.leagueRosterPlayer.deleteMany({ where: { leagueId: LEAGUE, memberId: BS } });

      const run = await sweepDueBloodsuckerBites(NOW);
      const again = await sweepDueBloodsuckerBites(new Date(NOW.getTime() + 5 * 60_000));

      expect(run).toMatchObject({
        unpairableBiteIds: [bite.id],
        autoExecutedBiteIds: [],
        failedLeagueIds: [],
      });
      expect(again).toMatchObject({ unpairableBiteIds: [], failedLeagueIds: [] });
      expect(await reload(bite)).toMatchObject({
        status: 'CANCELLED',
        cancelledBy: 'NO_PAIR',
        takenPlayerId: null,
      });
      expect(await ownerOf(V2)).toBe(VICTIM);
      const audits = await prisma.leagueCompetitionAudit.findMany({
        where: { leagueId: LEAGUE, eventType: 'BITE_CANCELLED' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorMemberId: null });
      expect(audits[0]?.payloadJson).toMatchObject({
        biteId: bite.id,
        actor: 'system',
        reason: 'NO_PAIR',
        rostersBefore: { bloodsucker: [] },
      });
      // The victim is no longer frozen (BR-30).
      await expect(hasPendingBite(prisma, LEAGUE, VICTIM)).resolves.toBe(false);
      const messages = await prisma.socialMessage.findMany({ where: { leagueId: LEAGUE } });
      expect(messages.map((message) => message.content)).toEqual([
        "The Bloodsucker's round 1 bite on Victims ended unused: a roster was empty at the deadline, so there was no player to swap.",
      ]);
    });

    it("keeps sweeping other leagues when one league's bite fails, alerts for it once, then only counts it (#1343)", async () => {
      const good = await grant(1, overdue());
      const broken = await seedBrokenLeagueBite();

      const first = await sweepDueBloodsuckerBites(NOW, failingBrokenLeague);

      expect(first).toMatchObject({
        autoExecutedBiteIds: [good.id],
        failedLeagueIds: [BROKEN.league],
        knownFailingBiteIds: [],
      });
      expect(await reload(broken)).toMatchObject({
        status: 'OPEN',
        failureCount: 1,
        lastFailureReason: 'swap exploded',
        failureAlertedAt: NOW,
        lastFailureAt: NOW,
      });

      const later = new Date(NOW.getTime() + 5 * 60_000);
      const second = await sweepDueBloodsuckerBites(later, failingBrokenLeague);

      // The run is green again: the stuck bite is listed, not failed, so a new failure elsewhere shows.
      expect(second).toMatchObject({ failedLeagueIds: [], knownFailingBiteIds: [broken.id] });
      expect(await reload(broken)).toMatchObject({
        failureCount: 2,
        failureAlertedAt: NOW,
        lastFailureAt: later,
      });
    });

    it('leaves a bite of a season that is not the active one alone', async () => {
      await prisma.leagueSeason.create({
        data: { id: `${SEASON}-old`, leagueId: LEAGUE, label: '2025 season', year: 2025 },
      });
      const old = await prisma.leagueBite.create({
        data: {
          leagueId: LEAGUE,
          seasonId: `${SEASON}-old`,
          roundId: `${P}-old-round`,
          round: 1,
          matchupId: rounds[1]!.matchupId,
          bloodsuckerMemberId: BS,
          victimMemberId: VICTIM,
          grantedWinnerMemberId: BS,
          ...overdue(),
          opensAt: new Date(NOW.getTime() - 400 * 24 * HOUR),
        },
      });
      const current = await grant(1, overdue());

      const run = await sweepDueBloodsuckerBites(NOW);

      // The old-season bite neither runs nor holds the current one up as an "earlier" bite.
      expect(run.autoExecutedBiteIds).toEqual([current.id]);
      expect(await reload(old)).toMatchObject({ status: 'OPEN', takenPlayerId: null });
      await expect(hasPendingBite(prisma, LEAGUE, VICTIM)).resolves.toBe(false);
    });

    it('alerts once when a bite is still suspended two hours past its deadline (#1343)', async () => {
      const bite = await grant(1, {
        opensAt: new Date(NOW.getTime() - 60 * HOUR),
        deadlineAt: new Date(NOW.getTime() - 3 * HOUR),
      });
      await prisma.leagueMatchup.update({
        where: { id: rounds[1]!.matchupId },
        data: { status: 'LIVE' },
      });

      const first = await sweepDueBloodsuckerBites(NOW);
      const second = await sweepDueBloodsuckerBites(new Date(NOW.getTime() + 5 * 60_000));

      expect(first).toMatchObject({ failedLeagueIds: [LEAGUE], knownFailingBiteIds: [] });
      expect(second).toMatchObject({ failedLeagueIds: [], knownFailingBiteIds: [bite.id] });
      expect(await reload(bite)).toMatchObject({
        status: 'OPEN',
        failureCount: 2,
        lastFailureReason: expect.stringContaining('BITE_SUSPENDED'),
      });

      // Once the matchup is FINAL again the bite runs.
      await prisma.leagueMatchup.update({
        where: { id: rounds[1]!.matchupId },
        data: { status: 'FINAL' },
      });
      const third = await sweepDueBloodsuckerBites(new Date(NOW.getTime() + 10 * 60_000));
      expect(third.autoExecutedBiteIds).toEqual([bite.id]);
    });

    it('waits while the matchup is being re-scored (E5)', async () => {
      const bite = await grant(1, overdue());
      await prisma.leagueMatchup.update({
        where: { id: rounds[1]!.matchupId },
        data: { status: 'LIVE' },
      });

      const run = await sweepDueBloodsuckerBites(NOW);

      expect(run).toMatchObject({ autoExecutedBiteIds: [], failedLeagueIds: [] });
      expect(await reload(bite)).toMatchObject({ status: 'OPEN' });
    });
  });

  describe('with a round in progress', () => {
    beforeEach(() => seed({ roundThree: 'IN_PROGRESS' }));

    it('marks the bite WAITING_LOCK once, then runs it at the first sweep after the round ends', async () => {
      const bite = await grant(2, overdue());

      const first = await sweepDueBloodsuckerBites(NOW);
      const second = await sweepDueBloodsuckerBites(new Date(NOW.getTime() + 5 * 60_000));

      expect(first).toMatchObject({ waitingLockBiteIds: [bite.id], autoExecutedBiteIds: [] });
      expect(second).toMatchObject({ waitingLockBiteIds: [], autoExecutedBiteIds: [] });
      expect(await reload(bite)).toMatchObject({ status: 'WAITING_LOCK', takenPlayerId: null });
      expect(await auditRows('BITE_WAITING_LOCK')).toHaveLength(1);
      expect(await ownerOf(V2)).toBe(VICTIM);

      const afterRound = new Date(NOW.getTime() + 25 * HOUR);
      const third = await sweepDueBloodsuckerBites(afterRound);

      expect(third.autoExecutedBiteIds).toEqual([bite.id]);
      expect(await reload(bite)).toMatchObject({
        status: 'AUTO_EXECUTED',
        takenPlayerId: V2,
        returnedPlayerId: B2,
      });
      const [audit] = await auditRows('BITE_AUTO');
      expect(audit?.payloadJson).toMatchObject({ actor: 'system', reason: 'LOCK_RELEASED' });
    });
  });
});
