import { describe, expect, it, vi } from 'vitest';

import { createCanonicalLeague } from '../../src/server/leagues/createLeagueService';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../src/types/fantasyCategories';
import type { CreateLeagueRequest } from '../../src/types/leagues';

// League format on create (#1278). The Bloodsucker member is chosen later, in settings.

const NOW = new Date('2026-07-29T16:52:19.679Z');

function buildPrisma() {
  const tx = {
    user: { upsert: vi.fn().mockResolvedValue({ id: 'owner-user' }) },
    leagueSettings: { create: vi.fn().mockResolvedValue({ id: 'settings-1' }) },
    league: {
      create: vi.fn().mockResolvedValue({ id: 'league-1' }),
      update: vi.fn().mockResolvedValue({ id: 'league-1' }),
    },
    leagueSeason: { create: vi.fn().mockResolvedValue({ id: 'season-1' }) },
    leagueMember: {
      create: vi.fn().mockResolvedValue({
        id: 'member-1',
        teamName: 'Owner',
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

function create(input: Partial<CreateLeagueRequest>) {
  const { client, tx } = buildPrisma();
  const result = createCanonicalLeague(
    {
      userId: 'owner-user',
      input: {
        name: 'Bloodsucker League',
        type: 'private',
        maxTeams: 12,
        categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
        ...input,
      },
    },
    { prisma: client as never, now: () => NOW, generateInviteCode: () => 'CODE1234' }
  );
  return { result, tx };
}

describe('creating a league with a format', () => {
  it('defaults to a standard league with weekly waivers', async () => {
    const { result, tx } = create({});

    await expect(result).resolves.toMatchObject({
      league: { leagueFormat: 'STANDARD', waiverRule: 'weekly' },
    });
    expect(tx.leagueSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leagueFormat: 'STANDARD', waiverRule: 'WEEKLY' }),
    });
  });

  it('stores a Bloodsucker league with rolling waivers when none are chosen', async () => {
    const { result, tx } = create({
      leagueFormat: 'BLOODSUCKER',
      scoringMode: 'H2H_MOST_CATEGORIES',
    });

    await expect(result).resolves.toMatchObject({
      league: {
        leagueFormat: 'BLOODSUCKER',
        scoringMode: 'H2H_MOST_CATEGORIES',
        waiverRule: 'rolling',
      },
    });
    expect(tx.leagueSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueFormat: 'BLOODSUCKER',
        scoringMode: 'H2H_MOST_CATEGORIES',
        waiverRule: 'ROLLING',
      }),
    });
  });

  it('refuses a Bloodsucker league with weekly waivers', async () => {
    const { result, tx } = create({ leagueFormat: 'BLOODSUCKER', waiverRule: 'weekly' });

    await expect(result).rejects.toMatchObject({
      status: 400,
      code: 'BLOODSUCKER_REQUIRES_ROLLING',
    });
    expect(tx.leagueSettings.create).not.toHaveBeenCalled();
  });
});
