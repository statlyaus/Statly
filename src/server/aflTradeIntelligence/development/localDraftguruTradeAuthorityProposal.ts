import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import { aflTradeGateDecisionProposalSchema } from '../governance/gateDecisionTypes';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from '../source/sourceContracts';

/**
 * Operations the owner's acquisition decision permits, and the operations it excludes. Draftguru trade
 * evidence establishes acquisition lineage only, so model training and derived-feature creation are
 * recorded as blocked here even though the broader internal factories allow them.
 */
export const DRAFTGURU_TRADE_PERMITTED_OPERATIONS = [
  'bounded_evaluation_capture',
  'raw_evidence_retention',
  'metadata_hash_retention',
  'internal_quality_evaluation',
] as const;

/** Exact candidate fields from the field-boundary review, which is the only field authority here. */
export const DRAFTGURU_TRADE_INDEX_FIELDS = [
  'trade_detail_link.anchorSeasonYear',
  'trade_detail_link.nativeEventId',
  'trade_detail_link.sourceUrl',
] as const;

export const DRAFTGURU_TRADE_DETAIL_FIELDS = [
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

export type DraftguruTradeCapability = 'draftguru-trade-index' | 'draftguru-trade-detail';

export interface DraftguruTradeAuthorityProposalInput {
  readonly capabilityId: DraftguruTradeCapability;
  readonly seasons: readonly number[];
  readonly evidenceIds: Readonly<{
    productOwnerAuthorization: string;
    boundedCapturePlan: string;
    publicAccessReview: string;
    fieldBoundaryReview: string;
  }>;
  readonly timing: Readonly<{
    termsEffectiveAt: string;
    termsExpireAt: string;
    rightsProposedAt: string;
    proposalProposedAt: string;
  }>;
}

function contiguousSeasons(seasons: readonly number[]): { from: number; to: number } {
  if (seasons.length === 0) throw new TypeError('A trade authority requires at least one season.');
  const ordered = [...seasons].sort((left, right) => left - right);
  if (ordered.some((season, index) => index > 0 && season !== ordered[index - 1]! + 1)) {
    throw new TypeError('Trade authority seasons must be contiguous.');
  }
  return { from: ordered[0]!, to: ordered.at(-1)! };
}

/** The decision is the owner's to record; this builder deliberately produces proposals only. */
export function createDraftguruTradeAuthorityProposal(
  input: DraftguruTradeAuthorityProposalInput
): Readonly<{
  sourceRights: AflTradeSourceRightsProposal;
  proposal: ReturnType<typeof aflTradeGateDecisionProposalSchema.parse>;
}> {
  const { from, to } = contiguousSeasons(input.seasons);
  const seasons = Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
  const fields =
    input.capabilityId === 'draftguru-trade-index'
      ? DRAFTGURU_TRADE_INDEX_FIELDS
      : DRAFTGURU_TRADE_DETAIL_FIELDS;
  const dataset =
    input.capabilityId === 'draftguru-trade-index'
      ? 'Draftguru AFL trade index'
      : 'Draftguru AFL trade detail';
  const date = input.timing.termsEffectiveAt.slice(0, 10);
  const issue = 579;
  const decisionKey = `${input.capabilityId}-issue-${issue}-private-non_production`;

  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: `${input.capabilityId}-internal-issue-${issue}-${date}`,
    provider: 'draftguru',
    dataset,
    datasetVersion: `live-web-${date}`,
    intendedPurpose:
      'Private non-production acquisition-spell registration for the admitted cohort, and deterministic replay. Acquisition lineage only; no valuation, training or forecasting use.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from, to }],
      accessMechanism: 'automated_web' as const,
    },
    acquisition: {
      kind: 'provider_web' as const,
      clientName: 'Statly governed Draftguru HTML client',
      clientVersion: 'draftguru-trade-parser/v1',
      capabilityId: input.capabilityId,
    },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      // The owner's acquisition decision excludes these, so the narrower record must say so.
      model_training: 'blocked' as const,
      derived_feature_creation: 'blocked' as const,
      public_derived_output: 'blocked' as const,
      public_fact_display: 'blocked' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: true,
      identification: `Statly private non-production issue-${issue} acquisition-lineage evaluation with bounded sequential requests.`,
      // The public-access review requires the retained five-second pacing, not the broader three.
      rateLimit: { requests: 1, perSeconds: 5, burst: 1 },
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
        basis: `Retain private derived evidence only for issue-${issue} acquisition lineage and rollback.`,
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
    fields: fields.map((sourceField) => ({
      sourceField,
      normalizedField: sourceField,
      uses: {
        archive_fact: 'allowed' as const,
        model_training: 'blocked' as const,
        derived_feature: 'blocked' as const,
        public_display: 'blocked' as const,
      },
      attributionRequired: true,
      notes: `Approved only for private non-production issue-${issue} acquisition lineage; training, derived features, public use and redistribution remain blocked.`,
    })),
    conditions: [
      {
        conditionId: 'provider-egress-control',
        description: `Capture only the approved ${from}-${to} trade pages with sequential provider egress at five-second pacing.`,
        appliesToOperations: ['bounded_evaluation_capture' as const],
        verificationEvidenceIds: [input.evidenceIds.boundedCapturePlan],
      },
      {
        conditionId: 'private-nonproduction-use',
        description:
          'Keep source facts, acquisition lineage and run evidence private and non-production. No training, derived features, publication or production activation.',
        appliesToOperations: [
          'raw_evidence_retention' as const,
          'internal_quality_evaluation' as const,
        ],
        verificationEvidenceIds: [input.evidenceIds.productOwnerAuthorization],
      },
    ],
    rightsEvidenceIds: [
      input.evidenceIds.productOwnerAuthorization,
      input.evidenceIds.publicAccessReview,
      input.evidenceIds.fieldBoundaryReview,
    ],
    termsEffectiveAt: input.timing.termsEffectiveAt,
    termsExpireAt: input.timing.termsExpireAt,
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions:
        'Stop collection and delete private raw and derived bytes marked for withdrawal deletion.',
      retainableAuditMaterial:
        'Retain only permitted hashes, decision history, provenance metadata, and rollback evidence.',
    },
    proposedAt: input.timing.rightsProposedAt,
    // Provenance says machine-prepared rather than claiming human authorship.
    proposedBy: 'statly-agent-assisted',
    proposalOrigin: 'agent_assisted' as const,
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });

  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope: {
      scopeKey: decisionKey,
      description: `Private non-production Draftguru authority for ${from}-${to} acquisition lineage.`,
      dimensions: [
        { name: 'source_rights_artifact', values: [sourceRights.rightsArtifactId] },
        { name: 'competition', values: ['AFLM'] },
        { name: 'season', values: seasons },
        { name: 'access_mechanism', values: ['automated_web'] },
        { name: 'geography', values: ['global'] },
        { name: 'commercial_context', values: ['internal-evaluation'] },
        { name: 'audience', values: ['internal'] },
        { name: 'operation', values: [...DRAFTGURU_TRADE_PERMITTED_OPERATIONS] },
      ],
      exclusions: [
        'Model training, predictive features and forecasting.',
        'Production activation or deployment.',
        'Public fact display, public derived output, raw redistribution, publication, or fantasy use.',
        `Any season outside ${from} through ${to}, or any Draftguru capability outside this exact authority.`,
      ],
    },
    proposal: `Approve this exact private issue-${issue} Draftguru ${input.capabilityId} capture for acquisition lineage and deterministic replay only.`,
    alternativesConsidered: [
      'Leave the cohort acquisition lineage unmaterialized and keep trade construction blocked.',
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
    proposedAt: input.timing.proposalProposedAt,
    proposedBy: 'statly-agent-assisted',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  return { sourceRights, proposal };
}
