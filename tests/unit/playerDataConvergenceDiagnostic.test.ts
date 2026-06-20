import { describe, expect, it } from 'vitest';

import {
  diagnosePlayerDataConvergence,
  type CanonicalPlayerRow,
  type PlayerDataSourceRecord,
} from '@/server/playerDataConvergenceDiagnostic';

const expectedCategories = ['goals', 'inside50s', 'effectiveDisposals'] as const;

function completeStats(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    goals: 1,
    inside50s: 2,
    effectiveDisposals: 3,
    ...overrides,
  };
}

function diagnose(input: {
  canonicalPlayers: CanonicalPlayerRow[];
  sourceRecords: PlayerDataSourceRecord[];
  rankingRecords?: PlayerDataSourceRecord[];
}) {
  return diagnosePlayerDataConvergence({
    ...input,
    expectedCategoryKeys: expectedCategories,
  });
}

describe('player data convergence diagnostic', () => {
  it('matches source records by direct id', () => {
    const result = diagnose({
      canonicalPlayers: [{ id: 'caleb_daniel', name: 'Caleb Daniel', club: 'North Melbourne' }],
      sourceRecords: [
        { player_uid: 'caleb_daniel', player_name: 'Caleb Daniel', stats: completeStats() },
      ],
    });

    expect(result.summary.matchedRecordsByDirectId).toBe(1);
    expect(result.matches[0]).toMatchObject({
      canonicalPlayerId: 'caleb_daniel',
      method: 'directId',
    });
    expect(result.summary.severity).toBe('ok');
  });

  it('matches source records by canonical id without treating that as a direct match', () => {
    const result = diagnose({
      canonicalPlayers: [{ id: 'caleb_daniel', name: 'Caleb Daniel', club: 'North Melbourne' }],
      sourceRecords: [
        { player_uid: 'Caleb Daniel', player_name: 'Caleb Daniel', stats: completeStats() },
      ],
    });

    expect(result.summary.matchedRecordsByDirectId).toBe(0);
    expect(result.summary.matchedRecordsByCanonicalId).toBe(1);
    expect(result.matches[0]).toMatchObject({
      canonicalPlayerId: 'caleb_daniel',
      method: 'canonicalId',
    });
  });

  it('matches source records by normalized name and team', () => {
    const result = diagnose({
      canonicalPlayers: [{ id: 'tom_green', name: 'Tom Green', club: 'GWS' }],
      sourceRecords: [{ player_name: '  TOM   GREEN ', team: 'gws', stats: completeStats() }],
    });

    expect(result.summary.matchedRecordsByNormalizedNameTeam).toBe(1);
    expect(result.matches[0]).toMatchObject({
      canonicalPlayerId: 'tom_green',
      method: 'nameTeam',
    });
  });

  it('reports ambiguous name matches instead of guessing', () => {
    const result = diagnose({
      canonicalPlayers: [
        { id: 'sam_reid_sydney', name: 'Sam Reid', club: 'Sydney' },
        { id: 'sam_reid_gws', name: 'Sam Reid', club: 'GWS' },
      ],
      sourceRecords: [{ player_name: 'Sam Reid', stats: completeStats() }],
    });

    expect(result.summary.ambiguousNameMatches).toBe(1);
    expect(result.ambiguousNameMatches[0]).toMatchObject({
      sourceIdentity: 'sam_reid',
      candidatePlayerIds: ['sam_reid_sydney', 'sam_reid_gws'],
    });
    expect(result.summary.severity).toBe('error');
  });

  it('reports unmatched canonical players', () => {
    const result = diagnose({
      canonicalPlayers: [
        { id: 'matched_player', name: 'Matched Player', club: 'Carlton' },
        { id: 'missing_player', name: 'Missing Player', club: 'Richmond' },
      ],
      sourceRecords: [
        { player_uid: 'matched_player', player_name: 'Matched Player', stats: completeStats() },
      ],
    });

    expect(result.summary.unmatchedCanonicalPlayers).toBe(1);
    expect(result.unmatchedCanonicalPlayers).toEqual([
      { canonicalPlayerId: 'missing_player', name: 'Missing Player', team: 'Richmond' },
    ]);
    expect(result.summary.severity).toBe('warning');
  });

  it('reports unmatched source records', () => {
    const result = diagnose({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'ghost_player', player_name: 'Ghost Player', stats: completeStats() },
      ],
    });

    expect(result.summary.unmatchedSourceRecords).toBe(1);
    expect(result.unmatchedSourceRecords[0]).toMatchObject({
      sourceIdentity: 'ghost_player',
      name: 'Ghost Player',
    });
    expect(result.summary.severity).toBe('error');
  });

  it('reports duplicate source identities', () => {
    const result = diagnose({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
    });

    expect(result.summary.duplicateSourceIdentities).toBe(1);
    expect(result.duplicateSourceIdentities).toEqual([
      { sourceIdentity: 'known_player', sourceIndexes: [0, 1] },
    ]);
    expect(result.summary.severity).toBe('warning');
  });

  it('reports missing expected fantasy categories', () => {
    const result = diagnose({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        {
          player_uid: 'known_player',
          player_name: 'Known Player',
          stats: completeStats({ effectiveDisposals: undefined }),
        },
      ],
    });

    expect(result.summary.missingExpectedCategoryValues).toBe(1);
    expect(result.missingExpectedCategoryValues).toEqual([
      {
        sourceIndex: 0,
        sourceIdentity: 'known_player',
        category: 'effectiveDisposals',
      },
    ]);
    expect(result.categoryCoverage).toContainEqual({
      category: 'effectiveDisposals',
      present: 0,
      missing: 1,
    });
  });

  it('reports deprecated or stale category keys from ranking-like records', () => {
    const result = diagnose({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
      rankingRecords: [
        {
          player_uid: 'known_player',
          player_name: 'Known Player',
          categories: {
            goals: 1,
            inside_50s: 2,
            effective_disposals: 3,
          },
        },
      ],
    });

    expect(result.summary.totalRankingRecords).toBe(1);
    expect(result.deprecatedCategoryKeys).toEqual(
      expect.arrayContaining([
        {
          sourceIndex: 1,
          sourceIdentity: 'known_player',
          key: 'inside_50s',
          suggestedKey: 'inside50s',
        },
        {
          sourceIndex: 1,
          sourceIdentity: 'known_player',
          key: 'effective_disposals',
          suggestedKey: 'effectiveDisposals',
        },
      ])
    );
    expect(result.summary.deprecatedCategoryKeys).toBe(2);
  });

  it('returns an all-clear result when identities and categories converge', () => {
    const result = diagnose({
      canonicalPlayers: [
        { id: 'caleb_daniel', name: 'Caleb Daniel', club: 'North Melbourne' },
        { id: 'tom_green', name: 'Tom Green', club: 'GWS' },
      ],
      sourceRecords: [
        { player_uid: 'caleb_daniel', player_name: 'Caleb Daniel', stats: completeStats() },
        { player_uid: 'tom_green', player_name: 'Tom Green', stats: completeStats() },
      ],
    });

    expect(result.summary).toMatchObject({
      totalCanonicalPlayers: 2,
      totalSourceStatRecords: 2,
      matchedRecordsByDirectId: 2,
      unmatchedCanonicalPlayers: 0,
      unmatchedSourceRecords: 0,
      ambiguousNameMatches: 0,
      duplicateSourceIdentities: 0,
      missingExpectedCategoryValues: 0,
      deprecatedCategoryKeys: 0,
      severity: 'ok',
    });
    expect(result.recommendedNextAction).toContain('No convergence blockers detected');
  });
});
