import { describe, expect, it } from 'vitest';

import {
  buildFootywireCanonicalRawMatchContract,
  readFootywireCanonicalStatNumber,
  readFootywireCanonicalStatPresence,
  readFootywireCanonicalStatProvenance,
  type FootywireCanonicalStats,
} from '@/lib/stats/footywireCanonicalContract';

function buildStats(overrides: Partial<FootywireCanonicalStats> = {}): FootywireCanonicalStats {
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

describe('Footywire canonical contract readers', () => {
  it('treats availability as the source of presence for zero values', () => {
    const contract = buildFootywireCanonicalRawMatchContract({
      stats: buildStats({ metres_gained: 0 }),
      availability: { metres_gained: true },
      sourceName: 'fitzroy_merged',
    });

    expect(readFootywireCanonicalStatPresence(contract, 'metresGained')).toEqual({
      hasValue: true,
      hasNonZeroValue: false,
    });
  });

  it('treats unavailable stats as absent even when a numeric value exists', () => {
    const contract = buildFootywireCanonicalRawMatchContract({
      stats: buildStats({ metres_gained: 412 }),
      availability: { metres_gained: false },
      sourceName: 'fitzroy_merged',
    });

    expect(readFootywireCanonicalStatNumber(contract, 'metresGained')).toEqual({
      found: true,
      value: 412,
    });
    expect(readFootywireCanonicalStatPresence(contract, 'metresGained')).toEqual({
      hasValue: false,
      hasNonZeroValue: false,
    });
  });

  it('falls back to stat field presence when availability is absent', () => {
    const contract = {
      version: 1,
      source_name: 'fitzroy_merged',
      stats: { MG: '315' },
      availability: {},
      provenance: {},
      source_priority: ['fitzroy_merged'],
      raw_source_rows: null,
    };

    expect(readFootywireCanonicalStatNumber(contract, 'metresGained')).toEqual({
      found: true,
      value: 315,
    });
    expect(readFootywireCanonicalStatPresence(contract, 'metresGained')).toEqual({
      hasValue: true,
      hasNonZeroValue: true,
    });
  });

  it('reads provenance through canonical stat aliases', () => {
    const contract = {
      version: 1,
      source_name: 'fitzroy_merged',
      stats: {},
      availability: {},
      provenance: { MG: 'afltables' },
      source_priority: ['fitzroy_merged'],
      raw_source_rows: null,
    };

    expect(readFootywireCanonicalStatProvenance(contract, 'metresGained')).toBe(
      'afltables'
    );
  });
});
