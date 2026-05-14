import { describe, expect, it } from 'vitest';

import {
  buildCanonicalPlayerMatchWarehouseRow,
  type FirestoreCanonicalPlayerMatchDocument,
} from './canonicalPlayerMatchRow';
import {
  buildFootywireCanonicalRawMatchContract,
  type FootywireCanonicalStats,
} from '@/lib/stats/footywireCanonicalContract';

function buildStats(
  overrides: Partial<FootywireCanonicalStats> = {}
): FootywireCanonicalStats {
  return {
    kicks: 0,
    handballs: 0,
    disposals: 0,
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
    metres_gained: 0,
    contested_marks: 0,
    effective_disposals: 0,
    score_involvements: 0,
    minutes: 0,
    tog_pct: 0,
    disposal_efficiency: 0,
    ...overrides,
  };
}

function buildDocument(
  overrides: Partial<FirestoreCanonicalPlayerMatchDocument> = {}
): FirestoreCanonicalPlayerMatchDocument {
  return {
    id: '2026-R1-COL-ADE-nick_daicos',
    match_id: '2026-R1-COL-ADE',
    player_id: 'nick_daicos',
    season: 2026,
    round_number: 1,
    player_name: 'Nick Daicos',
    team: 'Collingwood',
    opposition: 'Adelaide',
    match_date: '2026-03-20',
    data_source: 'afltables,footywire_match',
    raw_checksum: 'checksum-1',
    canonical_stats: buildFootywireCanonicalRawMatchContract({
      stats: buildStats({ disposals: 32, metres_gained: 0 }),
      availability: {
        disposals: true,
        metres_gained: true,
        disposal_efficiency: false,
      },
      provenance: {
        disposals: 'footywire_match',
        metres_gained: 'afltables',
      },
      sourceName: 'fitzroy_merged',
      sourcePriority: ['footywire_match', 'afltables'],
      rawSourceRows: { footywire_match: { row: 1 } },
    }),
    canonical_match_metadata: {
      match_date: '2026-03-20',
      start_time_utc: '2026-03-20T08:40:00.000Z',
      venue: 'MCG',
      status: 'final',
    },
    ...overrides,
  };
}

describe('buildCanonicalPlayerMatchWarehouseRow', () => {
  it('maps only canonical_stats even when legacy stats/raw_row have conflicting values', () => {
    const document = buildDocument({
      stats: { disposals: 99 },
      raw_row: { disposals: 88 },
    } as unknown as Partial<FirestoreCanonicalPlayerMatchDocument>);
    const row = buildCanonicalPlayerMatchWarehouseRow(document);

    expect(row).toMatchObject({
      firestoreDocId: '2026-R1-COL-ADE-nick_daicos',
      matchId: '2026-R1-COL-ADE',
      playerId: 'nick_daicos',
      season: 2026,
      roundNumber: 1,
      playerName: 'Nick Daicos',
      playerClub: 'Collingwood',
      opponent: 'Adelaide',
      matchDate: '2026-03-20',
      startTimeUtc: '2026-03-20T08:40:00.000Z',
      venue: 'MCG',
      matchStatus: 'final',
      disposals: 32,
      disposalsPresent: true,
      disposalsProvenance: 'footywire_match',
      metresGained: 0,
      metresGainedPresent: true,
      metresGainedProvenance: 'afltables',
      disposalEffPctPresent: false,
      rawChecksum: 'checksum-1',
      contractVersion: 1,
    });
    expect(JSON.parse(row.statsJson)).toMatchObject({
      disposals: 32,
      metres_gained: 0,
    });
    expect(JSON.parse(row.availabilityJson)).toMatchObject({
      disposals: true,
      metres_gained: true,
      disposal_efficiency: false,
    });
    expect(JSON.parse(row.provenanceJson)).toMatchObject({
      disposals: 'footywire_match',
      metres_gained: 'afltables',
    });
  });

  it('rejects rows without canonical_stats with contract error', () => {
    expect(() =>
      buildCanonicalPlayerMatchWarehouseRow(
        buildDocument({ canonical_stats: null })
      )
    ).toThrow('canonical_stats contract is required for warehouse export');
  });

  it('rejects rows with incomplete canonical_stats contract', () => {
    expect(() =>
      buildCanonicalPlayerMatchWarehouseRow(
        buildDocument({
          canonical_stats: { version: 1, stats: {}, availability: {} },
        })
      )
    ).toThrow('canonical_stats contract is required for warehouse export');
  });

  it('rejects rows with array canonical_stats buckets', () => {
    expect(() =>
      buildCanonicalPlayerMatchWarehouseRow(
        buildDocument({
          canonical_stats: {
            version: 1,
            stats: [],
            availability: [],
            provenance: [],
          },
        })
      )
    ).toThrow('canonical_stats contract is required for warehouse export');
  });

  it('rejects rows without player_id with identity error', () => {
    expect(() =>
      buildCanonicalPlayerMatchWarehouseRow(
        buildDocument({
          player_id: null,
          playerId: 'legacy_id',
        } as unknown as Partial<FirestoreCanonicalPlayerMatchDocument>)
      )
    ).toThrow('player_id is required for warehouse export');
  });
});
