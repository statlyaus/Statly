import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  removeLeagueMember,
  transferLeagueOwnership,
  updateLeagueMember,
} from '@/server/leagues/memberCommands';

function lockedOutClient() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    league: { findUnique: vi.fn() },
  };
  return { tx, client: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as never };
}

const input = { leagueId: 'league-1', actorUserId: 'owner', targetUserId: 'user-2' };

describe('member commands take the League row lock first, like join', () => {
  it.each([
    ['remove', (client: never) => removeLeagueMember(input, client)],
    ['transfer', (client: never) => transferLeagueOwnership(input, client)],
    ['update', (client: never) => updateLeagueMember({ ...input, teamName: 'X' } as never, client)],
  ])('%s locks the league before reading it', async (_name, run) => {
    const { tx, client } = lockedOutClient();

    const result = await run(client);

    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.league.findUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: 'league-not-found' });
  });
});
