/**
 * Bloodsucker 9/9 (#1286; BR-04b, US-2 AC1, AC1b): the lobby draw commits the winner and the audit
 * (method and candidates) before any client sees it, every reader gets the same committed winner,
 * and a draw can never be repeated.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { prisma } from '@/lib/prisma';
import {
  BloodsuckerDrawError,
  drawBloodsucker,
  loadBloodsuckerLobbyState,
} from '@/server/leagues/bloodsuckerDraw';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const P = 'int-bs-draw';
const LEAGUE = `${P}-league`;
const SETTINGS = `${P}-settings`;
const USERS = [`${P}-u-owner`, `${P}-u-a`, `${P}-u-b`];
const [OWNER_USER, A_USER, B_USER] = USERS as [string, string, string];
const MEMBERS = [`${P}-m-owner`, `${P}-m-a`, `${P}-m-b`];
const [OWNER, A, B] = MEMBERS as [string, string, string];

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [],
    settingsIds: [SETTINGS],
    userIds: USERS,
  });

async function seed(options: { draftStatus?: 'SCHEDULED' | 'LIVE' } = {}) {
  await removeFixture();
  await prisma.user.createMany({
    data: USERS.map((id) => ({ id, email: `${id}@statly.local`, passwordHash: 'x', displayName: id })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 2,
      benchSize: 0,
      maxTeams: 8,
      pickSeconds: 60,
      draftType: 'SNAKE',
      waiverRule: 'ROLLING',
      leagueFormat: 'BLOODSUCKER',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Draw',
      inviteCode: 'INTBSDRW',
      ownerId: OWNER_USER,
      settingsId: SETTINGS,
      categoriesJson: ['goals'],
    },
  });
  await prisma.leagueMember.createMany({
    data: [
      { id: OWNER, leagueId: LEAGUE, userId: OWNER_USER, role: 'OWNER', teamName: 'Owners' },
      { id: A, leagueId: LEAGUE, userId: A_USER, role: 'MANAGER', teamName: 'Alphas' },
      { id: B, leagueId: LEAGUE, userId: B_USER, role: 'MANAGER', teamName: 'Betas' },
    ],
  });
  await prisma.draft.create({
    data: { leagueId: LEAGUE, status: options.draftStatus ?? 'SCHEDULED', totalPicks: 4 },
  });
}

async function drawAudits() {
  return prisma.leagueCompetitionAudit.findMany({
    where: { leagueId: LEAGUE, eventType: 'LEAGUE_FORMAT_CHANGED' },
    orderBy: { createdAt: 'asc' },
  });
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BloodsuckerDrawError);
  return error as BloodsuckerDrawError;
}

beforeEach(() => seed());
afterAll(async () => {
  await removeFixture();
  await prisma.$disconnect();
});

describe('drawBloodsucker (BR-04b)', () => {
  it('commits the winner and the audit with the method and every candidate', async () => {
    const state = await drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER, pickIndex: () => 0 });

    const settings = await prisma.leagueSettings.findUniqueOrThrow({ where: { id: SETTINGS } });
    expect(settings.bloodsuckerMemberId).toBe(A);
    expect(state.bloodsucker).toEqual({ memberId: A, teamName: 'Alphas' });
    expect(state.method).toBe('DRAW');
    expect(state.canDraw).toBe(false);

    const [audit] = await drawAudits();
    expect(audit?.actorMemberId).toBe(OWNER);
    expect(audit?.payloadJson).toMatchObject({
      reason: 'BLOODSUCKER_DRAWN',
      method: 'DRAW',
      winnerMemberId: A,
      candidates: [
        { memberId: A, teamName: 'Alphas' },
        { memberId: B, teamName: 'Betas' },
        { memberId: OWNER, teamName: 'Owners' },
      ],
      before: { bloodsuckerMemberId: null },
      after: { bloodsuckerMemberId: A },
    });
  });

  it('gives every member the same committed draw, and a re-read never draws again', async () => {
    const drawn = await drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER, pickIndex: () => 2 });
    const [forA, forB, again] = await Promise.all([
      loadBloodsuckerLobbyState({ leagueId: LEAGUE, userId: A_USER }),
      loadBloodsuckerLobbyState({ leagueId: LEAGUE, userId: B_USER }),
      loadBloodsuckerLobbyState({ leagueId: LEAGUE, userId: OWNER_USER }),
    ]);

    for (const state of [forA, forB, again]) {
      expect(state.draw).toEqual(drawn.draw);
      expect(state.bloodsucker?.memberId).toBe(drawn.draw?.winnerMemberId);
    }
    expect(forA.canDraw).toBe(false);
    expect(await drawAudits()).toHaveLength(1);
  });

  it('refuses a second draw, even after the commissioner chooses another member', async () => {
    await drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER, pickIndex: () => 0 });
    expect((await refusal(drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER }))).code).toBe(
      'BLOODSUCKER_ALREADY_DRAWN'
    );

    // Clearing the setting is not a way to re-roll while the drawn winner is still in the league.
    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { bloodsuckerMemberId: null },
    });
    expect((await refusal(drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER }))).code).toBe(
      'BLOODSUCKER_ALREADY_DRAWN'
    );
  });

  it('runs once when two draws race', async () => {
    const results = await Promise.allSettled([
      drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER }),
      drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await drawAudits()).toHaveLength(1);
  });

  it('allows a new draw once the drawn Bloodsucker has left (BR-07)', async () => {
    await drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER, pickIndex: () => 0 });
    await prisma.leagueMember.update({ where: { id: A }, data: { isActive: false } });
    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { bloodsuckerMemberId: null },
    });

    const state = await drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER, pickIndex: () => 0 });
    expect(state.bloodsucker?.memberId).toBe(B);
    expect(state.draw?.candidates.map((candidate) => candidate.memberId)).toEqual([B, OWNER]);
  });

  it('refuses a manager, a chosen Bloodsucker and a started draft', async () => {
    expect((await refusal(drawBloodsucker({ leagueId: LEAGUE, userId: A_USER }))).code).toBe(
      'FORBIDDEN'
    );

    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { bloodsuckerMemberId: B },
    });
    expect((await refusal(drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER }))).code).toBe(
      'BLOODSUCKER_ALREADY_SET'
    );

    await seed({ draftStatus: 'LIVE' });
    expect((await refusal(drawBloodsucker({ leagueId: LEAGUE, userId: OWNER_USER }))).code).toBe(
      'DRAFT_STRUCTURE_LOCKED'
    );
    expect(await drawAudits()).toHaveLength(0);
  });

  it('tells a manager who the Bloodsucker is but offers no draw button', async () => {
    const state = await loadBloodsuckerLobbyState({ leagueId: LEAGUE, userId: A_USER });
    expect(state).toMatchObject({ canManage: false, canDraw: false, draw: null, bloodsucker: null });

    const owner = await loadBloodsuckerLobbyState({ leagueId: LEAGUE, userId: OWNER_USER });
    expect(owner).toMatchObject({ canManage: true, canDraw: true, drawBlockedReason: null });
  });
});
