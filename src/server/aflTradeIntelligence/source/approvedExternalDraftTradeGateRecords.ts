import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
} from '../governance/gateDecisionTypes';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from './sourceContracts';

export interface ApprovedAflTradeExternalGateRecordsInput {
  sourceRights: AflTradeSourceRightsProposal;
  version: number;
  supersedesDecisionId: string | null;
  decidedAt: string;
  effectiveAt: string;
  revalidateAt: string;
  accountableOwner: string;
  reviewer: { id: string; role: string; evidenceId: string };
  authorityEvidenceId: string;
}

export interface ApprovedAflTradeExternalGateRecords {
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
}

const operations = [
  'bounded_evaluation_capture',
  'raw_evidence_retention',
  'metadata_hash_retention',
  'internal_quality_evaluation',
  'model_training',
  'derived_feature_creation',
  'public_derived_output',
  'public_fact_display',
] as const;

function seasons(sourceRights: AflTradeSourceRightsProposal): string[] {
  return sourceRights.content.scope.seasonRanges.flatMap(({ from, to }) =>
    Array.from({ length: to - from + 1 }, (_, index) => String(from + index))
  );
}

export function createApprovedAflTradeExternalGateRecords(
  input: ApprovedAflTradeExternalGateRecordsInput
): ApprovedAflTradeExternalGateRecords {
  const sourceRights = aflTradeSourceRightsProposalSchema.parse(input.sourceRights);
  if (sourceRights.content.acquisition.kind !== 'provider_web') {
    throw new TypeError('External-source Gate records require provider-web source rights.');
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new TypeError('External-source Gate records require a positive decision version.');
  }
  if (
    (input.version === 1 && input.supersedesDecisionId !== null) ||
    (input.version > 1 && input.supersedesDecisionId === null)
  ) {
    throw new TypeError('External-source supersession must match its decision version.');
  }
  const capabilityId = sourceRights.content.acquisition.capabilityId;
  const decisionKey = `${capabilityId}-production`;
  const scope = {
    scopeKey: `afl-trade-${capabilityId}`,
    description: `Production authority for ${capabilityId} in the public AFL trade-intelligence boundary.`,
    dimensions: [
      { name: 'source_rights_artifact', values: [sourceRights.rightsArtifactId] },
      { name: 'competition', values: [...sourceRights.content.scope.competitions] },
      { name: 'season', values: seasons(sourceRights) },
      { name: 'access_mechanism', values: [sourceRights.content.scope.accessMechanism] },
      { name: 'external_capability', values: [capabilityId] },
      { name: 'geography', values: ['global'] },
      { name: 'commercial_context', values: ['public-research'] },
      { name: 'audience', values: ['public'] },
      { name: 'operation', values: [...operations] },
    ],
    exclusions: ['Raw upstream field redistribution', 'Fantasy user or league ownership'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey,
    version: input.version,
    environment: 'production' as const,
    scope,
    proposal: `Approve bounded ${capabilityId} capture for the exact reviewed fields and governed uses.`,
    alternativesConsidered: ['Keep this external capability unavailable to production capture.'],
    accountableOwner: input.accountableOwner,
    reviewRequirement: 'independent_review_required' as const,
    requiredReviewerRoles: [input.reviewer.role],
    conditions: sourceRights.content.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      description: condition.description,
      required: true,
      verificationEvidenceIds: condition.verificationEvidenceIds,
    })),
    evidenceIds: [...sourceRights.content.rightsEvidenceIds, input.authorityEvidenceId],
    affectedArtifacts: [
      { kind: 'source_rights' as const, artifactId: sourceRights.rightsArtifactId },
    ],
    proposedAt: sourceRights.content.proposedAt,
    proposedBy: sourceRights.content.proposedBy,
    proposalOrigin: sourceRights.content.proposalOrigin,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposal.content.gate,
    decisionKey,
    version: input.version,
    environment: proposal.content.environment,
    scope: proposal.content.scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: input.accountableOwner,
    decidedBy: input.accountableOwner,
    reviewers: [
      {
        reviewerId: input.reviewer.id,
        role: input.reviewer.role,
        evidenceId: input.reviewer.evidenceId,
      },
    ],
    authorityEvidenceIds: [input.authorityEvidenceId],
    conditionResults: proposal.content.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      status: 'satisfied' as const,
      evidenceIds: condition.verificationEvidenceIds,
      explanation: 'The exact source-specific control is retained in reviewed evidence.',
    })),
    rationale:
      'The named source is approved for bounded capture, retained evidence, modelling uses and public factual or derived output.',
    limitations: ['Raw upstream field redistribution remains blocked.'],
    decidedAt: input.decidedAt,
    effectiveAt: input.effectiveAt,
    revalidateAt: input.revalidateAt,
    supersedesDecisionId: input.supersedesDecisionId,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}
