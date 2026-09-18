import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import {
  aflTradeModelRunManifestV4Schema,
  aflTradeModelRunManifestV5Schema,
  aflTradeModelRunManifestV3Schema,
  type AflTradeModelRunManifestV3,
  type AflTradeModelRunManifestV4,
  type AflTradeModelRunManifestV5,
} from '../../artifacts/modelRunManifest';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import { aflTradeAdmittedPlayerPavCandidateSchema } from '../../modeling/admittedPlayerPavCandidate';
import { aflTradeNativePavPreFinalEvidenceSchema } from '../../modeling/admittedPlayerPavPreFinalContracts';
import { aflTradeNativePavFinalEvidenceSchema } from '../../modeling/admittedPlayerPavReports';
import { aflTradeNativePavValidationPlanEvidenceSchema } from '../../modeling/admittedPlayerPavValidationPlanContracts';
import {
  governedAflTradePickPavModelExecutionSchema,
  type GovernedAflTradePickPavModelExecution,
} from '../../modeling/governedPickPavModelExecution';
import {
  aflTradePickPavValidationReportSchema,
  type AflTradePickPavValidationReport,
} from '../../modeling/pickPavDistributionValidation';
import {
  aflTradePlayerValidationReportSchema,
  type AflTradePlayerValidationReport,
} from '../../modeling/playerContributionValidation';
import type { GovernedValuationComponentRunManifest } from './governedValuationComponentRunManifest';

export class GovernedNativeComponentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GovernedNativeComponentExecutionError';
  }
}

async function loadExactJsonDocument(input: {
  readonly reference: AflTradeArtifactRef;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}): Promise<unknown> {
  const reference = input.reference;
  const loaded = await input.artifactRepository.loadExact(reference, input.maximumArtifactBytes);
  if (
    loaded === null ||
    !doAflTradeArtifactRefsExactlyMatch(loaded.reference, reference) ||
    !doesAflTradeArtifactRefMatchBytes(loaded.reference, loaded.bytes)
  ) {
    throw new GovernedNativeComponentExecutionError(
      'Governed native execution artifact bytes failed exact authentication.'
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(loaded.bytes));
  } catch {
    throw new GovernedNativeComponentExecutionError(
      'Governed native execution artifact is not canonical JSON.'
    );
  }
}

export type GovernedNativeComponentValidationReport =
  | Readonly<{
      kind: 'player_contribution_and_availability';
      execution: AflTradeModelRunManifestV3;
      validationReport: AflTradePlayerValidationReport;
      validationReportArtifact: AflTradeArtifactRef;
    }>
  | Readonly<{
      kind: 'player_pav_final_evidence';
      execution: AflTradeModelRunManifestV4 | AflTradeModelRunManifestV5;
      finalEvidence: ReturnType<typeof aflTradeNativePavFinalEvidenceSchema.parse>;
      finalEvidenceArtifact: AflTradeArtifactRef;
      qualificationState: 'not_evaluated';
    }>
  | Readonly<{
      kind: 'draft_pick_and_future_pick_distribution';
      execution: GovernedAflTradePickPavModelExecution;
      validationReport: AflTradePickPavValidationReport;
    }>;

function exactlyEqual(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

async function loadRetainedPlayerPavFinalEvidence(input: {
  readonly execution: AflTradeModelRunManifestV4 | AflTradeModelRunManifestV5;
  readonly manifest: GovernedValuationComponentRunManifest;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}): Promise<
  Extract<GovernedNativeComponentValidationReport, { kind: 'player_pav_final_evidence' }>
> {
  const { execution } = input;
  const component = input.manifest.content;
  if (
    execution.runId !== component.nativeExecution.executionId ||
    execution.content.environment !== 'non_production' ||
    execution.content.outcome.status !== 'succeeded' ||
    execution.content.datasetId !== component.datasetId ||
    execution.content.datasetAdmissionId !== component.datasetAdmissionId ||
    execution.content.modelProtocolId !== component.protocolId
  ) {
    throw new GovernedNativeComponentExecutionError(
      'Governed native player-PAV recovery ancestry is invalid or unsuccessful.'
    );
  }

  const rootIntent = execution.content.recovery.intentChain[0]!;
  const candidateLocked = execution.content.recovery.checkpoints.find(
    (checkpoint) => checkpoint.content.stage === 'candidate_locked'
  );
  const finalTestStarted = execution.content.recovery.checkpoints.find(
    (checkpoint) => checkpoint.content.stage === 'final_test_started'
  );
  const finalTestCompleted = execution.content.recovery.checkpoints.find(
    (checkpoint) => checkpoint.content.stage === 'final_test_completed'
  );
  const completion = execution.content.recovery.completionEvidence;
  const finalEvidenceArtifact = execution.content.outcome.validationReportArtifact;
  if (
    !candidateLocked ||
    !finalTestStarted ||
    !finalTestCompleted ||
    !candidateLocked.content.evidenceArtifact ||
    !finalTestStarted.content.evidenceArtifact ||
    !finalTestCompleted.content.evidenceArtifact ||
    !doAflTradeArtifactRefsExactlyMatch(
      candidateLocked.content.evidenceArtifact,
      finalTestStarted.content.evidenceArtifact
    )
  ) {
    throw new GovernedNativeComponentExecutionError(
      'Governed native player-PAV recovery omits required retained checkpoints.'
    );
  }

  const finalDocument = await loadExactJsonDocument({
    reference: finalEvidenceArtifact,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  const finalEvidence = aflTradeNativePavFinalEvidenceSchema.safeParse(finalDocument);
  if (!finalEvidence.success) {
    throw new GovernedNativeComponentExecutionError(
      'Governed native player-PAV final evidence is invalid.'
    );
  }
  const final = finalEvidence.data.content;
  const completionDocument = await loadExactJsonDocument({
    reference: finalTestCompleted.content.evidenceArtifact,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  if (
    !exactlyEqual(completionDocument, completion) ||
    final.intentId !== rootIntent.intentId ||
    final.protocolId !== execution.content.modelProtocolId ||
    final.datasetId !== execution.content.datasetId ||
    final.datasetAdmissionId !== execution.content.datasetAdmissionId ||
    final.observationSetId !== execution.content.observationSetId ||
    final.candidateLockedCheckpointId !== candidateLocked.checkpointId ||
    final.finalTestStartedCheckpointId !== finalTestStarted.checkpointId ||
    !doAflTradeArtifactRefsExactlyMatch(
      final.candidateArtifact,
      execution.content.outcome.modelArtifact
    ) ||
    !candidateLocked.content.candidateArtifact ||
    !finalTestStarted.content.candidateArtifact ||
    !doAflTradeArtifactRefsExactlyMatch(
      final.candidateArtifact,
      candidateLocked.content.candidateArtifact
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      final.candidateArtifact,
      finalTestStarted.content.candidateArtifact
    ) ||
    !execution.content.outcome.selectionValidationReportArtifact ||
    !doAflTradeArtifactRefsExactlyMatch(
      execution.content.outcome.selectionValidationReportArtifact,
      final.preFinalArtifact
    ) ||
    Date.parse(finalEvidenceArtifact.createdAt) < Date.parse(completion.evaluatedAt) ||
    Date.parse(finalEvidenceArtifact.createdAt) > Date.parse(completion.recordedAt)
  ) {
    throw new GovernedNativeComponentExecutionError(
      'Governed native player-PAV final evidence ancestry or chronology is invalid.'
    );
  }

  const [candidateDocument, preFinalDocument, validationPlanDocument, custodyDocument] =
    await Promise.all([
      loadExactJsonDocument({
        reference: final.candidateArtifact,
        artifactRepository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
      }),
      loadExactJsonDocument({
        reference: final.preFinalArtifact,
        artifactRepository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
      }),
      loadExactJsonDocument({
        reference: final.validationPlanArtifact,
        artifactRepository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
      }),
      loadExactJsonDocument({
        reference: candidateLocked.content.evidenceArtifact,
        artifactRepository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
      }),
    ]);
  const candidate = aflTradeAdmittedPlayerPavCandidateSchema.safeParse(candidateDocument);
  const preFinal = aflTradeNativePavPreFinalEvidenceSchema.safeParse(preFinalDocument);
  const validationPlan =
    aflTradeNativePavValidationPlanEvidenceSchema.safeParse(validationPlanDocument);
  if (!candidate.success || !preFinal.success || !validationPlan.success) {
    throw new GovernedNativeComponentExecutionError(
      'Governed native player-PAV retained numerical parents are invalid.'
    );
  }

  const candidateContent = candidate.data.content;
  const preFinalContent = preFinal.data.content;
  const planContent = validationPlan.data.content;
  const commonBindings = {
    intentId: final.intentId,
    protocolId: final.protocolId,
    datasetId: final.datasetId,
    datasetAdmissionId: final.datasetAdmissionId,
    observationSetId: final.observationSetId,
    pavObservationSetId: final.pavObservationSetId,
    methodId: final.methodId,
  };
  const candidateMatches =
    candidate.data.candidateId === final.candidateId &&
    Object.entries(commonBindings).every(
      ([key, value]) => candidateContent[key as keyof typeof candidateContent] === value
    ) &&
    doAflTradeArtifactRefsExactlyMatch(
      candidateContent.configurationArtifact,
      rootIntent.content.configurationArtifact
    );
  const preFinalMatches =
    preFinal.data.evaluationId === final.preFinalEvaluationId &&
    Object.entries(commonBindings).every(
      ([key, value]) => preFinalContent[key as keyof typeof preFinalContent] === value
    ) &&
    preFinalContent.candidateId === final.candidateId &&
    doAflTradeArtifactRefsExactlyMatch(
      preFinalContent.candidateArtifact,
      final.candidateArtifact
    ) &&
    doAflTradeArtifactRefsExactlyMatch(
      preFinalContent.calibrationConfigurationArtifact,
      final.calibrationConfigurationArtifact
    ) &&
    preFinalContent.calibrationState.calibrationId === final.calibrationId;
  const validationPlanMatches =
    validationPlan.data.evaluationId === final.validationPlanEvaluationId &&
    Object.entries(commonBindings).every(
      ([key, value]) => planContent[key as keyof typeof planContent] === value
    ) &&
    planContent.primaryCandidateId === final.candidateId &&
    planContent.primaryPreFinalEvaluationId === final.preFinalEvaluationId &&
    doAflTradeArtifactRefsExactlyMatch(
      planContent.calibrationConfigurationArtifact,
      final.calibrationConfigurationArtifact
    );
  const baselineStates = planContent.evaluations.filter((item) => item.kind === 'baseline');
  const baselineMatches =
    baselineStates.length === final.baselineComparisons.length &&
    baselineStates.every((state, index) => {
      const comparison = final.baselineComparisons[index];
      return (
        comparison !== undefined &&
        comparison.fitId === state.fitState.fitId &&
        comparison.calibrationId === state.calibrationState.calibrationId &&
        comparison.definitionKey === state.definition.definitionKey &&
        exactlyEqual(comparison.definitionArtifact, state.definitionArtifact)
      );
    });
  const custodyMatches = exactlyEqual(custodyDocument, {
    schemaVersion: 'afl-trade-native-pav-candidate-custody/v3',
    authorityBoundary: 'pre_final_numerical_evidence_no_final_test_or_qualification',
    rootIntentId: rootIntent.intentId,
    fitIntentId: rootIntent.intentId,
    candidateId: final.candidateId,
    candidateArtifact: final.candidateArtifact,
    preFinalArtifact: final.preFinalArtifact,
    validationPlanArtifact: final.validationPlanArtifact,
  });
  const progressCheckpoints = execution.content.recovery.checkpoints.filter((checkpoint) =>
    ['candidate_fitted', 'pre_final_retained', 'validation_plan_retained'].includes(
      checkpoint.content.stage
    )
  );
  const progressCustodyMatches =
    execution.content.schemaVersion !== 'afl-trade-model-run/v5' ||
    (progressCheckpoints.length === 3 &&
      (
        await Promise.all(
          progressCheckpoints.map(async (checkpoint) => {
            const reference = checkpoint.content.evidenceArtifact;
            if (
              reference === null ||
              checkpoint.content.candidateArtifact === null ||
              !doAflTradeArtifactRefsExactlyMatch(
                checkpoint.content.candidateArtifact,
                final.candidateArtifact
              ) ||
              (checkpoint.content.stage !== 'candidate_fitted' &&
                Date.parse(final.preFinalArtifact.createdAt) >
                  Date.parse(checkpoint.content.recordedAt)) ||
              (checkpoint.content.stage === 'validation_plan_retained' &&
                Date.parse(final.validationPlanArtifact.createdAt) >
                  Date.parse(checkpoint.content.recordedAt))
            ) {
              return false;
            }
            const expected = {
              schemaVersion:
                checkpoint.content.stage === 'candidate_fitted'
                  ? 'afl-trade-native-pav-candidate-custody/v1'
                  : checkpoint.content.stage === 'pre_final_retained'
                    ? 'afl-trade-native-pav-candidate-custody/v2'
                    : 'afl-trade-native-pav-candidate-custody/v3',
              authorityBoundary:
                checkpoint.content.stage === 'candidate_fitted'
                  ? 'train_only_no_evaluation_or_qualification'
                  : 'pre_final_numerical_evidence_no_final_test_or_qualification',
              rootIntentId: rootIntent.intentId,
              fitIntentId: rootIntent.intentId,
              candidateId: final.candidateId,
              candidateArtifact: final.candidateArtifact,
              ...(checkpoint.content.stage === 'candidate_fitted'
                ? {}
                : { preFinalArtifact: final.preFinalArtifact }),
              ...(checkpoint.content.stage === 'validation_plan_retained'
                ? { validationPlanArtifact: final.validationPlanArtifact }
                : {}),
            };
            return exactlyEqual(
              await loadExactJsonDocument({
                reference,
                artifactRepository: input.artifactRepository,
                maximumArtifactBytes: input.maximumArtifactBytes,
              }),
              expected
            );
          })
        )
      ).every(Boolean));
  if (
    !candidateMatches ||
    !preFinalMatches ||
    !validationPlanMatches ||
    !baselineMatches ||
    !custodyMatches ||
    !progressCustodyMatches ||
    Date.parse(final.preFinalArtifact.createdAt) > Date.parse(candidateLocked.content.recordedAt) ||
    Date.parse(final.validationPlanArtifact.createdAt) >
      Date.parse(candidateLocked.content.recordedAt)
  ) {
    throw new GovernedNativeComponentExecutionError(
      'Governed native player-PAV final evidence differs from retained numerical ancestry.'
    );
  }

  return {
    kind: 'player_pav_final_evidence',
    execution,
    finalEvidence: finalEvidence.data,
    finalEvidenceArtifact,
    qualificationState: 'not_evaluated',
  };
}

/** Authenticates retained evidence ancestry only; it grants no execution or qualification authority. */
export async function loadGovernedNativeComponentValidationReport(input: {
  readonly manifest: GovernedValuationComponentRunManifest;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}): Promise<GovernedNativeComponentValidationReport> {
  if (
    input.artifactRepository.artifactClass !== 'derived_private' ||
    !Number.isSafeInteger(input.maximumArtifactBytes) ||
    input.maximumArtifactBytes <= 0
  ) {
    throw new TypeError('Native component authentication requires bounded private custody.');
  }
  const content = input.manifest.content;
  const document = await loadExactJsonDocument({
    reference: content.nativeExecution.artifact,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  if (content.nativeExecution.kind === 'admitted_player_model_run') {
    const parsed = aflTradeModelRunManifestV3Schema.safeParse(document);
    if (!parsed.success) {
      const recoveredV5 = aflTradeModelRunManifestV5Schema.safeParse(document);
      const recoveredV4 = recoveredV5.success
        ? null
        : aflTradeModelRunManifestV4Schema.safeParse(document);
      const recovered = recoveredV5.success
        ? recoveredV5.data
        : recoveredV4?.success
          ? recoveredV4.data
          : null;
      if (recovered === null) {
        throw new GovernedNativeComponentExecutionError(
          'Governed player native execution is not a supported retained manifest.'
        );
      }
      return loadRetainedPlayerPavFinalEvidence({
        execution: recovered,
        manifest: input.manifest,
        artifactRepository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
      });
    }
    if (
      parsed.data.runId !== content.nativeExecution.executionId ||
      parsed.data.content.environment !== 'non_production' ||
      parsed.data.content.outcome.status !== 'succeeded' ||
      parsed.data.content.datasetId !== content.datasetId ||
      parsed.data.content.datasetAdmissionId !== content.datasetAdmissionId ||
      parsed.data.content.modelProtocolId !== content.protocolId
    ) {
      throw new GovernedNativeComponentExecutionError(
        'Governed player native execution ancestry is invalid or unsuccessful.'
      );
    }
    const validationDocument = await loadExactJsonDocument({
      reference: parsed.data.content.outcome.validationReportArtifact,
      artifactRepository: input.artifactRepository,
      maximumArtifactBytes: input.maximumArtifactBytes,
    });
    const validationReport = aflTradePlayerValidationReportSchema.safeParse(validationDocument);
    const reportArtifact = parsed.data.content.outcome.validationReportArtifact;
    if (
      !validationReport.success ||
      validationReport.data.content.evaluatedPartition !== 'final_test' ||
      validationReport.data.content.observationSetId !== parsed.data.content.observationSetId ||
      validationReport.data.content.candidateModelId !== parsed.data.content.modelId ||
      parsed.data.content.finalTestEvaluatedAt === null ||
      Date.parse(reportArtifact.createdAt) < Date.parse(parsed.data.content.finalTestEvaluatedAt) ||
      Date.parse(reportArtifact.createdAt) > Date.parse(parsed.data.content.finishedAt)
    ) {
      throw new GovernedNativeComponentExecutionError(
        'Governed player native validation report ancestry or chronology is invalid.'
      );
    }
    return {
      kind: 'player_contribution_and_availability',
      execution: parsed.data,
      validationReport: validationReport.data,
      validationReportArtifact: reportArtifact,
    };
  }
  if (content.nativeExecution.kind !== 'governed_pick_pav_model_execution') {
    throw new GovernedNativeComponentExecutionError(
      'Legacy pick fixture executions are not eligible native authority.'
    );
  }
  const parsed = governedAflTradePickPavModelExecutionSchema.safeParse(document);
  if (
    !parsed.success ||
    parsed.data.executionId !== content.nativeExecution.executionId ||
    parsed.data.content.datasetId !== content.datasetId ||
    parsed.data.content.datasetAdmissionId !== content.datasetAdmissionId ||
    parsed.data.content.datasetAdmissionGateLedgerRevision !==
      content.datasetAdmissionGateLedgerRevision ||
    parsed.data.content.protocolId !== content.protocolId ||
    !doAflTradeArtifactRefsExactlyMatch(
      parsed.data.content.datasetArtifact,
      content.datasetArtifact
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      parsed.data.content.datasetAdmissionArtifact,
      content.datasetAdmissionArtifact
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      parsed.data.content.protocolArtifact,
      content.protocolArtifact
    )
  ) {
    throw new GovernedNativeComponentExecutionError(
      'Governed pick native execution ancestry is invalid.'
    );
  }
  return {
    kind: 'draft_pick_and_future_pick_distribution',
    execution: parsed.data,
    validationReport: aflTradePickPavValidationReportSchema.parse(
      parsed.data.content.validationReport
    ),
  };
}

export async function authenticateGovernedNativeComponentExecution(input: {
  readonly manifest: GovernedValuationComponentRunManifest;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}): Promise<void> {
  await loadGovernedNativeComponentValidationReport(input);
}
