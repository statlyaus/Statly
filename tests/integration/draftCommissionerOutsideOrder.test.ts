/**
 * A commissioner outside the draft order (#1279: the Bloodsucker never picks, yet may run the league)
 * still manages the draft. Rights come from league ownership or co-commissioner status, not the order.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '@/lib/prisma';
import { DraftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftProjectionService } from '@/server/draft/services/DraftProjectionService';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';
import { activateLeagueSeason } from './helpers/leagueSeason';

const LEAGUE = 'int-commish-league';
const SETTINGS = 'int-commish-settings';
const DRAFT = 'int-commish-draft';
const COMMISH = 'int-commish-owner';
const MANAGERS = ['int-commish-manager-1', 'int-commish-manager-2'];

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [],
    settingsIds: [SETTINGS],
    userIds: [COMMISH, ...MANAGERS],
  });

async function seedFixture() {
  for (const id of [COMMISH, ...MANAGERS]) {
    await prisma.user.create({
      data: { id, email: `${id}@statly.local`, passwordHash: 'x', displayName: id },
    });
  }
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 18,
      benchSize: 4,
      maxTeams: 8,
      pickSeconds: 120,
      allowAutoPick: true,
      draftType: 'SNAKE',
      pickOrder: 'RANDOM',
      waiverRule: 'ROLLING',
      startAt: new Date(Date.now() - 60_000),
      timeZone: 'Australia/Melbourne',
      locked: true,
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Commish',
      inviteCode: 'INTCOMM',
      ownerId: COMMISH,
      settingsId: SETTINGS,
    },
  });
  await activateLeagueSeason(prisma, LEAGUE);
  await prisma.leagueMember.create({
    data: {
      id: `${COMMISH}-member`,
      leagueId: LEAGUE,
      userId: COMMISH,
      role: 'OWNER',
      teamName: 'Bloodsucker',
    },
  });
  for (const [index, userId] of MANAGERS.entries()) {
    await prisma.leagueMember.create({
      data: {
        id: `${userId}-member`,
        leagueId: LEAGUE,
        userId,
        role: 'MANAGER',
        teamName: `Team ${index + 1}`,
        draftSlot: index + 1,
      },
    });
  }
  const now = Date.now();
  await prisma.draft.create({
    data: {
      id: DRAFT,
      leagueId: LEAGUE,
      status: 'LIVE',
      lobbyStatus: 'LIVE',
      currentPick: 1,
      totalPicks: 36,
      round: 1,
      direction: 'FORWARD',
      startedAt: new Date(now - 30_000),
      pickStartedAt: new Date(now - 30_000),
      pickDeadlineAt: new Date(now + 90_000),
      clockDurationSeconds: 120,
      // The commissioner is left out of the order, as the Bloodsucker is.
      orders: {
        create: MANAGERS.map((userId, index) => ({
          slot: index + 1,
          memberId: `${userId}-member`,
        })),
      },
    },
  });
}

beforeEach(async () => {
  await removeFixture();
  await seedFixture();
});

afterAll(removeFixture);

describe('a commissioner outside the draft order', () => {
  it('is named a draft manager in the room snapshot without taking a slot', async () => {
    const snapshot = await draftProjectionService.buildRoomSnapshot(DRAFT, COMMISH);

    expect(snapshot?.state.managerUserIds).toEqual([COMMISH]);
    expect(snapshot?.state.participants.map((participant) => participant.userId)).toEqual(MANAGERS);
  });

  it('may pause the draft, while a manager in the order may not', async () => {
    const service = new DraftApplicationService();

    await expect(service.pauseDraft({ draftId: DRAFT, actorUserId: MANAGERS[0] })).rejects.toThrow(
      'forbidden:Commissioner access required to pause drafts'
    );

    await expect(
      service.pauseDraft({ draftId: DRAFT, actorUserId: COMMISH })
    ).resolves.toMatchObject({ data: { status: 'PAUSED' } });
    const draft = await prisma.draft.findUniqueOrThrow({ where: { id: DRAFT } });
    expect(draft.status).toBe('PAUSED');
  });
});
