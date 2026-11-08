import { describe, expect, it, vi } from 'vitest';

import { addFreeAgentToRoster, FreeAgentAddError } from './freeAgentAdd';

const INPUT = {
  leagueId: 'league-1',
  userId: 'user-1',
  playerId: 'player-1',
  playerAliasIds: ['player-1', 'player-1-alias'],
};

function makeDb(
  overrides: {
    member?: unknown;
    player?: unknown;
    owned?: unknown;
    hold?: unknown;
    count?: number;
    createError?: unknown;
    draft?: unknown;
  } = {}
) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
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
      count: vi.fn().mockResolvedValue(overrides.count ?? 0),
      create: overrides.createError
        ? vi.fn().mockRejectedValue(overrides.createError)
        : vi.fn().mockResolvedValue({ id: 'roster-row-1' }),
    },
    teamAction: { findFirst: vi.fn().mockResolvedValue(overrides.hold ?? null) },
    draft: {
      findUnique: vi
        .fn()
        .mockResolvedValue('draft' in overrides ? overrides.draft : { status: 'COMPLETED' }),
    },
  };
  const db = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
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
    expect(tx.draft.findUnique).toHaveBeenCalledWith({
      where: { leagueId: 'league-1' },
      select: { status: true },
    });
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
    const { db, tx } = makeDb({ hold: { id: 'drop-1' } });

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
});
