import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createDraftguruTradeAuthorityProposal,
  type DraftguruTradeAuthorityProposalInput,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';
import {
  DRAFTGURU_NATIONAL_YEAR_CAPABILITY,
  DRAFTGURU_NATIONAL_YEAR_FIELDS as PRODUCTION_DRAFTGURU_NATIONAL_YEAR_FIELDS,
  DRAFTGURU_NATIONAL_YEAR_PARSER_VERSION,
  draftguruNationalYearDecisionKey,
} from '@/server/aflTradeIntelligence/development/localDraftguruNationalYearCapture';
import type { LocalNarrowCaptureAuthority } from '@/server/aflTradeIntelligence/development/localNarrowCaptureAuthority';
import {
  OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY,
  OFFICIAL_AFL_DRAFT_ORDER_FIELDS,
  officialAflDraftOrderDecisionKey,
} from '@/server/aflTradeIntelligence/development/localOfficialAflDraftOrderCapture';
import { officialAflDraftSessionDecisionKey } from '@/server/aflTradeIntelligence/development/localOfficialAflDraftSessionCapture';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/draftCorroborationAdapter';
import { OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';

export const OFFICIAL_AFL_DRAFT_SESSION_FIELDS = [
  'draft_session.draftType',
  'draft_session.draftYear',
  'draft_session.eventDate',
  'draft_session.officialName',
  'draft_session.selectionNumbers',
  'draft_session.sessionOrdinal',
] as const;

/** The genuine recorded field boundary for Draftguru national-year selections (parser v2). */
export const DRAFTGURU_NATIONAL_YEAR_FIELDS = PRODUCTION_DRAFTGURU_NATIONAL_YEAR_FIELDS;

interface NarrowAuthorityTiming {
  evidenceIds: DraftguruTradeAuthorityProposalInput['evidenceIds'];
  timing: DraftguruTradeAuthorityProposalInput['timing'];
}

/**
 * One per-season narrow issue-579 authority: the narrow operations, 1 request per 5 s with burst 1,
 * a 3,600 s cache and 365-day raw retention, around the given provider, capability and fields.
 */
function narrowSeasonAuthority(
  input: NarrowAuthorityTiming & {
    season: number;
    version?: number;
    decisionKey: string;
    provider: 'draftguru' | 'official_afl';
    dataset: string;
    capabilityId: string;
    clientVersion: string;
    fields: readonly string[];
  }
): LocalNarrowCaptureAuthority {
  const template = createDraftguruTradeAuthorityProposal({
    capabilityId: 'draftguru-trade-index',
    seasons: [input.season],
    evidenceIds: input.evidenceIds,
    timing: input.timing,
  });
  const base = template.sourceRights.content;
  const rightsContent = {
    ...base,
    registerId: `${input.decisionKey}-synthetic`,
    provider: input.provider,
    dataset: input.dataset,
    datasetVersion: 'reviewed-synthetic/v1',
    acquisition: {
      kind: 'provider_web' as const,
      clientName: 'Statly private acquisition review',
      clientVersion: input.clientVersion,
      capabilityId: input.capabilityId,
    },
    automatedAccess: {
      ...base.automatedAccess,
      cache: { permitted: true, maximumSeconds: 3_600 },
    },
    fields: input.fields.map((sourceField) => ({
      ...base.fields[0]!,
      sourceField,
      normalizedField: sourceField,
    })),
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const templateProposal = template.proposal.content;
  const proposalContent = {
    ...templateProposal,
    decisionKey: input.decisionKey,
    version: input.version ?? 1,
    scope: {
      ...templateProposal.scope,
      scopeKey: input.decisionKey,
      dimensions: templateProposal.scope.dimensions.map((dimension) =>
        dimension.name === 'source_rights_artifact'
          ? { ...dimension, values: [sourceRights.rightsArtifactId] }
          : dimension
      ),
    },
    affectedArtifacts: [
      { kind: 'source_rights' as const, artifactId: sourceRights.rightsArtifactId },
    ],
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  return { sourceRights, proposal };
}

/** The shape of the owner's recorded per-season Official AFL completed-session authority. */
export function officialAflDraftSessionAuthority(
  input: NarrowAuthorityTiming & {
    season: number;
    clientVersion?: string;
    /** A successor proposal carries the next version under the same decision key. */
    version?: number;
  }
): LocalNarrowCaptureAuthority {
  return narrowSeasonAuthority({
    ...input,
    decisionKey: officialAflDraftSessionDecisionKey(input.season),
    provider: 'official_afl',
    dataset: `Official AFL ${input.season} completed national draft sessions`,
    capabilityId: 'official-afl-completed-draft-session',
    clientVersion: input.clientVersion ?? OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
    fields: OFFICIAL_AFL_DRAFT_SESSION_FIELDS,
  });
}

/** The shape of the owner's recorded per-season Official AFL pre-draft order authority (issue 853). */
export function officialAflDraftOrderAuthority(
  input: NarrowAuthorityTiming & { season: number; clientVersion?: string; version?: number }
): LocalNarrowCaptureAuthority {
  return narrowSeasonAuthority({
    ...input,
    decisionKey: officialAflDraftOrderDecisionKey(input.season),
    provider: 'official_afl',
    dataset: `Official AFL ${input.season} pre-draft national order`,
    capabilityId: OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY,
    clientVersion: input.clientVersion ?? OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
    fields: OFFICIAL_AFL_DRAFT_ORDER_FIELDS,
  });
}

/** The shape of the owner's recorded per-season Draftguru national-year authority. */
export function draftguruNationalYearAuthority(
  input: NarrowAuthorityTiming & { season: number; clientVersion?: string }
): LocalNarrowCaptureAuthority {
  return narrowSeasonAuthority({
    ...input,
    decisionKey: draftguruNationalYearDecisionKey(input.season),
    provider: 'draftguru',
    dataset: `Draftguru ${input.season} national draft selections`,
    capabilityId: DRAFTGURU_NATIONAL_YEAR_CAPABILITY,
    clientVersion: input.clientVersion ?? DRAFTGURU_NATIONAL_YEAR_PARSER_VERSION,
    fields: DRAFTGURU_NATIONAL_YEAR_FIELDS,
  });
}

/** Stands in for the owner's recorded approval of one exact narrow proposal. */
export function approveNarrowAuthority(
  { sourceRights, proposal }: LocalNarrowCaptureAuthority,
  timing: { decidedAt: string; revalidateAt: string; supersedes?: string }
) {
  const content = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey: proposal.content.decisionKey,
    version: proposal.content.version,
    environment: 'non_production' as const,
    scope: proposal.content.scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: 'statly-product-owner',
    decidedBy: 'statly-product-owner',
    reviewers: [] as never[],
    authorityEvidenceIds: [sourceRights.content.rightsEvidenceIds[0]!],
    conditionResults: sourceRights.content.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      status: 'satisfied' as const,
      evidenceIds: condition.verificationEvidenceIds,
      explanation: 'Synthetic owner approval.',
    })),
    rationale: 'Synthetic owner approval of the exact narrow proposal.',
    limitations: [...proposal.content.scope.exclusions],
    decidedAt: timing.decidedAt,
    effectiveAt: timing.decidedAt,
    revalidateAt: timing.revalidateAt,
    supersedesDecisionId: timing.supersedes ?? null,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions: [] as string[],
  };
  return aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', content),
    content,
  });
}
