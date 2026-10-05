// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import {
  createAflTradePickPavModelRunAuthorization,
  createAflTradePickPavModelRunIntent,
  createAflTradePickPavObservationAdmission,
} from '@/server/aflTradeIntelligence/modeling/pickPavModelCandidateAuthority';
import {
  aflTradeGovernedPickPavModelCandidateSchema,
  createAflTradeGovernedPickPavModelCandidate,
} from '@/server/aflTradeIntelligence/modeling/governedPickPavModelCandidate';
import {
  computeAflTradePickPavModelExecutionOutputs,
  createAflTradePickPavModelExecution,
} from '@/server/aflTradeIntelligence/modeling/pickPavModelExecution';
import {
  aflTradePickPavModelRunConsumptionSchema,
  createAflTradePickPavModelRunConsumption,
} from '@/server/aflTradeIntelligence/modeling/pickPavModelRunConsumption';
import {
  loadAuthenticatedAflTradeGovernedPickPavCandidateChain,
  PostgresAflTradeGovernedPickPavModelCandidateRegistry,
} from '@/server/aflTradeIntelligence/modeling/postgresGovernedPickPavModelCandidateRegistry';
import { materializeAflTradePickPavObservationSet } from '@/server/aflTradeIntelligence/modeling/pickPavObservationService';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const releaseId = addressed('outcome-release', 'candidate-release');
const methodId = addressed('hpn-pav-method', 'candidate-method');
const years = [2000, 2001, 2002, 2003, 2006, 2009, 2012] as const;

function observationSet(environment: 'test_fixture' | 'non_production' = 'non_production') {
  const policy = createAflTradePickPavPolicy({
    schemaVersion: 'afl-trade-pick-pav-policy/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment,
    competition: 'AFLM',
    policyVersion: 'candidate-v1',
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
      id: addressed('review-decision', 'candidate-policy'),
      sha256: sha('candidate-policy'),
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

const artifact = (name: string) =>
  createAflTradeCanonicalJsonArtifactRef({ name }, '2015-01-02T00:00:00.000Z');

function candidateAuthority(set: ReturnType<typeof observationSet>) {
  const admission = createAflTradePickPavObservationAdmission({
    observationSetId: set.observationSetId,
    observationSetSha256: set.content.observationSetSha256,
    releaseId: set.content.releaseId,
    policyId: set.content.policy.policyId,
    sourceQualificationReportId: addressed(
      'valuation-source-qualification',
      'source-qualification'
    ),
    gate2DecisionId: addressed('gate-decision', 'gate-2'),
    sourceQualificationArtifact: artifact('source-qualification'),
    gate2DecisionArtifact: artifact('gate-2'),
    admittedAt: '2015-01-02T08:00:00.000Z',
  });
  const intent = createAflTradePickPavModelRunIntent({
    admission,
    modelId: 'pick-pav-distribution',
    modelVersion: 'candidate-v1',
    codeCommitSha: '1'.repeat(40),
    cleanWorktree: true,
    seed: 42,
    sourceCodeArtifact: artifact('source'),
    dependencyLockArtifact: artifact('lock'),
    runtimeArtifact: artifact('runtime'),
    configurationArtifact: artifact('configuration'),
    startedAt: '2015-01-02T10:00:00.000Z',
  });
  const authorization = createAflTradePickPavModelRunAuthorization({
    admission,
    intent,
    modelTrainingEvaluationReceiptIds: [addressed('gate0a-evaluation', 'training')],
    operationalPrincipalAuthorityId: addressed(
      'operational-principal-authority',
      'operator'
    ),
    gateLedgerRevision: 1,
    authorizedAt: '2015-01-02T11:00:00.000Z',
    validThrough: '2015-01-04T00:00:00.000Z',
  });
  return { admission, intent, authorization };
}

function createCandidate(
  set = observationSet(),
  overrides: Partial<Parameters<typeof createAflTradeGovernedPickPavModelCandidate>[0]> = {}
) {
  const outputs = computeAflTradePickPavModelExecutionOutputs({
    observationSet: set,
    benchmarkConfig,
    validationConfig,
  });
  const authority = candidateAuthority(set);
  return createAflTradeGovernedPickPavModelCandidate({
    outputs,
    ...authority,
    job: {
      jobId: 'pick-candidate-2015',
      attempt: 1,
      initiatedBy: 'operator:local-reviewer',
      workerIdentity: 'worker:local-non-production',
    },
    startedAt: '2015-01-02T12:00:00.000Z',
    candidateLockedAt: '2015-01-03T00:00:00.000Z',
    completedAt: '2015-01-03T00:00:01.000Z',
    ...overrides,
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

describe('governed pick-PAV model candidate', () => {
  it('retains a reproducible non-production candidate without granting Gate 3 or trade scoring', () => {
    const candidate = createCandidate();

    expect(candidate.content.environment).toBe('non_production');
    expect(candidate.content.publicationEligible).toBe(false);
    expect(candidate.content.gate3Authority).toBe('not_granted');
    expect(candidate.content.tradeScoringAuthority).toBe('not_granted');
    expect(candidate.content.runAuthorizationValidThrough).toBe(
      '2015-01-04T00:00:00.000Z'
    );
    expect(candidate.content.observationSetId).toBe(candidate.content.observationSet.observationSetId);
    expect(candidate.content.validationReport.content.evaluationStatus).toBe('scored_not_approved');
    expect(aflTradeGovernedPickPavModelCandidateSchema.parse(candidate)).toEqual(candidate);
  });

  it('does not relabel the development test-fixture execution as a governed candidate', () => {
    const set = observationSet('test_fixture');
    const execution = createAflTradePickPavModelExecution({
      outputs: computeAflTradePickPavModelExecutionOutputs({
        observationSet: set,
        benchmarkConfig,
        validationConfig,
      }),
      completedAt: '2015-01-03T00:00:01.000Z',
    });

    expect(() =>
      createCandidate(set, {
        outputs: {
          observationSet: execution.content.observationSet,
          benchmarkConfig: execution.content.benchmarkConfig,
          validationConfig: execution.content.validationConfig,
          benchmark: execution.content.benchmark,
          validationReport: execution.content.validationReport,
        },
      })
    ).toThrow(/non.production/i);
  });

  it('rejects drift in embedded outputs and non-canonical training receipts', () => {
    const candidate = createCandidate();
    const drifted = structuredClone(candidate);
    drifted.content.benchmark.content.selectionCurve[0]!.distribution.expectedContribution += 1;
    expect(() => aflTradeGovernedPickPavModelCandidateSchema.parse(drifted)).toThrow(
      /re-derived|content address/i
    );

    const nonCanonicalReceipts = [
      addressed('gate0a-evaluation', 'first'),
      addressed('gate0a-evaluation', 'second'),
    ].sort().reverse();
    expect(() =>
      createCandidate(observationSet(), {
        authorization: createAflTradePickPavModelRunAuthorization({
          ...candidateAuthority(observationSet()),
          modelTrainingEvaluationReceiptIds: nonCanonicalReceipts,
          operationalPrincipalAuthorityId: addressed(
            'operational-principal-authority',
            'operator'
          ),
          gateLedgerRevision: 1,
          authorizedAt: '2015-01-02T11:00:00.000Z',
          validThrough: '2015-01-04T00:00:00.000Z',
        }),
      })
    ).toThrow(/canonically ordered/i);
  });

  it('creates an exact, time-bounded consumption receipt for the candidate', () => {
    const set = observationSet();
    const authority = candidateAuthority(set);
    const candidate = createCandidate(set, authority);
    const consumption = createAflTradePickPavModelRunConsumption({
      authorization: authority.authorization,
      candidate,
      consumedAt: '2015-01-03T00:00:02.000Z',
    });

    expect(consumption.content.runAuthorizationId).toBe(
      authority.authorization.runAuthorizationId
    );
    expect(consumption.content.candidateId).toBe(candidate.candidateId);
    expect(aflTradePickPavModelRunConsumptionSchema.parse(consumption)).toEqual(consumption);
  });

  it('rejects consumption with drifted ancestry or outside the authorization window', () => {
    const set = observationSet();
    const authority = candidateAuthority(set);
    const candidate = createCandidate(set, authority);
    const otherAuthorization = createAflTradePickPavModelRunAuthorization({
      admission: authority.admission,
      intent: authority.intent,
      modelTrainingEvaluationReceiptIds: [addressed('gate0a-evaluation', 'training')],
      operationalPrincipalAuthorityId: addressed(
        'operational-principal-authority',
        'operator'
      ),
      gateLedgerRevision: 2,
      authorizedAt: '2015-01-02T11:00:00.000Z',
      validThrough: '2015-01-04T00:00:00.000Z',
    });

    expect(() =>
      createAflTradePickPavModelRunConsumption({
        authorization: otherAuthorization,
        candidate,
        consumedAt: '2015-01-03T00:00:02.000Z',
      })
    ).toThrow(/exact candidate.*authorization ancestry/i);
    expect(() =>
      createAflTradePickPavModelRunConsumption({
        authorization: authority.authorization,
        candidate,
        consumedAt: '2015-01-04T00:00:01.000Z',
      })
    ).toThrow(/authorization window/i);
  });

  it('persists candidate authority and exactly-once consumption atomically with exact replay', async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    try {
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
        CREATE TABLE outcome_pick_pav_observation_set (
          observation_set_id TEXT PRIMARY KEY,
          observation_set_sha256 CHAR(64) NOT NULL,
          environment TEXT NOT NULL,
          release_id TEXT NOT NULL,
          policy_id TEXT NOT NULL,
          observation_set_json JSONB NOT NULL,
          status TEXT NOT NULL,
          finalized_at TIMESTAMPTZ(3)
        );
        CREATE TABLE outcome_valuation_model_run (
          run_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          run_json JSONB NOT NULL
        );
      `);
      const migration = await readFile(
        join(
          process.cwd(),
          'prisma/afl-trade-outcomes/migrations/0071_governed_pick_candidate_and_private_bundle/migration.sql'
        ),
        'utf8'
      );
      await db.exec(migration);

      const set = observationSet();
      const authority = candidateAuthority(set);
      const candidate = createCandidate(set, authority);
      const consumption = createAflTradePickPavModelRunConsumption({
        authorization: authority.authorization,
        candidate,
        consumedAt: '2015-01-03T00:00:02.000Z',
      });
      await db.query(
        `INSERT INTO outcome_pick_pav_observation_set
          (observation_set_id,observation_set_sha256,environment,release_id,policy_id,
           observation_set_json,status,finalized_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,'finalized',$7)`,
        [
          set.observationSetId,
          set.content.observationSetSha256,
          set.content.environment,
          set.content.releaseId,
          set.content.policy.policyId,
          set,
          set.content.createdAt,
        ]
      );
      const registry = new PostgresAflTradeGovernedPickPavModelCandidateRegistry(
        new PGliteOutcomeSql(db)
      );
      const chain = { ...authority, candidate, consumption };

      await expect(registry.persistCandidateChain(chain)).resolves.toEqual({
        chain,
        idempotentReplay: false,
      });
      await expect(registry.persistCandidateChain(chain)).resolves.toEqual({
        chain,
        idempotentReplay: true,
      });
      await expect(
        new PGliteOutcomeSql(db).transaction((transaction) =>
          loadAuthenticatedAflTradeGovernedPickPavCandidateChain(
            transaction,
            candidate.candidateId
          )
        )
      ).resolves.toEqual(chain);

      await expect(
        db.exec(
          `UPDATE outcome_pick_pav_model_run_consumption SET consumed_at=consumed_at + interval '1 millisecond'`
        )
      ).rejects.toThrow(/append-only/i);

      const secondConsumption = createAflTradePickPavModelRunConsumption({
        authorization: authority.authorization,
        candidate,
        consumedAt: '2015-01-03T00:00:03.000Z',
      });
      await expect(
        registry.persistCandidateChain({ ...chain, consumption: secondConsumption })
      ).rejects.toThrow(/conflicting|exactly.once|replay/i);
    } finally {
      await db.close();
    }
  });
});
