import { describe, expect, it } from 'vitest';

import {
  diagnosePlayerDataConvergence,
  type CanonicalPlayerRow,
  type PlayerDataSourceRecord,
} from '@/server/playerDataConvergenceDiagnostic';
import { planPlayerDataConvergenceActions } from '@/server/playerDataConvergencePlanner';

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

function plan(input: {
  canonicalPlayers: CanonicalPlayerRow[];
  sourceRecords: PlayerDataSourceRecord[];
  rankingRecords?: PlayerDataSourceRecord[];
}) {
  return planPlayerDataConvergenceActions({
    diagnostic: diagnose(input),
    expectedCategoryKeys: expectedCategories,
  });
}

function actionKinds(input: ReturnType<typeof plan>): string[] {
  return input.actions.map((action) => action.kind);
}

describe('player data convergence planner', () => {
  it('produces no repair action for a clean diagnostic', () => {
    const result = plan({
      canonicalPlayers: [{ id: 'caleb_daniel', name: 'Caleb Daniel', club: 'North Melbourne' }],
      sourceRecords: [
        { player_uid: 'caleb_daniel', player_name: 'Caleb Daniel', stats: completeStats() },
      ],
    });

    expect(result).toMatchObject({
      status: 'allClear',
      safeForNextReadOnlyDryRun: true,
      safeForWritePlanning: false,
      requiresProductDecision: false,
    });
    expect(actionKinds(result)).toEqual(['noActionRequired', 'safeForNextReadOnlyDryRun']);
  });

  it('classifies all-null stat rows as skipped source evidence instead of repair work', () => {
    const result = plan({
      canonicalPlayers: [
        { id: 'tobie_travaglia_st_kilda', name: 'Tobie Travaglia', club: 'St Kilda' },
        { id: 'nathan_fyfe_fremantle', name: 'Nathan Fyfe', club: 'Fremantle' },
        { id: 'lachlan_mcneil_western_bulldogs', name: 'Lachlan McNeil', club: 'Western Bulldogs' },
        { id: 'mitchell_duncan_geelong', name: 'Mitchell Duncan', club: 'Geelong' },
      ],
      sourceRecords: [
        { player_name: 'Tobie Travaglia', team: 'St Kilda', stats: completeStats(nullStats()) },
        { player_name: 'Nathan Fyfe', team: 'Fremantle', stats: completeStats(nullStats()) },
        {
          player_name: 'Lachlan McNeil',
          team: 'Western Bulldogs',
          stats: completeStats(nullStats()),
        },
        { player_name: 'Mitchell Duncan', team: 'Geelong', stats: completeStats(nullStats()) },
      ],
    });

    const skippedAction = result.actions.find(
      (action) => action.kind === 'skippedNullStatSourceEvidence'
    );

    expect(skippedAction).toMatchObject({
      severity: 'warning',
      count: 4,
      sourceIndexes: [0, 1, 2, 3],
      categories: ['goals', 'inside50s', 'effectiveDisposals'],
    });
    expect(actionKinds(result)).not.toContain('identityReviewRequired');
    expect(actionKinds(result)).not.toContain('unsafeForWritePlanning');
    expect(result.safeForNextReadOnlyDryRun).toBe(true);
    expect(result.safeForWritePlanning).toBe(false);
  });

  it('blocks write planning for ambiguous name matches', () => {
    const result = plan({
      canonicalPlayers: [
        { id: 'sam_reid_sydney', name: 'Sam Reid', club: 'Sydney' },
        { id: 'sam_reid_gws', name: 'Sam Reid', club: 'GWS' },
      ],
      sourceRecords: [{ player_name: 'Sam Reid', stats: completeStats() }],
    });

    expect(actionKinds(result)).toEqual(
      expect.arrayContaining([
        'ambiguousNameReviewRequired',
        'unsafeForWritePlanning',
        'blockedPendingProductDecision',
      ])
    );
    expect(result).toMatchObject({
      status: 'blocked',
      safeForNextReadOnlyDryRun: false,
      safeForWritePlanning: false,
      requiresProductDecision: true,
    });
  });

  it('requires identity review for unmatched canonical players', () => {
    const result = plan({
      canonicalPlayers: [
        { id: 'matched_player', name: 'Matched Player', club: 'Carlton' },
        { id: 'missing_player', name: 'Missing Player', club: 'Richmond' },
      ],
      sourceRecords: [
        { player_uid: 'matched_player', player_name: 'Matched Player', stats: completeStats() },
      ],
    });

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: 'identityReviewRequired',
        severity: 'warning',
        count: 1,
        sourceIdentities: ['missing_player'],
      })
    );
    expect(result.safeForNextReadOnlyDryRun).toBe(true);
  });

  it('requires source review for unmatched source records', () => {
    const result = plan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'ghost_player', player_name: 'Ghost Player', stats: completeStats() },
      ],
    });

    expect(actionKinds(result)).toEqual(
      expect.arrayContaining(['sourceRecordReviewRequired', 'unsafeForWritePlanning'])
    );
    expect(result.safeForNextReadOnlyDryRun).toBe(false);
  });

  it('classifies repeated matched source identities as multi-row source evidence', () => {
    const result = plan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
    });

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: 'multiRowSourceEvidenceReviewRequired',
        severity: 'warning',
        count: 1,
        sourceIdentities: ['known_player'],
      })
    );
    expect(result.safeForNextReadOnlyDryRun).toBe(true);
    expect(result.safeForWritePlanning).toBe(false);
  });

  it('requires mapping review for stale snake_case category keys', () => {
    const result = plan({
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

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: 'staleCategoryKeyMappingReviewRequired',
        severity: 'warning',
        count: 2,
        categories: ['inside_50s', 'effective_disposals'],
      })
    );
  });

  it('warns on partial missing category values without automatic repair', () => {
    const result = plan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        {
          player_uid: 'known_player',
          player_name: 'Known Player',
          stats: completeStats({ effectiveDisposals: undefined }),
        },
      ],
    });

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: 'missingExpectedCategoryValueReviewRequired',
        severity: 'warning',
        count: 1,
        categories: ['effectiveDisposals'],
      })
    );
    expect(actionKinds(result)).not.toContain('unsafeForWritePlanning');
    expect(result.safeForWritePlanning).toBe(false);
  });

  it('marks severe diagnostics unsafe for write planning', () => {
    const result = plan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'ghost_player', player_name: 'Ghost Player', stats: completeStats() },
      ],
    });

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: 'unsafeForWritePlanning',
        severity: 'error',
      })
    );
    expect(result.status).toBe('blocked');
  });

  it('keeps the tracked-data warning shape safe for read-only follow-up', () => {
    const result = plan({
      canonicalPlayers: [
        { id: 'tobie_travaglia_st_kilda', name: 'Tobie Travaglia', club: 'St Kilda' },
      ],
      sourceRecords: [
        { player_name: 'Tobie Travaglia', team: 'St Kilda', stats: completeStats(nullStats()) },
      ],
    });

    expect(result).toMatchObject({
      status: 'readOnlyFollowUpSafe',
      safeForNextReadOnlyDryRun: true,
      safeForWritePlanning: false,
      requiresProductDecision: false,
    });
    expect(actionKinds(result)).toEqual(
      expect.arrayContaining(['skippedNullStatSourceEvidence', 'safeForNextReadOnlyDryRun'])
    );
  });
});

function nullStats(): Record<string, null> {
  return {
    goals: null,
    inside50s: null,
    effectiveDisposals: null,
  };
}
