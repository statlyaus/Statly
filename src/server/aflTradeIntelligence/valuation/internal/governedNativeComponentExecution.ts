import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
} from '../../artifacts/artifactReference';
import { aflTradeModelRunManifestV3Schema } from '../../artifacts/modelRunManifest';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import { governedAflTradePickPavModelExecutionSchema } from '../../modeling/governedPickPavModelExecution';
import type { GovernedValuationComponentRunManifest } from './governedValuationComponentRunManifest';

export class GovernedNativeComponentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GovernedNativeComponentExecutionError';
  }
}

async function loadNativeDocument(input: {
  readonly manifest: GovernedValuationComponentRunManifest;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}): Promise<unknown> {
  const reference = input.manifest.content.nativeExecution.artifact;
  const loaded = await input.artifactRepository.loadExact(
    reference,
    input.maximumArtifactBytes
  );
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

export async function authenticateGovernedNativeComponentExecution(input: {
  readonly manifest: GovernedValuationComponentRunManifest;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}): Promise<void> {
  if (
    input.artifactRepository.artifactClass !== 'derived_private' ||
    !Number.isSafeInteger(input.maximumArtifactBytes) ||
    input.maximumArtifactBytes <= 0
  ) {
    throw new TypeError('Native component authentication requires bounded private custody.');
  }
  const content = input.manifest.content;
  const document = await loadNativeDocument(input);
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
    return;
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
}
