import { expect, it } from 'vitest';
import {
  createAflTradeModelRunCheckpoint,
  createAflTradeModelRunCheckpointV2,
} from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeModelRunIntent,
  createAflTradeNativeFinalTestCompletionEvidenceV2,
  aflTradeNativeFinalTestCompletionEvidenceV2Schema,
  aflTradeNativeFinalTestCompletionEvidenceSchema,
  createAflTradeModelRunContinuationIntent,
  createAflTradeModelRunProgressPersistenceRecoveryManifest,
  aflTradeModelRunManifestV5Schema,
  aflTradeModelRunManifestV4Schema,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { admittedRunFixture, runContent } from '../testUtils/admittedPlayerModelRunFixture';
import {
  authenticateAflTradeAuthorizedPersistenceRecoveryManifest,
  aflTradeModelRunAuthorizationSchema,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';

const id = (prefix: string) => `${prefix}:${'a'.repeat(64)}`;
const time = (minute: number) => `2026-08-10T00:${String(minute).padStart(2, '0')}:00.000Z`;
function completionInput() {
  const root = createAflTradeModelRunIntent({
    ...admittedRunFixture().intent.content,
    environment: 'non_production',
    startedAt: time(3),
    job: {
      jobId: id('private-valuation-model-operation'),
      attempt: 1,
      initiatedBy: 'system:weekly-valuation-coordinator',
      workerIdentity: 'system:weekly-valuation-coordinator',
    },
  });
  const outcome = runContent().outcome;
  if (outcome.status !== 'succeeded') throw new Error('Expected structural successful reports.');
  const checkpoint = createAflTradeModelRunCheckpointV2({
    intentId: root.intentId,
    rootIntentId: root.intentId,
    authorizationId: id('model-run-authorization'),
    dispatchRequestId: id('private-valuation-dispatch'),
    substantiveOperationId: root.content.job.jobId,
    dispatchClaimId: id('private-valuation-dispatch-claim'),
    dispatchAttemptNumber: 1,
    stage: 'final_test_started',
    previousCheckpointId: id('model-run-checkpoint'),
    recordedAt: time(5),
    candidateArtifact: outcome.modelArtifact,
    evidenceArtifact: outcome.modelArtifact,
  });
  return {
    root,
    finalTestStartedCheckpoint: checkpoint,
    evaluatedAt: time(6),
    recordedAt: time(7),
    outcome,
  };
}
it('retains progress-version completion without reinterpreting the legacy completion schema', () => {
  // Structural synthetic reports, not a genuine executed or qualified model.
  const { root: _root, ...input } = completionInput();
  const result = createAflTradeNativeFinalTestCompletionEvidenceV2(input);
  expect(result.schemaVersion).toBe('afl-trade-native-final-test-completion/v2');
  expect(result.finalTestStartedCheckpoint).toEqual(input.finalTestStartedCheckpoint);
  expect(result.evaluatedAt).toBe(time(6));
  expect(
    aflTradeNativeFinalTestCompletionEvidenceV2Schema.parse(JSON.parse(JSON.stringify(result)))
  ).toEqual(result);
  expect(aflTradeNativeFinalTestCompletionEvidenceSchema.safeParse(result).success).toBe(false);
  expect(() =>
    createAflTradeNativeFinalTestCompletionEvidenceV2({ ...input, evaluatedAt: time(4) })
  ).toThrow();
});

function progressInput() {
  const { root, finalTestStartedCheckpoint: template, outcome } = completionInput();
  const { schemaVersion: _version, ...base } = template.content;
  const started = createAflTradeModelRunCheckpoint({
    ...base,
    stage: 'started',
    previousCheckpointId: null,
    candidateArtifact: null,
    evidenceArtifact: null,
    recordedAt: time(3),
  });
  const fitted = createAflTradeModelRunCheckpointV2({
    ...base,
    stage: 'candidate_fitted',
    previousCheckpointId: started.checkpointId,
    recordedAt: time(4),
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef({ synthetic: 'fit custody' }, time(4)),
  });
  const preFinal = createAflTradeModelRunCheckpointV2({
    ...fitted.content,
    stage: 'pre_final_retained',
    previousCheckpointId: fitted.checkpointId,
    recordedAt: time(5),
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
      { synthetic: 'pre-final custody' },
      time(5)
    ),
  });
  const plan = createAflTradeModelRunCheckpointV2({
    ...preFinal.content,
    stage: 'validation_plan_retained',
    previousCheckpointId: preFinal.checkpointId,
    recordedAt: time(6),
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
      { synthetic: 'plan custody' },
      time(6)
    ),
  });
  const locked = createAflTradeModelRunCheckpointV2({
    ...plan.content,
    stage: 'candidate_locked',
    previousCheckpointId: plan.checkpointId,
    recordedAt: time(7),
  });
  const finalStart = createAflTradeModelRunCheckpointV2({
    ...locked.content,
    stage: 'final_test_started',
    previousCheckpointId: locked.checkpointId,
    recordedAt: time(8),
  });
  const completionEvidence = createAflTradeNativeFinalTestCompletionEvidenceV2({
    finalTestStartedCheckpoint: finalStart,
    evaluatedAt: time(9),
    recordedAt: time(10),
    outcome,
  });
  const completed = createAflTradeModelRunCheckpointV2({
    ...finalStart.content,
    stage: 'final_test_completed',
    previousCheckpointId: finalStart.checkpointId,
    recordedAt: time(11),
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(completionEvidence, time(10)),
  });
  const child = createAflTradeModelRunContinuationIntent({
    previousIntent: root,
    checkpoint: completed,
    startedAt: time(12),
    dispatchClaimId: `private-valuation-dispatch-claim:${'b'.repeat(64)}`,
    dispatchAttemptNumber: 2,
    dispatchLeaseTokenSha256: 'b'.repeat(64),
    modelTrainingEvaluationReceiptIds: [`gate0a-evaluation:${'b'.repeat(64)}`],
  });
  return {
    intentChain: [root, child],
    checkpoints: [started, fitted, preFinal, plan, locked, finalStart, completed],
    completionEvidence,
    runAuthorizationId: `model-run-authorization:${'b'.repeat(64)}`,
    finishedAt: time(13),
  };
}
it('preserves every accepted numerical checkpoint in a strict versioned terminal manifest', () => {
  const input = progressInput();
  const result = createAflTradeModelRunProgressPersistenceRecoveryManifest(input);
  expect(result.content.schemaVersion).toBe('afl-trade-model-run/v5');
  expect(result.content.recovery.checkpoints.map((checkpoint) => checkpoint.content.stage)).toEqual(
    [
      'started',
      'candidate_fitted',
      'pre_final_retained',
      'validation_plan_retained',
      'candidate_locked',
      'final_test_started',
      'final_test_completed',
    ]
  );
  expect(result.content.candidateLockedAt).toBe(time(7));
  expect(result.content.finalTestEvaluatedAt).toBe(time(9));
  expect(result.content.startedAt).toBe(time(12));
  expect(aflTradeModelRunManifestV5Schema.parse(JSON.parse(JSON.stringify(result)))).toEqual(
    result
  );
  expect(aflTradeModelRunManifestV4Schema.safeParse(result).success).toBe(false);
  expect(() =>
    createAflTradeModelRunProgressPersistenceRecoveryManifest({
      ...input,
      checkpoints: input.checkpoints.filter(
        (checkpoint) => checkpoint.content.stage !== 'pre_final_retained'
      ),
    })
  ).toThrow();
});

function authorizedProgressInput() {
  const input = progressInput();
  const intent = input.intentChain.at(-1)!;
  const content = {
    schemaVersion: 'afl-trade-model-run-authorization/v1',
    authorityBoundary: 'model_run_start_authority_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    runIntentId: intent.intentId,
    datasetId: intent.content.datasetId,
    datasetAdmissionId: intent.content.datasetAdmissionId,
    datasetRowSetSha256: 'a'.repeat(64),
    modelProtocolId: intent.content.modelProtocolId,
    observationSetId: intent.content.observationSetId,
    operationalAuthorizationReceiptId: id('architecture-operation-receipt'),
    gate2DecisionId: id('gate-decision'),
    gateLedgerRevision: 1,
    authorizedAt: time(12),
    validThrough: '2026-08-10T00:12:30.000Z',
    modelTrainingEvaluationReceiptIds: intent.content.modelTrainingEvaluationReceiptIds,
  };
  const authorization = aflTradeModelRunAuthorizationSchema.parse({
    authorizationId: createAflTradeContentAddress('model-run-authorization', content),
    content,
  });
  const run = createAflTradeModelRunProgressPersistenceRecoveryManifest({
    ...input,
    runAuthorizationId: authorization.authorizationId,
  });
  return { input, intent, authorization, run };
}
it('authenticates the exact child authorization for a seven-stage terminal manifest', () => {
  const { input, intent, authorization, run } = authorizedProgressInput();
  expect(
    authenticateAflTradeAuthorizedPersistenceRecoveryManifest({ run, intent, authorization })
  ).toEqual(run);
  expect(() =>
    authenticateAflTradeAuthorizedPersistenceRecoveryManifest({
      run,
      intent: input.intentChain[0]!,
      authorization,
    })
  ).toThrow('exact child intent and authorization');
});

it('reads and persists exact retained progress completion without numerical execution', async () => {
  const { input, authorization, run } = authorizedProgressInput();
  const root = input.intentChain[0]!;
  const reference = input.checkpoints[6]!.content.evidenceArtifact!;
  const repository = createAflTradeFixtureArtifactRepository();
  await repository.putIfAbsent(
    reference,
    new TextEncoder().encode(canonicalizeAflTradeJson(input.completionEvidence))
  );
  let terminalRetained = false;
  let writesEnabled = false;
  let terminalInsertions = 0;
  let completionAvailable = true;
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string, parameters: readonly unknown[] = []) {
      if (writesEnabled && statement.includes('INSERT INTO outcome_valuation_model_run')) {
        expect(parameters[0]).toBe(run.runId);
        expect(JSON.parse(String(parameters[7]))).toEqual(run);
        const rows = terminalRetained ? [] : [{}];
        terminalInsertions += rows.length;
        terminalRetained = true;
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (/\b(INSERT|UPDATE|DELETE)\b/u.test(statement))
        throw new Error('Recovery must not execute or write');
      const rows =
        statement.includes('SELECT run_json AS document_json') && terminalRetained
          ? [{ document_json: run }]
          : statement.includes('SELECT intent.intent_json,run_authorization.authorization_json')
            ? [{ intent_json: input.intentChain[1], authorization_json: authorization }]
            : statement.includes('SELECT COALESCE')
              ? [{ root_intent_id: root.intentId }]
              : statement.includes('SELECT root.intent_json')
                ? [{ intent_json: root, consumed_at: root.content.startedAt }]
                : statement.includes('SELECT intent_json')
                  ? input.intentChain.map((intent_json) => ({ intent_json }))
                  : statement.includes('SELECT checkpoint_json')
                    ? input.checkpoints.map((checkpoint_json) => ({ checkpoint_json }))
                    : statement.includes('SELECT run.run_json') && terminalRetained
                      ? [{ run_json: run, authorization_json: authorization }]
                      : [];
      return { rows: rows as Row[], rowCount: rows.length };
    },
    transaction: async (work) => work(sql),
  };
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
    sql,
    artifactRepository: {
      ...repository,
      loadExact: (reference, maximumBytes) =>
        completionAvailable ? repository.loadExact(reference, maximumBytes) : Promise.resolve(null),
    },
    gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
  });
  const state = await adapter.loadRetainedRecoveryState({
    intentId: input.intentChain[1]!.intentId,
  });
  expect(state.checkpoints).toEqual(input.checkpoints);
  expect(state.finalTestCompletionEvidence).toEqual(input.completionEvidence);
  expect(state.terminalRun).toBeNull();
  terminalRetained = true;
  expect(
    (await adapter.loadRetainedRecoveryState({ intentId: input.intentChain[1]!.intentId }))
      .terminalRun
  ).toEqual(run);
  terminalRetained = false;
  writesEnabled = true;
  expect(await adapter.persistCompletedRun(run)).toBe(true);
  expect(await adapter.persistCompletedRun(run)).toBe(true);
  expect(terminalInsertions).toBe(1);
  terminalRetained = false;
  completionAvailable = false;
  await expect(adapter.persistCompletedRun(run)).rejects.toThrow('ancestry');
  expect(terminalInsertions).toBe(1);
});

it.each([
  'missing_stage',
  'reordered_stage',
  'changed_lock_time',
  'reused_authorization',
  'future_evaluation',
  'wrong_completion_start',
] as const)('rejects coherently readdressed progress recovery with %s', (change) => {
  const result = createAflTradeModelRunProgressPersistenceRecoveryManifest(progressInput());
  const content = structuredClone(result.content);
  if (change === 'missing_stage') content.recovery.checkpoints.splice(2, 1);
  if (change === 'reordered_stage') content.recovery.checkpoints.reverse();
  if (change === 'changed_lock_time') content.candidateLockedAt = time(6);
  if (change === 'reused_authorization')
    content.runAuthorizationId = content.recovery.checkpoints[0].content.authorizationId;
  if (change === 'future_evaluation') content.recovery.completionEvidence.evaluatedAt = time(13);
  if (change === 'wrong_completion_start')
    content.recovery.completionEvidence.finalTestStartedCheckpoint =
      content.recovery.checkpoints[4];
  expect(
    aflTradeModelRunManifestV5Schema.safeParse({
      runId: createAflTradeContentAddress('model-run', content),
      content,
    }).success
  ).toBe(false);
});
