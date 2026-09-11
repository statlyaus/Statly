import { describe, expect, it } from 'vitest';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeModelRunIntent,
  createAflTradeModelRunContinuationIntent,
  createAflTradeNativeFinalTestCompletionEvidence,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeModelRunCheckpoint } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import {
  createAflTradeFixtureArtifactRepository,
  type AflTradeImmutableArtifactRepository,
} from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import { aflTradeModelRunAuthorizationSchema } from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { admittedRunFixture, runContent } from '../testUtils/admittedPlayerModelRunFixture';

const id = (prefix: string) => `${prefix}:${'a'.repeat(64)}`;
function fixture() {
  const original = admittedRunFixture().intent;
  const root = createAflTradeModelRunIntent({
    ...original.content,
    environment: 'non_production',
    job: {
      jobId: id('private-valuation-model-operation'),
      attempt: 1,
      initiatedBy: 'system:weekly-valuation-coordinator',
      workerIdentity: 'system:weekly-valuation-coordinator',
    },
  });
  const checkpoint = createAflTradeModelRunCheckpoint({
    intentId: root.intentId,
    rootIntentId: root.intentId,
    authorizationId: id('model-run-authorization'),
    dispatchRequestId: id('private-valuation-dispatch'),
    substantiveOperationId: root.content.job.jobId,
    dispatchClaimId: id('private-valuation-dispatch-claim'),
    dispatchAttemptNumber: 1,
    stage: 'started',
    previousCheckpointId: null,
    recordedAt: root.content.startedAt,
    candidateArtifact: null,
    evidenceArtifact: null,
  });
  return { root, checkpoint };
}

function reader(
  { root, checkpoint }: ReturnType<typeof fixture>,
  options: {
    intents?: unknown[];
    checkpoints?: unknown[];
    rootMissing?: boolean;
    consumedAt?: string | null;
    runs?: unknown[];
    artifactRepository?: AflTradeImmutableArtifactRepository;
    maximumArtifactBytes?: number;
  } = {}
) {
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string) {
      if (/\b(INSERT|UPDATE|DELETE)\b/u.test(statement)) throw new Error('Unexpected write');
      const rows = statement.includes('SELECT COALESCE')
        ? [{ root_intent_id: root.intentId }]
        : statement.includes('SELECT root.intent_json')
          ? options.rootMissing
            ? []
            : [
                {
                  intent_json: root,
                  consumed_at:
                    options.consumedAt === undefined ? root.content.startedAt : options.consumedAt,
                },
              ]
          : statement.includes('SELECT intent_json')
            ? (options.intents ?? [root]).map((intent_json) => ({ intent_json }))
            : statement.includes('SELECT checkpoint_json')
              ? (options.checkpoints ?? [checkpoint]).map((checkpoint_json) => ({
                  checkpoint_json,
                }))
              : statement.includes('SELECT run.run_json')
                ? (options.runs ?? [])
                : [];
      return { rows: rows as Row[], rowCount: rows.length };
    },
    async transaction(work) {
      return work(sql);
    },
  };
  return new PostgresAflTradeAdmittedModelRunAuthority({
    sql,
    artifactRepository: options.artifactRepository ?? createAflTradeFixtureArtifactRepository(),
    maximumArtifactBytes: options.maximumArtifactBytes,
    gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
  });
}

async function completedFixture() {
  const input = fixture();
  const outcome = runContent().outcome;
  const candidate = createAflTradeModelRunCheckpoint({
    ...input.checkpoint.content,
    stage: 'candidate_locked',
    previousCheckpointId: input.checkpoint.checkpointId,
    recordedAt: '2026-08-10T00:04:00.000Z',
    candidateArtifact: outcome.modelArtifact,
    evidenceArtifact: outcome.diagnosticsArtifact,
  });
  const start = createAflTradeModelRunCheckpoint({
    ...candidate.content,
    stage: 'final_test_started',
    previousCheckpointId: candidate.checkpointId,
    recordedAt: '2026-08-10T00:04:30.000Z',
  });
  const evidence = createAflTradeNativeFinalTestCompletionEvidence({
    finalTestStartedCheckpoint: start,
    evaluatedAt: '2026-08-10T00:05:00.000Z',
    recordedAt: '2026-08-10T00:05:30.000Z',
    outcome,
  });
  const reference = createAflTradeCanonicalJsonArtifactRef(evidence, evidence.recordedAt);
  const completed = createAflTradeModelRunCheckpoint({
    ...start.content,
    stage: 'final_test_completed',
    previousCheckpointId: start.checkpointId,
    recordedAt: '2026-08-10T00:06:00.000Z',
    evidenceArtifact: reference,
  });
  const repository = createAflTradeFixtureArtifactRepository();
  await repository.putIfAbsent(
    reference,
    new TextEncoder().encode(canonicalizeAflTradeJson(evidence))
  );
  return {
    input,
    candidate,
    start,
    completed,
    evidence,
    reference,
    repository,
    checkpoints: [input.checkpoint, candidate, start, completed],
  };
}

// Synthetic persistence boundary: retained recovery evidence, never native execution permission.
describe('retained model-run recovery reader', () => {
  it('loads an exact started root without consuming or executing it again', async () => {
    const input = fixture();
    const { root, checkpoint } = input;
    const state = await reader(input).loadRetainedRecoveryState({ intentId: root.intentId });
    expect(state).toEqual({
      authorityBoundary: 'retained_model_run_recovery_evidence_no_execution_authority',
      rootIntent: root,
      activeIntent: root,
      checkpoints: [checkpoint],
      terminalRun: null,
      finalTestCompletionEvidence: null,
    });
  });

  it('loads exact retained completion bytes without evaluating or renewing authority', async () => {
    const { input, evidence, repository, checkpoints } = await completedFixture();
    const state = await reader(input, {
      checkpoints,
      artifactRepository: repository,
    }).loadRetainedRecoveryState({ intentId: input.root.intentId });
    expect(state.finalTestCompletionEvidence).toEqual(evidence);
    expect(state.terminalRun).toBeNull();
    expect(state.authorityBoundary).toBe(
      'retained_model_run_recovery_evidence_no_execution_authority'
    );
  });

  it.each(['missing', 'changed_bytes', 'changed_reference', 'over_bound'] as const)(
    'rejects %s completion custody',
    async (mode) => {
      const { input, checkpoints, repository } = await completedFixture();
      const artifactRepository: AflTradeImmutableArtifactRepository = {
        ...repository,
        async loadExact(reference, maximumBytes) {
          if (mode === 'over_bound')
            throw new Error('Oversize artifact must be rejected before reading');
          if (mode === 'missing') return null;
          const original = (await repository.loadExact(reference, maximumBytes))!;
          return mode === 'changed_bytes'
            ? { ...original, bytes: new TextEncoder().encode('{}') }
            : {
                ...original,
                reference: { ...original.reference, createdAt: '2026-08-10T00:05:29.000Z' },
              };
        },
      };
      await expect(
        reader(input, {
          checkpoints,
          artifactRepository,
          maximumArtifactBytes: mode === 'over_bound' ? 1 : undefined,
        }).loadRetainedRecoveryState({ intentId: input.root.intentId })
      ).rejects.toMatchObject({ code: 'MISSING_EVIDENCE' });
    }
  );

  it('does not open artifacts or manufacture completion for an ambiguous final-test start', async () => {
    const { input, checkpoints, repository } = await completedFixture();
    const state = await reader(input, {
      checkpoints: checkpoints.slice(0, 3),
      artifactRepository: {
        ...repository,
        async loadExact() {
          throw new Error('Ambiguous final test must not read artifacts');
        },
      },
    }).loadRetainedRecoveryState({ intentId: input.root.intentId });
    expect(state.finalTestCompletionEvidence).toBeNull();
    expect(state.checkpoints.at(-1)?.content.stage).toBe('final_test_started');
  });

  it.each(['substituted_start', 'retention_time'] as const)(
    'rejects readdressed completion evidence with %s',
    async (mode) => {
      const { input, checkpoints, evidence, completed, repository } = await completedFixture();
      const changed =
        mode === 'substituted_start'
          ? {
              ...evidence,
              finalTestStartedCheckpoint: createAflTradeModelRunCheckpoint({
                ...evidence.finalTestStartedCheckpoint.content,
                evidenceArtifact: evidence.outcome.modelCardArtifact,
              }),
            }
          : evidence;
      const reference = createAflTradeCanonicalJsonArtifactRef(
        changed,
        mode === 'retention_time' ? '2026-08-10T00:05:31.000Z' : evidence.recordedAt
      );
      await repository.putIfAbsent(
        reference,
        new TextEncoder().encode(canonicalizeAflTradeJson(changed))
      );
      const changedCheckpoint = createAflTradeModelRunCheckpoint({
        ...completed.content,
        evidenceArtifact: reference,
      });
      await expect(
        reader(input, {
          checkpoints: [...checkpoints.slice(0, 3), changedCheckpoint],
          artifactRepository: repository,
        }).loadRetainedRecoveryState({ intentId: input.root.intentId })
      ).rejects.toMatchObject({ code: 'MISSING_EVIDENCE' });
    }
  );

  it('rejects a readdressed continuation that changes the root scientific parents', async () => {
    const input = fixture();
    const child = createAflTradeModelRunContinuationIntent({
      previousIntent: input.root,
      checkpoint: input.checkpoint,
      startedAt: new Date(Date.parse(input.root.content.startedAt) + 60_000).toISOString(),
      dispatchClaimId: id('private-valuation-dispatch-claim'),
      dispatchLeaseTokenSha256: 'a'.repeat(64),
      dispatchAttemptNumber: 2,
      modelTrainingEvaluationReceiptIds: input.root.content.modelTrainingEvaluationReceiptIds,
    });
    const content = { ...child.content, seed: child.content.seed + 1 };
    const substituted = {
      intentId: createAflTradeContentAddress('model-run-intent', content),
      content,
    };
    await expect(
      reader(input, { intents: [input.root, substituted] }).loadRetainedRecoveryState({
        intentId: input.root.intentId,
      })
    ).rejects.toMatchObject({ code: 'MISSING_EVIDENCE' });
  });

  it('finds the leaf through an unconsumed intermediate continuation without inventing checkpoints', async () => {
    const input = fixture();
    const continuationInput = {
      previousIntent: input.root,
      checkpoint: input.checkpoint,
      startedAt: new Date(Date.parse(input.root.content.startedAt) + 60_000).toISOString(),
      dispatchClaimId: id('private-valuation-dispatch-claim'),
      dispatchLeaseTokenSha256: 'a'.repeat(64),
      dispatchAttemptNumber: 2,
      modelTrainingEvaluationReceiptIds: input.root.content.modelTrainingEvaluationReceiptIds,
    };
    const intermediate = createAflTradeModelRunContinuationIntent(continuationInput);
    const active = createAflTradeModelRunContinuationIntent({
      ...continuationInput,
      previousIntent: intermediate,
      dispatchAttemptNumber: 3,
    });
    const state = await reader(input, {
      intents: [active, input.root, intermediate],
    }).loadRetainedRecoveryState({ intentId: intermediate.intentId });
    expect(state.rootIntent).toEqual(input.root);
    expect(state.activeIntent).toEqual(active);
    expect(state.checkpoints).toEqual([input.checkpoint]);
    expect(state.terminalRun).toBeNull();
  });

  it.each([{ rootMissing: true }, { checkpoints: [] }, { consumedAt: null }, { intents: [] }])(
    'rejects incomplete durable recovery evidence %j',
    async (options) => {
      const input = fixture();
      await expect(
        reader(input, options).loadRetainedRecoveryState({ intentId: input.root.intentId })
      ).rejects.toMatchObject({ code: 'MISSING_EVIDENCE' });
    }
  );

  it('distinguishes a prepared but unconsumed root from a consumed run with missing checkpoints', async () => {
    const input = fixture();
    const state = await reader(input, {
      consumedAt: null,
      checkpoints: [],
    }).loadRetainedRecoveryState({ intentId: input.root.intentId });
    expect(state.checkpoints).toEqual([]);
    expect(state.activeIntent).toEqual(input.root);
  });

  it('does not return a terminal result without its exact retained authorization', async () => {
    const input = fixture();
    const {
      schemaVersion: _version,
      authorityBoundary: _boundary,
      publicationEligible: _eligible,
      ...rootContent
    } = input.root.content;
    const content = {
      ...runContent(),
      ...rootContent,
      runIntentId: input.root.intentId,
      runAuthorizationId: input.checkpoint.content.authorizationId,
    };
    const run = { runId: createAflTradeContentAddress('model-run', content), content };
    await expect(
      reader(input, { runs: [{ run_json: run }] }).loadRetainedRecoveryState({
        intentId: input.root.intentId,
      })
    ).rejects.toThrow();
  });

  it('returns an authenticated retained failure without reopening the root', async () => {
    const input = fixture();
    const root = input.root.content;
    const authorityContent = {
      schemaVersion: 'afl-trade-model-run-authorization/v1',
      authorityBoundary: 'model_run_start_authority_no_grade_publication_or_fantasy_ownership',
      publicationEligible: false,
      environment: root.environment,
      runIntentId: input.root.intentId,
      datasetId: root.datasetId,
      datasetAdmissionId: root.datasetAdmissionId,
      datasetRowSetSha256: 'a'.repeat(64),
      modelProtocolId: root.modelProtocolId,
      observationSetId: root.observationSetId,
      operationalAuthorizationReceiptId: id('architecture-operation-receipt'),
      gate2DecisionId: id('gate-decision'),
      gateLedgerRevision: 1,
      authorizedAt: root.startedAt,
      validThrough: new Date(Date.parse(root.startedAt) + 30_000).toISOString(),
      modelTrainingEvaluationReceiptIds: root.modelTrainingEvaluationReceiptIds,
    };
    const authorization = aflTradeModelRunAuthorizationSchema.parse({
      authorizationId: createAflTradeContentAddress('model-run-authorization', authorityContent),
      content: authorityContent,
    });
    const checkpoint = createAflTradeModelRunCheckpoint({
      ...input.checkpoint.content,
      authorizationId: authorization.authorizationId,
    });
    const {
      schemaVersion: _version,
      authorityBoundary: _boundary,
      publicationEligible: _eligible,
      ...rootContent
    } = root;
    const content = {
      ...runContent(),
      ...rootContent,
      runIntentId: input.root.intentId,
      runAuthorizationId: authorization.authorizationId,
      candidateLockedAt: null,
      finalTestEvaluatedAt: null,
      outcome: {
        status: 'failed',
        failureClassification: 'data_quality',
        failureArtifact: root.configurationArtifact,
        diagnosticsArtifact: root.configurationArtifact,
      },
    };
    const run = { runId: createAflTradeContentAddress('model-run', content), content };
    const state = await reader(input, {
      checkpoints: [checkpoint],
      runs: [{ run_json: run, authorization_json: authorization }],
    }).loadRetainedRecoveryState({ intentId: input.root.intentId });
    expect(state.terminalRun).toEqual(run);
    expect(state.activeIntent).toEqual(input.root);
  });
});
