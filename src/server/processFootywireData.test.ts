import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  recordUnresolvedPlayerStatRow,
  resolvePlayerIdentity,
  firestoreMatchDocGet,
  firestoreStatDocGet,
  firestoreDocSet,
  firestoreDocDelete,
  firestoreMatchesGet,
} = vi.hoisted(() => ({
  recordUnresolvedPlayerStatRow: vi.fn(),
  resolvePlayerIdentity: vi.fn(),
  firestoreMatchDocGet: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
  firestoreStatDocGet: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
  firestoreDocSet: vi.fn().mockResolvedValue(undefined),
  firestoreDocDelete: vi.fn().mockResolvedValue(undefined),
  firestoreMatchesGet: vi.fn().mockResolvedValue({
    empty: false,
    docs: [
      {
        id: '2026-R1-SYD-CAR',
        data: () => ({
          match_uid: '2026-R1-SYD-CAR',
          home_team: 'Sydney',
          away_team: 'Carlton',
          status: 'final',
        }),
      },
    ],
  }),
}));

vi.mock('../../shared/db/prisma', () => ({
  prisma: {},
}));

vi.mock('../../shared/player-identity/playerIdentityResolver', () => ({
  recordUnresolvedPlayerStatRow,
  resolvePlayerIdentity,
}));

vi.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: vi.fn(),
  credential: {
    cert: vi.fn(),
  },
  firestore: Object.assign(
    vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === 'matches') {
          return {
            doc: vi.fn(() => ({
              get: firestoreMatchDocGet,
            })),
            where: vi.fn(() => ({
              where: vi.fn(() => ({
                get: firestoreMatchesGet,
              })),
            })),
          };
        }

        return {
          doc: vi.fn(() => ({
            get: firestoreStatDocGet,
            set: firestoreDocSet,
            delete: firestoreDocDelete,
          })),
        };
      }),
    })),
    {
      FieldValue: {
        serverTimestamp: vi.fn(() => 'server-timestamp'),
      },
    }
  ),
}));

import {
  buildCanonicalRawMatchContract,
  clearRoundMatchCache,
  hasCanonicalRawMatchContract,
  processPlayerRow,
} from '../../etl/processFootywireData';

describe('processPlayerRow quarantine flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRoundMatchCache();
    firestoreMatchDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
    firestoreStatDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
    firestoreDocSet.mockResolvedValue(undefined);
    firestoreDocDelete.mockResolvedValue(undefined);
    firestoreMatchesGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: '2026-R1-SYD-CAR',
          data: () => ({
            match_uid: '2026-R1-SYD-CAR',
            home_team: 'Sydney',
            away_team: 'Carlton',
            status: 'final',
          }),
        },
      ],
    });
    process.env.BACKFILL_MODE = 'true';
    delete process.env.OBSERVE_ONLY;
    delete process.env.ETL_OBSERVE_MODE;
  });

  it('observes unresolved identities without writing quarantine rows', async () => {
    process.env.OBSERVE_ONLY = 'true';
    resolvePlayerIdentity.mockResolvedValue({
      outcome: 'unresolved',
      candidates: [],
      diagnostics: {
        playerName: 'Mystery Player',
        normalizedPlayerNames: ['mystery player'],
        normalizedTeam: 'western bulldogs',
      },
    });

    const result = await processPlayerRow({
      season: 2026,
      round: 1,
      team: 'Western Bulldogs',
      opposition: 'Carlton',
      player_name: 'Mystery Player',
    });

    expect(result).toBe('observed_quarantined_unresolved');
    expect(recordUnresolvedPlayerStatRow).not.toHaveBeenCalled();
  });

  it('quarantines unresolved identities into Prisma when observe mode is off', async () => {
    resolvePlayerIdentity.mockResolvedValue({
      outcome: 'unresolved',
      candidates: [],
      diagnostics: {
        playerName: 'Mystery Player',
        normalizedPlayerNames: ['mystery player'],
        normalizedTeam: 'western bulldogs',
      },
    });

    const result = await processPlayerRow({
      season: 2026,
      round: 1,
      team: 'Western Bulldogs',
      opposition: 'Carlton',
      player_name: 'Mystery Player',
    });

    expect(result).toBe('quarantined_unresolved');
    expect(recordUnresolvedPlayerStatRow).toHaveBeenCalledOnce();
  });

  it('persists the canonical raw-match contract on resolved writes', async () => {
    const contract = buildCanonicalRawMatchContract({
      row: {
        season: 2026,
        round: 1,
        team: 'Carlton',
        opposition: 'Sydney',
        player_name: 'Adam Saad',
        kicks: 5,
        handballs: 6,
        disposals: 11,
        metres_gained: 221,
        disposal_efficiency: 81.8,
        source_name: 'footywire_match',
        source_provenance: {
          metres_gained: 'footywire_match',
          disposal_efficiency: 'footywire_match',
        },
        source_priority: ['footywire_match', 'afltables'],
        raw_source_rows: {
          footywire_match: { metres_gained: 221 },
        },
      },
      stats: {
        kicks: 5,
        handballs: 6,
        disposals: 11,
        marks: 0,
        tackles: 0,
        goals: 0,
        behinds: 0,
        hit_outs: 0,
        clearances: 0,
        inside_50s: 0,
        rebound_50s: 0,
        clangers: 0,
        contested_possessions: 0,
        uncontested_possessions: 0,
        frees_for: 0,
        frees_against: 0,
        one_percenters: 0,
        goal_assists: 0,
        turnovers: 0,
        intercepts: 0,
        metres_gained: 221,
        contested_marks: 0,
        effective_disposals: 0,
        score_involvements: 0,
        minutes: 0,
        tog_pct: 0,
        disposal_efficiency: 81.8,
      },
      dataSource: 'footywire_fitzroy',
    });

    expect(contract).toEqual({
      version: 1,
      source_name: 'footywire_match',
      stats: expect.objectContaining({
        disposals: 11,
        metres_gained: 221,
        disposal_efficiency: 81.8,
      }),
      availability: expect.objectContaining({
        disposals: true,
        metres_gained: true,
        disposal_efficiency: true,
        score_involvements: false,
      }),
      provenance: expect.objectContaining({
        metres_gained: 'footywire_match',
        disposal_efficiency: 'footywire_match',
      }),
      source_priority: ['footywire_match', 'afltables'],
      raw_source_rows: {
        footywire_match: { metres_gained: 221 },
      },
    });
  });

  it('detects whether an existing raw doc has the canonical contract', () => {
    expect(
      hasCanonicalRawMatchContract({
        version: 1,
        stats: {},
        availability: {},
      })
    ).toBe(true);

    expect(
      hasCanonicalRawMatchContract({
        stats: {},
        availability: {},
      })
    ).toBe(false);
  });

});
