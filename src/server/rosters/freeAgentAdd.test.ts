import { beforeEach, describe, expect, it, vi } from 'vitest';

const moveLock = vi.hoisted(() => ({ findPlayersLockedForMove: vi.fn() }));
vi.mock('@/server/leagues/playerMoveLock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/leagues/playerMoveLock')>()),
  findPlayersLockedForMove: moveLock.findPlayersLockedForMove,
}));

import { addFreeAgentToRoster, FreeAgentAddError } from './freeAgentAdd';

const INPUT = {
  leagueId: 'league-1',
  userId: 'user-1',
  playerId: 'player-1',
  playerAliasIds: ['player-1', 'player-1-alias'],
};
const NOW = new Date('2026-07-18T06:00:00.000Z');

function makeDb(
  overrides: {
    member?: unknown;
    player?: unknown;
    owned?: unknown;
    hold?: unknown;
    count?: number;
    createError?: unknown;
    draft?: unknown;
    bite?: unknown;
    dropRows?: unknown[];
    dropDeleted?: number;
  } = {}
) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'league-1' }]),
    leagueMember: {
      findFirst: vi.fn().mockResolvedValue(
        'member' in overrides
          ? overrides.member
          : {
              id: 'member-1',
              isActive: true,
              status: 'ACTIVE',
              league: { settings: { rosterSize: 2, benchSize: 1 } },
            }
      ),
    },
    player: {
      findUnique: vi
        .fn()
        .mockResolvedValue('player' in overrides ? overrides.player : { id: 'player-1' }),
    },
    leagueRosterPlayer: {
      findFirst: vi.fn().mockResolvedValue(overrides.owned ?? null),
      // The drop player's rows; the alias-held one by default.
      findMany: vi.fn().mockResolvedValue(overrides.dropRows ?? [{ playerId: 'player-9-old' }]),
      deleteMany: vi.fn().mockResolvedValue({ count: overrides.dropDeleted ?? 1 }),
      count: vi.fn().mockResolvedValue(overrides.count ?? 0),
      create: overrides.createError
        ? vi.fn().mockRejectedValue(overrides.createError)
        : vi.fn().mockResolvedValue({ id: 'roster-row-1' }),
    },
    // No Bloodsucker freeze on the caller unless a test says so (BR-30, #1355).
    league: { findUnique: vi.fn().mockResolvedValue({ activeSeasonId: 'season-1' }) },
    leagueBite: { findFirst: vi.fn().mockResolvedValue(overrides.bite ?? null) },
    leagueSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    teamAction: {
      findMany: vi.fn().mockResolvedValue(overrides.hold ? [overrides.hold] : []),
      create: vi.fn().mockResolvedValue({}),
    },
    leagueCompetitionRound: { findMany: vi.fn().mockResolvedValue([]) },
    leagueLineupPlayer: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    draft: {
      findUnique: vi
        .fn()
        .mockResolvedValue('draft' in overrides ? overrides.draft : { status: 'COMPLETED' }),
    },
  };
  const db = {
    $transaction: vi.fn((work: (client: typeof tx) => unknown, _options?: unknown) => work(tx)),
  };
  return { db, tx };
}

async function refusal(promise: Promise<unknown>): Promise<FreeAgentAddError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(FreeAgentAddError);
  return error as FreeAgentAddError;
}

describe('addFreeAgentToRoster', () => {
  beforeEach(() => {
    moveLock.findPlayersLockedForMove.mockReset();
    moveLock.findPlayersLockedForMove.mockResolvedValue({ ok: true, lockedPlayers: [] });
  });

  it('refuses with 409 a player whose game has started this round, before any write', async () => {
    moveLock.findPlayersLockedForMove.mockResolvedValue({
      ok: true,
      lockedPlayers: [{ playerId: 'player-1', name: 'Sam Walsh' }],
    });
    const { db } = makeDb();

    const error = await refusal(addFreeAgentToRoster(db as never, { ...INPUT, now: NOW }));

    expect(error.status).toBe(409);
    expect(error.code).toBe('PLAYER_LOCKED');
    expect(error.message).toBe(
      "Sam Walsh's game has started; he can be picked up after the round ends."
    );
    expect(moveLock.findPlayersLockedForMove).toHaveBeenCalledWith({
      leagueId: 'league-1',
      playerIds: ['player-1'],
      now: NOW,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses with 503 when the round game times cannot be read', async () => {
    moveLock.findPlayersLockedForMove.mockResolvedValue({
      ok: false,
      error: 'Fixture timing is unavailable',
    });
    const { db } = makeDb();

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.status).toBe(503);
    expect(error.code).toBe('TIMING_UNAVAILABLE');
    expect(error.message).toBe('Fixture timing is unavailable');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('adds the player inside one transaction after locking the caller’s member row', async () => {
    const { db, tx } = makeDb({ count: 2 });

    const result = await addFreeAgentToRoster(db as never, INPUT);

    expect(result).toEqual({ memberId: 'member-1', rosterPlayerId: 'roster-row-1' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.leagueRosterPlayer.count.mock.invocationCallOrder[0]
    );
    expect(tx.leagueRosterPlayer.create).toHaveBeenCalledWith({
      data: {
        leagueId: 'league-1',
        memberId: 'member-1',
        playerId: 'player-1',
        acquiredBy: 'FREE_AGENT',
      },
      select: { id: true },
    });
  });

  it('refuses with 409 until the league draft is complete', async () => {
    const { db, tx } = makeDb({ draft: { status: 'LIVE' } });

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.status).toBe(409);
    expect(error.code).toBe('DRAFT_NOT_COMPLETE');
    expect(error.message).toBe(
      'Adds, waiver claims and trades open once the league draft is complete.'
    );
    expect(tx.draft.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'league-1' } })
    );
    expect(tx.leagueRosterPlayer.create).not.toHaveBeenCalled();
  });

  it('does not reveal the draft state to a caller who is not an active manager', async () => {
    const { db, tx } = makeDb({ member: null, draft: { status: 'LIVE' } });

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.code).toBe('NOT_ACTIVE_MEMBER');
    expect(tx.draft.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a removed manager with 403', async () => {
    const { db, tx } = makeDb({
      member: {
        id: 'member-1',
        isActive: false,
        status: 'REMOVED',
        league: { settings: { rosterSize: 2, benchSize: 1 } },
      },
    });

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.status).toBe(403);
    expect(error.code).toBe('NOT_ACTIVE_MEMBER');
    expect(tx.leagueRosterPlayer.create).not.toHaveBeenCalled();
  });

  it('refuses a caller with no membership with 403', async () => {
    const { db } = makeDb({ member: null });

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.status).toBe(403);
  });

  it('refuses with 422 when the roster already holds rosterSize + benchSize players', async () => {
    const { db, tx } = makeDb({ count: 3 });

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.status).toBe(422);
    expect(error.code).toBe('ROSTER_FULL');
    expect(tx.leagueRosterPlayer.create).not.toHaveBeenCalled();
  });

  it('checks ownership across every alias of the player', async () => {
    const { db, tx } = makeDb({ owned: { memberId: 'member-2' } });

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.status).toBe(409);
    expect(error.code).toBe('PLAYER_OWNED');
    expect(tx.leagueRosterPlayer.findFirst).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', playerId: { in: ['player-1', 'player-1-alias'] } },
      select: { memberId: true },
    });
    expect(tx.leagueRosterPlayer.create).not.toHaveBeenCalled();
  });

  it('refuses a player still on a drop waiver hold with 409', async () => {
    const { db, tx } = makeDb({
      hold: {
        leagueId: 'league-1',
        actionType: 'DROP_PLAYER',
        details: { playerId: 'player-1-alias' },
        processingAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.status).toBe(409);
    expect(error.code).toBe('PLAYER_ON_WAIVERS');
    expect(tx.leagueRosterPlayer.create).not.toHaveBeenCalled();
  });

  it('turns a concurrent add of the same player (unique key) into 409, not 500', async () => {
    const { db } = makeDb({ createError: Object.assign(new Error('unique'), { code: 'P2002' }) });

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.status).toBe(409);
    expect(error.code).toBe('PLAYER_OWNED');
  });

  it('refuses an unknown player with 404', async () => {
    const { db } = makeDb({ player: null });

    const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

    expect(error.status).toBe(404);
  });

  it('refuses a member the Bloodsucker has a bite waiting on with 409 BITE_PENDING', async () => {
    const { db, tx } = makeDb({ bite: { id: 'bite-1' } });

    const error = await refusal(addFreeAgentToRoster(db as never, { ...INPUT, now: NOW }));

    expect(error).toMatchObject({ code: 'BITE_PENDING', status: 409 });
    expect(tx.leagueRosterPlayer.create).not.toHaveBeenCalled();
  });

  describe('add and drop', () => {
    const DROP_INPUT = {
      ...INPUT,
      now: NOW,
      drop: { playerId: 'player-9', playerAliasIds: ['player-9', 'player-9-old'] },
    };

    it('drops and adds in one transaction under the League row lock, with the waiver hold', async () => {
      const { db, tx } = makeDb({ count: 3 });

      const result = await addFreeAgentToRoster(db as never, DROP_INPUT);

      expect(result).toEqual({
        memberId: 'member-1',
        rosterPlayerId: 'roster-row-1',
        dropped: {
          playerId: 'player-9',
          actionId: expect.stringMatching(/^action_/),
          processingAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
        },
      });
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction.mock.calls[0]![1]).toEqual({ timeout: 20_000 });
      // League row lock (lock_timeout, FOR UPDATE), never the member row no-op lock.
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(moveLock.findPlayersLockedForMove).toHaveBeenCalledWith({
        leagueId: 'league-1',
        playerIds: ['player-1', 'player-9'],
        now: NOW,
      });
      expect(tx.leagueRosterPlayer.deleteMany).toHaveBeenCalledWith({
        where: { leagueId: 'league-1', memberId: 'member-1', playerId: 'player-9-old' },
      });
      expect(tx.leagueLineupPlayer.deleteMany).toHaveBeenCalled();
      expect(tx.teamAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leagueId: 'league-1',
          seasonId: 'season-1',
          memberId: 'member-1',
          actionType: 'DROP_PLAYER',
          details: { playerId: 'player-9' },
        }),
      });
      expect(tx.leagueRosterPlayer.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.leagueRosterPlayer.create.mock.invocationCallOrder[0]
      );
    });

    it('refuses a drop player who is not on the caller’s roster, and adds nothing', async () => {
      const { db, tx } = makeDb({ count: 3, dropRows: [] });

      const error = await refusal(addFreeAgentToRoster(db as never, DROP_INPUT));

      expect(error).toMatchObject({ code: 'DROP_PLAYER_NOT_ON_ROSTER', status: 409 });
      expect(tx.leagueRosterPlayer.findMany).toHaveBeenCalledWith({
        where: {
          leagueId: 'league-1',
          memberId: 'member-1',
          playerId: { in: ['player-9', 'player-9-old'] },
        },
        select: { playerId: true },
      });
      expect(tx.leagueRosterPlayer.deleteMany).not.toHaveBeenCalled();
      expect(tx.leagueRosterPlayer.create).not.toHaveBeenCalled();
    });

    it('refuses with 409 a drop player whose game has started, before any write', async () => {
      moveLock.findPlayersLockedForMove.mockResolvedValue({
        ok: true,
        lockedPlayers: [{ playerId: 'player-9', name: 'Zak Butters' }],
      });
      const { db } = makeDb({ count: 3 });

      const error = await refusal(addFreeAgentToRoster(db as never, DROP_INPUT));

      expect(error).toMatchObject({ code: 'DROP_PLAYER_LOCKED', status: 409 });
      expect(error.message).toBe(
        "Zak Butters's game has started; he can be dropped after the round ends."
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('refuses an add the rules block without dropping anyone', async () => {
      const { db, tx } = makeDb({ count: 3, owned: { memberId: 'member-2' } });

      const error = await refusal(addFreeAgentToRoster(db as never, DROP_INPUT));

      expect(error.code).toBe('PLAYER_OWNED');
      expect(tx.leagueRosterPlayer.deleteMany).not.toHaveBeenCalled();
      expect(tx.teamAction.create).not.toHaveBeenCalled();
    });

    it('drops only the picked row when two roster players share an identity group', async () => {
      const { db, tx } = makeDb({
        count: 3,
        dropRows: [{ playerId: 'player-9' }, { playerId: 'player-9-old' }],
      });

      await addFreeAgentToRoster(db as never, {
        ...DROP_INPUT,
        drop: { playerId: 'player-9', playerAliasIds: ['player-9-old', 'player-9'] },
      });

      expect(tx.leagueRosterPlayer.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.leagueRosterPlayer.deleteMany).toHaveBeenCalledWith({
        where: { leagueId: 'league-1', memberId: 'member-1', playerId: 'player-9-old' },
      });
    });

    it('lets a roster already over its limit swap one for one', async () => {
      const { db, tx } = makeDb({ count: 4 });

      await addFreeAgentToRoster(db as never, DROP_INPUT);

      expect(tx.leagueRosterPlayer.create).toHaveBeenCalled();
    });

    it('still asks for a drop when the roster is full and none was chosen', async () => {
      const { db } = makeDb({ count: 3 });

      const error = await refusal(addFreeAgentToRoster(db as never, INPUT));

      expect(error.message).toBe('Your roster is full (3 of 3). Choose a player to drop.');
    });
  });
});
