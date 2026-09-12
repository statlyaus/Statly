import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeModelRunCheckpoint } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import { fitAflTradeAdmittedPlayerPavCandidate } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavCandidate';
import {
  evaluateAflTradeAdmittedPlayerPavPreFinal,
  prepareAflTradeAdmittedPlayerPavValidationPlan,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavPreFinalEvaluation';
import type { nativePavModelRunSqlFixture } from './nativePavModelRunSqlFixture';

/** Synthetic checkpoint documents exercise numerical evidence, not committed execution authority. */
export function nativePavFinalEvidenceFixture(
  fixture: Awaited<ReturnType<typeof nativePavModelRunSqlFixture>>
) {
  const fitInput = {
    intent: fixture.intent,
    protocol: fixture.protocol,
    observationSet: fixture.observationSet,
    datasetCandidate: fixture.graph.dataset,
    pavObservationSet: fixture.evidence.pavObservationSet,
    hpnMethod: fixture.evidence.hpnMethod,
    configurationBytes: fixture.configurationBytes,
  };
  const candidate = fitAflTradeAdmittedPlayerPavCandidate(fitInput);
  const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(candidate, fixture.startedAt);
  const calibrationConfigurationArtifact =
    fixture.protocol.content.validationPlan.intervalCalibrationArtifact;
  const calibrationConfigurationBytes = fixture.evidence.executableArtifacts.find(
    (item) => item.artifactId === calibrationConfigurationArtifact.artifactId
  )!.bytes;
  const preFinalInput = {
    fitInput,
    candidate,
    candidateArtifact,
    calibrationConfigurationArtifact,
    calibrationConfigurationBytes,
  };
  const preFinalEvidence = evaluateAflTradeAdmittedPlayerPavPreFinal(preFinalInput);
  const preFinalArtifact = createAflTradeCanonicalJsonArtifactRef(
    preFinalEvidence,
    fixture.startedAt
  );
  const definitionArtifacts = [
    ...fixture.protocol.content.validationPlan.baselineDefinitionArtifacts,
    ...fixture.protocol.content.validationPlan.sensitivityAnalysisArtifacts,
  ].map((reference) => ({
    reference,
    bytes: fixture.evidence.executableArtifacts.find(
      (item) => item.artifactId === reference.artifactId
    )!.bytes,
  }));
  const validationPlanEvidence = prepareAflTradeAdmittedPlayerPavValidationPlan({
    preFinalInput,
    preFinalEvidence,
    definitionArtifacts,
  });
  const validationPlanArtifact = createAflTradeCanonicalJsonArtifactRef(
    validationPlanEvidence,
    fixture.startedAt
  );
  const custody = {
    schemaVersion: 'afl-trade-native-pav-candidate-custody/v3',
    authorityBoundary: 'pre_final_numerical_evidence_no_final_test_or_qualification',
    rootIntentId: fixture.intent.intentId,
    fitIntentId: fixture.intent.intentId,
    candidateId: candidate.candidateId,
    candidateArtifact,
    preFinalArtifact,
    validationPlanArtifact,
  };
  const operation = fixture.operationalAuthorization.content;
  if (!('dispatchRequestId' in operation))
    throw new Error('Synthetic final evaluation fixture requires private dispatch authority.');
  const candidateLockedCheckpoint = createAflTradeModelRunCheckpoint({
    intentId: fixture.intent.intentId,
    rootIntentId: fixture.intent.intentId,
    authorizationId: fixture.authorization.authorizationId,
    dispatchRequestId: operation.dispatchRequestId,
    substantiveOperationId: operation.substantiveOperationId,
    dispatchClaimId: operation.dispatchClaimId,
    dispatchAttemptNumber: operation.dispatchAttemptNumber,
    stage: 'candidate_locked',
    previousCheckpointId: createAflTradeContentAddress('model-run-checkpoint', {
      synthetic: 'prior started checkpoint',
    }),
    recordedAt: fixture.startedAt,
    candidateArtifact,
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(custody, fixture.startedAt),
  });
  const finalTestStartedCheckpoint = createAflTradeModelRunCheckpoint({
    ...candidateLockedCheckpoint.content,
    stage: 'final_test_started',
    previousCheckpointId: candidateLockedCheckpoint.checkpointId,
  });
  return {
    ...preFinalInput,
    preFinalEvidence,
    validationPlanEvidence,
    validationPlanArtifact,
    preFinalArtifact,
    candidateLockedCheckpoint,
    finalTestStartedCheckpoint,
    candidateCustodyBytes: new TextEncoder().encode(canonicalizeAflTradeJson(custody)),
  };
}
