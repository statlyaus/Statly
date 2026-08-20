import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import {
  aflTradeModelRunManifestV3Schema,
  type AflTradeModelRunManifestV3,
} from '../../artifacts/modelRunManifest';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
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
      kind: 'draft_pick_and_future_pick_distribution';
      execution: GovernedAflTradePickPavModelExecution;
      validationReport: AflTradePickPavValidationReport;
    }>;

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
    if (
      !parsed.success ||
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
