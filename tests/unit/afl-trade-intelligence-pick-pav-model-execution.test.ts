// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { describe, expect, it } from 'vitest';

import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import {
  aflTradePickPavModelExecutionSchema,
  computeAflTradePickPavModelExecutionOutputs,
  createAflTradePickPavModelExecution,
} from '@/server/aflTradeIntelligence/modeling/pickPavModelExecution';
import { retainAflTradePickPavModelExecution } from '@/server/aflTradeIntelligence/modeling/pickPavModelExecutionCustody';
import {
  AflTradePickPavModelExecutionService,
  type AflTradePickPavModelExecutionRegistry,
} from '@/server/aflTradeIntelligence/modeling/pickPavModelExecutionService';
import { materializeAflTradePickPavObservationSet } from '@/server/aflTradeIntelligence/modeling/pickPavObservationService';
import { PostgresAflTradePickPavModelExecutionRegistry } from '@/server/aflTradeIntelligence/modeling/postgresPickPavModelExecutionRegistry';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const releaseId = addressed('outcome-release', 'execution-release');
const methodId = addressed('hpn-pav-method', 'execution-method');
const years = [2000, 2001, 2002, 2003, 2006, 2009, 2012] as const;

function observationSet(
  environment: 'test_fixture' | 'non_production' | 'production' = 'test_fixture'
) {
  const policy = createAflTradePickPavPolicy({
    schemaVersion: 'afl-trade-pick-pav-policy/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment,
    competition: 'AFLM',
    policyVersion: 'execution-v1',
    supportedPathway: 'national',
    supportedAccess: 'open',
    firstOutcomeSeasonOffset: 1,
    fixedHorizonSeasons: 1,
    methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    categoryMinimums: {
      replacementLevel: 10,
      regularContributor: 30,
      highQuality: 60,
      elite: 90,
    },
    partitions: [
      { role: 'train', fromDraftYear: 2000, throughDraftYear: 2003 },
      { role: 'calibration', fromDraftYear: 2006, throughDraftYear: 2006 },
      { role: 'validation', fromDraftYear: 2009, throughDraftYear: 2009 },
      { role: 'final_test', fromDraftYear: 2012, throughDraftYear: 2012 },
    ],
    approvalDecision: {
      id: addressed('review-decision', 'execution-policy'),
      sha256: sha('execution-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
  const selections = years.map((draftYear, index) => ({
    releaseId,
    selectionId: addressed('draft-selection', `${draftYear}:${index}`),
    eventId: `draft:${draftYear}:national`,
    eventVersionId: addressed('event-version', `draft:${draftYear}:national`),
    eventDate: `${draftYear}-11-20`,
    recordedAt: `${draftYear}-11-21T00:00:00.000Z`,
    draftYear,
    pathway: 'national' as const,
    actualSelectionNumber: index < 4 ? [10, 14, 14, 20][index]! : 14,
    nominalSelectionNumber: index < 4 ? [10, 14, 14, 20][index]! : 14,
    draftRound: 1,
    pickId: `pick:${draftYear}:national:${index + 1}`,
    playerId: `player:${draftYear}`,
    clubId: `club:${draftYear}`,
    access: {
      state: 'open' as const,
      decision: {
        id: addressed('review-decision', `access:${draftYear}`),
        sha256: sha(`access:${draftYear}`),
      },
      recordedAt: `${draftYear}-11-22T00:00:00.000Z`,
    },
  }));
  const contributions = [100, 60, 80, 20, 70, 65, 75];
  const calculations = years.map((draftYear, index) => {
    const seasonYear = draftYear + 1;
    const calculationSha256 = sha(`calculation:${draftYear}`);
    const sourceRowIds = Array.from(
      { length: 10 },
      (_, rowIndex) => `decoded-row:${draftYear}:${rowIndex + 1}`
    );
    return {
      calculation: {
        calculationId: `hpn-pav-season:${calculationSha256}`,
        calculationSha256,
        inputSetId: addressed('hpn-pav-input-set', `input:${draftYear}`),
        methodId,
        seasonYear,
        effectiveThrough: `${seasonYear}-12-31T23:59:59.000Z`,
        calculatedAt: `${seasonYear + 1}-01-01T00:00:00.000Z`,
      },
      playerValues: [
        {
          calculationId: `hpn-pav-season:${calculationSha256}`,
          calculationSha256,
          seasonYear,
          spellVersionId: addressed('acquisition-spell-version', `spell:${draftYear}`),
          playerId: `player:${draftYear}`,
          playerSha256: sha(`player:${draftYear}`),
          clubId: `club:${draftYear}`,
          sourceRowIds,
          gamesPlayed: sourceRowIds.length,
          totalPav: contributions[index]!,
        },
      ],
    };
  });
  return materializeAflTradePickPavObservationSet({
    environment,
    competition: 'AFLM',
    createdAt: '2015-01-02T00:00:00.000Z',
    knowledgeCutoffAt: '2015-01-01T00:00:00.000Z',
    releaseId,
    policy,
    selections,
    calculations,
  });
}

const benchmarkConfig = {
  schemaVersion: 'afl-trade-pick-pav-distribution-benchmark-config/v1' as const,
  minimumBlockObservations: 1,
  eligibility: 'mature_open_access_national_draft_training_observations' as const,
  informationWeight: 'eligible_selection_count' as const,
  smoother: 'weighted_non_increasing_isotonic' as const,
  sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break' as const,
  interpolation: 'left_block_carry_forward_within_training_domain' as const,
  extrapolation: 'prohibited' as const,
  estimatorStatus: 'benchmark_only_requires_temporal_validation_and_approval' as const,
};

const validationConfig = {
  schemaVersion: 'afl-trade-pick-pav-validation-config/v1' as const,
  evaluatedAt: '2015-01-03T00:00:00.000Z',
  minimumEligibleObservations: 3,
  minimumPartitionObservations: 1,
  nominalIntervalCoverage: 0.8 as const,
};

function createExecution(input: {
  set?: ReturnType<typeof observationSet>;
  config?: typeof validationConfig;
  completedAt?: string;
}) {
  const set = input.set ?? observationSet();
  const config = input.config ?? validationConfig;
  return createAflTradePickPavModelExecution({
    outputs: computeAflTradePickPavModelExecutionOutputs({
      observationSet: set,
      benchmarkConfig,
      validationConfig: config,
    }),
    completedAt: input.completedAt ?? '2015-01-03T00:00:01.000Z',
  });
}

class PGliteOutcomeSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  constructor(private readonly db: PGlite) {}

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN');
    try {
      const result = await work(this);
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    const result = await this.db.query<Row>(sql, [...parameters]);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }
}

describe('pick-PAV model execution envelope', () => {
  it('binds the exact fitted benchmark and held-out report without claiming approval', () => {
    const execution = createExecution({});

    expect(execution.content.publicationEligible).toBe(false);
    expect(execution.content.approvalStatus).toBe('development_only_not_eligible_for_gate_3');
    expect(execution.content.benchmark.content.selectionCurve).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selectionNumber: 14, observationCount: 2 }),
      ])
    );
    expect(execution.content.validationReport.content.evaluationStatus).toBe('scored_not_approved');
    expect(execution.content.validationReport.content.benchmarkId).toBe(
      execution.content.benchmark.benchmarkId
    );
    expect(execution.content.observationSetId).toBe(
      execution.content.benchmark.content.observationSetId
    );
  });

  it('is deterministic and rejects tampered embedded output', () => {
    const first = createExecution({});
    const second = createExecution({});
    const tampered = structuredClone(first);
    tampered.content.benchmark.content.selectionCurve[0]!.distribution.expectedContribution += 1;

    expect(second).toEqual(first);
    expect(() => aflTradePickPavModelExecutionSchema.parse(tampered)).toThrow(
      /exact fitted benchmark|content-address/i
    );
  });

  it('rejects chronology that claims completion before final-test evaluation starts', () => {
    expect(() =>
      createExecution({
        config: {
          ...validationConfig,
          evaluatedAt: '2015-01-03T00:00:02.000Z',
        },
        completedAt: '2015-01-03T00:00:00.000Z',
      })
    ).toThrow(/final-test evaluation.*completion|chronology/i);
  });

  it('retains and verifies the exact execution and readback evidence before reporting custody', async () => {
    const execution = createExecution({});
    const repository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });

    const receipt = await retainAflTradePickPavModelExecution({
      execution,
      repository,
      clock: {
        now: async () => '2015-01-03T00:00:02.000Z',
      },
      maximumBytes: 4 * 1024 * 1024,
    });

    expect(receipt.content.executionId).toBe(execution.executionId);
    expect(receipt.content.publicationEligible).toBe(false);
    expect(receipt.content.repositoryAssurance).toBe('fixture_memory');
    expect(receipt.content.executionArtifact.artifactId).toBe(
      receipt.content.executionReadback.content.artifact.artifactId
    );
    expect(
      await repository.loadExact(receipt.content.executionArtifact, 4 * 1024 * 1024)
    ).not.toBeNull();
    expect(
      await repository.loadExact(receipt.content.readbackReceiptArtifact, 4 * 1024 * 1024)
    ).not.toBeNull();
  });

  it('does not create production-labelled execution evidence before run authority exists', () => {
    expect(() => createExecution({ set: observationSet('non_production') })).toThrow(
      /test_fixture|environment|literal/i
    );
  });

  it('loads a finalized observation set, uses trusted chronology, retains it, and indexes once', async () => {
    const finalized = observationSet();
    const loadRequests: unknown[] = [];
    const indexed: Array<{ executionId: string; custodyReceiptId: string }> = [];
    const instants = [
      '2015-01-02T12:00:00.000Z',
      '2015-01-03T00:00:00.000Z',
      '2015-01-03T00:00:01.000Z',
      '2015-01-03T00:00:02.000Z',
    ];
    const registry: AflTradePickPavModelExecutionRegistry = {
      persist: async ({ execution, custody }) => {
        indexed.push({
          executionId: execution.executionId,
          custodyReceiptId: custody.custodyReceiptId,
        });
        return { idempotentReplay: false };
      },
    };
    const service = new AflTradePickPavModelExecutionService({
      observationSets: {
        loadFinalized: async (request) => {
          loadRequests.push(request);
          return finalized;
        },
      },
      artifacts: createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' }),
      registry,
      clock: { now: async () => instants.shift()! },
      maximumArtifactBytes: 4 * 1024 * 1024,
    });

    const result = await service.execute({
      observationSetId: finalized.observationSetId,
      environment: 'test_fixture',
      benchmarkConfig,
      validationPolicy: {
        schemaVersion: 'afl-trade-pick-pav-validation-policy/v1',
        minimumEligibleObservations: 3,
        minimumPartitionObservations: 1,
        nominalIntervalCoverage: 0.8,
      },
    });

    expect(loadRequests).toEqual([
      { observationSetId: finalized.observationSetId, environment: 'test_fixture' },
    ]);
    expect(result.execution.content.finalTestEvaluationStartedAt).toBe('2015-01-02T12:00:00.000Z');
    expect(result.execution.content.completedAt).toBe('2015-01-03T00:00:00.000Z');
    expect(result.custody.content.retainedAt).toBe('2015-01-03T00:00:02.000Z');
    expect(indexed).toEqual([
      {
        executionId: result.execution.executionId,
        custodyReceiptId: result.custody.custodyReceiptId,
      },
    ]);
    expect(result.idempotentReplay).toBe(false);
  });

  it('persists exact execution custody once and rejects conflicting or mutable PostgreSQL evidence', async () => {
    const db = await PGlite.create({ extensions: { pgcrypto } });
    try {
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE TYPE "OutcomeEnvironment" AS ENUM ('test_fixture','non_production','production');
        CREATE TABLE outcome_pick_pav_observation_set (
          observation_set_id TEXT PRIMARY KEY,
          observation_set_sha256 CHAR(64) NOT NULL UNIQUE,
          environment "OutcomeEnvironment" NOT NULL,
          competition TEXT NOT NULL,
          release_id TEXT NOT NULL,
          policy_id TEXT NOT NULL,
          created_at TIMESTAMPTZ(3) NOT NULL,
          status TEXT NOT NULL,
          observation_set_json JSONB NOT NULL,
          finalized_at TIMESTAMPTZ(3)
        );
        CREATE FUNCTION outcome_afl_trade_canonical_json(value JSONB) RETURNS TEXT AS $$
        DECLARE value_type TEXT;
        BEGIN
          value_type:=jsonb_typeof(value);
          IF value_type='object' THEN
            RETURN '{' || COALESCE((SELECT string_agg(
              to_json(key)::text || ':' || outcome_afl_trade_canonical_json(item),
              ',' ORDER BY key COLLATE "C") FROM jsonb_each(value) entry(key,item)), '') || '}';
          ELSIF value_type='array' THEN
            RETURN '[' || COALESCE((SELECT string_agg(
              outcome_afl_trade_canonical_json(item),',' ORDER BY ordinal)
              FROM jsonb_array_elements(value) WITH ORDINALITY entry(item,ordinal)), '') || ']';
          ELSIF value_type='string' THEN
            RETURN to_json(value#>>'{}')::text;
          END IF;
          RETURN value::text;
        END;
        $$ LANGUAGE plpgsql IMMUTABLE STRICT;
      `);
      const migration = await readFile(
        join(
          process.cwd(),
          'prisma/afl-trade-outcomes/migrations/0042_pick_pav_model_execution_registry/migration.sql'
        ),
        'utf8'
      );
      await db.exec(migration);

      const finalized = observationSet();
      await db.query(
        `INSERT INTO outcome_pick_pav_observation_set
          (observation_set_id, observation_set_sha256, environment, competition, release_id,
           policy_id, created_at, status, observation_set_json, finalized_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'finalized',$8::jsonb,$7)`,
        [
          finalized.observationSetId,
          finalized.content.observationSetSha256,
          finalized.content.environment,
          finalized.content.competition,
          finalized.content.releaseId,
          finalized.content.policy.policyId,
          finalized.content.createdAt,
          finalized,
        ]
      );
      const execution = createExecution({ set: finalized });
      const artifacts = createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private',
      });
      const custody = await retainAflTradePickPavModelExecution({
        execution,
        repository: artifacts,
        clock: {
          now: async () => '2015-01-03T00:00:02.000Z',
        },
        maximumBytes: 4 * 1024 * 1024,
      });
      const registry = new PostgresAflTradePickPavModelExecutionRegistry(new PGliteOutcomeSql(db));

      await expect(registry.persist({ execution, custody })).resolves.toEqual({
        idempotentReplay: false,
      });
      await expect(registry.persist({ execution, custody })).resolves.toEqual({
        idempotentReplay: true,
      });

      const conflictingCustody = await retainAflTradePickPavModelExecution({
        execution,
        repository: artifacts,
        clock: {
          now: async () => '2015-01-03T00:00:03.000Z',
        },
        maximumBytes: 4 * 1024 * 1024,
      });
      await expect(registry.persist({ execution, custody: conflictingCustody })).rejects.toThrow(
        /conflicting.*execution|custody/i
      );
      await expect(
        db.exec(
          `UPDATE outcome_pick_pav_model_execution SET status='changed' WHERE execution_id='${execution.executionId}'`
        )
      ).rejects.toThrow(/append-only|mutation/i);
    } finally {
      await db.close();
    }
  });
});
