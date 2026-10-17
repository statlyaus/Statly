import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { joinLeague } from '@/server/leagues/memberCommands';

function member(id: string, teamName: string, draftSlot: number) {
  return {
    id,
    userId: `user-${id}`,
    teamName,
    isActive: true,
    status: 'ACTIVE',
    draftSlot,
    joinedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function clientWithMembers(members: ReturnType<typeof member>[]) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    league: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'league-1',
        name: 'AFL League',
        inviteCode: 'CODE1234',
        settings: { maxTeams: 12, timeZone: 'Australia/Melbourne', startAt: null },
        members,
        drafts: [],
      }),
    },
    user: { upsert: vi.fn().mockResolvedValue({}) },
    leagueMember: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'member-new',
        ...data,
      })),
      update: vi.fn(),
    },
    draftOrder: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return { tx, client: { $transaction: vi.fn((work) => work(tx)) } };
}

describe('joinLeague default team name', () => {
  it('skips a default number an active member already holds after a removal', async () => {
    // Team 2 was removed, so the next joiner's slot is 3, which Team 3 already uses.
    const { tx, client } = clientWithMembers([
      member('m1', 'AFL League Team 1', 1),
      member('m3', 'AFL League Team 3', 3),
    ]);

    const result = await joinLeague(
      { leagueId: 'league-1', userId: 'joining-user' },
      client as never
    );

    expect(result).toMatchObject({ ok: true, data: { member: { teamName: 'AFL League Team 4' } } });
    expect(tx.leagueMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ teamName: 'AFL League Team 4', draftSlot: 3 }),
    });
  });

  it('uses the slot-based default name when no active member holds it', async () => {
    const { client } = clientWithMembers([member('m1', 'AFL League Team 1', 1)]);

    const result = await joinLeague(
      { leagueId: 'league-1', userId: 'joining-user' },
      client as never
    );

    expect(result).toMatchObject({ ok: true, data: { member: { teamName: 'AFL League Team 2' } } });
  });
});
