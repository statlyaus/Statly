import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

import { loadPlayerIdentityDirectory } from '@/server/playerIdentityResolver';

import {
  buildMergedIngestProgressEventForTest,
  resolveMergedReconciliationPlayerId,
} from './footywireStatsIngestion';

describe('merged ingest progress events', () => {
  it('exposes typed progress events for live source diagnostics', () => {
    expect(
      buildMergedIngestProgressEventForTest({
        event: 'round_fetch_start',
        season: 2026,
        round: 0,
        dataSource: 'afltables,footywire_match',
      })
    ).toEqual({
      event: 'round_fetch_start',
      season: 2026,
      round: 0,
      dataSource: 'afltables,footywire_match',
    });
  });
});

describe('resolveMergedReconciliationPlayerId', () => {
  it('prefers canonical shared player resolution over stale raw player ids', async () => {
    const prisma = {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'nasiah_wmilera',
            name: 'Nasiah Wanganeen-Milera',
            club: 'St Kilda',
            position: 'DEF',
          },
        ]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const directory = await loadPlayerIdentityDirectory(prisma as never, 2026);
    const playerId = await resolveMergedReconciliationPlayerId(
      {
        season: 2026,
        round: 0,
        team: 'St Kilda',
        opposition: 'Collingwood',
        player_name: 'Nasiah Wanganeen-Milera',
        player_id: 'nasiah_wanganeenmilera',
      },
      directory
    );

    expect(playerId).toBe('nasiah_wmilera');
  });

  it('resolves merged source aliases through the canonical player identity directory', async () => {
    const prisma = {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'joseph_fonti',
            name: 'Joseph Fonti',
            club: 'Greater Western Sydney',
            position: 'DEF',
          },
        ]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([
          {
            playerId: 'joseph_fonti',
            normalizedAliasName: 'joe fonti',
            normalizedClub: null,
            scopeKey: 'all:all:global',
            seasonFrom: null,
            seasonTo: null,
          },
        ]),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const directory = await loadPlayerIdentityDirectory(prisma as never, 2026);
    const playerId = await resolveMergedReconciliationPlayerId(
      {
        season: 2026,
        round: 1,
        team: 'GWS',
        opposition: 'Western Bulldogs',
        player_name: 'Joe Fonti',
      },
      directory
    );

    expect(playerId).toBe('joseph_fonti');
  });
});
