import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeModelRunCheckpointSchema,
  aflTradeModelRunCheckpointV2Schema,
  createAflTradeModelRunCheckpoint,
  createAflTradeModelRunCheckpointV2,
} from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import {
  createAflTradeModelRunContinuationIntent,
  createAflTradeModelRunPersistenceRecoveryManifest,
  createAflTradeModelRunProgressPersistenceRecoveryManifest,
  createAflTradeNativeFinalTestCompletionEvidence,
  createAflTradeNativeFinalTestCompletionEvidenceV2,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  createAflTradeFixtureArtifactRepository,
  type AflTradeImmutableArtifactRepository,
} from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { evaluateAflTradeAdmittedPlayerPavFinal } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavFinalEvaluation';
import {
  aflTradeNativePavFinalEvidenceSchema,
  createAflTradeNativePavReportDocuments,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavReports';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';

import { nativePavFinalEvidenceFixture } from './nativePavFinalEvidenceFixture';
import { nativePavModelRunSqlFixture } from './nativePavModelRunSqlFixture';

const bytes = (document: unknown) => new TextEncoder().encode(canonicalizeAflTradeJson(document));

/** Synthetic retained evidence for reader tests; it grants no execution or qualification authority. */
export async function governedNativePlayerPavComponentFixture(input: {
  manifestVersion: 'v4' | 'v5';
  finalEvidenceVersion: 'v1' | 'v2';
  source?: Awaited<ReturnType<typeof nativePavModelRunSqlFixture>>;
  artifactRepository?: AflTradeImmutableArtifactRepository;
  tamper?: 'custody_parents' | 'outcome_selection_validation';
}) {
  const source = input.source ?? (await nativePavModelRunSqlFixture());
  const originalParents = nativePavFinalEvidenceFixture(source);
  const root = source.intent;
  const operation = source.operationalAuthorization.content;
  if (!('dispatchRequestId' in operation)) throw new Error('Expected private dispatch authority.');
  const at = (offsetSeconds: number) =>
    new Date(Date.parse(source.startedAt) + offsetSeconds * 1000).toISOString();
  const started = createAflTradeModelRunCheckpoint({
    intentId: root.intentId,
    rootIntentId: root.intentId,
    authorizationId: source.authorization.authorizationId,
    dispatchRequestId: operation.dispatchRequestId,
    substantiveOperationId: operation.substantiveOperationId,
    dispatchClaimId: operation.dispatchClaimId,
    dispatchAttemptNumber: operation.dispatchAttemptNumber,
    stage: 'started',
    previousCheckpointId: null,
    recordedAt: at(0),
    candidateArtifact: null,
    evidenceArtifact: null,
  });

  const originalCustodyArtifact =
    originalParents.candidateLockedCheckpoint.content.evidenceArtifact!;
  const makeV4Parents = (custodyArtifact: AflTradeArtifactRef, custodyBytes: Uint8Array) => {
    const locked = createAflTradeModelRunCheckpoint({
      ...originalParents.candidateLockedCheckpoint.content,
      previousCheckpointId: started.checkpointId,
      recordedAt: at(1),
      evidenceArtifact: custodyArtifact,
    });
    const finalStarted = createAflTradeModelRunCheckpoint({
      ...locked.content,
      stage: 'final_test_started',
      previousCheckpointId: locked.checkpointId,
      recordedAt: at(2),
    });
    return {
      parents: {
        ...originalParents,
        candidateCustodyBytes: custodyBytes,
        candidateLockedCheckpoint: locked,
        finalTestStartedCheckpoint: finalStarted,
      },
      checkpoints: [started, locked, finalStarted] as const,
      intermediateEvidence: [] as const,
    };
  };

  const makeV5Parents = (custodyArtifact: AflTradeArtifactRef, custodyBytes: Uint8Array) => {
    const fitEvidenceDocument = { fixture: 'retained native fit custody' };
    const preFinalEvidenceDocument = { fixture: 'retained native pre-final custody' };
    const fitEvidence = createAflTradeCanonicalJsonArtifactRef(fitEvidenceDocument, at(1));
    const preFinalEvidence = createAflTradeCanonicalJsonArtifactRef(
      preFinalEvidenceDocument,
      at(2)
    );
    const candidateFitted = createAflTradeModelRunCheckpointV2({
      ...started.content,
      stage: 'candidate_fitted',
      previousCheckpointId: started.checkpointId,
      recordedAt: at(1),
      candidateArtifact: originalParents.candidateArtifact,
      evidenceArtifact: fitEvidence,
    });
    const preFinalRetained = createAflTradeModelRunCheckpointV2({
      ...candidateFitted.content,
      stage: 'pre_final_retained',
      previousCheckpointId: candidateFitted.checkpointId,
      recordedAt: at(2),
      evidenceArtifact: preFinalEvidence,
    });
    const validationPlanRetained = createAflTradeModelRunCheckpointV2({
      ...preFinalRetained.content,
      stage: 'validation_plan_retained',
      previousCheckpointId: preFinalRetained.checkpointId,
      recordedAt: at(3),
      evidenceArtifact: custodyArtifact,
    });
    const locked = createAflTradeModelRunCheckpointV2({
      ...validationPlanRetained.content,
      stage: 'candidate_locked',
      previousCheckpointId: validationPlanRetained.checkpointId,
      recordedAt: at(4),
    });
    const finalStarted = createAflTradeModelRunCheckpointV2({
      ...locked.content,
      stage: 'final_test_started',
      previousCheckpointId: locked.checkpointId,
      recordedAt: at(5),
    });
    return {
      parents: {
        ...originalParents,
        candidateCustodyBytes: custodyBytes,
        candidateLockedCheckpoint: locked,
        finalTestStartedCheckpoint: finalStarted,
      },
      checkpoints: [
        started,
        candidateFitted,
        preFinalRetained,
        validationPlanRetained,
        locked,
        finalStarted,
      ] as const,
      intermediateEvidence: [
        { document: fitEvidenceDocument, reference: fitEvidence },
        { document: preFinalEvidenceDocument, reference: preFinalEvidence },
      ] as const,
    };
  };

  const validStaged =
    input.manifestVersion === 'v4'
      ? makeV4Parents(originalCustodyArtifact, originalParents.candidateCustodyBytes)
      : makeV5Parents(originalCustodyArtifact, originalParents.candidateCustodyBytes);
  const evaluatedV2 = evaluateAflTradeAdmittedPlayerPavFinal(validStaged.parents);
  const custodyDocument =
    input.tamper === 'custody_parents'
      ? {
          schemaVersion: 'afl-trade-native-pav-candidate-custody/v3',
          authorityBoundary: 'pre_final_numerical_evidence_no_final_test_or_qualification',
          rootIntentId: root.intentId,
          fitIntentId: root.intentId,
          candidateId: originalParents.candidate.candidateId,
          candidateArtifact: originalParents.candidateArtifact,
          preFinalArtifact: createAflTradeCanonicalJsonArtifactRef(
            { fixture: 'different frozen pre-final evidence' },
            source.startedAt
          ),
          validationPlanArtifact: createAflTradeCanonicalJsonArtifactRef(
            { fixture: 'different frozen validation plan' },
            source.startedAt
          ),
        }
      : JSON.parse(new TextDecoder().decode(originalParents.candidateCustodyBytes));
  const custodyBytes = bytes(custodyDocument);
  const custodyArtifact = createAflTradeCanonicalJsonArtifactRef(custodyDocument, source.startedAt);
  const staged =
    input.manifestVersion === 'v4'
      ? makeV4Parents(custodyArtifact, custodyBytes)
      : makeV5Parents(custodyArtifact, custodyBytes);
  const stagedV2 = aflTradeNativePavFinalEvidenceSchema.parse({
    evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', {
      ...evaluatedV2.content,
      candidateLockedCheckpointId: staged.parents.candidateLockedCheckpoint.checkpointId,
      finalTestStartedCheckpointId: staged.parents.finalTestStartedCheckpoint.checkpointId,
    }),
    content: {
      ...evaluatedV2.content,
      candidateLockedCheckpointId: staged.parents.candidateLockedCheckpoint.checkpointId,
      finalTestStartedCheckpointId: staged.parents.finalTestStartedCheckpoint.checkpointId,
    },
  });
  const finalEvidence = (() => {
    if (input.finalEvidenceVersion === 'v2') return stagedV2;
    const content = {
      ...stagedV2.content,
      schemaVersion: 'afl-trade-native-pav-final-evaluation/v1' as const,
      baselineComparisons: evaluatedV2.content.baselineComparisons.map(
        ({ pairedScores: _pairedScores, ...comparison }) => comparison
      ),
    };
    return aflTradeNativePavFinalEvidenceSchema.parse({
      evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', content),
      content,
    });
  })();
  const metricDefinitionArtifacts =
    source.protocol.content.validationPlan.metricDefinitionArtifacts.map((reference) => ({
      reference,
      bytes: source.evidence.executableArtifacts.find(
        (artifact) => artifact.artifactId === reference.artifactId
      )!.bytes,
    }));
  const documents = createAflTradeNativePavReportDocuments({
    parents: staged.parents,
    finalEvidence,
    metricDefinitionArtifacts,
  });
  const artifactRepository =
    input.artifactRepository ??
    createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  const retain = async (document: unknown, createdAt: string, reference?: AflTradeArtifactRef) => {
    const exact = reference ?? createAflTradeCanonicalJsonArtifactRef(document, createdAt);
    await artifactRepository.putIfAbsent(exact, bytes(document));
    return exact;
  };
  await retain(documents.modelArtifact, source.startedAt, staged.parents.candidateArtifact);
  await retain(
    documents.selectionValidationReportArtifact,
    source.startedAt,
    staged.parents.preFinalArtifact
  );
  await retain(
    staged.parents.validationPlanEvidence,
    source.startedAt,
    staged.parents.validationPlanArtifact
  );
  await artifactRepository.putIfAbsent(
    staged.parents.candidateLockedCheckpoint.content.evidenceArtifact!,
    staged.parents.candidateCustodyBytes
  );
  await Promise.all(
    staged.intermediateEvidence.map(({ document, reference }) =>
      artifactRepository.putIfAbsent(reference, bytes(document))
    )
  );
  const reportTime = input.manifestVersion === 'v4' ? at(3) : at(6);
  const reportReferences = {
    validationReportArtifact: await retain(documents.validationReportArtifact, reportTime),
    baselineComparisonArtifact: await retain(documents.baselineComparisonArtifact, reportTime),
    calibrationReportArtifact: await retain(documents.calibrationReportArtifact, reportTime),
    intervalCoverageArtifact: await retain(documents.intervalCoverageArtifact, reportTime),
    subgroupReportArtifact: await retain(documents.subgroupReportArtifact, reportTime),
    sensitivityReportArtifact: await retain(documents.sensitivityReportArtifact, reportTime),
    leakageAuditArtifact: await retain(documents.leakageAuditArtifact, reportTime),
    modelCardArtifact: await retain(documents.modelCardArtifact, reportTime),
    diagnosticsArtifact: await retain(documents.diagnosticsArtifact, reportTime),
  };
  const outcomeSelectionValidationArtifact =
    input.tamper === 'outcome_selection_validation'
      ? await retain({ fixture: 'different outcome selection validation' }, source.startedAt)
      : staged.parents.preFinalArtifact;
  const outcome = {
    status: 'succeeded' as const,
    modelArtifact: staged.parents.candidateArtifact,
    selectionValidationReportArtifact: outcomeSelectionValidationArtifact,
    ...reportReferences,
  };
  const recovered = (() => {
    const dispatchClaimId = createAflTradeContentAddress('private-valuation-dispatch-claim', {
      fixture: 'native component recovery child',
      version: input.manifestVersion,
    });
    const runAuthorizationId = createAflTradeContentAddress('model-run-authorization', {
      fixture: 'native component recovery authorization',
      version: input.manifestVersion,
    });
    if (input.manifestVersion === 'v4') {
      const checkpoints = staged.checkpoints.map((checkpoint) =>
        aflTradeModelRunCheckpointSchema.parse(checkpoint)
      );
      const finalStarted = checkpoints[2]!;
      const completion = createAflTradeNativeFinalTestCompletionEvidence({
        finalTestStartedCheckpoint: finalStarted,
        evaluatedAt: at(3),
        recordedAt: at(4),
        outcome,
      });
      const completed = createAflTradeModelRunCheckpoint({
        ...finalStarted.content,
        stage: 'final_test_completed',
        previousCheckpointId: finalStarted.checkpointId,
        recordedAt: at(5),
        evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(completion, at(4)),
      });
      const child = createAflTradeModelRunContinuationIntent({
        previousIntent: root,
        checkpoint: completed,
        startedAt: at(6),
        dispatchClaimId,
        dispatchLeaseTokenSha256: 'b'.repeat(64),
        dispatchAttemptNumber: 2,
        modelTrainingEvaluationReceiptIds: root.content.modelTrainingEvaluationReceiptIds,
      });
      const finishedAt = at(7);
      return {
        execution: createAflTradeModelRunPersistenceRecoveryManifest({
          intentChain: [root, child],
          checkpoints: [...checkpoints, completed],
          completionEvidence: completion,
          runAuthorizationId,
          finishedAt,
        }),
        finishedAt,
      };
    }
    const checkpoints = [
      aflTradeModelRunCheckpointSchema.parse(staged.checkpoints[0]),
      ...staged.checkpoints
        .slice(1)
        .map((checkpoint) => aflTradeModelRunCheckpointV2Schema.parse(checkpoint)),
    ];
    const finalStarted = checkpoints[5]!;
    const completion = createAflTradeNativeFinalTestCompletionEvidenceV2({
      finalTestStartedCheckpoint: aflTradeModelRunCheckpointV2Schema.parse(finalStarted),
      evaluatedAt: at(6),
      recordedAt: at(7),
      outcome,
    });
    const completed = createAflTradeModelRunCheckpointV2({
      ...finalStarted.content,
      stage: 'final_test_completed',
      previousCheckpointId: finalStarted.checkpointId,
      recordedAt: at(8),
      evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(completion, at(7)),
    });
    const child = createAflTradeModelRunContinuationIntent({
      previousIntent: root,
      checkpoint: completed,
      startedAt: at(9),
      dispatchClaimId,
      dispatchLeaseTokenSha256: 'b'.repeat(64),
      dispatchAttemptNumber: 2,
      modelTrainingEvaluationReceiptIds: root.content.modelTrainingEvaluationReceiptIds,
    });
    const finishedAt = at(10);
    return {
      execution: createAflTradeModelRunProgressPersistenceRecoveryManifest({
        intentChain: [root, child],
        checkpoints: [...checkpoints, completed],
        completionEvidence: completion,
        runAuthorizationId,
        finishedAt,
      }),
      finishedAt,
    };
  })();
  const execution = recovered.execution;
  const executionArtifact = await retain(execution, recovered.finishedAt);
  const protocolArtifact = await retain(
    source.protocol,
    source.startedAt,
    createAflTradeCanonicalJsonArtifactRef(source.protocol, source.startedAt)
  );
  const datasetArtifact = await retain(
    source.graph.dataset,
    source.startedAt,
    createAflTradeCanonicalJsonArtifactRef(source.graph.dataset, source.startedAt)
  );
  const datasetAdmissionArtifact = await retain(
    source.admission,
    source.startedAt,
    createAflTradeCanonicalJsonArtifactRef(source.admission, source.startedAt)
  );
  const registeredAt = input.manifestVersion === 'v4' ? at(8) : at(11);
  const component = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'player_contribution_and_availability',
    nativeExecution: {
      kind: 'admitted_player_model_run',
      executionId: execution.runId,
      artifact: executionArtifact,
    },
    protocolId: execution.content.modelProtocolId,
    protocolArtifact,
    datasetId: execution.content.datasetId,
    datasetArtifact,
    datasetAdmissionId: execution.content.datasetAdmissionId,
    datasetAdmissionArtifact,
    datasetAdmissionGateLedgerRevision: source.evidence.gateLedgerRevision,
    registeredAt,
  });
  const componentArtifact = await retain(component, registeredAt);
  return {
    artifactRepository,
    component,
    execution,
    finalEvidence,
    finalEvidenceArtifact: reportReferences.validationReportArtifact,
    componentArtifact,
  };
}
