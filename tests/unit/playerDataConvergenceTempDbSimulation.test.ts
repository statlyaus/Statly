import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  diagnosePlayerDataConvergence,
  type CanonicalPlayerRow,
  type PlayerDataSourceRecord,
} from '@/server/playerDataConvergenceDiagnostic';
import { planPlayerDataConvergenceTempDbDryRun } from '@/server/playerDataConvergenceDryRunPlan';
import { planPlayerDataConvergenceActions } from '@/server/playerDataConvergencePlanner';
import { planPlayerDataConvergenceTempDbSimulation } from '@/server/playerDataConvergenceTempDbSimulation';

const expectedCategories = ['goals', 'inside50s', 'effectiveDisposals'] as const;
const tempDb = '/tmp/statly-verify-20260621030303.db';

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

function dryRunPlan(input: {
  canonicalPlayers: CanonicalPlayerRow[];
  sourceRecords: PlayerDataSourceRecord[];
  statlyVerifyDb?: string | null;
  databaseUrl?: string | null;
  repositoryRoot?: string | null;
}) {
  const diagnostic = diagnosePlayerDataConvergence({
    canonicalPlayers: input.canonicalPlayers,
    sourceRecords: input.sourceRecords,
    expectedCategoryKeys: expectedCategories,
  });
  const convergencePlan = planPlayerDataConvergenceActions({
    diagnostic,
    expectedCategoryKeys: expectedCategories,
  });

  return planPlayerDataConvergenceTempDbDryRun({
    diagnostic,
    convergencePlan,
    statlyVerifyDb: input.statlyVerifyDb ?? tempDb,
    databaseUrl: input.databaseUrl ?? `file://${input.statlyVerifyDb ?? tempDb}`,
    repositoryRoot: input.repositoryRoot,
  });
}

function simulation(input: Parameters<typeof dryRunPlan>[0]) {
  return planPlayerDataConvergenceTempDbSimulation(dryRunPlan(input));
}

describe('player data convergence temp DB simulation contract', () => {
  it('is ready for temp DB simulation when dry-run evidence is safe and non-writing', () => {
    const result = simulation({
      canonicalPlayers: [{ id: 'caleb_daniel', name: 'Caleb Daniel', club: 'North Melbourne' }],
      sourceRecords: [
        { player_uid: 'caleb_daniel', player_name: 'Caleb Daniel', stats: completeStats() },
      ],
    });

    expect(result).toMatchObject({
      status: 'readyForTempDbSimulation',
      safeForTempDbSimulation: true,
      safeForWritePlanning: false,
      safeForWriteApply: false,
      proposedWriteCount: 0,
      skippedRepairCount: 0,
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'validateTempDatabaseContract',
          status: 'ready',
        }),
        expect.objectContaining({
          kind: 'confirmNoRepairCandidates',
          status: 'ready',
          evidence: expect.objectContaining({ proposedRepairCount: 0 }),
        }),
        expect.objectContaining({
          kind: 'holdBeforeWriteApply',
          status: 'blocked',
        }),
      ])
    );
    expect(result.approvalGates).toContain(
      'Convert simulation steps into executable database writes.'
    );
  });

  it('classifies all-null stat rows as skipped evidence without creating writes', () => {
    const result = simulation({
      canonicalPlayers: [
        { id: 'tobie_travaglia_st_kilda', name: 'Tobie Travaglia', club: 'St Kilda' },
      ],
      sourceRecords: [
        { player_name: 'Tobie Travaglia', team: 'St Kilda', stats: completeStats(nullStats()) },
      ],
    });

    expect(result).toMatchObject({
      status: 'readyForTempDbSimulation',
      safeForTempDbSimulation: true,
      safeForWritePlanning: false,
      safeForWriteApply: false,
      proposedWriteCount: 0,
      skippedRepairCount: 1,
    });
    expect(result.steps).toContainEqual(
      expect.objectContaining({
        kind: 'classifySkippedSourceEvidence',
        status: 'ready',
        evidence: expect.objectContaining({
          skippedNullStatSourceEvidence: 1,
          missingExpectedCategoryValues: 3,
        }),
      })
    );
  });

  it('blocks simulation when temp database validation is unsafe', () => {
    const result = simulation({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
      statlyVerifyDb: tempDb,
      databaseUrl: 'file:///Users/robert/Developer/Statly/prisma/dev.db',
      repositoryRoot: '/Users/robert/Developer/Statly',
    });

    expect(result.status).toBe('blocked');
    expect(result.safeForTempDbSimulation).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'protectedDevDatabasePath' }),
        expect.objectContaining({ kind: 'databaseUrlMustNotPointInsideRepository' }),
      ])
    );
    expect(result.steps).toContainEqual(
      expect.objectContaining({
        kind: 'validateTempDatabaseContract',
        status: 'blocked',
      })
    );
  });

  it('blocks simulation when identity evidence requires product decisions', () => {
    const result = simulation({
      canonicalPlayers: [
        { id: 'sam_reid_sydney', name: 'Sam Reid', club: 'Sydney' },
        { id: 'sam_reid_gws', name: 'Sam Reid', club: 'GWS' },
      ],
      sourceRecords: [{ player_name: 'Sam Reid', stats: completeStats() }],
    });

    expect(result.status).toBe('blocked');
    expect(result.safeForTempDbSimulation).toBe(false);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'validateDiagnosticEvidence',
          status: 'blocked',
        }),
        expect.objectContaining({
          kind: 'holdBeforeWriteApply',
          status: 'blocked',
        }),
      ])
    );
  });

  it('blocks simulation if a future dry-run plan exposes repair candidates', () => {
    const basePlan = dryRunPlan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
    });
    const result = planPlayerDataConvergenceTempDbSimulation({
      ...basePlan,
      evidence: {
        ...basePlan.evidence,
        proposedRepairCount: 1,
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.safeForTempDbSimulation).toBe(false);
    expect(result.proposedWriteCount).toBe(0);
    expect(result.steps).toContainEqual(
      expect.objectContaining({
        kind: 'confirmNoRepairCandidates',
        status: 'blocked',
      })
    );
  });

  it('stays a pure planner without DB, filesystem, or apply runner imports', () => {
    const source = readFileSync('src/server/playerDataConvergenceTempDbSimulation.ts', 'utf8');

    expect(source).not.toMatch(/@\/lib\/prisma|firebase|Firestore|node:fs|from 'fs'/);
    expect(source).not.toMatch(/\bapplyPlayerData|\bwritePlayerData|\brunPlayerData/);
    expect(source).toContain('safeForWritePlanning: false');
    expect(source).toContain('safeForWriteApply: false');
  });
});
