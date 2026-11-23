/**
 * Add and drop: a manager with a full roster adds a free agent and drops one of his players in one
 * transaction. Run against PostgreSQL because the guarantee is about commits and row locks: both
 * moves land together or neither does, and concurrent moves never deadlock or overfill a roster.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { prisma } from '@/lib/prisma';
import { addFreeAgentToRoster } from '@/server/rosters/freeAgentAdd';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';
import { activateLeagueSeason } from './helpers/leagueSeason';

const LEAGUE = 'int-add-drop-league';
const SETTINGS = 'int-add-drop-settings';
const DRAFT = 'int-add-drop-draft';
const USER = 'int-add-drop-user';
const RIVAL = 'int-add-drop-rival';
const MEMBER = 'int-add-drop-member';
const RIVAL_MEMBER = 'int-add-drop-rival-member';
const KEEP = 'int-add-drop-keep';
const DROP = 'int-add-drop-drop';
/** An old roster row still holds this alias id of DROP. */
const DROP_ALIAS = 'int-add-drop-drop-old';
const FREE = 'int-add-drop-free';
const FREE_TWO = 'int-add-drop-free-two';
const PLAYERS = [KEEP, DROP, DROP_ALIAS, FREE, FREE_TWO];

const NOW = new Date('2026-07-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: [USER, RIVAL],
  });

function addAndDrop(playerId: string, drop: { playerId: string; playerAliasIds: string[] }) {
  return addFreeAgentToRoster(prisma, {
    leagueId: LEAGUE,
    userId: USER,
    playerId,
    playerAliasIds: [playerId],
    drop,
    now: NOW,
  });
}

async function rosterIds(memberId = MEMBER): Promise<string[]> {
  const rows = await prisma.leagueRosterPlayer.findMany({
    where: { leagueId: LEAGUE, memberId },
    select: { playerId: true },
  });
  return rows.map((row) => row.playerId).sort();
}

describe.sequential('free-agent add and drop', () => {
  beforeAll(async () => {
    await removeFixture();
    await prisma.user.createMany({
      data: [USER, RIVAL].map((id) => ({
        id,
        email: `${id}@statly.local`,
        passwordHash: 'x',
        displayName: id,
      })),
    });
    await prisma.player.createMany({
      data: PLAYERS.map((id) => ({ id, name: id, club: 'Test', position: 'MID' })),
    });
    await prisma.leagueSettings.create({
      data: {
        id: SETTINGS,
        rosterSize: 1,
        benchSize: 1,
        maxTeams: 2,
        pickSeconds: 60,
        draftType: 'SNAKE',
        startAt: NOW,
      },
    });
    await prisma.league.create({
      data: {
        id: LEAGUE,
        name: 'Add and drop',
        inviteCode: 'ADDANDDROP',
        ownerId: USER,
        settingsId: SETTINGS,
      },
    });
    await activateLeagueSeason(prisma, LEAGUE);
    await prisma.leagueMember.createMany({
      data: [
        { id: MEMBER, leagueId: LEAGUE, userId: USER, teamName: 'Mine', role: 'OWNER' },
        { id: RIVAL_MEMBER, leagueId: LEAGUE, userId: RIVAL, teamName: 'Rival', role: 'MANAGER' },
      ],
    });
    await prisma.draft.create({
      data: { id: DRAFT, leagueId: LEAGUE, status: 'COMPLETED', totalPicks: 4 },
    });
  });

  beforeEach(async () => {
    await prisma.teamAction.deleteMany({ where: { leagueId: LEAGUE } });
    await prisma.leagueRosterPlayer.deleteMany({ where: { leagueId: LEAGUE } });
    // A full roster (capacity 2); DROP's row is stored under its old alias id.
    await prisma.leagueRosterPlayer.createMany({
      data: [KEEP, DROP_ALIAS].map((playerId) => ({
        leagueId: LEAGUE,
        memberId: MEMBER,
        playerId,
        acquiredBy: 'DRAFT' as const,
      })),
    });
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('commits the add, the drop of an alias-held row and its waiver hold together', async () => {
    const result = await addAndDrop(FREE, { playerId: DROP, playerAliasIds: [DROP_ALIAS] });

    expect(result.dropped).toMatchObject({
      playerId: DROP,
      processingAt: new Date(NOW.getTime() + DAY),
    });
    await expect(rosterIds()).resolves.toEqual([FREE, KEEP].sort());
    const holds = await prisma.teamAction.findMany({
      where: { leagueId: LEAGUE, memberId: MEMBER, actionType: 'DROP_PLAYER' },
      select: { id: true, details: true, status: true, processingAt: true },
    });
    expect(holds).toEqual([
      {
        id: result.dropped!.actionId,
        details: { playerId: DROP },
        status: 'PENDING',
        processingAt: new Date(NOW.getTime() + DAY),
      },
    ]);
  });

  it('drops nothing when the add is refused', async () => {
    await prisma.leagueRosterPlayer.create({
      data: { leagueId: LEAGUE, memberId: RIVAL_MEMBER, playerId: FREE, acquiredBy: 'DRAFT' },
    });

    await expect(
      addAndDrop(FREE, { playerId: DROP, playerAliasIds: [DROP_ALIAS] })
    ).rejects.toMatchObject({ code: 'PLAYER_OWNED', status: 409 });
    await expect(rosterIds()).resolves.toEqual([DROP_ALIAS, KEEP].sort());
    await expect(prisma.teamAction.count({ where: { leagueId: LEAGUE } })).resolves.toBe(0);
  });

  it('refuses a drop player who is not on the roster, and adds nothing', async () => {
    await expect(
      addAndDrop(FREE, { playerId: FREE_TWO, playerAliasIds: [] })
    ).rejects.toMatchObject({ code: 'DROP_PLAYER_NOT_ON_ROSTER', status: 409 });
    await expect(rosterIds()).resolves.toEqual([DROP_ALIAS, KEEP].sort());
  });

  it('settles a concurrent plain add and add-and-drop without a deadlock or an overfull roster', async () => {
    const [plain, swap] = await Promise.allSettled([
      addFreeAgentToRoster(prisma, {
        leagueId: LEAGUE,
        userId: USER,
        playerId: FREE_TWO,
        playerAliasIds: [FREE_TWO],
        now: NOW,
      }),
      addAndDrop(FREE, { playerId: DROP, playerAliasIds: [DROP_ALIAS] }),
    ]);

    expect(plain).toMatchObject({ status: 'rejected', reason: { code: 'ROSTER_FULL' } });
    expect(swap.status).toBe('fulfilled');
    await expect(rosterIds()).resolves.toEqual([FREE, KEEP].sort());
  });

  it('lets only one of two concurrent drops of the same player commit', async () => {
    const results = await Promise.allSettled([
      addAndDrop(FREE, { playerId: DROP, playerAliasIds: [DROP_ALIAS] }),
      addAndDrop(FREE_TWO, { playerId: DROP, playerAliasIds: [DROP_ALIAS] }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'DROP_PLAYER_NOT_ON_ROSTER' },
    });
    await expect(
      prisma.leagueRosterPlayer.count({ where: { leagueId: LEAGUE, memberId: MEMBER } })
    ).resolves.toBe(2);
    await expect(prisma.teamAction.count({ where: { leagueId: LEAGUE } })).resolves.toBe(1);
  });
});
