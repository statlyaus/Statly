import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceFieldUse,
  type AflTradeSourceRightsProposal,
} from './sourceContracts';

export const APPROVED_AFL_TRADE_EXTERNAL_CAPABILITIES = [
  'draftguru-trade-index',
  'draftguru-trade-detail',
  'draftguru-year-page',
  'footywire-draft-results',
  'official-afl-indicative-draft-order',
] as const;

export type ApprovedAflTradeExternalCapabilityId =
  (typeof APPROVED_AFL_TRADE_EXTERNAL_CAPABILITIES)[number];

export interface ApprovedAflTradeExternalSourcePolicyInput {
  fieldSets: Readonly<
    Record<ApprovedAflTradeExternalCapabilityId, readonly AflTradeSourceFieldUse[]>
  >;
  datasetVersions: Readonly<Record<ApprovedAflTradeExternalCapabilityId, string>>;
  parserVersions: Readonly<Record<ApprovedAflTradeExternalCapabilityId, string>>;
  conditionEvidence: Readonly<
    Record<ApprovedAflTradeExternalCapabilityId, Readonly<Record<string, string>>>
  >;
  evidence: { terms: string; authority: string; egress: string };
  termsEffectiveAt: string;
  termsExpireAt: string;
  proposedAt: string;
  proposedBy: string;
}

interface CapabilityPolicy {
  provider: 'draftguru' | 'footywire' | 'official_afl';
  dataset: string;
  purpose: string;
  minimumSeason: number;
  rateLimit: { requests: number; perSeconds: number; burst: number };
  cacheSeconds: number;
  attribution: string;
  conditions: readonly { id: string; description: string }[];
}

const policies: Readonly<Record<ApprovedAflTradeExternalCapabilityId, CapabilityPolicy>> = {
  'draftguru-trade-index': {
    provider: 'draftguru',
    dataset: 'Draftguru AFL trade index',
    purpose:
      'Bounded discovery of source-native trade detail URLs and season identifiers for scheduled archive capture.',
    minimumSeason: 1988,
    rateLimit: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    attribution: 'Trade discovery evidence sourced from Draftguru.',
    conditions: [
      {
        id: 'discovery-field-boundary',
        description:
          'Capture only reviewed trade URL, source-native event identity and season metadata.',
      },
      {
        id: 'html-schema-fingerprint',
        description: 'Quarantine unreviewed index-page or link-shape changes before scheduling.',
      },
    ],
  },
  'draftguru-trade-detail': {
    provider: 'draftguru',
    dataset: 'Draftguru AFL trade transaction detail',
    purpose:
      'Transaction, party, player-transfer, current-pick and future-pick source evidence for the public AFL trade archive.',
    minimumSeason: 1988,
    rateLimit: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    attribution: 'Transaction and draft evidence sourced from Draftguru.',
    conditions: [
      {
        id: 'transaction-field-boundary',
        description:
          'Capture only reviewed transaction facts; exclude Draftguru grades, games, pick points and derived values.',
      },
      {
        id: 'html-schema-fingerprint',
        description: 'Quarantine unreviewed page-shape or field-set changes before normalization.',
      },
    ],
  },
  'draftguru-year-page': {
    provider: 'draftguru',
    dataset: 'Draftguru AFL draft selection list',
    purpose:
      'Draft selection number, player and selecting-club evidence used to resolve exercised picks.',
    minimumSeason: 1986,
    rateLimit: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    attribution: 'Draft selection evidence sourced from Draftguru.',
    conditions: [
      {
        id: 'selection-field-boundary',
        description:
          'Capture reviewed selection facts only; exclude provider grades, games and derived pick values.',
      },
      {
        id: 'html-schema-fingerprint',
        description: 'Quarantine unreviewed page-shape or field-set changes before normalization.',
      },
    ],
  },
  'footywire-draft-results': {
    provider: 'footywire',
    dataset: 'Footywire AFL draft results',
    purpose: 'Independent selection-number, player and club evidence for draft reconciliation.',
    minimumSeason: 1993,
    rateLimit: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    attribution: 'Draft selection evidence sourced from Footywire.',
    conditions: [
      {
        id: 'selection-corroboration-only',
        description:
          'Use the source as selection evidence and never infer trade edges or pick custody from it.',
      },
      {
        id: 'html-schema-fingerprint',
        description: 'Quarantine unreviewed page-shape or field-set changes before normalization.',
      },
    ],
  },
  'official-afl-indicative-draft-order': {
    provider: 'official_afl',
    dataset: 'Official AFL indicative draft order',
    purpose: 'Official time-stamped pick-number, original-club and current-club custody evidence.',
    minimumSeason: 2015,
    rateLimit: { requests: 1, perSeconds: 5, burst: 1 },
    cacheSeconds: 3_600,
    attribution: 'Indicative draft-order evidence sourced from AFL.com.au.',
    conditions: [
      {
        id: 'indicative-order-not-final-selection',
        description:
          'Treat the article as time-stamped custody evidence, not as the final draft result.',
      },
      {
        id: 'article-schema-fingerprint',
        description:
          'Quarantine unreviewed article-table or field-set changes before normalization.',
      },
    ],
  },
};

function yearAt(instant: string): number {
  const parsed = Date.parse(instant);
  if (!Number.isFinite(parsed)) throw new TypeError('A valid proposedAt timestamp is required.');
  return new Date(parsed).getUTCFullYear();
}

function exactConditionEvidence(
  capabilityId: ApprovedAflTradeExternalCapabilityId,
  input: ApprovedAflTradeExternalSourcePolicyInput
): Readonly<Record<string, string>> {
  const evidence = input.conditionEvidence[capabilityId];
  const expected = policies[capabilityId].conditions.map(({ id }) => id).sort();
  const actual = Object.keys(evidence).sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new TypeError(`${capabilityId} condition evidence must cover the exact condition set.`);
  }
  return evidence;
}

export function createApprovedAflTradeExternalSourcePolicies(
  input: ApprovedAflTradeExternalSourcePolicyInput
): readonly AflTradeSourceRightsProposal[] {
  const throughSeason = yearAt(input.proposedAt);
  return APPROVED_AFL_TRADE_EXTERNAL_CAPABILITIES.map((capabilityId) => {
    const policy = policies[capabilityId];
    const fields = input.fieldSets[capabilityId];
    if (fields.length === 0) throw new TypeError(`${capabilityId} field set cannot be empty.`);
    const evidence = exactConditionEvidence(capabilityId, input);
    const content = {
      schemaVersion: 'afl-trade-source-rights/v2' as const,
      registerId: `${capabilityId}-${input.datasetVersions[capabilityId]}`,
      provider: policy.provider,
      dataset: policy.dataset,
      datasetVersion: input.datasetVersions[capabilityId],
      intendedPurpose: policy.purpose,
      scope: {
        competitions: ['AFLM'],
        seasonRanges: [{ from: policy.minimumSeason, to: throughSeason }],
        accessMechanism: 'automated_web' as const,
      },
      acquisition: {
        kind: 'provider_web' as const,
        clientName: 'Statly bounded external-source capture',
        clientVersion: input.parserVersions[capabilityId],
        capabilityId,
      },
      operations: {
        bounded_evaluation_capture: 'allowed' as const,
        raw_evidence_retention: 'allowed' as const,
        metadata_hash_retention: 'allowed' as const,
        internal_quality_evaluation: 'allowed' as const,
        model_training: 'allowed' as const,
        derived_feature_creation: 'allowed' as const,
        public_derived_output: 'allowed' as const,
        public_fact_display: 'allowed' as const,
        raw_field_redistribution: 'blocked' as const,
      },
      automatedAccess: {
        permitted: true,
        identification: 'Statly public AFL trade-intelligence evidence capture.',
        rateLimit: policy.rateLimit,
        cache: { permitted: true, maximumSeconds: policy.cacheSeconds },
      },
      retention: {
        rawEvidence: {
          disposition: 'retained' as const,
          maximumDays: 365,
          deleteOnWithdrawal: true,
          basis: 'Retain exact source evidence for reproducibility while authority is current.',
        },
        hashesAndMetadata: {
          disposition: 'retained' as const,
          maximumDays: null,
          deleteOnWithdrawal: false,
          basis: 'Retain provenance and governance history for permanent audit.',
        },
        derivedArtifacts: {
          disposition: 'retained' as const,
          maximumDays: 365,
          deleteOnWithdrawal: true,
          basis: 'Retain reviewed derived evidence for release reproduction and rollback.',
        },
      },
      redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: true },
      attribution: {
        required: true,
        text: policy.attribution,
        placement: 'Public methodology, factual views and generated downloads.',
      },
      restrictions: { geographic: [], commercial: [], audience: [] },
      fields: [...fields],
      conditions: [
        {
          conditionId: 'provider-egress-control',
          description: 'Enforce identified conditional capture and the reviewed provider rate.',
          appliesToOperations: ['bounded_evaluation_capture' as const],
          verificationEvidenceIds: [input.evidence.egress],
        },
        ...policy.conditions.map((condition) => ({
          conditionId: condition.id,
          description: condition.description,
          appliesToOperations: ['bounded_evaluation_capture' as const],
          verificationEvidenceIds: [evidence[condition.id]],
        })),
      ],
      rightsEvidenceIds: [input.evidence.terms, input.evidence.authority],
      termsEffectiveAt: input.termsEffectiveAt,
      termsExpireAt: input.termsExpireAt,
      withdrawalDuties: {
        stopCollection: true,
        stopNewDerivedWork: true,
        reassessPublishedOutputs: true,
        deletionInstructions: 'Stop capture and delete source bytes where custody requires it.',
        retainableAuditMaterial: 'Retain permitted hashes, decisions and provenance metadata.',
      },
      proposedAt: input.proposedAt,
      proposedBy: input.proposedBy,
      proposalOrigin: 'human_authored' as const,
    };
    return aflTradeSourceRightsProposalSchema.parse({
      rightsArtifactId: createAflTradeContentAddress('source-rights', content),
      content,
    });
  });
}
