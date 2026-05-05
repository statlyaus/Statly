import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  buildPlayerSeasonSummaries,
  listCanonicalPlayerIdsForRounds,
  resolveCanonicalMatchIdFromRecord,
  getAdvancedStatIntegrityFromSummaries,
  listRawMatchLogStageRows,
  parseMatchLogStatsJson,
  parseStatsJson,
  persistPlayerMatchLogProjections,
  resolveRawReconciliationPlayerId,
  resolveLatestProjectedSeason,
} from '@/server/readModels/playerReadModels';
import { adminDb } from '@/lib/firebaseAdmin';
import { createPlayerIdentityResolver } from '@/lib/playerMatchStats';
import { prisma } from '@/lib/prisma';

describe('parseStatsJson', () => {
  it('maps MG and metres_gained aliases onto metresGained', () => {
    expect(parseStatsJson(JSON.stringify({ MG: 412 })).metresGained).toBe(412);
    expect(parseStatsJson(JSON.stringify({ mg: 400 })).metresGained).toBe(400);
    expect(parseStatsJson(JSON.stringify({ metres_gained: 300 })).metresGained).toBe(300);
  });

  it('prefers canonical metresGained when both MG and metresGained exist', () => {
    const stats = parseStatsJson(JSON.stringify({ MG: 400, metresGained: 350 }));
    expect(stats.metresGained).toBe(350);
  });
});

describe('parseMatchLogStatsJson', () => {
  it('restores nullable advanced stats from availability metadata', () => {
    const stats = parseMatchLogStatsJson(
      JSON.stringify({
        stats: {
          kicks: 12,
          disposals: 20,
          disposalEffPct: 0,
          metresGained: 0,
          scoreInvolvements: 3,
        },
        availability: {
          disposalEffPct: false,
          metresGained: false,
          scoreInvolvements: true,
        },
      })
    );

    expect(stats.kicks).toBe(12);
    expect(stats.disposals).toBe(20);
    expect(stats.disposalEffPct).toBeNull();
    expect(stats.metresGained).toBeNull();
    expect(stats.scoreInvolvements).toBe(3);
  });

  it('preserves core stats as numeric values even when availability marks them absent', () => {
    const stats = parseMatchLogStatsJson(
      JSON.stringify({
        stats: {
          kicks: 12,
          hitouts: 0,
        },
        availability: {
          kicks: true,
          hitouts: false,
        },
      })
    );

    expect(stats.kicks).toBe(12);
    expect(stats.hitouts).toBe(0);
  });
});

describe('persistPlayerMatchLogProjections', () => {
  it('uses refreshed rounds as the cleanup boundary when canonical player identity changes', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const prismaClient = {
      playerMatchLogProjection: {
        deleteMany,
        createMany,
      },
    } as unknown as Parameters<typeof persistPlayerMatchLogProjections>[0];

    await persistPlayerMatchLogProjections(prismaClient, 2026, [], ['bailey_j_williams'], [5]);

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        season: 2026,
        roundNumber: { in: [5] },
      },
    });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('only writes match-log projections inside the refreshed round boundary', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const prismaClient = {
      playerMatchLogProjection: {
        deleteMany,
        createMany,
      },
    } as unknown as Parameters<typeof persistPlayerMatchLogProjections>[0];

    await persistPlayerMatchLogProjections(
      prismaClient,
      2026,
      [
        {
          id: 'joseph_fonti-2026-r0',
          playerId: 'joseph_fonti',
          season: 2026,
          roundNumber: 0,
          matchId: '2026-R0-GWS-BUL',
          matchDate: '2026-03-05T08:30:00Z',
          opponent: 'Western Bulldogs',
          stats: parseMatchLogStatsJson(JSON.stringify({ stats: { disposals: 10 } })),
          sourceUpdatedAt: new Date('2026-03-05T10:30:00Z'),
        },
        {
          id: 'joseph_fonti-2026-r5',
          playerId: 'joseph_fonti',
          season: 2026,
          roundNumber: 5,
          matchId: '2026-R5-GWS-RIC',
          matchDate: '2026-04-10T08:30:00Z',
          opponent: 'Richmond',
          stats: parseMatchLogStatsJson(JSON.stringify({ stats: { disposals: 12 } })),
          sourceUpdatedAt: new Date('2026-04-10T10:30:00Z'),
        },
      ],
      ['joseph_fonti'],
      [5]
    );

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0].data).toHaveLength(1);
    expect(createMany.mock.calls[0]?.[0].data[0]).toMatchObject({
      id: 'joseph_fonti-2026-r5',
      roundNumber: 5,
      matchId: '2026-R5-GWS-RIC',
    });
  });
});

describe('resolveLatestProjectedSeason', () => {
  it('prefers the latest published projection season', async () => {
    const prismaClient = {
      playerProjectionPublication: {
        findFirst: vi.fn().mockResolvedValue({ season: 2026 }),
      },
      playerRankingSnapshot: {
        count: vi.fn(),
        findFirst: vi.fn(),
      },
      playerSeasonSummary: {
        count: vi.fn(),
        findFirst: vi.fn(),
      },
    } as unknown as Parameters<typeof resolveLatestProjectedSeason>[0];

    await expect(resolveLatestProjectedSeason(prismaClient, 2025)).resolves.toBe(2026);
    expect(prismaClient.playerRankingSnapshot.count).not.toHaveBeenCalled();
    expect(prismaClient.playerSeasonSummary.count).not.toHaveBeenCalled();
  });

  it('does not promote a season that only has partial projected data', async () => {
    const rankingCount = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(422)
      .mockResolvedValueOnce(0);
    const summaryCount = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(422)
      .mockResolvedValueOnce(422)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const prismaClient = {
      playerProjectionPublication: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      playerRankingSnapshot: {
        count: rankingCount,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      playerSeasonSummary: {
        count: summaryCount,
        findMany: vi.fn().mockResolvedValue([
          {
            statsJson: JSON.stringify({
              clearances: 5,
              inside50s: 4,
              rebound50s: 3,
              contestedPossessions: 8,
              uncontestedPossessions: 10,
              freesFor: 1,
              freesAgainst: 1,
              onePercenters: 2,
              goalAssists: 1,
              turnovers: 3,
              intercepts: 4,
              metresGained: 420,
              contestedMarks: 2,
              effectiveDisposals: 19,
              scoreInvolvements: 6,
              timeOnGroundPct: 82,
              disposalEffPct: 78,
              minutes: 96,
            }),
            totalsJson: JSON.stringify({
              clearances: 10,
              inside50s: 8,
              rebound50s: 6,
              contestedPossessions: 16,
              uncontestedPossessions: 20,
              freesFor: 2,
              freesAgainst: 2,
              onePercenters: 4,
              goalAssists: 2,
              turnovers: 6,
              intercepts: 8,
              metresGained: 840,
              contestedMarks: 4,
              effectiveDisposals: 38,
              scoreInvolvements: 12,
              timeOnGroundPct: 164,
              disposalEffPct: 156,
              minutes: 192,
            }),
          },
        ]),
        findFirst: vi.fn().mockResolvedValue({ season: 2024 }),
      },
    } as unknown as Parameters<typeof resolveLatestProjectedSeason>[0];

    await expect(resolveLatestProjectedSeason(prismaClient, 2026)).resolves.toBe(2025);
  });
});

describe('getAdvancedStatIntegrityFromSummaries', () => {
  it('flags degraded advanced stats when every summary is zero for a scoring-critical stat', () => {
    const integrity = getAdvancedStatIntegrityFromSummaries([
      {
        stats: parseStatsJson(JSON.stringify({ metresGained: 0, scoreInvolvements: 0 })),
        totals: parseStatsJson(JSON.stringify({ metresGained: 0, scoreInvolvements: 0 })),
      },
      {
        stats: parseStatsJson(JSON.stringify({ metresGained: 0, scoreInvolvements: 0 })),
        totals: parseStatsJson(JSON.stringify({ metresGained: 0, scoreInvolvements: 0 })),
      },
    ]);

    expect(integrity.degradedStats).toContain('metresGained');
    expect(integrity.degradedStats).toContain('scoreInvolvements');
  });

  it('treats advanced stats as healthy when at least one summary contains a non-zero value', () => {
    const integrity = getAdvancedStatIntegrityFromSummaries([
      {
        stats: parseStatsJson(JSON.stringify({ metresGained: 412, scoreInvolvements: 5 })),
        totals: parseStatsJson(JSON.stringify({ metresGained: 824, scoreInvolvements: 10 })),
      },
    ]);

    expect(integrity.degradedStats).not.toContain('metresGained');
    expect(integrity.degradedStats).not.toContain('scoreInvolvements');
  });
});

describe('buildPlayerSeasonSummaries', () => {
  it('rescues raw rows whose stored player id no longer matches Prisma but name and team still resolve canonically', async () => {
    const docs = [
      {
        data: () => ({
          season: 2026,
          round_number: 1,
          player_id: 'nasiah_wanganeenmilera',
          player_name: 'Nasiah Wanganeen-Milera',
          team: 'St Kilda',
          opposition: 'Collingwood',
          match_id: '2026-R0-STK-COL',
          match_date: '2026-03-01',
          canonical_stats: {
            version: 1,
            source_name: 'footywire_match',
            stats: {
              goals: 1,
              behinds: 0,
              kicks: 16,
              handballs: 8,
              disposals: 24,
              marks: 6,
              tackles: 2,
              hit_outs: 0,
              clearances: 1,
              inside_50s: 2,
              rebound_50s: 5,
              clangers: 1,
              contested_possessions: 0,
              uncontested_possessions: 0,
              frees_for: 0,
              frees_against: 1,
              one_percenters: 0,
              goal_assists: 0,
              turnovers: 0,
              intercepts: 0,
              metres_gained: 0,
              contested_marks: 0,
              effective_disposals: 0,
              score_involvements: 0,
              minutes: 0,
              tog_pct: 0,
              disposal_efficiency: 0,
            },
            availability: {
              goals: true,
              behinds: false,
              kicks: true,
              handballs: true,
              disposals: true,
              marks: true,
              tackles: true,
              hit_outs: true,
              clearances: true,
              inside_50s: true,
              rebound_50s: true,
              clangers: true,
              contested_possessions: false,
              uncontested_possessions: false,
              frees_for: true,
              frees_against: true,
              one_percenters: false,
              goal_assists: false,
              turnovers: false,
              intercepts: false,
              metres_gained: false,
              contested_marks: false,
              effective_disposals: false,
              score_involvements: false,
              minutes: false,
              tog_pct: false,
              disposal_efficiency: false,
            },
            provenance: {
              goals: 'footywire_match',
              kicks: 'footywire_match',
              handballs: 'footywire_match',
              disposals: 'footywire_match',
            },
            source_priority: ['footywire_match'],
            raw_source_rows: null,
          },
          last_updated: new Date('2026-03-01T12:00:00Z'),
        }),
      },
    ];

    const firestore = {
      collection: vi.fn((name: string) => {
        if (name === 'player_match_stats') {
          return {
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            startAfter: vi.fn().mockReturnThis(),
            get: vi
              .fn()
              .mockResolvedValueOnce({ empty: false, docs, size: docs.length })
              .mockResolvedValueOnce({ empty: true, docs: [], size: 0 }),
          };
        }

        if (name === 'matches') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [
                {
                  id: '2026-R0-STK-COL',
                  data: () => ({
                    match_uid: '2026-R0-STK-COL',
                    home_team: 'St Kilda',
                    away_team: 'Collingwood',
                    season: 2026,
                    round_number: 1,
                  }),
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected collection ${name}`);
      }),
    };

    const prismaClient = {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'nasiah_wmilera',
            name: 'Nasiah Wanganeen-Milera',
            club: 'St Kilda',
            position: 'DEF',
            active: true,
          },
        ]),
      },
    } as any;

    const result = await buildPlayerSeasonSummaries({
      season: 2026,
      firestore: firestore as any,
      prismaClient,
    });

    expect(result.skippedWithoutCanonicalId).toBe(0);
    expect(result.fallbackResolvedPlayerProfiles).toBe(1);
    expect(result.skippedWithoutResolvedPlayerProfile).toBe(0);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]?.playerId).toBe('nasiah_wmilera');
    expect(result.matchLogProjections).toHaveLength(1);
    expect(result.matchLogProjections[0]?.playerId).toBe('nasiah_wmilera');
    expect(result.matchLogProjections[0]?.matchId).toBe('2026-R0-STK-COL');
  });

  it('prefers the repaired canonical raw row when a stale duplicate exists for the same player-match', async () => {
    const docs = [
      {
        data: () => ({
          season: 2026,
          round_number: 2,
          player_id: 'james_odonnell',
          player_name: "James O'Donnell",
          team: 'Western Bulldogs',
          opposition: 'Adelaide',
          match_id: '2026-R2-WBD-ADE',
          match_date: '2026-03-20T08:10:00.000Z',
          kicks: 0,
          handballs: 0,
          disposals: 0,
          marks: 0,
          tackles: 0,
          goals: 0,
          behinds: 0,
          hitouts: 0,
          clangers: 0,
          last_updated: new Date('2026-03-20T12:00:00Z'),
        }),
      },
      {
        data: () => ({
          season: 2026,
          round_number: 2,
          player_id: 'james_odonnell',
          player_name: "James O'Donnell",
          team: 'Western Bulldogs',
          opposition: 'Adelaide',
          match_id: '2026-R2-ADE-BUL',
          match_date: '2026-03-20',
          canonical_stats: {
            version: 1,
            source_name: 'fitzroy_merged',
            stats: {
              goals: 0,
              behinds: 0,
              kicks: 5,
              handballs: 3,
              disposals: 8,
              marks: 1,
              tackles: 2,
              hit_outs: 0,
              clearances: 0,
              inside_50s: 0,
              rebound_50s: 3,
              clangers: 0,
              contested_possessions: 5,
              uncontested_possessions: 3,
              frees_for: 1,
              frees_against: 0,
              one_percenters: 7,
              goal_assists: 0,
              turnovers: 1,
              intercepts: 6,
              metres_gained: 155,
              contested_marks: 1,
              effective_disposals: 8,
              score_involvements: 2,
              minutes: 66,
              tog_pct: 83,
              disposal_efficiency: 100,
            },
            availability: {
              goals: true,
              behinds: true,
              kicks: true,
              handballs: true,
              disposals: true,
              marks: true,
              tackles: true,
              hit_outs: true,
              clearances: true,
              inside_50s: true,
              rebound_50s: true,
              clangers: true,
              contested_possessions: true,
              uncontested_possessions: true,
              frees_for: true,
              frees_against: true,
              one_percenters: true,
              goal_assists: true,
              turnovers: true,
              intercepts: true,
              metres_gained: true,
              contested_marks: true,
              effective_disposals: true,
              score_involvements: true,
              minutes: true,
              tog_pct: true,
              disposal_efficiency: true,
            },
            provenance: {
              kicks: 'footywire_match',
              handballs: 'footywire_match',
              disposals: 'footywire_match',
            },
            source_priority: ['footywire_match'],
            raw_source_rows: null,
          },
          last_updated: new Date('2026-03-21T12:00:00Z'),
        }),
      },
    ];

    const firestore = {
      collection: vi.fn((name: string) => {
        if (name === 'player_match_stats') {
          return {
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            startAfter: vi.fn().mockReturnThis(),
            get: vi
              .fn()
              .mockResolvedValueOnce({ empty: false, docs, size: docs.length })
              .mockResolvedValueOnce({ empty: true, docs: [], size: 0 }),
          };
        }

        if (name === 'matches') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [
                {
                  id: '2026-R2-ADE-BUL',
                  data: () => ({
                    match_uid: '2026-R2-ADE-BUL',
                    home_team: 'Adelaide',
                    away_team: 'Western Bulldogs',
                    season: 2026,
                    round_number: 2,
                  }),
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected collection ${name}`);
      }),
    };

    const prismaClient = {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'james_odonnell',
            name: "James O'Donnell",
            club: 'Western Bulldogs',
            position: 'DEF',
            active: true,
          },
        ]),
      },
    } as any;

    const result = await buildPlayerSeasonSummaries({
      season: 2026,
      firestore: firestore as any,
      prismaClient,
    });

    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]?.gamesPlayed).toBe(1);
    expect(result.summaries[0]?.totals.kicks).toBe(5);
    expect(result.matchLogProjections).toHaveLength(1);
    expect(result.matchLogProjections[0]?.matchId).toBe('2026-R2-ADE-BUL');
    expect(result.matchLogProjections[0]?.stats.kicks).toBe(5);
    expect(result.matchLogProjections[0]?.stats.intercepts).toBe(6);
  });

  it('includes legacy stored player ids when rebuilding a scoped canonical player', async () => {
    const docs = [
      {
        data: () => ({
          season: 2026,
          round_number: 1,
          player_id: 'cooper_dufftytler',
          player_name: 'Cooper Duff-Tytler',
          team: 'West Coast',
          opposition: 'Gold Coast',
          match_id: '2026-R1-GCS-WCE',
          match_date: '2026-03-15',
          canonical_stats: {
            version: 1,
            source_name: 'fitzroy_merged',
            stats: {
              kicks: 5,
              handballs: 3,
              disposals: 8,
              marks: 1,
              tackles: 5,
              goals: 0,
              behinds: 1,
              hit_outs: 5,
            },
            availability: {
              kicks: true,
              handballs: true,
              disposals: true,
              marks: true,
              tackles: true,
              goals: true,
              behinds: true,
              hit_outs: true,
            },
            provenance: {
              kicks: 'footywire_match',
              handballs: 'footywire_match',
              disposals: 'footywire_match',
            },
            source_priority: ['footywire_match'],
            raw_source_rows: null,
          },
          last_updated: new Date('2026-03-15T12:00:00Z'),
        }),
      },
    ];
    const whereCalls: Array<[string, string, unknown]> = [];

    const firestore = {
      collection: vi.fn((name: string) => {
        if (name === 'player_match_stats') {
          const query = {
            where: vi.fn((field: string, operator: string, value: unknown) => {
              whereCalls.push([field, operator, value]);
              return query;
            }),
            get: vi.fn().mockResolvedValue({ empty: false, docs, size: docs.length }),
          };
          return query;
        }

        if (name === 'matches') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
          };
        }

        throw new Error(`Unexpected collection ${name}`);
      }),
    };

    const prismaClient = {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cooper_duff_tytler',
            name: 'Cooper Duff-Tytler',
            club: 'West Coast',
            position: 'RUC',
            active: true,
          },
        ]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as any;

    const result = await buildPlayerSeasonSummaries({
      season: 2026,
      firestore: firestore as any,
      prismaClient,
      playerIds: ['cooper_duff_tytler'],
    });

    expect(whereCalls).toContainEqual([
      'player_id',
      'in',
      ['cooper_duff_tytler', 'cooper_dufftytler'],
    ]);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]?.playerId).toBe('cooper_duff_tytler');
    expect(result.summaries[0]?.totals.kicks).toBe(5);
    expect(result.matchLogProjections[0]?.stats.disposals).toBe(8);
  });
});

describe('listCanonicalPlayerIdsForRounds', () => {
  it('returns resolved canonical player ids instead of legacy stored ids', async () => {
    const firestore = {
      collection: vi.fn((name: string) => {
        if (name !== 'player_match_stats') {
          throw new Error(`Unexpected collection ${name}`);
        }

        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            docs: [
              {
                data: () => ({
                  season: 2026,
                  round_number: 1,
                  player_id: 'cooper_dufftytler',
                  player_name: 'Cooper Duff-Tytler',
                  team: 'West Coast',
                }),
              },
            ],
          }),
        };
      }),
    };
    const prismaClient = {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cooper_duff_tytler',
            name: 'Cooper Duff-Tytler',
            club: 'West Coast',
            position: 'RUC',
            active: true,
          },
        ]),
      },
    } as any;

    await expect(
      listCanonicalPlayerIdsForRounds({
        season: 2026,
        rounds: [1],
        firestore: firestore as any,
        prismaClient,
      })
    ).resolves.toEqual(['cooper_duff_tytler']);
  });
});

describe('resolveRawReconciliationPlayerId', () => {
  it('keeps the stored raw player id while reconciling to the canonical player id', () => {
    const resolver = createPlayerIdentityResolver([
      {
        id: 'nasiah_wmilera',
        name: 'Nasiah Wanganeen-Milera',
        club: 'St Kilda',
        position: 'DEF',
      },
    ]);

    const resolved = resolveRawReconciliationPlayerId(
      {
        player_id: 'nasiah_wanganeenmilera',
        player_name: 'Nasiah Wanganeen-Milera',
        team: 'St Kilda',
      },
      resolver
    );

    expect(resolved).toEqual({
      storagePlayerId: 'nasiah_wanganeenmilera',
      playerId: 'nasiah_wmilera',
    });
  });
});

describe('listRawMatchLogStageRows', () => {
  it('emits only the best raw alias row for a canonical player-match', async () => {
    const docs = [
      {
        id: '2026-R1-BUL-GWS_ply_harrison_himmelberg',
        data: () => ({
          season: 2026,
          round_number: 1,
          player_id: 'harrison_himmelberg',
          player_name: 'Harrison Himmelberg',
          team: 'GWS',
          opposition: 'Western Bulldogs',
          match_id: '2026-R1-BUL-GWS',
          canonical_stats: {
            version: 1,
            source_name: 'fitzroy_merged',
            stats: {
              goals: 0,
              behinds: 0,
              kicks: 11,
              handballs: 6,
              disposals: 17,
              marks: 8,
              tackles: 0,
              hit_outs: 0,
              clearances: 0,
              inside_50s: 2,
              rebound_50s: 4,
              clangers: 2,
              contested_possessions: 5,
              uncontested_possessions: 12,
              frees_for: 1,
              frees_against: 0,
              one_percenters: 3,
              goal_assists: 0,
              turnovers: 4,
              intercepts: 4,
              metres_gained: 250,
              contested_marks: 0,
              effective_disposals: 14,
              score_involvements: 5,
              minutes: 51,
              tog_pct: 64,
              disposal_efficiency: 82.4,
            },
            availability: {
              goals: true,
              behinds: true,
              kicks: true,
              handballs: true,
              disposals: true,
              marks: true,
              tackles: true,
              hit_outs: true,
              clearances: true,
              inside_50s: true,
              rebound_50s: true,
              clangers: true,
              contested_possessions: true,
              uncontested_possessions: true,
              frees_for: true,
              frees_against: true,
              one_percenters: true,
              goal_assists: true,
              turnovers: true,
              intercepts: true,
              metres_gained: true,
              contested_marks: true,
              effective_disposals: true,
              score_involvements: true,
              minutes: true,
              tog_pct: true,
              disposal_efficiency: true,
            },
          },
          last_updated: new Date('2026-03-14T12:00:00Z'),
        }),
      },
      {
        id: '2026-R1-BUL-GWS_ply_harry_himmelberg',
        data: () => ({
          season: 2026,
          round_number: 1,
          player_id: 'harrison_himmelberg',
          player_name: 'Harry Himmelberg',
          team: 'Greater Western Sydney',
          opposition: 'Hawthorn',
          match_id: '2026-R1-BUL-GWS',
          canonical_stats: {
            version: 1,
            source_name: 'fitzroy_merged',
            stats: {
              goals: 0,
              behinds: 0,
              kicks: 8,
              handballs: 11,
              disposals: 19,
              marks: 5,
              tackles: 2,
              hit_outs: 0,
              clearances: 1,
              inside_50s: 2,
              rebound_50s: 3,
              clangers: 3,
              contested_possessions: 4,
              uncontested_possessions: 15,
              frees_for: 0,
              frees_against: 1,
              one_percenters: 1,
              goal_assists: 0,
              turnovers: 0,
              intercepts: 0,
              metres_gained: 0,
              contested_marks: 0,
              effective_disposals: 0,
              score_involvements: 0,
              minutes: 62,
              tog_pct: 78,
              disposal_efficiency: 0,
            },
            availability: {
              goals: true,
              behinds: true,
              kicks: true,
              handballs: true,
              disposals: true,
              marks: true,
              tackles: true,
              hit_outs: true,
              clearances: true,
              inside_50s: true,
              rebound_50s: true,
              clangers: true,
              contested_possessions: true,
              uncontested_possessions: true,
              frees_for: true,
              frees_against: true,
              one_percenters: true,
              goal_assists: true,
              turnovers: false,
              intercepts: false,
              metres_gained: false,
              contested_marks: true,
              effective_disposals: false,
              score_involvements: false,
              minutes: true,
              tog_pct: true,
              disposal_efficiency: false,
            },
          },
          last_updated: new Date('2026-03-14T11:00:00Z'),
        }),
      },
    ];

    Object.assign(adminDb as object, {
      collection: vi.fn((name: string) => {
        if (name === 'player_match_stats') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ docs }),
          };
        }

        if (name === 'matches') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [
                {
                  id: '2026-R1-BUL-GWS',
                  data: () => ({
                    match_uid: '2026-R1-BUL-GWS',
                    home_team: 'Western Bulldogs',
                    away_team: 'GWS',
                    season: 2026,
                    round_number: 1,
                  }),
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    Object.assign(prisma as object, {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'harrison_himmelberg',
            name: 'Harrison Himmelberg',
            club: 'GWS',
            position: 'DEF',
            active: true,
          },
        ]),
      },
    });

    const rows = await listRawMatchLogStageRows({ season: 2026 });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.playerId).toBe('harrison_himmelberg');
    expect(rows[0]?.playerName).toBe('Harrison Himmelberg');
    expect(rows[0]?.matchId).toBe('2026-R1-BUL-GWS');
    expect(rows[0]?.stage.kicks.value).toBe(11);
    expect(rows[0]?.stage.metresGained.value).toBe(250);
  });

  it('resolves stale round-zero raw match ids through canonical match metadata', async () => {
    const docs = [
      {
        id: '2026-R0-BRL-WBD_ply_zane_zakostelsky',
        data: () => ({
          season: 2026,
          round_number: 0,
          player_id: 'zane_zakostelsky',
          player_name: 'Zane Zakostelsky',
          team: 'BRL',
          opposition: 'WBD',
          match_id: '2026-R0-BRL-WBD',
          canonical_stats: {
            version: 1,
            source_name: 'footywire_match',
            stats: {
              goals: 1,
              kicks: 3,
              handballs: 3,
              disposals: 6,
            },
            availability: {
              goals: true,
              kicks: true,
              handballs: true,
              disposals: true,
            },
            provenance: {
              goals: 'footywire_match',
              kicks: 'footywire_match',
              handballs: 'footywire_match',
              disposals: 'footywire_match',
            },
            source_priority: ['footywire_match'],
            raw_source_rows: null,
          },
          last_updated: new Date('2026-03-07T12:00:00Z'),
        }),
      },
    ];

    Object.assign(adminDb as object, {
      collection: vi.fn((name: string) => {
        if (name === 'player_match_stats') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ docs }),
          };
        }

        if (name === 'matches') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [
                {
                  id: '2026-R0-BRI-BUL',
                  data: () => ({
                    match_uid: '2026-R0-BRI-BUL',
                    home_team: 'Brisbane',
                    away_team: 'Western Bulldogs',
                    season: 2026,
                    round_number: 0,
                  }),
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    Object.assign(prisma as object, {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'zane_zakostelsky',
            name: 'Zane Zakostelsky',
            club: 'Brisbane',
            position: 'DEF',
            active: true,
          },
        ]),
      },
    });

    const rows = await listRawMatchLogStageRows({ season: 2026 });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.matchId).toBe('2026-R0-BRI-BUL');
    expect(rows[0]?.storageMatchId).toBe('2026-R0-BRL-WBD');
    expect(rows[0]?.entityKey).toBe('match|2026_r0_bri_bul|player_id|zane_zakostelsky');
  });

  it('limits raw reconciliation rows to requested rounds', async () => {
    const docs = [
      {
        id: '2026-R0-GWS-BUL_ply_joseph_fonti',
        data: () => ({
          season: 2026,
          round_number: 0,
          player_id: 'joseph_fonti',
          player_name: 'Joseph Fonti',
          team: 'GWS',
          opposition: 'Western Bulldogs',
          match_id: '2026-R0-GWS-BUL',
          canonical_stats: {
            version: 1,
            source_name: 'fitzroy_merged',
            stats: { disposals: 10 },
            availability: { disposals: true },
          },
        }),
      },
      {
        id: '2026-R1-SYD-BRI_ply_logan_mcdonald',
        data: () => ({
          season: 2026,
          round_number: 1,
          player_id: 'logan_mcdonald',
          player_name: 'Logan McDonald',
          team: 'Sydney',
          opposition: 'Brisbane Lions',
          match_id: '2026-R1-SYD-BRI',
          canonical_stats: {
            version: 1,
            source_name: 'fitzroy_merged',
            stats: { disposals: 12 },
            availability: { disposals: true },
          },
        }),
      },
    ];

    Object.assign(adminDb as object, {
      collection: vi.fn((name: string) => {
        if (name === 'player_match_stats') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ docs }),
          };
        }

        if (name === 'matches') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [
                {
                  id: '2026-R0-GWS-BUL',
                  data: () => ({
                    match_uid: '2026-R0-GWS-BUL',
                    home_team: 'GWS',
                    away_team: 'Western Bulldogs',
                    season: 2026,
                    round_number: 0,
                  }),
                },
                {
                  id: '2026-R1-SYD-BRI',
                  data: () => ({
                    match_uid: '2026-R1-SYD-BRI',
                    home_team: 'Sydney',
                    away_team: 'Brisbane Lions',
                    season: 2026,
                    round_number: 1,
                  }),
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    Object.assign(prisma as object, {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'joseph_fonti',
            name: 'Joseph Fonti',
            club: 'GWS',
            position: 'DEF',
            active: true,
          },
          {
            id: 'logan_mcdonald',
            name: 'Logan McDonald',
            club: 'Sydney',
            position: 'FWD',
            active: true,
          },
        ]),
      },
    });

    const rows = await listRawMatchLogStageRows({ season: 2026, rounds: [0] });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.roundNumber).toBe(0);
    expect(rows[0]?.playerId).toBe('joseph_fonti');
  });

  it('skips raw rows that cannot be reconciled to match metadata for the round', async () => {
    const docs = [
      {
        id: '2026-R1-BRL-WBD_ply_zane_zakostelsky',
        data: () => ({
          season: 2026,
          round_number: 1,
          player_id: 'zane_zakostelsky',
          player_name: 'Zane Zakostelsky',
          team: 'BRL',
          opposition: 'WBD',
          match_id: '2026-R1-BRL-WBD',
          canonical_stats: {
            version: 1,
            source_name: 'afltables',
            stats: {
              goals: 1,
              kicks: 3,
            },
            availability: {
              goals: true,
              kicks: true,
            },
            provenance: {
              goals: 'afltables',
              kicks: 'afltables',
            },
            source_priority: ['afltables'],
            raw_source_rows: null,
          },
          last_updated: new Date('2026-03-15T12:00:00Z'),
        }),
      },
    ];

    Object.assign(adminDb as object, {
      collection: vi.fn((name: string) => {
        if (name === 'player_match_stats') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ docs }),
          };
        }

        if (name === 'matches') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [
                {
                  id: '2026-R1-SYD-BRI',
                  data: () => ({
                    match_uid: '2026-R1-SYD-BRI',
                    home_team: 'Sydney',
                    away_team: 'Brisbane',
                    season: 2026,
                    round_number: 1,
                  }),
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    Object.assign(prisma as object, {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'zane_zakostelsky',
            name: 'Zane Zakostelsky',
            club: 'Brisbane',
            position: 'DEF',
            active: true,
          },
        ]),
      },
    });

    await expect(listRawMatchLogStageRows({ season: 2026 })).resolves.toEqual([]);
  });
});

describe('resolveCanonicalMatchIdFromRecord', () => {
  it('reconciles stale legacy match ids like KAN-POR to canonical match identity', () => {
    const matchId = resolveCanonicalMatchIdFromRecord(
      {
        season: 2026,
        round_number: 1,
        team: 'Kangaroos',
        opposition: 'Port Adelaide',
        match_id: '2026-R1-KAN-POR',
      },
      [
        {
          match_uid: '2026-R1-NOR-POR',
          home_team: 'North Melbourne',
          away_team: 'Port Adelaide',
        },
      ]
    );

    expect(matchId).toBe('2026-R1-NOR-POR');
  });

  it('reconciles stale Brisbane and Bulldogs match codes to canonical match identity', () => {
    const matchId = resolveCanonicalMatchIdFromRecord(
      {
        season: 2026,
        round_number: 0,
        team: 'BRL',
        opposition: 'WBD',
        match_id: '2026-R0-BRL-WBD',
      },
      [
        {
          match_uid: '2026-R0-BRI-BUL',
          home_team: 'Brisbane',
          away_team: 'Western Bulldogs',
        },
      ]
    );

    expect(matchId).toBe('2026-R0-BRI-BUL');
  });
});
