import { describe, expect, it, vi } from 'vitest';

import {
  createCanonicalLeague,
  createLeague,
  LeagueCreationError,
} from '../../src/server/leagues/createLeagueService';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../src/types/fantasyCategories';
import type { CreateLeagueRequest } from '../../src/types/leagues';

const NOW = new Date('2026-07-29T16:52:19.679Z');

describe('canonical league creation', () => {
  it('persists the complete league aggregate and preserves an unscheduled draft', async () => {
    const { client, tx } = buildPrisma();

    const result = await createCanonicalLeague(
      { userId: 'owner-user', input: buildInput({ draftDate: undefined }) },
      {
        prisma: client as never,
        now: () => NOW,
        generateInviteCode: () => 'CODE1234',
      }
    );

    expect(tx.leagueSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        maxTeams: 12,
        startAt: null,
        timeZone: 'Australia/Sydney',
        scoringMode: 'H2H_EACH_CATEGORY',
        fixtureGenerationMode: 'AUTOMATIC',
        lineupSlotsJson: expect.any(String),
        categoryDirectionsJson: expect.any(String),
      }),
    });
    expect(tx.league.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Statly Premier League',
        inviteCode: 'CODE1234',
        ownerId: 'owner-user',
        categoriesJson: JSON.stringify([...REAL_DATA_NINE_CATEGORY_PRESET]),
        visibility: 'PRIVATE',
        description: null,
      }),
    });
    expect(tx.leagueSeason.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league-1',
        label: '2026 season',
        year: 2026,
      }),
    });
    expect(tx.league.update).toHaveBeenCalledWith({
      where: { id: 'league-1' },
      data: { activeSeasonId: 'season-1' },
    });
    expect(tx.leagueMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league-1',
        userId: 'owner-user',
        role: 'OWNER',
        isActive: true,
        status: 'ACTIVE',
      }),
    });
    expect(result.league).not.toHaveProperty('draftDate');
  });

  it('persists an explicit schedule and stable identity during controlled adoption', async () => {
    const { client, tx } = buildPrisma();

    const result = await createCanonicalLeague(
      {
        userId: 'owner-user',
        input: buildInput({ draftDate: '2026-08-15T09:00:00.000Z' }),
        identity: {
          leagueId: 'legacy-league',
          inviteCode: 'LEGACY01',
          createdAt: NOW,
        },
      },
      { prisma: client as never }
    );

    expect(tx.leagueSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ startAt: new Date('2026-08-15T09:00:00.000Z') }),
    });
    expect(tx.league.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'legacy-league', inviteCode: 'LEGACY01' }),
    });
    expect(tx.leagueMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        leagueId: 'legacy-league',
      }),
    });
    expect(result.league.draftDate).toBe('2026-08-15T09:00:00.000Z');
  });

  it('normalizes invalid time zones and rejects invalid category payloads at the domain boundary', async () => {
    const { client, tx } = buildPrisma();

    const result = await createCanonicalLeague(
      { userId: 'owner-user', input: buildInput({ timeZone: 'Mars/Olympus_Mons' }) },
      {
        prisma: client as never,
        now: () => NOW,
        generateInviteCode: () => 'CODE1234',
      }
    );

    expect(result.league.timeZone).toBe('UTC');
    expect(tx.leagueSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ timeZone: 'UTC' }),
    });

    await expect(
      createCanonicalLeague(
        {
          userId: 'owner-user',
          input: buildInput({ categories: ['not-a-category'] as never }),
        },
        { prisma: client as never }
      )
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION',
    } satisfies Partial<LeagueCreationError>);
  });

  it('rejects malformed trade deadlines at the domain boundary', async () => {
    const { client, tx } = buildPrisma();

    await expect(
      createCanonicalLeague(
        {
          userId: 'owner-user',
          input: buildInput({ tradeSettings: { tradeDeadline: 'not-a-date' } }),
        },
        { prisma: client as never }
      )
    ).rejects.toMatchObject({
      message: 'Trade deadline must be a valid ISO date',
      status: 400,
      code: 'VALIDATION',
    } satisfies Partial<LeagueCreationError>);

    expect(tx.leagueSettings.create).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('persists public visibility and a normalized description in canonical and projected state', async () => {
    const { client, tx } = buildPrisma();
    const { firestore, batch, refs } = buildFirestore();

    await createLeague(
      {
        userId: 'owner-user',
        input: buildInput({ type: 'public', description: '  Public AFL competition  ' }),
      },
      {
        prisma: client as never,
        firestore: firestore as never,
        now: () => NOW,
        generateInviteCode: () => 'PUBLIC01',
      }
    );

    expect(tx.league.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        visibility: 'PUBLIC',
        description: 'Public AFL competition',
      }),
    });
    expect(batch.set).toHaveBeenCalledWith(
      refs.league,
      expect.objectContaining({ type: 'public', description: 'Public AFL competition' }),
      { merge: true }
    );
  });

  it('returns a conflict after exhausting generated invite codes', async () => {
    const { client } = buildPrisma();
    client.league.findUnique.mockResolvedValue({ id: 'existing-league' });

    await expect(
      createCanonicalLeague(
        { userId: 'owner-user', input: buildInput() },
        {
          prisma: client as never,
          generateInviteCode: () => 'TAKEN123',
        }
      )
    ).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    } satisfies Partial<LeagueCreationError>);

    expect(client.league.findUnique).toHaveBeenCalledTimes(10);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('maps an invite-code collision at the canonical write to a retryable conflict', async () => {
    const { client, tx } = buildPrisma();
    tx.league.create.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['inviteCode'] },
    });

    await expect(
      createCanonicalLeague(
        { userId: 'owner-user', input: buildInput() },
        {
          prisma: client as never,
          generateInviteCode: () => 'RACED123',
        }
      )
    ).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    } satisfies Partial<LeagueCreationError>);
  });

  it('projects the canonical result into all compatibility documents', async () => {
    const { client } = buildPrisma();
    const { firestore, batch, refs } = buildFirestore();

    const result = await createLeague(
      { userId: 'owner-user', input: buildInput() },
      {
        prisma: client as never,
        firestore: firestore as never,
        now: () => NOW,
        generateInviteCode: () => 'CODE1234',
      }
    );

    expect(result.league.id).toBe('league-1');
    expect(batch.set).toHaveBeenCalledTimes(3);
    expect(batch.set).toHaveBeenCalledWith(
      refs.league,
      expect.objectContaining({ name: 'Statly Premier League', ownerId: 'owner-user' }),
      { merge: true }
    );
    expect(batch.set).toHaveBeenCalledWith(
      refs.topMember,
      expect.objectContaining({ role: 'owner', status: 'ACTIVE' }),
      { merge: true }
    );
    expect(batch.set).toHaveBeenCalledWith(
      refs.embeddedMember,
      expect.objectContaining({ role: 'owner', status: 'ACTIVE' }),
      { merge: true }
    );
    expect(batch.commit).toHaveBeenCalledOnce();
  });

  it('preserves the canonical aggregate when the compatibility projection remains unavailable', async () => {
    const { client } = buildPrisma();
    const { firestore, batch } = buildFirestore();
    batch.commit.mockRejectedValue(new Error('Firestore unavailable'));

    const result = await createLeague(
      { userId: 'owner-user', input: buildInput() },
      {
        prisma: client as never,
        firestore: firestore as never,
        now: () => NOW,
        generateInviteCode: () => 'CODE1234',
      }
    );

    expect(result.league.id).toBe('league-1');
    expect(batch.commit).toHaveBeenCalledTimes(3);
    expect(client.$transaction).toHaveBeenCalledOnce();
  });
});

function buildInput(overrides: Partial<CreateLeagueRequest> = {}): CreateLeagueRequest {
  return {
    name: 'Statly Premier League',
    type: 'private',
    maxTeams: 12,
    categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
    timeZone: 'Australia/Sydney',
    draftType: 'snake',
    pickOrder: 'random',
    waiverRule: 'weekly',
    ...overrides,
  };
}

function buildPrisma() {
  const tx = {
    user: { upsert: vi.fn().mockResolvedValue({ id: 'owner-user' }) },
    leagueSettings: {
      create: vi.fn().mockResolvedValue({ id: 'settings-1' }),
    },
    league: {
      create: vi.fn(async ({ data }: { data: { id?: string } }) => ({ id: data.id ?? 'league-1' })),
      update: vi.fn().mockResolvedValue({ id: 'league-1' }),
    },
    leagueSeason: {
      create: vi.fn().mockResolvedValue({ id: 'season-1' }),
    },
    leagueMember: {
      create: vi.fn().mockResolvedValue({
        id: 'member-1',
        teamName: 'Statly Premier League Owner',
        joinedAt: NOW,
        isActive: true,
      }),
    },
  };
  const client = {
    league: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };

  return { client, tx };
}

function buildFirestore() {
  const refs = {
    league: {
      path: 'leagues/league-1',
      collection: vi.fn(() => ({ doc: vi.fn(() => refs.embeddedMember) })),
    },
    topMember: { path: 'leagueMembers/member-1' },
    embeddedMember: { path: 'leagues/league-1/members/owner-user' },
  };
  const batch = {
    set: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  };
  const firestore = {
    batch: vi.fn(() => batch),
    collection: vi.fn((name: string) => ({
      doc: vi.fn(() => (name === 'leagues' ? refs.league : refs.topMember)),
    })),
  };

  return { firestore, batch, refs };
}
