import { z } from 'zod';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '../governance/gateDecisionTypes';
import type { AflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import type { AflTradeGate0ARequest } from '../source/gate0aEvaluation';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';

const CAPTURE_OPERATIONS = [
  'bounded_evaluation_capture',
  'raw_evidence_retention',
  'metadata_hash_retention',
  'internal_quality_evaluation',
  'model_training',
  'derived_feature_creation',
] as const;

const INDEX_FIELDS = [
  'trade_detail_link.anchorSeasonYear',
  'trade_detail_link.nativeEventId',
  'trade_detail_link.sourceUrl',
] as const;

const DETAIL_FIELDS = [
  'directed_transfer.asset.draftType',
  'directed_transfer.asset.draftYear',
  'directed_transfer.asset.kind',
  'directed_transfer.asset.originalClub.recordedName',
  'directed_transfer.asset.player.nativeId',
  'directed_transfer.asset.player.recordedName',
  'directed_transfer.asset.recordedPickNumber',
  'directed_transfer.asset.roundNumber',
  'directed_transfer.fromClub.recordedName',
  'directed_transfer.nativeEventId',
  'directed_transfer.nativeTransferId',
  'directed_transfer.toClub.recordedName',
  'transaction.nativeEventId',
  'transaction.seasonYear',
  'transaction.title',
  'transaction.transactionType',
  'transaction_party.club.recordedName',
  'transaction_party.nativeEventId',
  'transaction_party.nativePartyId',
] as const;

const PLAYER_DETAIL_FIELDS = [
  'directed_transfer.asset.kind',
  'directed_transfer.asset.player.nativeId',
  'directed_transfer.asset.player.recordedName',
  'directed_transfer.fromClub.recordedName',
  'directed_transfer.nativeEventId',
  'directed_transfer.nativeTransferId',
  'directed_transfer.toClub.recordedName',
  'transaction.nativeEventId',
  'transaction.seasonYear',
  'transaction.title',
  'transaction.transactionType',
  'transaction_party.club.recordedName',
  'transaction_party.nativeEventId',
  'transaction_party.nativePartyId',
] as const;

type CapabilityId =
  'draftguru-trade-index' | 'draftguru-trade-detail' | 'draftguru-player-trade-detail';

export interface LocalGenuinePlayerDraftguruAuthorityEvidence {
  readonly productOwnerAuthorization: LocalGenuinePlayerDraftguruAuthorityEvidenceArtifact;
  readonly boundedCapturePlan: LocalGenuinePlayerDraftguruAuthorityEvidenceArtifact;
  readonly publicAccessReview: LocalGenuinePlayerDraftguruAuthorityEvidenceArtifact;
  readonly fieldBoundaryReview: LocalGenuinePlayerDraftguruAuthorityEvidenceArtifact;
}

const evidenceKindSchema = z.enum([
  'product_owner_authorization',
  'bounded_capture_plan',
  'public_access_review',
  'field_boundary_review',
]);

const authorityEvidenceContentSchema = z
  .object({
    schemaVersion: z.literal('local-genuine-draftguru-authority-evidence/v1'),
    issueNumber: z.literal(574),
    provider: z.literal('draftguru'),
    environment: z.literal('non_production'),
    evidenceKind: evidenceKindSchema,
    decision: z.literal('approved'),
    scope: z
      .object({
        competition: z.literal('AFLM'),
        seasons: z.tuple([
          z.literal(2020),
          z.literal(2021),
          z.literal(2022),
          z.literal(2023),
          z.literal(2024),
        ]),
        capabilities: z.tuple([
          z.literal('draftguru-trade-index'),
          z.literal('draftguru-trade-detail'),
          z.literal('draftguru-player-trade-detail'),
        ]),
        use: z.literal('private_non_production_evaluation_training_and_replay'),
        publicUse: z.literal('blocked'),
      })
      .strict(),
    statement: z.string().trim().min(1).max(2_000),
    recordedBy: z.literal('statly-product-owner'),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type LocalGenuinePlayerDraftguruAuthorityEvidenceContent = z.infer<
  typeof authorityEvidenceContentSchema
>;

export interface LocalGenuinePlayerDraftguruAuthorityEvidenceArtifact {
  readonly artifact: AflTradeArtifactRef;
  readonly content: LocalGenuinePlayerDraftguruAuthorityEvidenceContent;
}

interface ParsedAuthorityEvidenceIds {
  readonly productOwnerAuthorizationArtifactId: string;
  readonly boundedCapturePlanArtifactId: string;
  readonly publicAccessReviewArtifactId: string;
  readonly fieldBoundaryReviewArtifactId: string;
}

export const LOCAL_GENUINE_PLAYER_DRAFTGURU_PARSER_VERSION =
  'local-genuine-draftguru-html/v1' as const;
export const LOCAL_GENUINE_PLAYER_DRAFTGURU_PLAYER_PARSER_VERSION =
  'local-genuine-draftguru-player-trade-html/v1' as const;

const EVIDENCE_KEYS = [
  ['productOwnerAuthorization', 'product_owner_authorization'],
  ['boundedCapturePlan', 'bounded_capture_plan'],
  ['publicAccessReview', 'public_access_review'],
  ['fieldBoundaryReview', 'field_boundary_review'],
] as const;

function parseEvidence(
  input: LocalGenuinePlayerDraftguruAuthorityEvidence
): ParsedAuthorityEvidenceIds {
  const identifiers = new Set<string>();
  const parsed = {} as Record<string, string>;
  for (const [key, expectedKind] of EVIDENCE_KEYS) {
    const evidence = input[key];
    const content = authorityEvidenceContentSchema.parse(evidence.content);
    const artifact = aflTradeArtifactRefSchema.parse(evidence.artifact);
    const expectedArtifact = createAflTradeCanonicalJsonArtifactRef(content, content.recordedAt);
    if (
      content.evidenceKind !== expectedKind ||
      artifact.mediaType !== AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE ||
      !doAflTradeArtifactRefsExactlyMatch(artifact, expectedArtifact) ||
      identifiers.has(artifact.artifactId)
    ) {
      throw new TypeError(
        `Draftguru ${key} must bind one distinct canonical retained authority document.`
      );
    }
    identifiers.add(artifact.artifactId);
    parsed[`${key}ArtifactId`] = artifact.artifactId;
  }
  return parsed as unknown as ParsedAuthorityEvidenceIds;
}

export function createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact(
  content: LocalGenuinePlayerDraftguruAuthorityEvidenceContent
): LocalGenuinePlayerDraftguruAuthorityEvidenceArtifact {
  const parsed = authorityEvidenceContentSchema.parse(content);
  return {
    artifact: createAflTradeCanonicalJsonArtifactRef(parsed, parsed.recordedAt),
    content: parsed,
  };
}

async function authenticateEvidence(
  repository: Pick<
    AflTradeImmutableArtifactRepository,
    'assurance' | 'artifactClass' | 'custodyProfile' | 'loadExact'
  >,
  input: LocalGenuinePlayerDraftguruAuthorityEvidence
): Promise<ParsedAuthorityEvidenceIds> {
  if (
    repository.artifactClass !== 'capture_metadata' ||
    (repository.assurance !== 'fixture_memory' &&
      repository.assurance !== 'fixture_filesystem' &&
      repository.assurance !== 'local_non_production_filesystem')
  ) {
    throw new TypeError('Draftguru authority evidence requires private capture-metadata custody.');
  }
  const parsed = parseEvidence(input);
  for (const [key] of EVIDENCE_KEYS) {
    const evidence = input[key];
    const loaded = await repository.loadExact(evidence.artifact, 64 * 1024);
    const expectedBytes = new TextEncoder().encode(canonicalizeAflTradeJson(evidence.content));
    if (
      loaded === null ||
      !doAflTradeArtifactRefsExactlyMatch(evidence.artifact, loaded.reference) ||
      !doesAflTradeArtifactRefMatchBytes(
        loaded.reference,
        loaded.bytes,
        AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE
      ) ||
      new TextDecoder().decode(loaded.bytes) !== new TextDecoder().decode(expectedBytes)
    ) {
      throw new TypeError(
        `Draftguru ${key} authority bytes are missing or differ from the reviewed document.`
      );
    }
  }
  return parsed;
}

function sourceFieldUse(sourceField: string) {
  return {
    sourceField,
    normalizedField: sourceField,
    uses: {
      archive_fact: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature: 'allowed' as const,
      public_display: 'blocked' as const,
    },
    attributionRequired: true,
    notes:
      'Approved only for private non-production issue-574 evidence, lineage, model training, and replay; public use and redistribution remain blocked.',
  };
}

function createAuthority(
  capabilityId: CapabilityId,
  fields: readonly string[],
  evidence: ParsedAuthorityEvidenceIds
) {
  const playerProjection = capabilityId === 'draftguru-player-trade-detail';
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: `${capabilityId}-internal-2026-09-03`,
    provider: 'draftguru',
    dataset:
      capabilityId === 'draftguru-trade-index'
        ? 'Draftguru AFL trade index'
        : playerProjection
          ? 'Draftguru AFL player trade detail projection'
          : 'Draftguru AFL trade detail',
    datasetVersion: 'live-web-2026-09-03',
    intendedPurpose:
      'Private non-production acquisition lineage for the genuine admitted player-contribution issue-574 run and deterministic replay.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2020, to: 2024 }],
      accessMechanism: 'automated_web' as const,
    },
    acquisition: {
      kind: 'provider_web' as const,
      clientName: 'Statly governed Draftguru HTML client',
      clientVersion: playerProjection
        ? LOCAL_GENUINE_PLAYER_DRAFTGURU_PLAYER_PARSER_VERSION
        : LOCAL_GENUINE_PLAYER_DRAFTGURU_PARSER_VERSION,
      capabilityId,
    },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature_creation: 'allowed' as const,
      public_derived_output: 'blocked' as const,
      public_fact_display: 'blocked' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: true,
      identification:
        'Statly private local non-production issue-574 evaluation with bounded sequential requests.',
      rateLimit: { requests: 1, perSeconds: 3, burst: 1 },
      cache: { permitted: true, maximumSeconds: 86_400 },
    },
    retention: {
      rawEvidence: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Retain private source bytes only for exact issue-574 reproducibility and audit.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Retain immutable hashes and governance metadata for permanent audit.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Retain private derived evidence only for issue-574 evaluation and rollback.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
    attribution: {
      required: true,
      text: 'Draft transaction evidence sourced from Draftguru.',
      placement: 'Private internal methodology and evidence review only.',
    },
    restrictions: {
      geographic: [] as string[],
      commercial: ['internal-evaluation'],
      audience: ['internal'],
    },
    fields: fields.map(sourceFieldUse),
    conditions: [
      {
        conditionId: 'provider-egress-control',
        description:
          'Capture only the approved 2020-2024 trade index and linked trade-detail pages with sequential provider egress.',
        appliesToOperations: ['bounded_evaluation_capture' as const],
        verificationEvidenceIds: [evidence.boundedCapturePlanArtifactId],
      },
      {
        conditionId: 'private-nonproduction-use',
        description:
          'Keep source facts, derived features, trained models, and run evidence private and non-production.',
        appliesToOperations: [
          'raw_evidence_retention' as const,
          'internal_quality_evaluation' as const,
          'model_training' as const,
          'derived_feature_creation' as const,
        ],
        verificationEvidenceIds: [evidence.productOwnerAuthorizationArtifactId],
      },
    ],
    rightsEvidenceIds: [
      evidence.productOwnerAuthorizationArtifactId,
      evidence.publicAccessReviewArtifactId,
      evidence.fieldBoundaryReviewArtifactId,
    ],
    termsEffectiveAt: '2026-09-02T20:00:00.000Z',
    termsExpireAt: '2027-09-03T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions:
        'Stop collection and delete private raw and derived bytes marked for withdrawal deletion.',
      retainableAuditMaterial:
        'Retain only permitted hashes, decision history, provenance metadata, and rollback evidence.',
    },
    proposedAt: '2026-09-02T20:00:01.000Z',
    proposedBy: 'statly-product-owner',
    proposalOrigin: 'human_authored' as const,
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const decisionKey = `${capabilityId}-non_production`;
  const scope = {
    scopeKey: decisionKey,
    description:
      'Private non-production Draftguru authority for the exact issue-574 acquisition lineage.',
    dimensions: [
      { name: 'source_rights_artifact', values: [sourceRights.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: ['2020', '2021', '2022', '2023', '2024'] },
      { name: 'access_mechanism', values: ['automated_web'] },
      { name: 'geography', values: ['global'] },
      { name: 'commercial_context', values: ['internal-evaluation'] },
      { name: 'audience', values: ['internal'] },
      { name: 'operation', values: [...CAPTURE_OPERATIONS] },
    ],
    exclusions: [
      'Production activation or deployment.',
      'Public fact display, public derived output, raw redistribution, or publication.',
      'Any season outside 2020 through 2024 or any Draftguru capability outside this exact authority.',
    ],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope,
    proposal:
      'Approve this exact private issue-574 Draftguru capture, factual archive, feature construction, model training, and replay boundary.',
    alternativesConsidered: [
      'Leave genuine draft-transaction acquisition lineage unmaterialized and keep the run blocked.',
    ],
    accountableOwner: 'statly-product-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [] as string[],
    conditions: rightsContent.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      description: condition.description,
      required: true,
      verificationEvidenceIds: condition.verificationEvidenceIds,
    })),
    evidenceIds: rightsContent.rightsEvidenceIds,
    affectedArtifacts: [
      { kind: 'source_rights' as const, artifactId: sourceRights.rightsArtifactId },
    ],
    proposedAt: '2026-09-02T20:00:02.000Z',
    proposedBy: 'statly-product-owner',
    proposalOrigin: 'human_authored' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: 'statly-product-owner',
    decidedBy: 'statly-product-owner',
    reviewers: [] as never[],
    authorityEvidenceIds: [evidence.productOwnerAuthorizationArtifactId],
    conditionResults: rightsContent.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      status: 'satisfied' as const,
      evidenceIds: condition.verificationEvidenceIds,
      explanation: 'The product owner approved the exact bounded private issue-574 use.',
    })),
    rationale:
      'The product owner explicitly approved this bounded private non-production evidence lineage and model run.',
    limitations: [...scope.exclusions],
    decidedAt: '2026-09-02T20:00:03.000Z',
    effectiveAt: '2026-09-02T20:00:03.000Z',
    revalidateAt: '2027-09-02T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: proposalContent.affectedArtifacts,
    withdrawalActions: [] as string[],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { capabilityId, sourceRights, proposal, decision };
}

function createLocalGenuinePlayerDraftguruAuthorities(evidence: ParsedAuthorityEvidenceIds) {
  return [
    createAuthority('draftguru-trade-index', INDEX_FIELDS, evidence),
    createAuthority('draftguru-trade-detail', DETAIL_FIELDS, evidence),
    createAuthority('draftguru-player-trade-detail', PLAYER_DETAIL_FIELDS, evidence),
  ] as const;
}

export type LocalGenuinePlayerDraftguruAuthority = ReturnType<
  typeof createLocalGenuinePlayerDraftguruAuthorities
>[number];

export async function loadExactLocalGenuinePlayerDraftguruAuthorities(
  artifactRepository: Pick<
    AflTradeImmutableArtifactRepository,
    'assurance' | 'artifactClass' | 'custodyProfile' | 'loadExact'
  >,
  evidence: LocalGenuinePlayerDraftguruAuthorityEvidence
) {
  return createLocalGenuinePlayerDraftguruAuthorities(
    await authenticateEvidence(artifactRepository, evidence)
  );
}

export function createLocalGenuinePlayerDraftguruGateRequest(
  authority: LocalGenuinePlayerDraftguruAuthority,
  season: number,
  input: Readonly<{ evaluatedAt: string }>
): AflTradeGate0ARequest {
  if (!Number.isSafeInteger(season) || season < 2020 || season > 2024) {
    throw new TypeError('The local Draftguru authority is limited to seasons 2020 through 2024.');
  }
  return {
    decisionKey: authority.proposal.content.decisionKey,
    environment: 'non_production',
    rightsArtifactId: authority.sourceRights.rightsArtifactId,
    evaluatedAt: input.evaluatedAt,
    competition: 'AFLM',
    season,
    accessMechanism: 'automated_web',
    capabilityId: null,
    geography: 'global',
    commercialContext: 'internal-evaluation',
    audience: 'internal',
    operations: [...CAPTURE_OPERATIONS],
    fieldUses: authority.sourceRights.content.fields.flatMap(({ sourceField }) => [
      { sourceField, use: 'archive_fact' as const },
      { sourceField, use: 'derived_feature' as const },
      { sourceField, use: 'model_training' as const },
    ]),
    rawRetentionDays: 365,
    metadataRetentionDays: null,
    cacheSeconds: 86_400,
  };
}

export function createLocalGenuinePlayerDraftguruCaptureCommand(
  authority: LocalGenuinePlayerDraftguruAuthority,
  input: Readonly<{
    season: number;
    discoveryFromSeason?: number;
    sourceUrl: string;
    capturedAt: string;
    effectiveAt: string;
    maximumBytes: number;
  }>
): AflTradeExternalProviderIngestionCommand {
  const gateRequest = createLocalGenuinePlayerDraftguruGateRequest(authority, input.season, {
    evaluatedAt: input.capturedAt,
  });
  if (
    (authority.capabilityId === 'draftguru-trade-index' &&
      input.discoveryFromSeason === undefined) ||
    (authority.capabilityId !== 'draftguru-trade-index' && input.discoveryFromSeason !== undefined)
  ) {
    throw new TypeError('Draftguru discovery range must be supplied only for the trade index.');
  }
  return {
    gateRequest,
    request: {
      environment: 'non_production',
      provider: 'draftguru',
      competition: 'AFLM',
      anchorSeasonYear: input.season,
      ...(input.discoveryFromSeason === undefined
        ? {}
        : { discoveryFromSeasonYear: input.discoveryFromSeason }),
      draftPathway: null,
      dataset: authority.sourceRights.content.dataset,
      datasetVersion: authority.sourceRights.content.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId: authority.capabilityId,
      sourceUrl: input.sourceUrl,
      capturedAt: input.capturedAt,
      effectiveAt: input.effectiveAt,
      parserVersion:
        authority.capabilityId === 'draftguru-player-trade-detail'
          ? LOCAL_GENUINE_PLAYER_DRAFTGURU_PLAYER_PARSER_VERSION
          : LOCAL_GENUINE_PLAYER_DRAFTGURU_PARSER_VERSION,
      fieldManifestSha256: sha256AflTradeCanonicalJson(authority.sourceRights.content.fields),
      maximumBytes: input.maximumBytes,
    },
  };
}

export async function recordLocalGenuinePlayerDraftguruAuthorities(
  repository: Pick<AflTradeGateDecisionLedgerRepository, 'load' | 'appendBatch'>,
  artifactRepository: Pick<
    AflTradeImmutableArtifactRepository,
    'assurance' | 'artifactClass' | 'custodyProfile' | 'loadExact'
  >,
  evidence: LocalGenuinePlayerDraftguruAuthorityEvidence
) {
  const authorities = await loadExactLocalGenuinePlayerDraftguruAuthorities(
    artifactRepository,
    evidence
  );
  const stored = await repository.load();
  return repository.appendBatch({
    expectedRevision: stored.revision,
    records: authorities.map(({ sourceRights, proposal, decision }) => ({
      sourceRights,
      proposal,
      decision,
    })),
  });
}
