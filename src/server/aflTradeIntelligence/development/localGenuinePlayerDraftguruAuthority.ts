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

const legacyAuthorityEvidenceContentSchema = z
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

const currentAuthorityEvidenceContentSchema = legacyAuthorityEvidenceContentSchema
  .extend({
    schemaVersion: z.literal('local-genuine-draftguru-authority-evidence/v2'),
    issueNumber: z.literal(579),
    scope: legacyAuthorityEvidenceContentSchema.shape.scope.extend({
      seasons: z
        .array(z.number().int().min(1897).max(2025))
        .min(1)
        .max(129)
        .refine(
          (seasons) =>
            seasons.at(-1) === 2025 &&
            seasons.every((season, index) => index === 0 || season === seasons[index - 1]! + 1),
          'Issue 579 requires explicit contiguous unique seasons ending in 2025.'
        ),
    }),
    decisionTiming: z
      .object({
        termsEffectiveAt: z.iso.datetime({ offset: true }),
        rightsProposedAt: z.iso.datetime({ offset: true }),
        proposalProposedAt: z.iso.datetime({ offset: true }),
        decidedAt: z.iso.datetime({ offset: true }),
        effectiveAt: z.iso.datetime({ offset: true }),
        termsExpireAt: z.iso.datetime({ offset: true }),
        revalidateAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .superRefine((content, context) => {
    const timing = content.decisionTiming;
    const chronology = [
      content.recordedAt,
      timing.termsEffectiveAt,
      timing.rightsProposedAt,
      timing.proposalProposedAt,
      timing.decidedAt,
      timing.effectiveAt,
    ].map(Date.parse);
    const expiry = Date.parse(timing.termsExpireAt);
    const revalidation = Date.parse(timing.revalidateAt);
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    if (
      chronology.some((instant, index) => index > 0 && instant < chronology[index - 1]!) ||
      expiry <= chronology[5]! ||
      expiry - chronology[1]! > oneYear ||
      revalidation <= chronology[5]! ||
      revalidation > expiry ||
      revalidation - chronology[5]! > oneYear
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Draftguru authority timing must follow document recording and expire/revalidate within one year.',
      });
    }
  });

const authorityEvidenceContentSchema = z.union([
  legacyAuthorityEvidenceContentSchema,
  currentAuthorityEvidenceContentSchema,
]);

export type LocalGenuinePlayerDraftguruAuthorityEvidenceContent = z.infer<
  typeof authorityEvidenceContentSchema
>;

export interface LocalGenuinePlayerDraftguruAuthorityEvidenceArtifact {
  readonly artifact: AflTradeArtifactRef;
  readonly content: LocalGenuinePlayerDraftguruAuthorityEvidenceContent;
}

interface ParsedAuthorityEvidenceIds {
  readonly currentContent?: z.infer<typeof currentAuthorityEvidenceContentSchema>;
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
  let packageScope: string | undefined;
  let currentContent: z.infer<typeof currentAuthorityEvidenceContentSchema> | undefined;
  for (const [key, expectedKind] of EVIDENCE_KEYS) {
    const evidence = input[key];
    const content = authorityEvidenceContentSchema.parse(evidence.content);
    const scope = canonicalizeAflTradeJson({
      version: content.schemaVersion,
      scope: content.scope,
      timing: 'decisionTiming' in content ? content.decisionTiming : null,
    });
    if (packageScope !== undefined && scope !== packageScope) {
      throw new TypeError(
        'Draftguru authority documents must share the exact version, scope and decision timing.'
      );
    }
    packageScope = scope;
    if (content.schemaVersion === 'local-genuine-draftguru-authority-evidence/v2')
      currentContent = content;
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
  return {
    ...parsed,
    ...(currentContent ? { currentContent } : {}),
  } as unknown as ParsedAuthorityEvidenceIds;
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

function sourceFieldUse(sourceField: string, issue = 574) {
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
    notes: `Approved only for private non-production issue-${issue} evidence, lineage, model training, and replay; public use and redistribution remain blocked.`,
  };
}

function createAuthority(
  capabilityId: CapabilityId,
  fields: readonly string[],
  evidence: ParsedAuthorityEvidenceIds
) {
  const playerProjection = capabilityId === 'draftguru-player-trade-detail';
  const current = evidence.currentContent;
  const issue = current?.issueNumber ?? 574;
  const seasons = current?.scope.seasons ?? [2020, 2021, 2022, 2023, 2024];
  const from = seasons[0]!;
  const to = seasons.at(-1)!;
  const timing = current?.decisionTiming;
  const date = timing?.termsEffectiveAt.slice(0, 10) ?? '2026-09-03';
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: `${capabilityId}-internal-${current ? `issue-${issue}-` : ''}${date}`,
    provider: 'draftguru',
    dataset:
      capabilityId === 'draftguru-trade-index'
        ? 'Draftguru AFL trade index'
        : playerProjection
          ? 'Draftguru AFL player trade detail projection'
          : 'Draftguru AFL trade detail',
    datasetVersion: `live-web-${date}`,
    intendedPurpose: `Private non-production acquisition lineage for the genuine admitted player-contribution issue-${issue} run and deterministic replay.`,
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from, to }],
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
      identification: `Statly private local non-production issue-${issue} evaluation with bounded sequential requests.`,
      rateLimit: { requests: 1, perSeconds: 3, burst: 1 },
      cache: { permitted: true, maximumSeconds: 86_400 },
    },
    retention: {
      rawEvidence: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: `Retain private source bytes only for exact issue-${issue} reproducibility and audit.`,
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
        basis: `Retain private derived evidence only for issue-${issue} evaluation and rollback.`,
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
    fields: fields.map((field) => sourceFieldUse(field, issue)),
    conditions: [
      {
        conditionId: 'provider-egress-control',
        description: `Capture only the approved ${from}-${to} trade index and linked trade-detail pages with sequential provider egress.`,
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
    termsEffectiveAt: timing?.termsEffectiveAt ?? '2026-09-02T20:00:00.000Z',
    termsExpireAt: timing?.termsExpireAt ?? '2027-09-03T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions:
        'Stop collection and delete private raw and derived bytes marked for withdrawal deletion.',
      retainableAuditMaterial:
        'Retain only permitted hashes, decision history, provenance metadata, and rollback evidence.',
    },
    proposedAt: timing?.rightsProposedAt ?? '2026-09-02T20:00:01.000Z',
    proposedBy: 'statly-product-owner',
    proposalOrigin: 'human_authored' as const,
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const decisionKey = `${capabilityId}-${current ? `issue-${issue}-` : ''}non_production`;
  const scope = {
    scopeKey: decisionKey,
    description: `Private non-production Draftguru authority for the exact issue-${issue} acquisition lineage.`,
    dimensions: [
      { name: 'source_rights_artifact', values: [sourceRights.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: seasons.map(String) },
      { name: 'access_mechanism', values: ['automated_web'] },
      { name: 'geography', values: ['global'] },
      { name: 'commercial_context', values: ['internal-evaluation'] },
      { name: 'audience', values: ['internal'] },
      { name: 'operation', values: [...CAPTURE_OPERATIONS] },
    ],
    exclusions: [
      'Production activation or deployment.',
      'Public fact display, public derived output, raw redistribution, or publication.',
      `Any season outside ${from} through ${to} or any Draftguru capability outside this exact authority.`,
    ],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope,
    proposal: `Approve this exact private issue-${issue} Draftguru capture, factual archive, feature construction, model training, and replay boundary.`,
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
    proposedAt: timing?.proposalProposedAt ?? '2026-09-02T20:00:02.000Z',
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
      explanation: `The product owner approved the exact bounded private issue-${issue} use.`,
    })),
    rationale:
      'The product owner explicitly approved this bounded private non-production evidence lineage and model run.',
    limitations: [...scope.exclusions],
    decidedAt: timing?.decidedAt ?? '2026-09-02T20:00:03.000Z',
    effectiveAt: timing?.effectiveAt ?? '2026-09-02T20:00:03.000Z',
    revalidateAt: timing?.revalidateAt ?? '2027-09-02T00:00:00.000Z',
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
  const range = authority.sourceRights.content.scope.seasonRanges[0]!;
  if (!Number.isSafeInteger(season) || season < range.from || season > range.to) {
    throw new TypeError(
      `The local Draftguru authority is limited to seasons ${range.from} through ${range.to}.`
    );
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
  if (
    input.discoveryFromSeason !== undefined &&
    (!Number.isSafeInteger(input.discoveryFromSeason) ||
      input.discoveryFromSeason < authority.sourceRights.content.scope.seasonRanges[0]!.from ||
      input.discoveryFromSeason > input.season)
  ) {
    throw new TypeError(
      'Draftguru discovery range must remain entirely inside the authorized seasons.'
    );
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
