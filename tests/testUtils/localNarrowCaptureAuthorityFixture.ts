import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createDraftguruTradeAuthorityProposal,
  type DraftguruTradeAuthorityProposalInput,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';
import type { LocalNarrowCaptureAuthority } from '@/server/aflTradeIntelligence/development/localNarrowCaptureAuthority';
import { officialAflDraftSessionDecisionKey } from '@/server/aflTradeIntelligence/development/localOfficialAflDraftSessionCapture';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
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

/**
 * The shape of the owner's recorded per-season Official AFL completed-session authority: the narrow
 * issue-579 operations, 1 request per 5 s with burst 1, a 3,600 s cache and 365-day raw retention.
 */
export function officialAflDraftSessionAuthority(input: {
  season: number;
  clientVersion?: string;
  /** A successor proposal carries the next version under the same decision key. */
  version?: number;
  evidenceIds: DraftguruTradeAuthorityProposalInput['evidenceIds'];
  timing: DraftguruTradeAuthorityProposalInput['timing'];
}): LocalNarrowCaptureAuthority {
  const template = createDraftguruTradeAuthorityProposal({
    capabilityId: 'draftguru-trade-index',
    seasons: [input.season],
    evidenceIds: input.evidenceIds,
    timing: input.timing,
  });
  const decisionKey = officialAflDraftSessionDecisionKey(input.season);
  const base = template.sourceRights.content;
  const rightsContent = {
    ...base,
    registerId: `${decisionKey}-synthetic`,
    provider: 'official_afl',
    dataset: `Official AFL ${input.season} completed national draft sessions`,
    datasetVersion: 'reviewed-synthetic/v1',
    acquisition: {
      kind: 'provider_web' as const,
      clientName: 'Statly private acquisition review',
      clientVersion: input.clientVersion ?? OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
      capabilityId: 'official-afl-completed-draft-session',
    },
    automatedAccess: {
      ...base.automatedAccess,
      cache: { permitted: true, maximumSeconds: 3_600 },
    },
    fields: OFFICIAL_AFL_DRAFT_SESSION_FIELDS.map((sourceField) => ({
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
    decisionKey,
    version: input.version ?? 1,
    scope: {
      ...templateProposal.scope,
      scopeKey: decisionKey,
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
