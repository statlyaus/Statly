import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateCode,
  type AflTradeGovernedArtifactRef,
} from '../governance/gateDecisionTypes';
import { createAflDraftTradeOutcomeActivationAuthorization } from '../outcomes/outcomeReleaseContracts';
import { aflTradeExternalCanonicalPromotionProposalSchema } from '../source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '../source/externalCanonicalPromotionReviewContracts';

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));

const promotionInputSchema = z
  .object({
    proposal: aflTradeExternalCanonicalPromotionProposalSchema,
    competition: z.string().trim().min(1).max(40),
    validFromSeason: z.number().int().min(1897).max(2200),
    validThroughSeason: z.number().int().min(1897).max(2200),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.validThroughSeason < input.validFromSeason) {
      context.addIssue({ code: 'custom', message: 'Authority season range is invalid.' });
    }
  });

const publicationInputSchema = z
  .object({
    scopeKey: z.string().trim().min(1).max(1_000),
    competition: z.string().trim().min(1).max(40),
    validFromSeason: z.number().int().min(1897).max(2200),
    validThroughSeason: z.number().int().min(1897).max(2200),
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    lineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    projectionId: aflTradeContentAddressedIdSchema('outcome-projection'),
    parityReportArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    expectedActivationRegistryRevision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.validThroughSeason < input.validFromSeason) {
      context.addIssue({ code: 'custom', message: 'Authority season range is invalid.' });
    }
  });

const inputSchema = promotionInputSchema.safeExtend(publicationInputSchema.shape).strict();

type GateBundle = {
  proposal: z.infer<typeof aflTradeGateDecisionProposalSchema>;
  decision: z.infer<typeof aflTradeGateDecisionRecordSchema>;
  ledger: AflTradeGateDecisionLedger;
};

function gateDecision(input: {
  gate: AflTradeGateCode;
  decisionKey: string;
  scopeKey: string;
  dimensions: readonly { readonly name: string; readonly values: readonly string[] }[];
  affectedArtifacts: readonly AflTradeGovernedArtifactRef[];
  proposedAt: string;
  decidedAt: string;
}): GateBundle {
  const scope = {
    scopeKey: input.scopeKey,
    description: 'Deterministic local promotion-backed AFL factual authority.',
    dimensions: [...input.dimensions],
    exclusions: ['Production authority', 'Valuation', 'Grading', 'Fantasy ownership'],
  };
  const evidenceId = createAflTradeContentAddress('artifact', {
    fixture: true,
    gate: input.gate,
    decisionKey: input.decisionKey,
  });
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: input.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    proposal: 'Approve this exact deterministic local fixture lineage only.',
    alternativesConsidered: ['Keep the local factual archive inactive.'],
    accountableOwner: 'local-fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [evidenceId],
    affectedArtifacts: [...input.affectedArtifacts],
    proposedAt: instantSchema.parse(input.proposedAt),
    proposedBy: 'local-fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: input.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: 'local-fixture-owner',
    decidedBy: 'local-fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [evidenceId],
    conditionResults: [],
    rationale: 'The deterministic fixture satisfies this exact local gate.',
    limitations: ['No production, valuation, grading, or fantasy authority.'],
    decidedAt: instantSchema.parse(input.decidedAt),
    effectiveAt: instantSchema.parse(input.decidedAt),
    revalidateAt: '2027-08-10T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: [...input.affectedArtifacts],
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision, ledger: { proposals: [proposal], decisions: [decision] } };
}

export function createLocalAflTradeCanonicalPromotionAuthority(unparsedInput: unknown) {
  const input = promotionInputSchema.parse(unparsedInput);
  const principalRef = 'operator:local-external-canonical-promotion';
  const authorityPayload = {
    evidenceKind: 'reviewer_authority_evidence',
    environment: 'test_fixture',
    principalRef,
    role: 'afl_trade_canonical_promoter',
    scopeKey: 'public-afl-draft-trade-outcomes',
    provider: 'multi_source',
    capabilityId: 'external_candidate_promotion',
    competition: input.competition,
    validFromSeason: input.validFromSeason,
    validThroughSeason: input.validThroughSeason,
  };
  const authorityId = createAflTradeContentAddress('reviewer-authority-evidence', authorityPayload);
  const authoritySha256 = sha256AflTradeCanonicalJson(authorityPayload);
  return {
    principalRef,
    authorityPayload,
    authorityId,
    authoritySha256,
    authorityArtifactId: `artifact:${authoritySha256}`,
    authorityApprovalId: createAflTradeContentAddress('governed-evidence-approval-decision', {
      authorityId,
    }),
    decision: createAflTradeExternalCanonicalPromotionReviewDecision({
      candidateId: input.proposal.content.candidateId,
      proposalId: input.proposal.proposalId,
      proposalSha256: input.proposal.proposalId.split(':')[1] ?? '',
      proposal: input.proposal,
      revision: 1,
      supersedesDecisionId: null,
      decision: 'approved',
      rationale: 'Promote the exact issue-free deterministic local candidate.',
      authorityEvidenceId: authorityId,
      decidedBy: principalRef,
      decidedAt: '2026-08-09T09:00:03.000Z',
    }),
  };
}

export function createLocalAflTradePromotionBackedPublicationAuthority(unparsedInput: unknown) {
  const input = publicationInputSchema.parse(unparsedInput);
  const gate2 = gateDecision({
    gate: 'gate_2_corpus_lineage',
    decisionKey: `gate2:${input.lineageId}`,
    scopeKey: input.scopeKey,
    dimensions: [
      { name: 'competition', values: [input.competition] },
      { name: 'valid_from_season', values: [String(input.validFromSeason)] },
      { name: 'valid_through_season', values: [String(input.validThroughSeason)] },
    ],
    affectedArtifacts: [
      { kind: 'corpus_manifest', artifactId: input.corpusId },
      { kind: 'factual_release', artifactId: input.releaseId },
      { kind: 'factual_release_candidate', artifactId: input.factualCandidateId },
      { kind: 'corpus_factual_lineage', artifactId: input.lineageId },
    ],
    proposedAt: '2026-08-09T09:00:08.000Z',
    decidedAt: '2026-08-09T09:00:09.000Z',
  });
  const publicationArtifacts: AflTradeGovernedArtifactRef[] = [
    { kind: 'factual_release', artifactId: input.releaseId },
    { kind: 'factual_projection', artifactId: input.projectionId },
  ];
  const review = gateDecision({
    gate: 'gate_4_publication_api_readiness',
    decisionKey: `local-factual-review:${input.releaseId}`,
    scopeKey: input.scopeKey,
    dimensions: [{ name: 'environment', values: ['test_fixture'] }],
    affectedArtifacts: publicationArtifacts,
    proposedAt: '2026-08-09T09:00:10.000Z',
    decidedAt: '2026-08-09T09:00:11.000Z',
  });
  const operation = gateDecision({
    gate: 'gate_5_comprehension_accessibility',
    decisionKey: `local-factual-activation:${input.releaseId}`,
    scopeKey: input.scopeKey,
    dimensions: [{ name: 'environment', values: ['test_fixture'] }],
    affectedArtifacts: publicationArtifacts,
    proposedAt: '2026-08-09T09:00:12.000Z',
    decidedAt: '2026-08-09T09:00:13.000Z',
  });
  const activation = createAflDraftTradeOutcomeActivationAuthorization({
    schemaVersion: 'afl-draft-trade-outcome-activation-authorization/v1',
    environment: 'test_fixture',
    scopeKey: input.scopeKey,
    releaseId: input.releaseId,
    projectionId: input.projectionId,
    expectedRegistryRevision: input.expectedActivationRegistryRevision,
    authorizedAt: '2026-08-09T09:00:17.500Z',
    expiresAt: '2027-08-10T00:00:00.000Z',
    rollbackWindowEndsAt: '2027-08-10T00:00:00.000Z',
    writeBarrier: 'engaged',
    parityReportArtifactId: input.parityReportArtifactId,
    authorityKind: 'fixture',
    authorizedBy: 'local-fixture-owner',
    authorityEvidenceIds: [operation.decision.decisionId],
  });
  return { gate2, review, operation, activation };
}

export function createLocalAflTradePromotionBackedAuthority(unparsedInput: unknown) {
  const input = inputSchema.parse(unparsedInput);
  return {
    promotion: createLocalAflTradeCanonicalPromotionAuthority({
      proposal: input.proposal,
      competition: input.competition,
      validFromSeason: input.validFromSeason,
      validThroughSeason: input.validThroughSeason,
    }),
    ...createLocalAflTradePromotionBackedPublicationAuthority({
      scopeKey: input.scopeKey,
      competition: input.competition,
      validFromSeason: input.validFromSeason,
      validThroughSeason: input.validThroughSeason,
      corpusId: input.corpusId,
      factualCandidateId: input.factualCandidateId,
      lineageId: input.lineageId,
      releaseId: input.releaseId,
      projectionId: input.projectionId,
      parityReportArtifactId: input.parityReportArtifactId,
      expectedActivationRegistryRevision: input.expectedActivationRegistryRevision,
    }),
  };
}
