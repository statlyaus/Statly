import { describe, expect, it, vi } from 'vitest';

import type { ReviewedSeasonRosterEntry } from './playerDirectorySeasonRoster';
import {
  applySeasonRosterSyncPlan,
  buildSeasonRosterSyncPlan,
} from './playerDirectorySeasonRosterSync';

type MockPlayer = {
  id: string;
  name: string;
  club: string;
  position: string;
  active: boolean;
};

type MockRegistration = {
  playerId: string;
  season: number;
  club: string;
  normalizedClub: string;
  position: string;
  listStatus: string;
  active: boolean;
};

type MockAlias = {
  playerId: string;
  normalizedAliasName: string;
  normalizedClub: string | null;
  scopeKey: string;
  seasonFrom: number | null;
  seasonTo: number | null;
};

const rosterEntry = (
  overrides: Partial<ReviewedSeasonRosterEntry> = {}
): ReviewedSeasonRosterEntry => ({
  season: 2026,
  playerId: 'aaron_naughton',
  playerName: 'Aaron Naughton',
  club: 'Western Bulldogs',
  position: 'FWD',
  playerStatus: 'listed',
  listStatus: 'active',
  active: true,
  source: 'club-roster',
  sourceLabel: 'Western Bulldogs AFL player profile',
  sourceUrl: 'https://www.westernbulldogs.com.au/players/1605/aaron-naughton',
  reviewedBy: 'manual-review-2026-05-05',
  reviewedAt: '2026-05-05',
  notes: 'Official player profile identifies Naughton as a Western Bulldogs forward.',
  aliases: [],
  ...overrides,
});

function prismaMock(
  existing: {
    players?: MockPlayer[];
    registrations?: MockRegistration[];
    aliases?: MockAlias[];
    aliasCreateDuplicateRaceForSameOwner?: boolean;
  } = {}
) {
  const players = [...(existing.players ?? [])];
  const registrations = [...(existing.registrations ?? [])];
  const aliases = [...(existing.aliases ?? [])];
  let aliasCreateDuplicateRaceTriggered = false;
  const filterByPlayerIds = <T extends { playerId: string }>(
    rows: T[],
    query?: { where?: { playerId?: { in?: string[] } } }
  ) => {
    const playerIds = query?.where?.playerId?.in;
    if (!playerIds) return rows;
    return rows.filter((row) => playerIds.includes(row.playerId));
  };
  const filterAliases = (
    rows: MockAlias[],
    query?: {
      where?: {
        playerId?: { in?: string[] };
        OR?: Array<{ normalizedAliasName: string; scopeKey: string }>;
      };
    }
  ) => {
    const playerIds = query?.where?.playerId?.in;
    const aliasKeys = query?.where?.OR;
    return rows.filter((row) => {
      const playerMatches = !playerIds || playerIds.includes(row.playerId);
      const aliasMatches =
        !aliasKeys ||
        aliasKeys.some(
          (aliasKey) =>
            aliasKey.normalizedAliasName === row.normalizedAliasName &&
            aliasKey.scopeKey === row.scopeKey
        );
      return playerMatches && aliasMatches;
    });
  };
  const tx = {
    player: {
      create: vi.fn().mockImplementation(({ data }) => {
        if (players.some((player) => player.id === data.id)) {
          throw new Error(`Duplicate player ${data.id}`);
        }
        players.push(data);
        return Promise.resolve(data);
      }),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockImplementation(({ create, update, where }) => {
        const existingPlayer = players.find((player) => player.id === where.id);
        if (existingPlayer) {
          Object.assign(existingPlayer, update);
          return Promise.resolve(existingPlayer);
        }
        players.push(create);
        return Promise.resolve(create);
      }),
    },
    playerSeasonRegistration: {
      create: vi.fn().mockImplementation(({ data }) => {
        if (
          registrations.some(
            (registration) =>
              registration.playerId === data.playerId &&
              registration.season === data.season &&
              registration.normalizedClub === data.normalizedClub
          )
        ) {
          throw new Error(`Duplicate registration ${data.playerId}`);
        }
        registrations.push(data);
        return Promise.resolve(data);
      }),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockImplementation(({ create, update, where }) => {
        const key = where.playerId_season_normalizedClub;
        const existingRegistration = registrations.find(
          (registration) =>
            registration.playerId === key.playerId &&
            registration.season === key.season &&
            registration.normalizedClub === key.normalizedClub
        );
        if (existingRegistration) {
          Object.assign(existingRegistration, update);
          return Promise.resolve(existingRegistration);
        }
        registrations.push(create);
        return Promise.resolve(create);
      }),
    },
    playerAlias: {
      findFirst: vi.fn().mockImplementation(({ where }) => {
        const found =
          aliases.find(
            (alias) =>
              alias.normalizedAliasName === where.normalizedAliasName &&
              alias.scopeKey === where.scopeKey
          ) ?? null;
        return Promise.resolve(found);
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        if (existing.aliasCreateDuplicateRaceForSameOwner && !aliasCreateDuplicateRaceTriggered) {
          aliasCreateDuplicateRaceTriggered = true;
          aliases.push({
            playerId: data.playerId,
            normalizedAliasName: data.normalizedAliasName,
            normalizedClub: data.normalizedClub,
            scopeKey: data.scopeKey,
            seasonFrom: data.seasonFrom,
            seasonTo: data.seasonTo,
          });
          throw Object.assign(
            new Error(`Duplicate alias ${data.normalizedAliasName}|${data.scopeKey}`),
            { code: 'P2002' }
          );
        }
        if (
          aliases.some(
            (alias) =>
              alias.normalizedAliasName === data.normalizedAliasName &&
              alias.scopeKey === data.scopeKey
          )
        ) {
          throw new Error(`Duplicate alias ${data.normalizedAliasName}|${data.scopeKey}`);
        }
        aliases.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  return {
    player: {
      findMany: vi.fn().mockResolvedValue(players),
    },
    playerSeasonRegistration: {
      findMany: vi.fn().mockResolvedValue(registrations),
    },
    playerAlias: {
      findMany: vi
        .fn()
        .mockImplementation((query) => Promise.resolve(filterAliases(aliases, query))),
    },
    $transaction: vi.fn(async (fn) => fn(tx)),
    tx,
  };
}

describe('buildSeasonRosterSyncPlan', () => {
  it('plans missing players, registrations, and aliases without duplicate writes', async () => {
    const prisma = prismaMock();

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [
        rosterEntry({
          aliases: [
            {
              aliasName: 'A Naughton',
              club: 'Western Bulldogs',
              seasonFrom: 2026,
              seasonTo: 2026,
              source: 'CLUB_ROSTER',
              confidence: 0.98,
              notes: 'Common abbreviated listing.',
            },
            {
              aliasName: ' A  Naughton ',
              club: 'western bulldogs',
              seasonFrom: 2026,
              seasonTo: 2026,
              source: 'CLUB_ROSTER',
              confidence: 0.98,
              notes: 'Duplicate normalized alias should be skipped.',
            },
          ],
        }),
      ],
    });

    expect(plan.valid).toBe(true);
    expect(plan.playersToCreate).toEqual([
      expect.objectContaining({
        id: 'aaron_naughton',
        name: 'Aaron Naughton',
        club: 'Western Bulldogs',
        position: 'FWD',
        active: true,
      }),
    ]);
    expect(plan.registrationsToCreate).toEqual([
      expect.objectContaining({
        playerId: 'aaron_naughton',
        season: 2026,
        normalizedClub: 'western bulldogs',
      }),
    ]);
    expect(plan.aliasesToCreate).toEqual([
      expect.objectContaining({
        playerId: 'aaron_naughton',
        aliasName: 'A Naughton',
        normalizedAliasName: 'a naughton',
        scopeKey: '2026:2026:western bulldogs',
      }),
    ]);
    expect(plan.existingPlayerIds).toEqual([]);
  });

  it('plans canonical player and registration updates for changed reviewed facts', async () => {
    const prisma = prismaMock({
      players: [
        {
          id: 'aaron_naughton',
          name: 'Aaron Naughton',
          club: 'Western Bulldogs',
          position: 'DEF',
          active: false,
        },
      ],
      registrations: [
        {
          playerId: 'aaron_naughton',
          season: 2026,
          club: 'Western Bulldogs',
          normalizedClub: 'western bulldogs',
          position: 'DEF',
          listStatus: 'inactive',
          active: false,
        },
      ],
    });

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [rosterEntry()],
    });

    expect(plan.playersToCreate).toEqual([]);
    expect(plan.playersToUpdate).toEqual([
      expect.objectContaining({
        id: 'aaron_naughton',
        position: 'FWD',
        active: true,
      }),
    ]);
    expect(plan.registrationsToCreate).toEqual([]);
    expect(plan.registrationsToUpdate).toEqual([
      expect.objectContaining({
        playerId: 'aaron_naughton',
        position: 'FWD',
        listStatus: 'active',
        active: true,
      }),
    ]);
    expect(plan.existingPlayerIds).toEqual(['aaron_naughton']);
  });

  it('does not recreate existing player, registration, or alias', async () => {
    const prisma = prismaMock({
      players: [
        {
          id: 'aaron_naughton',
          name: 'Aaron Naughton',
          club: 'Western Bulldogs',
          position: 'FWD',
          active: true,
        },
      ],
      registrations: [
        {
          playerId: 'aaron_naughton',
          season: 2026,
          club: 'Western Bulldogs',
          normalizedClub: 'western bulldogs',
          position: 'FWD',
          listStatus: 'active',
          active: true,
        },
      ],
      aliases: [
        {
          playerId: 'aaron_naughton',
          normalizedAliasName: 'a naughton',
          normalizedClub: 'western bulldogs',
          scopeKey: '2026:2026:western bulldogs',
          seasonFrom: 2026,
          seasonTo: 2026,
        },
      ],
    });

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [
        rosterEntry({
          aliases: [
            {
              aliasName: 'A Naughton',
              club: 'Western Bulldogs',
              seasonFrom: 2026,
              seasonTo: 2026,
              source: 'MANUAL',
              confidence: 1,
              notes: 'Reviewed alias.',
            },
          ],
        }),
      ],
    });

    expect(plan.playersToCreate).toEqual([]);
    expect(plan.playersToUpdate).toEqual([]);
    expect(plan.registrationsToCreate).toEqual([]);
    expect(plan.registrationsToUpdate).toEqual([]);
    expect(plan.aliasesToCreate).toEqual([]);
    expect(plan.existingPlayerIds).toEqual(['aaron_naughton']);
  });

  it('returns an explicit error when an existing alias with the same normalized alias and scope belongs to another player', async () => {
    const prisma = prismaMock({
      aliases: [
        {
          playerId: 'another_player',
          normalizedAliasName: 'a naughton',
          normalizedClub: 'western bulldogs',
          scopeKey: '2026:2026:western bulldogs',
          seasonFrom: 2026,
          seasonTo: 2026,
        },
      ],
    });

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [
        rosterEntry({
          aliases: [
            {
              aliasName: 'A Naughton',
              club: 'Western Bulldogs',
              seasonFrom: 2026,
              seasonTo: 2026,
              source: 'MANUAL',
              confidence: 1,
              notes: 'Reviewed alias.',
            },
          ],
        }),
      ],
    });

    expect(plan.valid).toBe(false);
    expect(plan.errors).toEqual([
      'Alias A Naughton for aaron_naughton conflicts with existing alias a naughton in scope 2026:2026:western bulldogs owned by another_player',
    ]);
    expect(plan.aliasesToCreate).toEqual([]);
  });

  it('returns an explicit error when reviewed entries assign the same alias scope to different players', async () => {
    const prisma = prismaMock();

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [
        rosterEntry({
          aliases: [
            {
              aliasName: 'A Naughton',
              club: 'Western Bulldogs',
              seasonFrom: 2026,
              seasonTo: 2026,
              source: 'MANUAL',
              confidence: 1,
              notes: 'Reviewed alias.',
            },
          ],
        }),
        rosterEntry({
          playerId: 'another_player',
          playerName: 'Another Player',
          aliases: [
            {
              aliasName: ' A  Naughton ',
              club: 'western bulldogs',
              seasonFrom: 2026,
              seasonTo: 2026,
              source: 'MANUAL',
              confidence: 1,
              notes: 'Conflicting reviewed alias.',
            },
          ],
        }),
      ],
    });

    expect(plan.valid).toBe(false);
    expect(plan.errors).toEqual([
      'Alias A Naughton in scope 2026:2026:western bulldogs is assigned to multiple reviewed players: aaron_naughton, another_player',
    ]);
    expect(plan.aliasesToCreate).toEqual([]);
  });

  it('returns an explicit error before creating a duplicate player under a different id', async () => {
    const prisma = prismaMock({
      players: [
        {
          id: 'existing_aaron_naughton',
          name: 'Aaron Naughton',
          club: 'Western Bulldogs',
          position: 'FWD',
          active: true,
        },
      ],
    });

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [rosterEntry()],
    });

    expect(plan.valid).toBe(false);
    expect(plan.errors).toEqual([
      'Player aaron_naughton (Aaron Naughton, Western Bulldogs) conflicts with existing Prisma player existing_aaron_naughton',
    ]);
    expect(plan.playersToCreate).toEqual([]);
  });

  it('uses normalized name and club when checking duplicate existing players', async () => {
    const prisma = prismaMock({
      players: [
        {
          id: 'existing_aaron_naughton',
          name: ' Aaron   Naughton ',
          club: 'western bulldogs',
          position: 'FWD',
          active: true,
        },
      ],
    });

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [rosterEntry()],
    });

    expect(plan.valid).toBe(false);
    expect(plan.errors).toEqual([
      'Player aaron_naughton (Aaron Naughton, Western Bulldogs) conflicts with existing Prisma player existing_aaron_naughton',
    ]);
  });

  it('returns validation errors without querying Prisma for invalid reviewed roster input', async () => {
    const prisma = prismaMock();

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [rosterEntry({ reviewedBy: '', sourceUrl: '' })],
    });

    expect(plan.valid).toBe(false);
    expect(plan.errors).toEqual([
      'Player aaron_naughton is missing reviewedBy',
      'Player aaron_naughton is missing sourceUrl',
    ]);
    expect(plan.playersToCreate).toEqual([]);
    expect(prisma.player.findMany).not.toHaveBeenCalled();
  });
});

describe('applySeasonRosterSyncPlan', () => {
  it('applies all Prisma writes inside one transaction', async () => {
    const prisma = prismaMock();
    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [
        rosterEntry({
          aliases: [
            {
              aliasName: 'A Naughton',
              club: 'Western Bulldogs',
              seasonFrom: 2026,
              seasonTo: 2026,
              source: 'MANUAL',
              confidence: 1,
              notes: 'Reviewed alias.',
            },
          ],
        }),
      ],
    });

    const result = await applySeasonRosterSyncPlan(prisma as never, plan);

    expect(result.applied).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.tx.player.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.tx.playerSeasonRegistration.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.tx.playerAlias.create).toHaveBeenCalledTimes(1);
  });

  it('can apply the same precomputed plan twice without duplicate-key failures', async () => {
    const prisma = prismaMock();
    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [
        rosterEntry({
          aliases: [
            {
              aliasName: 'A Naughton',
              club: 'Western Bulldogs',
              seasonFrom: 2026,
              seasonTo: 2026,
              source: 'MANUAL',
              confidence: 1,
              notes: 'Reviewed alias.',
            },
          ],
        }),
      ],
    });

    const firstResult = await applySeasonRosterSyncPlan(prisma as never, plan);
    const secondResult = await applySeasonRosterSyncPlan(prisma as never, plan);

    expect(firstResult.applied).toBe(true);
    expect(secondResult.applied).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.tx.player.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.tx.playerSeasonRegistration.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.tx.playerAlias.create).toHaveBeenCalledTimes(1);
  });

  it('continues idempotently when alias create races with a same-owner duplicate', async () => {
    const prisma = prismaMock({
      aliasCreateDuplicateRaceForSameOwner: true,
    });
    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [
        rosterEntry({
          aliases: [
            {
              aliasName: 'A Naughton',
              club: 'Western Bulldogs',
              seasonFrom: 2026,
              seasonTo: 2026,
              source: 'MANUAL',
              confidence: 1,
              notes: 'Reviewed alias.',
            },
          ],
        }),
      ],
    });

    const result = await applySeasonRosterSyncPlan(prisma as never, plan);

    expect(result.applied).toBe(true);
    expect(prisma.tx.playerAlias.create).toHaveBeenCalledTimes(1);
    expect(prisma.tx.playerAlias.findFirst).toHaveBeenCalledTimes(2);
  });

  it('does not open a transaction for invalid plans', async () => {
    const prisma = prismaMock();
    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [rosterEntry({ reviewedBy: '' })],
    });

    const result = await applySeasonRosterSyncPlan(prisma as never, plan);

    expect(result.applied).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
