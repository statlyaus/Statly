import { z } from 'zod';

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const requestSchema = z
  .object({
    corpusId: z.string().regex(/^corpus:[a-f0-9]{64}$/),
    scopeKey: z.string().trim().min(1).max(1_000),
    releaseCreatedAt: instantSchema,
    lineageCreatedAt: instantSchema,
    archiveCreatedAt: instantSchema,
  })
  .strict();

type PreparationRequest = z.infer<typeof requestSchema>;

interface ReleaseBuildReceipt {
  readonly corpusId: string;
  readonly releaseId: string;
  readonly candidateId: string;
  readonly canonicalMemberCount: number;
  readonly status: 'finalized';
  readonly idempotentReplay: boolean;
}

interface Gate2ArtifactReference {
  readonly kind: string;
  readonly artifactId: string;
}

interface Gate2StageReceipt {
  readonly lineageId: string;
  readonly decisionKey: string;
  readonly affectedArtifacts: readonly Gate2ArtifactReference[];
  readonly status: 'staged';
  readonly idempotentReplay: boolean;
}

interface ArchiveBuildReceipt {
  readonly archive: {
    readonly archiveId: string;
    readonly content: {
      readonly releaseId: string;
      readonly factualCandidateId: string;
      readonly corpusId: string;
      readonly recordCount: number;
    };
  };
  readonly projection: {
    readonly projectionId: string;
    readonly content: {
      readonly releaseId: string;
      readonly factualCandidateId: string;
      readonly publicArchiveId: string;
    };
  };
  readonly idempotentReplay: boolean;
}

export interface AflTradePromotionBackedFactualPublicationPreparationDependencies {
  readonly releaseRepository: {
    build(request: {
      readonly corpusId: string;
      readonly scopeKey: string;
      readonly createdAt: string;
    }): Promise<ReleaseBuildReceipt>;
  };
  readonly gate2Repository: {
    stage(request: {
      readonly factualCandidateId: string;
      readonly createdAt: string;
    }): Promise<Gate2StageReceipt>;
  };
  readonly archiveRepository: {
    build(request: {
      readonly releaseId: string;
      readonly createdAt: string;
    }): Promise<ArchiveBuildReceipt>;
  };
}

export interface AflTradePromotionBackedFactualPublicationPreparation {
  readonly status: 'awaiting_gate_2_review';
  readonly publicationEligible: false;
  readonly corpusId: string;
  readonly releaseId: string;
  readonly factualCandidateId: string;
  readonly lineageId: string;
  readonly publicArchiveId: string;
  readonly projectionId: string;
  readonly gate2DecisionKey: string;
  readonly gate2AffectedArtifacts: readonly Gate2ArtifactReference[];
  readonly canonicalMemberCount: number;
  readonly publicRecordCount: number;
  readonly idempotentReplay: boolean;
}

export class AflTradePromotionBackedFactualPublicationPreparationError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'NONCAUSAL_CHRONOLOGY' | 'ANCESTRY_MISMATCH',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradePromotionBackedFactualPublicationPreparationError';
  }
}

function validateChronology(request: PreparationRequest): void {
  if (
    Date.parse(request.releaseCreatedAt) > Date.parse(request.lineageCreatedAt) ||
    Date.parse(request.lineageCreatedAt) > Date.parse(request.archiveCreatedAt)
  ) {
    throw new AflTradePromotionBackedFactualPublicationPreparationError(
      'NONCAUSAL_CHRONOLOGY',
      'Promotion-backed factual publication preparation chronology is noncausal.'
    );
  }
}

function exactGate2Artifacts(
  actual: readonly Gate2ArtifactReference[],
  expected: readonly Gate2ArtifactReference[]
): boolean {
  const key = ({ artifactId, kind }: Gate2ArtifactReference) => `${kind}\0${artifactId}`;
  return (
    actual.length === expected.length &&
    [...actual]
      .map(key)
      .sort()
      .every((value, index) => value === [...expected].map(key).sort()[index])
  );
}

function requireExactAncestry(
  request: PreparationRequest,
  release: ReleaseBuildReceipt,
  stage: Gate2StageReceipt,
  archive: ArchiveBuildReceipt
): void {
  const expectedArtifacts = [
    { kind: 'corpus_manifest', artifactId: release.corpusId },
    { kind: 'factual_release', artifactId: release.releaseId },
    { kind: 'factual_release_candidate', artifactId: release.candidateId },
    { kind: 'corpus_factual_lineage', artifactId: stage.lineageId },
  ];
  if (
    release.corpusId !== request.corpusId ||
    stage.decisionKey !== `gate2:${stage.lineageId}` ||
    !exactGate2Artifacts(stage.affectedArtifacts, expectedArtifacts) ||
    archive.archive.content.releaseId !== release.releaseId ||
    archive.archive.content.factualCandidateId !== release.candidateId ||
    archive.archive.content.corpusId !== release.corpusId ||
    archive.archive.content.recordCount !== release.canonicalMemberCount ||
    archive.projection.content.releaseId !== release.releaseId ||
    archive.projection.content.factualCandidateId !== release.candidateId ||
    archive.projection.content.publicArchiveId !== archive.archive.archiveId
  ) {
    throw new AflTradePromotionBackedFactualPublicationPreparationError(
      'ANCESTRY_MISMATCH',
      'Prepared release, Gate 2 lineage, public archive, and projection do not share exact ancestry.'
    );
  }
}

export async function prepareAflTradePromotionBackedFactualPublication(
  unparsedRequest: unknown,
  dependencies: AflTradePromotionBackedFactualPublicationPreparationDependencies
): Promise<AflTradePromotionBackedFactualPublicationPreparation> {
  const parsed = requestSchema.safeParse(unparsedRequest);
  if (!parsed.success) {
    throw new AflTradePromotionBackedFactualPublicationPreparationError(
      'INVALID_INPUT',
      'Promotion-backed factual publication preparation request is invalid.',
      { cause: parsed.error }
    );
  }
  const request = parsed.data;
  validateChronology(request);
  const release = await dependencies.releaseRepository.build({
    corpusId: request.corpusId,
    scopeKey: request.scopeKey,
    createdAt: request.releaseCreatedAt,
  });
  const stage = await dependencies.gate2Repository.stage({
    factualCandidateId: release.candidateId,
    createdAt: request.lineageCreatedAt,
  });
  const archive = await dependencies.archiveRepository.build({
    releaseId: release.releaseId,
    createdAt: request.archiveCreatedAt,
  });
  requireExactAncestry(request, release, stage, archive);
  return {
    status: 'awaiting_gate_2_review',
    publicationEligible: false,
    corpusId: release.corpusId,
    releaseId: release.releaseId,
    factualCandidateId: release.candidateId,
    lineageId: stage.lineageId,
    publicArchiveId: archive.archive.archiveId,
    projectionId: archive.projection.projectionId,
    gate2DecisionKey: stage.decisionKey,
    gate2AffectedArtifacts: stage.affectedArtifacts,
    canonicalMemberCount: release.canonicalMemberCount,
    publicRecordCount: archive.archive.content.recordCount,
    idempotentReplay:
      release.idempotentReplay && stage.idempotentReplay && archive.idempotentReplay,
  };
}
