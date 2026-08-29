import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
} from '../governance/gateDecisionTypes';
import {
  AFL_TRADE_SOURCE_OPERATIONS,
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceOperation,
  type AflTradeSourceRightsProposal,
} from './sourceContracts';

export interface ApprovedAflTradeFitzRoyGateRecordsInput {
  sourceRights: AflTradeSourceRightsProposal;
  environment: 'non_production' | 'production';
  version: number;
  supersedesDecisionId: string | null;
  decidedAt: string;
  effectiveAt: string;
  revalidateAt: string;
  accountableOwner: string;
  reviewer: {
    id: string;
    role: string;
    evidenceId: string;
  };
  authorityEvidenceId: string;
  rateLimitEvidenceId: string;
}

export interface ApprovedAflTradeFitzRoyGateRecords {
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
}

function seasons(sourceRights: AflTradeSourceRightsProposal): string[] {
  return sourceRights.content.scope.seasonRanges.flatMap(({ from, to }) =>
    Array.from({ length: to - from + 1 }, (_, index) => String(from + index))
  );
}

function allowedOperations(sourceRights: AflTradeSourceRightsProposal): AflTradeSourceOperation[] {
  return AFL_TRADE_SOURCE_OPERATIONS.filter(
    (operation) => sourceRights.content.operations[operation] === 'allowed'
  );
}

function permittedValues(values: readonly string[], unrestrictedValue: string): string[] {
  return values.length === 0 ? [unrestrictedValue] : [...values];
}

export function createApprovedAflTradeFitzRoyGateRecords(
  input: ApprovedAflTradeFitzRoyGateRecordsInput
): ApprovedAflTradeFitzRoyGateRecords {
  const sourceRights = aflTradeSourceRightsProposalSchema.parse(input.sourceRights);
  if (sourceRights.content.acquisition.kind !== 'fitzroy') {
    throw new TypeError('Approved fitzRoy Gate records require a fitzRoy source-rights policy.');
  }
  const capability = sourceRights.content.acquisition.capabilities[0];
  if (capability === undefined) {
    throw new TypeError('Approved fitzRoy Gate records require exactly one capability.');
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new TypeError('Approved fitzRoy Gate records require a positive decision version.');
  }
  if (
    (input.version === 1 && input.supersedesDecisionId !== null) ||
    (input.version > 1 && input.supersedesDecisionId === null)
  ) {
    throw new TypeError(
      'Approved fitzRoy Gate record supersession must match its decision version.'
    );
  }
  const decisionKey = `${capability.capabilityId}-${input.environment}`;
  const environmentLabel = input.environment === 'production' ? 'Production' : 'Non-production';
  const operations = allowedOperations(sourceRights);
  const scope = {
    scopeKey:
      input.environment === 'production'
        ? `afl-trade-${capability.capabilityId}`
        : `afl-trade-${capability.capabilityId}-${input.environment}`,
    description: `${environmentLabel} authority for ${capability.capabilityId} within its exact source-rights scope.`,
    dimensions: [
      { name: 'source_rights_artifact', values: [sourceRights.rightsArtifactId] },
      { name: 'competition', values: [...sourceRights.content.scope.competitions] },
      { name: 'season', values: seasons(sourceRights) },
      { name: 'access_mechanism', values: [sourceRights.content.scope.accessMechanism] },
      { name: 'fitzroy_capability', values: [capability.capabilityId] },
      {
        name: 'geography',
        values: permittedValues(sourceRights.content.restrictions.geographic, 'global'),
      },
      {
        name: 'commercial_context',
        values: permittedValues(sourceRights.content.restrictions.commercial, 'public-research'),
      },
      {
        name: 'audience',
        values: permittedValues(sourceRights.content.restrictions.audience, 'public'),
      },
      { name: 'operation', values: operations },
    ],
    exclusions: ['Raw upstream field redistribution', 'Fantasy user or league ownership'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey,
    version: input.version,
    environment: input.environment,
    scope,
    proposal: `Approve ${capability.directFunction} through fitzRoy ${sourceRights.content.acquisition.fitzRoyVersion} for its exact reviewed fields and governed uses.`,
    alternativesConsidered: [
      `Keep the capability unavailable to ${input.environment.replace('_', '-')} capture and modelling.`,
    ],
    accountableOwner: input.accountableOwner,
    reviewRequirement: 'independent_review_required' as const,
    requiredReviewerRoles: [input.reviewer.role],
    conditions: sourceRights.content.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      description: condition.description,
      required: true,
      verificationEvidenceIds: condition.verificationEvidenceIds,
    })),
    evidenceIds: [
      ...sourceRights.content.rightsEvidenceIds,
      input.authorityEvidenceId,
      input.rateLimitEvidenceId,
    ],
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
    decisionKey: proposal.content.decisionKey,
    version: proposal.content.version,
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
      explanation:
        'The exact source-specific control is implemented and retained in its dedicated reviewed evidence.',
    })),
    rationale:
      'The named source is approved only within the operations and contextual dimensions authenticated by its exact source-rights artifact.',
    limitations: [
      'Every operation, audience, commercial context, geography, field use, retention, or cache behavior outside the pinned source-rights artifact remains blocked.',
    ],
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
