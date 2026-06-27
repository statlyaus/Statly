import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  diagnosePlayerDataConvergence,
  type CanonicalPlayerRow,
  type PlayerDataSourceRecord,
} from '@/server/playerDataConvergenceDiagnostic';
import { planPlayerDataConvergenceApply } from '@/server/playerDataConvergenceApplyPlan';
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

function nullStats(): Record<string, null> {
  return {
    goals: null,
    inside50s: null,
    effectiveDisposals: null,
  };
}

function applyPlan(input: {
  canonicalPlayers: CanonicalPlayerRow[];
  sourceRecords: PlayerDataSourceRecord[];
  rankingRecords?: PlayerDataSourceRecord[];
}) {
  const diagnostic = diagnosePlayerDataConvergence({
    ...input,
    expectedCategoryKeys: expectedCategories,
  });
  const convergencePlan = planPlayerDataConvergenceActions({
    diagnostic,
    expectedCategoryKeys: expectedCategories,
  });

  return planPlayerDataConvergenceApply({ diagnostic, convergencePlan });
}

describe('player data convergence apply plan', () => {
  it('produces zero product repairs for clean converged evidence', () => {
    const result = applyPlan({
      canonicalPlayers: [{ id: 'caleb_daniel', name: 'Caleb Daniel', club: 'North Melbourne' }],
      sourceRecords: [
        { player_uid: 'caleb_daniel', player_name: 'Caleb Daniel', stats: completeStats() },
      ],
    });

    expect(result).toMatchObject({
      status: 'noProductRepairs',
      safeForTempDbApplySimulation: true,
      safeForProductApply: false,
      requiresProductDecision: false,
      productMutationCount: 0,
      skippedEvidenceCount: 0,
      productMutations: [],
      blockers: [],
    });
  });

  it('keeps all-null stat rows as skipped evidence instead of product repairs', () => {
    const result = applyPlan({
      canonicalPlayers: [
        { id: 'tobie_travaglia_st_kilda', name: 'Tobie Travaglia', club: 'St Kilda' },
      ],
      sourceRecords: [
        { player_name: 'Tobie Travaglia', team: 'St Kilda', stats: completeStats(nullStats()) },
      ],
    });

    expect(result).toMatchObject({
      status: 'requiresReview',
      safeForTempDbApplySimulation: true,
      safeForProductApply: false,
      productMutationCount: 0,
      skippedEvidenceCount: 1,
      productMutations: [],
      blockers: [],
    });
    expect(result.skippedEvidence).toContainEqual(
      expect.objectContaining({
        kind: 'nullStatSourceEvidence',
        count: 1,
        sourceIdentities: ['tobie travaglia|st kilda'],
        categories: ['goals', 'inside50s', 'effectiveDisposals'],
      })
    );
  });

  it('blocks ambiguous names instead of proposing identity repairs', () => {
    const result = applyPlan({
      canonicalPlayers: [
        { id: 'sam_reid_sydney', name: 'Sam Reid', club: 'Sydney' },
        { id: 'sam_reid_gws', name: 'Sam Reid', club: 'GWS' },
      ],
      sourceRecords: [{ player_name: 'Sam Reid', stats: completeStats() }],
    });

    expect(result.status).toBe('blocked');
    expect(result.safeForTempDbApplySimulation).toBe(false);
    expect(result.productMutationCount).toBe(0);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'plannerBlocked' }),
        expect.objectContaining({ kind: 'ambiguousNameMatches', count: 1 }),
        expect.objectContaining({ kind: 'productDecisionRequired' }),
      ])
    );
  });

  it('blocks unmatched source records instead of creating players', () => {
    const result = applyPlan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'ghost_player', player_name: 'Ghost Player', stats: completeStats() },
      ],
    });

    expect(result.status).toBe('blocked');
    expect(result.productMutationCount).toBe(0);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'unmatchedSourceRecords', count: 1 }),
        expect.objectContaining({ kind: 'unsafeForWritePlanning' }),
      ])
    );
  });

  it('classifies stale category keys as skipped review evidence', () => {
    const result = applyPlan({
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

    expect(result).toMatchObject({
      status: 'requiresReview',
      productMutationCount: 0,
    });
    expect(result.skippedEvidenceCount).toBeGreaterThanOrEqual(2);
    expect(result.skippedEvidence).toContainEqual(
      expect.objectContaining({
        kind: 'staleCategoryKey',
        count: 2,
        categories: ['inside_50s', 'effective_disposals'],
      })
    );
  });

  it('classifies repeated source rows as multi-row evidence, not product repairs', () => {
    const result = applyPlan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
    });

    expect(result).toMatchObject({
      status: 'requiresReview',
      safeForTempDbApplySimulation: true,
      safeForProductApply: false,
      productMutationCount: 0,
      productMutations: [],
      blockers: [],
    });
    expect(result.skippedEvidence).toContainEqual(
      expect.objectContaining({
        kind: 'multiRowSourceEvidence',
        count: 1,
        sourceIdentities: ['known_player'],
      })
    );
  });

  it('stays pure and does not import database or runner dependencies', () => {
    const source = readFileSync('src/server/playerDataConvergenceApplyPlan.ts', 'utf8');
    const imports = source
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .join('\n');

    expect(imports).not.toMatch(/@\/lib\/prisma|@prisma\/client|firebase|Firestore|node:fs/);
    expect(source).not.toMatch(/\$executeRaw|\$queryRaw|INSERT INTO|UPDATE|DELETE FROM/);
    expect(source).toContain('safeForProductApply: false');
  });
});
