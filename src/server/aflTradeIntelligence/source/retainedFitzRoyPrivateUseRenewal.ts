import {
  createAflTradeContentAddress,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
} from '../governance/gateDecisionTypes';
import {
  AFL_TRADE_SOURCE_OPERATIONS,
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from './sourceContracts';

export interface RetainedFitzRoyPrivateUseRenewalInput {
  sourceRights: AflTradeSourceRightsProposal;
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
  captureId: string;
  renewedAt: string;
  accountableOwner: string;
  authorityEvidenceId: string;
  reviewer: { id: string; role: string; evidenceId: string };
}

/** Constructs an internal approval record; capture custody and currentness are checked by the ledger/DB. */
export function createRetainedFitzRoyPrivateUseRenewal(
  input: RetainedFitzRoyPrivateUseRenewalInput
) {
  const originalRights = aflTradeSourceRightsProposalSchema.parse(input.sourceRights);
  const originalProposal = aflTradeGateDecisionProposalSchema.parse(input.proposal);
  const originalDecision = aflTradeGateDecisionRecordSchema.parse(input.decision);
  const previous = originalDecision.content;
  const renewalTime = Date.parse(input.renewedAt);
  const proposed = originalProposal.content;
  if (
    !/^source-capture:[a-f0-9]{64}$/.test(input.captureId) ||
    !Number.isFinite(renewalTime) ||
    previous.effectiveAt === null ||
    renewalTime <= Date.parse(previous.effectiveAt) ||
    previous.environment !== 'non_production' ||
    proposed.gate !== previous.gate ||
    proposed.accountableOwner !== previous.accountableOwner ||
    canonicalizeAflTradeJson(proposed.scope) !== canonicalizeAflTradeJson(previous.scope) ||
    canonicalizeAflTradeJson(proposed.affectedArtifacts) !==
      canonicalizeAflTradeJson(previous.affectedArtifacts) ||
    renewalTime < Date.parse(proposed.proposedAt) ||
    renewalTime < Date.parse(originalRights.content.proposedAt) ||
    proposed.conditions.length !== previous.conditionResults.length ||
    proposed.conditions.some(
      (condition) =>
        !previous.conditionResults.some(
          (result) =>
            result.conditionId === condition.conditionId &&
            (!condition.required || result.status === 'satisfied')
        )
    ) ||
    previous.state !== 'approved' ||
    previous.gate !== 'gate_0a_permission_to_evaluate' ||
    previous.proposalId !== originalProposal.proposalId ||
    previous.decisionKey !== originalProposal.content.decisionKey ||
    previous.version !== originalProposal.content.version ||
    originalProposal.content.environment !== previous.environment ||
    originalRights.content.acquisition.kind !== 'fitzroy' ||
    originalRights.content.operations.derived_feature_creation !== 'allowed' ||
    originalProposal.content.scope.dimensions.some(
      ({ name }) => name === 'retained_source_capture'
    ) ||
    !originalProposal.content.scope.dimensions.some(
      ({ name, values }) =>
        name === 'source_rights_artifact' &&
        values.length === 1 &&
        values[0] === originalRights.rightsArtifactId
    )
  )
    throw new TypeError(
      'Private retained-capture renewal requires matching original approved authority.'
    );

  const expiresAt = new Date(renewalTime + 30 * 24 * 60 * 60 * 1000).toISOString();
  const privateOperations = new Set([
    'raw_evidence_retention',
    'metadata_hash_retention',
    'internal_quality_evaluation',
    'derived_feature_creation',
  ]);
  const operations = Object.fromEntries(
    AFL_TRADE_SOURCE_OPERATIONS.map((operation) => [
      operation,
      privateOperations.has(operation) ? originalRights.content.operations[operation] : 'blocked',
    ])
  );
  const rightsContent = {
    ...originalRights.content,
    operations,
    fields: originalRights.content.fields.map((field) => ({
      ...field,
      uses: { ...field.uses, model_training: 'blocked', public_display: 'blocked' },
    })),
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
    termsEffectiveAt: input.renewedAt,
    termsExpireAt: expiresAt,
    proposedAt: input.renewedAt,
    proposedBy: input.accountableOwner,
    proposalOrigin: 'agent_assisted',
    rightsEvidenceIds: [
      ...new Set([...originalRights.content.rightsEvidenceIds, input.authorityEvidenceId]),
    ],
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const scope = {
    ...originalProposal.content.scope,
    description:
      'Thirty-day private use of one exact retained capture; no new capture, training or publication authority.',
    dimensions: [
      ...originalProposal.content.scope.dimensions.map((dimension) => {
        if (dimension.name === 'source_rights_artifact')
          return { ...dimension, values: [sourceRights.rightsArtifactId] };
        if (dimension.name === 'operation')
          return {
            ...dimension,
            values: AFL_TRADE_SOURCE_OPERATIONS.filter(
              (operation) => sourceRights.content.operations[operation] === 'allowed'
            ),
          };
        return dimension;
      }),
      { name: 'retained_source_capture', values: [input.captureId] },
      { name: 'original_gate_decision', values: [originalDecision.decisionId] },
      { name: 'original_source_rights_artifact', values: [originalRights.rightsArtifactId] },
    ],
  };
  const proposalContent = {
    ...originalProposal.content,
    version: previous.version + 1,
    scope,
    proposal:
      'Renew internal private-derived use of the explicitly linked retained capture for thirty days.',
    accountableOwner: input.accountableOwner,
    requiredReviewerRoles: [input.reviewer.role],
    evidenceIds: [
      ...new Set([
        ...originalProposal.content.evidenceIds,
        input.authorityEvidenceId,
        input.reviewer.evidenceId,
      ]),
    ],
    affectedArtifacts: [
      { kind: 'source_rights' as const, artifactId: sourceRights.rightsArtifactId },
    ],
    proposedAt: input.renewedAt,
    proposedBy: input.accountableOwner,
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    ...previous,
    proposalId: proposal.proposalId,
    version: proposal.content.version,
    scope,
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
    rationale:
      'Explicit owner renewal of retained private use, not an upstream licence or permission expansion.',
    limitations: [
      ...previous.limitations,
      'Only the exact retained capture and original permitted private fields; no new capture, training or publication.',
    ],
    decidedAt: input.renewedAt,
    effectiveAt: input.renewedAt,
    revalidateAt: expiresAt,
    supersedesDecisionId: originalDecision.decisionId,
    affectedArtifacts: proposal.content.affectedArtifacts,
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { sourceRights, proposal, decision };
}
