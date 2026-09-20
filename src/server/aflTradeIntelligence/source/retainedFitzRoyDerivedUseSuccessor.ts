import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalizeAflTradeJson, createAflTradeContentAddress } from '../artifacts/contentAddress';
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

const addressed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`, 'u'));
const candidateSchema = z.object({
  methodUseId: addressed('cameron-2020-hpn-method-use'),
  content: z.object({
    schemaVersion: z.literal('statly-cameron-2020-hpn-retained-source-use-method/v1'),
    environment: z.literal('non_production'),
    competition: z.literal('AFLM'),
    operation: z.literal('derived_feature_creation'),
    seasonYear: z.literal(2020),
    valuationScopeKey: z.literal('cameron-2020-private-pilot'),
    hpnPavMethodId: addressed('hpn-pav-method'),
    ownerApprovalSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    restrictions: z.object({
      originalAcquisitionProvenanceImmutable: z.literal(true),
      rawFieldRedistributionPermitted: z.literal(false),
      publicOutputAuthorizedByThisCandidate: z.literal(false),
      externalLicenseAsserted: z.literal(false),
    }).strict(),
    captureUses: z.array(z.object({
      capabilityId: z.string().trim().min(1),
      captureId: addressed('source-capture'),
      originalGateDecisionId: addressed('gate-decision'),
      originalRightsArtifactId: addressed('source-rights'),
      sourceFields: z.array(z.string().trim().min(1)).min(1),
    }).passthrough()).length(2),
    state: z.literal('candidate_requires_durable_source_use_admission'),
  }).passthrough(),
}).strict();

export interface RetainedFitzRoyDerivedUseSuccessorInput {
  sourceRights: AflTradeSourceRightsProposal;
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
  methodUseCandidate: unknown;
  ownerApprovalBytes: Uint8Array;
  captureId: string;
  effectiveAt: string;
  accountableOwner: string;
  reviewer: { id: string; role: string; evidenceId: string };
}

/** One finite, capture-bound private derived-use decision; never rewrites acquisition evidence. */
export function createRetainedFitzRoyDerivedUseSuccessor(
  input: RetainedFitzRoyDerivedUseSuccessorInput
) {
  const originalRights = aflTradeSourceRightsProposalSchema.parse(input.sourceRights);
  const originalProposal = aflTradeGateDecisionProposalSchema.parse(input.proposal);
  const originalDecision = aflTradeGateDecisionRecordSchema.parse(input.decision);
  const candidate = candidateSchema.parse(input.methodUseCandidate);
  const approval = z.object({
    decision: z.literal('approved'),
    approvedBy: z.literal('statly-product-owner'),
    approvedAt: z.iso.datetime({ offset: true }),
    ownerAuthorization: z.object({ approvedUses: z.array(z.string()) }).passthrough(),
  }).passthrough().parse(JSON.parse(Buffer.from(input.ownerApprovalBytes).toString('utf8')));
  const original = originalDecision.content;
  const proposed = originalProposal.content;
  const effective = Date.parse(input.effectiveAt);
  const capture = candidate.content.captureUses.find((use) => use.captureId === input.captureId);
  const originalOperations = proposed.scope.dimensions.find(({ name }) => name === 'operation')?.values;
  if (
    !Number.isFinite(effective) || original.effectiveAt === null ||
    effective <= Date.parse(original.effectiveAt) ||
    effective >= Date.parse(original.revalidateAt ?? '') ||
    effective < Date.parse(originalRights.content.termsEffectiveAt ?? '') ||
    effective >= Date.parse(originalRights.content.termsExpireAt ?? '') ||
    effective < Date.parse(approval.approvedAt) ||
    candidate.methodUseId !== createAflTradeContentAddress('cameron-2020-hpn-method-use', candidate.content) ||
    createHash('sha256').update(input.ownerApprovalBytes).digest('hex') !== candidate.content.ownerApprovalSha256 ||
    !approval.ownerAuthorization.approvedUses.includes('valuation and grading') ||
    !approval.ownerAuthorization.approvedUses.includes('retained source evidence as a basis for other documented methods') ||
    new Set(candidate.content.captureUses.map((use) => use.captureId)).size !== 2 ||
    capture === undefined || capture.originalGateDecisionId !== originalDecision.decisionId ||
    capture.originalRightsArtifactId !== originalRights.rightsArtifactId ||
    new Set(capture.sourceFields).size !== capture.sourceFields.length ||
    canonicalizeAflTradeJson(capture.sourceFields) !== canonicalizeAflTradeJson([...capture.sourceFields].sort()) ||
    capture.sourceFields.some((field) =>
      originalRights.content.fields.find((item) => item.sourceField === field)?.uses.archive_fact !== 'allowed') ||
    originalRights.content.operations.derived_feature_creation !== 'blocked' ||
    originalRights.content.operations.raw_evidence_retention !== 'allowed' ||
    originalRights.content.operations.metadata_hash_retention !== 'allowed' ||
    originalRights.content.operations.internal_quality_evaluation !== 'allowed' ||
    originalRights.content.acquisition.kind !== 'fitzroy' ||
    originalRights.content.scope.competitions.join(',') !== 'AFLM' ||
    !originalRights.content.scope.seasonRanges.some((range) => range.from <= 2020 && range.to >= 2020) ||
    original.environment !== 'non_production' || original.gate !== 'gate_0a_permission_to_evaluate' ||
    original.state !== 'approved' || original.proposalId !== originalProposal.proposalId ||
    input.accountableOwner !== approval.approvedBy ||
    proposed.accountableOwner !== original.accountableOwner ||
    original.accountableOwner !== input.accountableOwner ||
    original.decisionKey !== proposed.decisionKey || original.version !== proposed.version ||
    proposed.environment !== original.environment || proposed.gate !== original.gate ||
    canonicalizeAflTradeJson(proposed.scope) !== canonicalizeAflTradeJson(original.scope) ||
    canonicalizeAflTradeJson(proposed.affectedArtifacts) !== canonicalizeAflTradeJson(original.affectedArtifacts) ||
    !proposed.scope.dimensions.some(({ name, values }) =>
      name === 'source_rights_artifact' && values.length === 1 && values[0] === originalRights.rightsArtifactId) ||
    !proposed.scope.dimensions.some(({ name, values }) => name === 'season' && values.includes('2020')) ||
    !proposed.scope.dimensions.some(({ name, values }) =>
      name === 'fitzroy_capability' && values.includes(capture.capabilityId)) ||
    !originalRights.content.acquisition.capabilities.some((item) =>
      item.capabilityId === capture.capabilityId) ||
    originalOperations?.includes('derived_feature_creation') ||
    proposed.scope.dimensions.some(({ name }) => name.startsWith('retained_') || name.startsWith('original_')) ||
    proposed.conditions.length !== original.conditionResults.length ||
    proposed.conditions.some((condition) => !original.conditionResults.some((result) =>
      result.conditionId === condition.conditionId && (!condition.required || result.status === 'satisfied')))
  ) throw new TypeError('Exact retained 2020 derived-use successor authority is unavailable.');

  const expiry = new Date(effective + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (Date.parse(expiry) > Date.parse(originalRights.content.termsExpireAt ?? '')) {
    throw new TypeError('Retained derived use cannot outlive the original source terms.');
  }
  const selectedFields = new Set(capture.sourceFields);
  const allowedPrivateOperations = new Set([
    'raw_evidence_retention', 'metadata_hash_retention', 'internal_quality_evaluation',
    'derived_feature_creation',
  ]);
  const rightsContent = {
    ...originalRights.content,
    operations: Object.fromEntries(AFL_TRADE_SOURCE_OPERATIONS.map((operation) => [
      operation, allowedPrivateOperations.has(operation) ? 'allowed' : 'blocked',
    ])),
    fields: originalRights.content.fields.map((field) => ({
      ...field,
      uses: { ...field.uses, derived_feature: selectedFields.has(field.sourceField) ? 'allowed' : 'blocked',
        model_training: 'blocked', public_display: 'blocked' },
    })),
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
    termsEffectiveAt: input.effectiveAt,
    termsExpireAt: expiry,
    proposedAt: input.effectiveAt,
    proposedBy: input.accountableOwner,
    proposalOrigin: 'agent_assisted' as const,
    rightsEvidenceIds: [...new Set([
      ...originalRights.content.rightsEvidenceIds,
      `artifact:${candidate.content.ownerApprovalSha256}`,
    ])],
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const scope = {
    ...proposed.scope,
    description: 'Thirty-day private derived use of one exact retained 2020 capture and method; no new capture or public use.',
    dimensions: [
      ...proposed.scope.dimensions.map((dimension) => {
        if (dimension.name === 'source_rights_artifact') return { ...dimension, values: [sourceRights.rightsArtifactId] };
        if (dimension.name === 'operation') return { ...dimension, values: AFL_TRADE_SOURCE_OPERATIONS.filter(
          (operation) => sourceRights.content.operations[operation] === 'allowed') };
        return dimension;
      }),
      { name: 'retained_source_capture', values: [input.captureId] },
      { name: 'original_gate_decision', values: [originalDecision.decisionId] },
      { name: 'original_source_rights_artifact', values: [originalRights.rightsArtifactId] },
      { name: 'retained_method_use', values: [candidate.methodUseId] },
      { name: 'hpn_pav_method', values: [candidate.content.hpnPavMethodId] },
      { name: 'owner_approval_sha256', values: [candidate.content.ownerApprovalSha256] },
    ],
  };
  const proposalContent = {
    ...proposed,
    version: proposed.version + 1,
    scope,
    proposal: 'Permit only the documented 2020 HPN private derived calculation on this retained capture for thirty days.',
    accountableOwner: input.accountableOwner,
    requiredReviewerRoles: [input.reviewer.role],
    evidenceIds: [...new Set([
      ...proposed.evidenceIds, `artifact:${candidate.content.ownerApprovalSha256}`,
      input.reviewer.evidenceId,
    ])],
    affectedArtifacts: [{ kind: 'source_rights' as const, artifactId: sourceRights.rightsArtifactId }],
    proposedAt: input.effectiveAt,
    proposedBy: input.accountableOwner,
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    ...original,
    proposalId: proposal.proposalId,
    version: proposal.content.version,
    scope,
    accountableOwner: input.accountableOwner,
    decidedBy: input.accountableOwner,
    reviewers: [{ reviewerId: input.reviewer.id, role: input.reviewer.role,
      evidenceId: input.reviewer.evidenceId }],
    authorityEvidenceIds: [`artifact:${candidate.content.ownerApprovalSha256}`],
    rationale: 'Owner-authorized exact private derived use of retained evidence; no external licence is asserted.',
    limitations: [...original.limitations,
      'Only the exact 2020 capture, documented HPN method and source fields; no training, public or raw redistribution.'],
    decidedAt: input.effectiveAt,
    effectiveAt: input.effectiveAt,
    revalidateAt: expiry,
    supersedesDecisionId: originalDecision.decisionId,
    affectedArtifacts: proposal.content.affectedArtifacts,
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { sourceRights, proposal, decision };
}
