import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  AFL_TRADE_FITZROY_CAPABILITIES,
  AFL_TRADE_FITZROY_CAPABILITY_SCHEMA_VERSION,
  AFL_TRADE_FITZROY_PINNED_VERSION,
} from './fitzRoyProviderCapabilities';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceFieldUse,
  type AflTradeSourceRightsProposal,
} from './sourceContracts';

export const APPROVED_AFL_TRADE_FITZROY_PLAYER_STAT_CAPABILITIES = [
  'afl-tables-player-stats',
  'footywire-player-stats',
  'fryzigg-player-stats',
] as const;

export type ApprovedAflTradeFitzRoyCapabilityId =
  (typeof APPROVED_AFL_TRADE_FITZROY_PLAYER_STAT_CAPABILITIES)[number];

export type ApprovedAflTradeFitzRoyFieldSets = Readonly<
  Record<ApprovedAflTradeFitzRoyCapabilityId, readonly AflTradeSourceFieldUse[]>
>;

export interface ApprovedAflTradeFitzRoySourcePolicyInput {
  fieldSets: ApprovedAflTradeFitzRoyFieldSets;
  conditionEvidence: Readonly<
    Record<ApprovedAflTradeFitzRoyCapabilityId, Readonly<Record<string, string>>>
  >;
  evidence: {
    terms: string;
    authority: string;
    rateLimit: string;
  };
  termsEffectiveAt: string;
  termsExpireAt: string;
  proposedAt: string;
  proposedBy: string;
}

interface ProviderPolicy {
  registerId: string;
  dataset: string;
  intendedPurpose: string;
  minimumSeason: number;
  accessMechanism: 'automated_web' | 'provider_api';
  rateLimit: { requests: number; perSeconds: number; burst: number };
  cacheSeconds: number;
  rawRetentionDays: number;
  attribution: string;
  attributionPlacement: string;
  conditions: readonly { id: string; description: string }[];
}

const providerPolicies: Readonly<Record<ApprovedAflTradeFitzRoyCapabilityId, ProviderPolicy>> = {
  'afl-tables-player-stats': {
    registerId: 'afl-tables-player-stats-fitzroy-1.7.0',
    dataset: 'AFL Tables historical player match statistics',
    intendedPurpose:
      'Primary historical AFL player-match facts, appearances, goals, votes, and reconciliation evidence for public trade outcomes.',
    minimumSeason: 1897,
    accessMechanism: 'automated_web',
    rateLimit: { requests: 1, perSeconds: 2, burst: 1 },
    cacheSeconds: 86_400,
    rawRetentionDays: 365,
    attribution: 'Player statistics sourced through fitzRoy from AFL Tables.',
    attributionPlacement: 'Public methodology, factual views, and generated downloads.',
    conditions: [
      {
        id: 'full-season-custody',
        description:
          'Capture and retain the exact full-season return before normalization because round filtering is not supported.',
      },
      {
        id: 'zero-provenance-review',
        description:
          'Do not treat a returned numeric zero as measured until its source and match appearance are reconciled.',
      },
    ],
  },
  'footywire-player-stats': {
    registerId: 'footywire-player-stats-fitzroy-1.7.0',
    dataset: 'Footywire historical player match statistics',
    intendedPurpose:
      'Secondary historical AFL player-match facts and independent corroboration for public trade outcomes.',
    minimumSeason: 2010,
    accessMechanism: 'automated_web',
    rateLimit: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    rawRetentionDays: 365,
    attribution: 'Player statistics sourced through fitzRoy from Footywire.',
    attributionPlacement: 'Public methodology, factual views, and generated downloads.',
    conditions: [
      {
        id: 'full-season-custody',
        description:
          'Capture and retain the exact full-season return before normalization because round filtering is not supported.',
      },
      {
        id: 'html-schema-fingerprint',
        description:
          'Reject fixed-position HTML layout changes until the exact returned field set is reviewed again.',
      },
    ],
  },
  'fryzigg-player-stats': {
    registerId: 'fryzigg-player-stats-fitzroy-1.7.0',
    dataset: 'Fryzigg historical player statistics dataset',
    intendedPurpose:
      'Independent reconciliation evidence for AFL player-match statistics and public trade outcomes.',
    minimumSeason: 1897,
    accessMechanism: 'provider_api',
    rateLimit: { requests: 1, perSeconds: 5, burst: 1 },
    cacheSeconds: 86_400,
    rawRetentionDays: 365,
    attribution: 'Player statistics sourced through fitzRoy from Fryzigg.',
    attributionPlacement: 'Public methodology, factual views, and generated downloads.',
    conditions: [
      {
        id: 'complete-rds-custody',
        description: 'Capture and digest the complete returned RDS object before any filtering.',
      },
      {
        id: 'reconciliation-promotion-review',
        description:
          'Keep source facts in reconciliation until identifiers, coverage, duplicates, and repeatability pass review.',
      },
    ],
  },
};

function requireSeason(proposedAt: string): number {
  const proposed = Date.parse(proposedAt);
  if (!Number.isFinite(proposed)) throw new TypeError('A valid proposedAt timestamp is required.');
  return new Date(proposed).getUTCFullYear();
}

function requireFieldSet(
  capabilityId: ApprovedAflTradeFitzRoyCapabilityId,
  fieldSets: ApprovedAflTradeFitzRoyFieldSets
): readonly AflTradeSourceFieldUse[] {
  const fields = fieldSets[capabilityId];
  if (fields.length === 0) {
    throw new TypeError(`The approved ${capabilityId} field set cannot be empty.`);
  }
  return fields;
}

function requireConditionEvidence(
  capabilityId: ApprovedAflTradeFitzRoyCapabilityId,
  policy: ProviderPolicy,
  input: ApprovedAflTradeFitzRoySourcePolicyInput
): Readonly<Record<string, string>> {
  const evidence = input.conditionEvidence[capabilityId];
  const expectedIds = policy.conditions.map(({ id }) => id).sort();
  const actualIds = Object.keys(evidence).sort();
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((conditionId, index) => conditionId !== actualIds[index])
  ) {
    throw new TypeError(
      `The approved ${capabilityId} condition evidence must cover every and only provider-specific condition.`
    );
  }
  return evidence;
}

export function createApprovedAflTradeFitzRoySourcePolicies(
  input: ApprovedAflTradeFitzRoySourcePolicyInput
): readonly AflTradeSourceRightsProposal[] {
  const throughSeason = requireSeason(input.proposedAt);
  return APPROVED_AFL_TRADE_FITZROY_PLAYER_STAT_CAPABILITIES.map((capabilityId) => {
    const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
      (candidate) => candidate.capabilityId === capabilityId
    );
    if (capability === undefined) {
      throw new TypeError(`Pinned fitzRoy capability ${capabilityId} is unavailable.`);
    }
    const policy = providerPolicies[capabilityId];
    const conditionEvidence = requireConditionEvidence(capabilityId, policy, input);
    const content = {
      schemaVersion: 'afl-trade-source-rights/v2' as const,
      registerId: policy.registerId,
      provider: capability.provider,
      dataset: policy.dataset,
      datasetVersion: `fitzroy-${AFL_TRADE_FITZROY_PINNED_VERSION}`,
      intendedPurpose: policy.intendedPurpose,
      scope: {
        competitions: [...capability.competitions],
        seasonRanges: [{ from: policy.minimumSeason, to: throughSeason }],
        accessMechanism: policy.accessMechanism,
      },
      acquisition: {
        kind: 'fitzroy' as const,
        capabilitySchemaVersion: AFL_TRADE_FITZROY_CAPABILITY_SCHEMA_VERSION,
        fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
        capabilities: [
          {
            capabilityId: capability.capabilityId,
            provider: capability.provider,
            directFunction: capability.directFunction,
          },
        ],
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
        identification: 'Statly public AFL trade-intelligence fitzRoy capture.',
        rateLimit: policy.rateLimit,
        cache: { permitted: true, maximumSeconds: policy.cacheSeconds },
      },
      retention: {
        rawEvidence: {
          disposition: 'retained' as const,
          maximumDays: policy.rawRetentionDays,
          deleteOnWithdrawal: true,
          basis: 'Retain exact source evidence for reproducibility while authority is current.',
        },
        hashesAndMetadata: {
          disposition: 'retained' as const,
          maximumDays: null,
          deleteOnWithdrawal: false,
          basis: 'Retain provenance, hashes, and governance decisions for permanent audit.',
        },
        derivedArtifacts: {
          disposition: 'retained' as const,
          maximumDays: 365,
          deleteOnWithdrawal: true,
          basis: 'Retain derived evidence for release reproducibility and reviewed rollback.',
        },
      },
      redistribution: {
        rawFieldsPermitted: false,
        publicDerivedOutputPermitted: true,
      },
      attribution: {
        required: true,
        text: policy.attribution,
        placement: policy.attributionPlacement,
      },
      restrictions: { geographic: [], commercial: [], audience: [] },
      fields: [...requireFieldSet(capabilityId, input.fieldSets)],
      conditions: [
        {
          conditionId: 'provider-egress-control',
          description:
            'Enforce the reviewed provider request rate, burst, cache, and identified egress boundary.',
          appliesToOperations: ['bounded_evaluation_capture' as const],
          verificationEvidenceIds: [input.evidence.rateLimit],
        },
        ...policy.conditions.map((condition) => ({
          conditionId: condition.id,
          description: condition.description,
          appliesToOperations: ['bounded_evaluation_capture' as const],
          verificationEvidenceIds: [conditionEvidence[condition.id]],
        })),
      ],
      rightsEvidenceIds: [input.evidence.terms, input.evidence.authority],
      termsEffectiveAt: input.termsEffectiveAt,
      termsExpireAt: input.termsExpireAt,
      withdrawalDuties: {
        stopCollection: true,
        stopNewDerivedWork: true,
        reassessPublishedOutputs: true,
        deletionInstructions:
          'Stop capture and remove source or derived bytes whose custody profile requires withdrawal deletion.',
        retainableAuditMaterial:
          'Retain permitted content hashes, decision history, provenance metadata, and rollback evidence.',
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
