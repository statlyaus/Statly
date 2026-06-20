import { describe, expect, it } from 'vitest';

import {
  diagnosePlayerDataConvergence,
  type CanonicalPlayerRow,
  type PlayerDataSourceRecord,
} from '@/server/playerDataConvergenceDiagnostic';
import { planPlayerDataConvergenceTempDbDryRun } from '@/server/playerDataConvergenceDryRunPlan';
import { planPlayerDataConvergenceActions } from '@/server/playerDataConvergencePlanner';

const expectedCategories = ['goals', 'inside50s', 'effectiveDisposals'] as const;
const tempDb = '/tmp/statly-verify-20260621010101.db';

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

function blockerKinds(input: ReturnType<typeof dryRunPlan>): string[] {
  return input.blockers.map((blocker) => blocker.kind);
}

describe('player data convergence temp DB dry-run plan', () => {
  it('builds a ready non-writing temp DB plan for clean diagnostic evidence', () => {
    const result = dryRunPlan({
      canonicalPlayers: [{ id: 'caleb_daniel', name: 'Caleb Daniel', club: 'North Melbourne' }],
      sourceRecords: [
        { player_uid: 'caleb_daniel', player_name: 'Caleb Daniel', stats: completeStats() },
      ],
    });

    expect(result).toMatchObject({
      status: 'readyForTempDbDryRun',
      safeForTempDbDryRun: true,
      safeForWritePlanning: false,
      safeForWriteApply: false,
      requiresProductDecision: false,
      tempDatabase: {
        statlyVerifyDb: tempDb,
        databaseUrl: `file://${tempDb}`,
        precreateRequired: true,
        cleanupCommand: 'rm -f "$STATLY_VERIFY_DB"',
      },
      evidence: {
        totalCanonicalPlayers: 1,
        totalSourceStatRecords: 1,
        matchedRecordsByDirectId: 1,
        matchedRecordsByCanonicalId: 0,
        matchedRecordsByNormalizedNameTeam: 0,
        proposedRepairCount: 0,
      },
    });
    expect(result.blockers).toEqual([]);
    expect(result.approvalGates).toContain('Add an apply function.');
    expect(result.stopConditions).toContain(
      'A command references, reads, or mutates prisma/dev.db.'
    );
  });

  it('rejects temp database paths outside /tmp/statly-verify-*.db', () => {
    const result = dryRunPlan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
      statlyVerifyDb: '/tmp/other.db',
      databaseUrl: 'file:///tmp/other.db',
    });

    expect(result.status).toBe('blocked');
    expect(result.safeForTempDbDryRun).toBe(false);
    expect(blockerKinds(result)).toContain('tempDatabaseMustUseTmpStatlyVerifyPath');
  });

  it('rejects DATABASE_URL values that do not match STATLY_VERIFY_DB', () => {
    const result = dryRunPlan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
      statlyVerifyDb: tempDb,
      databaseUrl: 'file:///tmp/statly-verify-other.db',
    });

    expect(result.status).toBe('blocked');
    expect(blockerKinds(result)).toContain('databaseUrlMustMatchTempDatabasePath');
  });

  it('rejects protected prisma dev database paths', () => {
    const result = dryRunPlan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
      statlyVerifyDb: '/tmp/statly-verify-prisma-dev.db',
      databaseUrl: 'file:///Users/robert/Developer/Statly/prisma/dev.db',
      repositoryRoot: '/Users/robert/Developer/Statly',
    });

    expect(result.status).toBe('blocked');
    expect(blockerKinds(result)).toEqual(
      expect.arrayContaining([
        'databaseUrlMustMatchTempDatabasePath',
        'protectedDevDatabasePath',
        'databaseUrlMustNotPointInsideRepository',
      ])
    );
  });

  it('blocks dry-run planning when source evidence requires product decisions', () => {
    const result = dryRunPlan({
      canonicalPlayers: [
        { id: 'sam_reid_sydney', name: 'Sam Reid', club: 'Sydney' },
        { id: 'sam_reid_gws', name: 'Sam Reid', club: 'GWS' },
      ],
      sourceRecords: [{ player_name: 'Sam Reid', stats: completeStats() }],
    });

    expect(result.status).toBe('blocked');
    expect(blockerKinds(result)).toEqual(
      expect.arrayContaining(['diagnosticUnsafeForDryRun', 'productDecisionRequired'])
    );
    expect(result.recommendedNextAction).toContain('Resolve blockers');
    expect(result.requiresProductDecision).toBe(true);
  });

  it('keeps all-null stat rows as skipped source evidence, not proposed repairs', () => {
    const result = dryRunPlan({
      canonicalPlayers: [
        { id: 'tobie_travaglia_st_kilda', name: 'Tobie Travaglia', club: 'St Kilda' },
      ],
      sourceRecords: [
        { player_name: 'Tobie Travaglia', team: 'St Kilda', stats: completeStats(nullStats()) },
      ],
    });

    expect(result.status).toBe('readyForTempDbDryRun');
    expect(result.evidence).toMatchObject({
      missingExpectedCategoryValues: 3,
      skippedNullStatSourceEvidence: 1,
      proposedRepairCount: 0,
      skippedRepairCount: 1,
    });
    expect(result.safeForWritePlanning).toBe(false);
    expect(result.safeForWriteApply).toBe(false);
  });

  it('keeps duplicate source identities review-only while allowing temp dry-run evidence', () => {
    const result = dryRunPlan({
      canonicalPlayers: [{ id: 'known_player', name: 'Known Player', club: 'Adelaide' }],
      sourceRecords: [
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
        { player_uid: 'known_player', player_name: 'Known Player', stats: completeStats() },
      ],
    });

    expect(result.status).toBe('readyForTempDbDryRun');
    expect(result.evidence).toMatchObject({
      duplicateSourceIdentities: 1,
      proposedRepairCount: 0,
      skippedRepairCount: 1,
    });
    expect(result.safeForWritePlanning).toBe(false);
    expect(result.safeForWriteApply).toBe(false);
  });
});
