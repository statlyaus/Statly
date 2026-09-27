import { describe, expect, it, vi } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

/**
 * The recorded execution policy declares a concurrency limit and a heartbeat. Both components now
 * require that limit, and the composition roots resolve it from the policy. The resolver is a pure
 * function with the recorded policy as its default, so these tests supply a policy directly; the
 * assertion that a root forwards the resolved limit injects one rather than mocking the policy
 * module.
 */
/** Dependencies each composition root forwarded to the component it constructs. */
const forwardedDependencies = vi.hoisted(() => [] as { readonly maximumConcurrency?: number }[]);

/**
 * A concurrency that cannot equal the literal `8` both components previously carried as a fallback,
 * so nothing below can pass coincidentally against a silent default.
 */
const injectedLimits = {
  maximumConcurrency: 3,
  heartbeatMilliseconds: 9_000,
} as const;

vi.mock(
  '@/server/aflTradeIntelligence/valuation/currentValuationCohortPreparation',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/server/aflTradeIntelligence/valuation/currentValuationCohortPreparation')
      >();
    return {
      ...actual,
      createAflTradeCurrentValuationCohortCoordinator: (dependencies: {
        readonly maximumConcurrency?: number;
      }) => {
        forwardedDependencies.push(dependencies);
        return {
          prepare: async () => ({ state: 'stale_authority' as const, reason: 'not exercised' }),
        };
      },
    };
  }
);

import {
  AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY,
  resolveAflTradePrivateEvaluationCohortExecutionLimits,
} from '@/server/aflTradeIntelligence/valuation/privateEvaluationCohortExecution';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_LIMITATION,
  AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_SCHEMA_VERSION,
} from '@/server/aflTradeIntelligence/valuation/currentValuationModelEvidence';
import {
  createPostgresAflTradeCurrentValuationCohortCoordinator,
  createPostgresAflTradePrivateCurrentValuationCohortCoordinator,
} from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortPreparation';
import { createAflTradeCurrentValuationBundleFixture } from '../testUtils/currentValuationCohortFixture';
import { createPostgresAflTradePrivateEvaluationCohortRunner } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortRunner';
import type { PostgresAflTradePrivateEvaluationCohortExecutionRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateEvaluationCohortExecutionRepository';

const scopeKey = 'afl-men:2026-trades';

function unusedClient(): AflOutcomeSqlClient {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    transaction: vi.fn(),
  } as unknown as AflOutcomeSqlClient;
}

/**
 * The composition roots construct their staging repository eagerly, which enforces private fixture
 * custody before any policy value is read. The stub therefore has to declare retained-custody
 * metadata rather than being an empty object.
 */
function fixtureArtifactRepository() {
  return {
    artifactClass: 'derived_private',
    assurance: 'test_fixture',
  } as never;
}

describe('private evaluation execution policy wiring', () => {
  it('resolves the recorded policy into the limits the components require', () => {
    expect(resolveAflTradePrivateEvaluationCohortExecutionLimits()).toEqual({
      maximumConcurrency: AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY.maximumConcurrency,
      heartbeatMilliseconds:
        AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY.heartbeatSeconds * 1_000,
    });
  });

  it('rejects a policy that cannot bound the worker pool or a lease renewal', () => {
    expect(() =>
      resolveAflTradePrivateEvaluationCohortExecutionLimits({
        maximumConcurrency: 33,
        heartbeatSeconds: 30,
      })
    ).toThrowError('Recorded private evaluation concurrency must be between 1 and 32.');
    expect(() =>
      resolveAflTradePrivateEvaluationCohortExecutionLimits({
        maximumConcurrency: 8,
        heartbeatSeconds: 0,
      })
    ).toThrowError('Recorded private evaluation heartbeat must be a positive integer.');
  });

  it('keeps the injected limit distinguishable from any silent fallback', () => {
    expect(injectedLimits.maximumConcurrency).not.toBe(8);
  });

  it('forwards the resolved concurrency into the public cohort preparation', () => {
    forwardedDependencies.length = 0;

    createPostgresAflTradeCurrentValuationCohortCoordinator({
      client: unusedClient(),
      artifactRepository: fixtureArtifactRepository(),
      maximumArtifactBytes: 1_048_576,
      factualReleaseScopeKey: scopeKey,
      executionLimits: injectedLimits,
      loadConstructionEvidence: (async () => {
        throw new Error('Construction evidence must not load while policy sourcing is asserted.');
      }) as never,
      constructTrade: (() => {
        throw new Error('Construct must not run while policy sourcing is asserted.');
      }) as never,
    });

    expect(forwardedDependencies).toHaveLength(1);
    expect(forwardedDependencies[0]?.maximumConcurrency).toBe(injectedLimits.maximumConcurrency);
  });
});

const digest = (character: string) => character.repeat(64);

/** A sha256-shaped hash that differs per fixture entry. */
const fixtureSha = (index: number) => (index + 64).toString(16).padStart(2, '0').repeat(32);

function fixtureArtifactRef(index: number) {
  const contentSha256 = fixtureSha(index);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 512,
    createdAt: '2026-08-21T09:00:00.000Z',
  };
}

/** A prepared-v3 ready entry, which is what `outcome_prepared_valuation_input_entry.entry_json` holds. */
function readyEntryJson(tradeId: string, index: number) {
  return {
    tradeId,
    state: 'ready',
    materializationManifestId: `private-evaluation-materialization-manifest:${fixtureSha(index + 32)}`,
    materializationManifestArtifact: fixtureArtifactRef(index),
  };
}

/**
 * A recording client for the cohort runner root's capture path. It answers only the statements
 * `captureCurrent` issues and throws on anything else, so a divergence between this fake and the
 * real SQL fails loudly instead of silently widening what the test accepts.
 */
function recordingCaptureClient(entryTradeIds: readonly string[]): AflOutcomeSqlClient {
  const preparedInputSetId = `prepared-valuation-input-set:${digest('1')}`;
  const capturedAt = '2026-08-21T09:00:00.000Z';
  let insertedCapture: readonly unknown[] = [];

  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    if (sql.includes('SET TRANSACTION ISOLATION LEVEL')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM outcome_current_prepared_valuation_input_set')) {
      return {
        rows: [
          {
            prepared_input_set_id: preparedInputSetId,
            schema_version: 'afl-trade-prepared-valuation-input-set/v3',
            environment: 'non_production',
            prepared_revision: 4,
            factual_release_id: `outcome-release:${digest('2')}`,
            factual_release_revision: 3,
            qualification_id: `model-qualification:${digest('3')}`,
            work_id: `model-qualification-work:${digest('4')}`,
            model_pair_revision: 5,
            batch_json: null,
            batch_id: null,
            batch_revision: null,
            transition_id: null,
            batch_activated_at: null,
            batch_factual_release_revision: null,
            batch_model_pair_revision: null,
            captured_at: capturedAt,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('INSERT INTO outcome_private_evaluation_cohort_capture')) {
      insertedCapture = parameters;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_private_evaluation_cohort_capture WHERE operation_id')) {
      return {
        rows: [
          {
            scope_key: insertedCapture[1],
            prepared_input_set_id: insertedCapture[2],
            prepared_input_set_revision: insertedCapture[3],
            model_qualification_work_id: insertedCapture[4],
            factual_release_revision: insertedCapture[5],
            model_pair_revision: insertedCapture[6],
            expected_batch_revision: insertedCapture[7],
            captured_at: insertedCapture[8],
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_prepared_valuation_input_entry')) {
      return {
        rows: entryTradeIds.map((tradeId, index) => ({
          trade_id: tradeId,
          state: 'ready',
          entry_json: readyEntryJson(tradeId, index),
        })),
        rowCount: entryTradeIds.length,
      };
    }
    throw new Error(`Recording capture client received an unexpected statement: ${sql}`);
  };

  return {
    query,
    transaction: async (work: (transaction: { query: typeof query }) => Promise<unknown>) =>
      work({ query }),
  } as unknown as AflOutcomeSqlClient;
}

describe('private current valuation cohort preparation composition root', () => {
  /**
   * The private root only reaches its coordinator construction after a real capture, so this path is
   * driven through a recording client instead of being asserted from the outside.
   */
  it.each([1, 2, 3])(
    'forwards the resolved concurrency limit of %i into the private cohort coordinator',
    async (maximumConcurrency) => {
      forwardedDependencies.length = 0;
      const bundle = createAflTradeCurrentValuationBundleFixture({
        scopeKey: privateScopeKey,
        playerRunId: privatePlayerRunId,
        pickRunId: privatePickRunId,
      });

      const coordinator = createPostgresAflTradePrivateCurrentValuationCohortCoordinator({
        client: recordingPrivatePreparationClient(),
        artifactRepository: fixtureArtifactRepository(),
        maximumArtifactBytes: 1_048_576,
        executionLimits: {
          maximumConcurrency,
          heartbeatMilliseconds: 9_000,
        },
        selectValuationInputBundleId: async () => bundle.valuationInputBundleId,
        loadConstructionEvidence: async () => ({
          factualReleaseArtifact: fixtureArtifactRef(0),
          releaseMembershipArtifact: fixtureArtifactRef(1),
          releaseTradeIds: ['trade-alpha'],
          valuationInputBundleId: bundle.valuationInputBundleId,
          valuationInputBundleArtifact: bundle.valuationInputBundleArtifact,
          valuationInputBundle: bundle.valuationInputBundle,
        }),
        constructTrade: (() => {
          throw new Error('Construct must not run while limit forwarding is asserted.');
        }) as never,
      });

      await coordinator.prepare({
        requestId: `private-valuation-dispatch:${digest('7')}`,
        claim: { claimId: 'fixture-claim', leaseToken: 'fixture-lease-token' },
      });

      expect(forwardedDependencies).toHaveLength(1);
      expect(forwardedDependencies[0]?.maximumConcurrency).toBe(maximumConcurrency);
    }
  );
});

describe('private evaluation cohort runner composition root', () => {
  const entryTradeIds = Array.from({ length: 6 }, (_, index) => `trade-${index}`);

  /**
   * The runner root hand-assembled this limit before, reading one policy field and ignoring the one
   * that governs concurrency. Drive the real root, real capture, and real inner runner, and prove
   * the effective worker bound tracks the resolved limit rather than any literal.
   */
  it.each([1, 2, 3])(
    'bounds real worker concurrency by the resolved limit of %i',
    async (maximumConcurrency) => {
      let active = 0;
      let observedMaximum = 0;

      const executionRepository = {
        async openAutomatic() {
          return { cycleId: `cohort-execution-cycle:${digest('e')}` };
        },
        async loadWork() {
          active += 1;
          observedMaximum = Math.max(observedMaximum, active);
          await Promise.resolve();
          active -= 1;
          return {
            status: 'leased' as const,
            attemptCount: 0,
            availableAt: '2026-08-21T09:00:05.000Z',
            leaseExpiresAt: null,
            terminalStage: null,
            terminalCause: null,
            result: null,
          };
        },
        async claim() {
          return null;
        },
      } as unknown as PostgresAflTradePrivateEvaluationCohortExecutionRepository;

      const runner = createPostgresAflTradePrivateEvaluationCohortRunner({
        client: recordingCaptureClient(entryTradeIds),
        workspace: {
          stageAutomated: async () => {
            throw new Error('A trade without a claim must not stage.');
          },
        } as never,
        batchRepository: {} as never,
        executionRepository,
        executionLimits: {
          maximumConcurrency,
          heartbeatMilliseconds: 9_000,
        },
      });

      await expect(runner.runCurrent(scopeKey)).resolves.toEqual({
        state: 'retry_pending',
        pendingTradeIds: entryTradeIds,
      });
      expect(observedMaximum).toBe(maximumConcurrency);
    }
  );
});

const privateScopeKey = 'afl-men:2026-trades';
const privatePlayerRunId = `model-run:${digest('1')}`;
const privatePickRunId = `model-run:${digest('2')}`;

/**
 * A qualified current model evidence record, which is what the private prepared-v3 authority carries
 * as JSON. Its content address and revision advance are cross-checked by the real schema, so this has
 * to be built the same way production builds it rather than hand-waved.
 */
const privateModelEvidence = (() => {
  const factualOperationId = `current-valuation-factual-refresh-operation:${digest('e')}`;
  const privateFactualAuthority = {
    valuationScopeKey: privateScopeKey,
    candidateId: `private-factual-candidate:${digest('a')}`,
    evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
    evidenceBundleId: `private-reviewed-evidence-bundle:${digest('b')}`,
    reviewDecisionId: `private-reviewed-evidence-evaluation-decision:${digest('c')}`,
    normalizedReconciledCustodySha256: digest('d'),
    revision: 4,
  };
  return {
    schemaVersion: AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_SCHEMA_VERSION,
    operationId: createAflTradeContentAddress('current-valuation-model-evidence-operation', {
      scopeKey: privateScopeKey,
      factualOperationId,
      privateFactualAuthority,
    }),
    scopeKey: privateScopeKey,
    factualOperationId,
    privateFactualAuthority,
    expectedModelRevision: 5,
    modelRevision: 6,
    capturedAt: '2026-08-21T08:00:00.000Z',
    completedAt: '2026-08-21T09:00:00.000Z',
    executionLocation: 'local',
    visibility: 'private',
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_CURRENT_VALUATION_MODEL_EVIDENCE_LIMITATION,
    state: 'qualified',
    playerObservationSetId: `player-observation-set:${digest('f')}`,
    pickBenchmarkEvidenceId: `pick-pav-observation-set:${digest('0')}`,
    playerRunId: privatePlayerRunId,
    pickRunId: privatePickRunId,
    qualificationId: `model-qualification:${digest('3')}`,
    qualificationWorkId: `model-qualification-work:${digest('4')}`,
    // The persisted context cross-checks the bundle's component gate-3 decisions against these, and
    // `createAflTradeCurrentValuationBundleFixture` fixes them to digests 3 and 6.
    playerGate3DecisionId: `gate-decision:${digest('3')}`,
    pickGate3DecisionId: `gate-decision:${digest('6')}`,
  } as const;
})();

function privateAuthorityRow() {
  return {
    scope_key: privateScopeKey,
    factual_release_scope_key: 'afl-men:2026-trades-private-factual',
    factual_release_id: `outcome-release:${digest('7')}`,
    factual_output_id: `private-valuation-factual-output:${digest('8')}`,
    hpn_calculation_id: `hpn-pav-season:${digest('9')}`,
    model_operation_id: `private-valuation-model-operation:${digest('a')}`,
    model_evidence_json: privateModelEvidence,
  };
}

/**
 * A recording client for the private preparation path. It answers only the statements
 * `loadPostgresAflTradePrivateCurrentPreparedValuationCohort` and the private capture issue, and
 * throws on anything else, so drift from the real SQL fails loudly rather than silently passing.
 */
function recordingPrivatePreparationClient(): AflOutcomeSqlClient {
  let insertedContext: string | null = null;

  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    if (sql.includes('SET TRANSACTION ISOLATION LEVEL')) return { rows: [], rowCount: 0 };
    if (sql.includes('SET LOCAL ROLE')) return { rows: [], rowCount: 0 };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('load_outcome_private_valuation_dispatch_request_for_claim')) {
      return { rows: [{ authenticated: true }], rowCount: 1 };
    }
    if (sql.includes('load_outcome_private_prepared_v3_authority')) {
      return { rows: [privateAuthorityRow()], rowCount: 1 };
    }
    if (sql.includes('load_outcome_private_current_prepared_valuation_input_head')) {
      // No private head keeps the path on its first-capture branch.
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('prepared_set_json')) {
      // No retained prepared custody, so preparation proceeds to capture.
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO outcome_current_valuation_cohort_operation')) {
      // The context is stored as JSONB, so it must come back as an object, not a string.
      insertedContext = String(parameters[10]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT context_json')) {
      if (sql.includes('dispatch_request_id')) return { rows: [], rowCount: 0 };
      if (insertedContext === null) return { rows: [], rowCount: 0 };
      return { rows: [{ context_json: JSON.parse(insertedContext) }], rowCount: 1 };
    }
    if (sql.includes('transaction_timestamp()')) {
      return { rows: [{ captured_at: '2026-08-21T09:00:00.000Z' }], rowCount: 1 };
    }
    throw new Error(
      `Recording private preparation client received an unexpected statement: ${sql}`
    );
  };

  return {
    query,
    transaction: async (work: (transaction: { query: typeof query }) => Promise<unknown>) =>
      work({ query }),
  } as unknown as AflOutcomeSqlClient;
}
