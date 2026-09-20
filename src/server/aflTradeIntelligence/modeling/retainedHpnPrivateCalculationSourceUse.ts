import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import type {
  AflTradeGateDecisionProposal,
  AflTradeGateDecisionRecord,
} from '../governance/gateDecisionTypes';
import {
  aflTradeHpnSourceFirstCalculationSourceUseAssessmentSchema,
  type AflTradeHpnSourceFirstCalculationSourceUseAssessment,
} from './hpnPrivateCalculationSourceUse';
import { createRetainedFitzRoyDerivedUseSuccessor } from '../source/retainedFitzRoyDerivedUseSuccessor';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from '../source/sourceRights';

type Source = AflTradeHpnSourceFirstCalculationSourceUseAssessment['content']['source'];

/** Assessment of the exact retained 2020 private successor; database authority is rechecked later. */
export function assessRetainedCameron2020HpnPrivateCalculationSourceUse(input: {
  original: {
    sourceRights: AflTradeSourceRightsProposal;
    proposal: AflTradeGateDecisionProposal;
    decision: AflTradeGateDecisionRecord;
  };
  originalRightsArtifact: AflTradeArtifactRef;
  successor: ReturnType<typeof createRetainedFitzRoyDerivedUseSuccessor>;
  methodUseCandidate: unknown;
  ownerApprovalBytes: Uint8Array;
  source: Source;
  sourceFields: readonly string[];
  evaluatedAt: string;
}): AflTradeHpnSourceFirstCalculationSourceUseAssessment {
  const originalRights = aflTradeSourceRightsProposalSchema.parse(input.original.sourceRights);
  const successorDecision = input.successor.decision.content;
  const reviewer = successorDecision.reviewers[0];
  if (
    successorDecision.effectiveAt === null ||
    successorDecision.reviewers.length !== 1 ||
    reviewer === undefined ||
    !doesAflTradeArtifactRefMatchCanonicalJson(input.originalRightsArtifact, originalRights)
  )
    throw new TypeError('Retained HPN source-use successor evidence is incomplete.');
  const rebuilt = createRetainedFitzRoyDerivedUseSuccessor({
    ...input.original,
    methodUseCandidate: input.methodUseCandidate,
    ownerApprovalBytes: input.ownerApprovalBytes,
    captureId: input.source.captureId,
    effectiveAt: successorDecision.effectiveAt,
    accountableOwner: successorDecision.accountableOwner,
    reviewer: { id: reviewer.reviewerId, role: reviewer.role, evidenceId: reviewer.evidenceId },
  });
  if (
    canonicalizeAflTradeJson(rebuilt) !== canonicalizeAflTradeJson(input.successor) ||
    input.source.gateDecisionId !== input.original.decision.decisionId ||
    input.source.gateProposalId !== input.original.proposal.proposalId ||
    input.source.gateDecisionKey !== input.original.decision.content.decisionKey ||
    Date.parse(input.evaluatedAt) < Date.parse(successorDecision.effectiveAt) ||
    Date.parse(input.evaluatedAt) >= Date.parse(successorDecision.revalidateAt ?? '') ||
    !Number.isFinite(Date.parse(input.evaluatedAt))
  )
    throw new TypeError('Retained HPN source-use successor is not current for this capture.');
  const fields = [...input.sourceFields].sort((left, right) => left.localeCompare(right));
  const enabled = rebuilt.sourceRights.content.fields
    .filter((field) => field.uses.derived_feature === 'allowed')
    .map((field) => field.sourceField)
    .sort((left, right) => left.localeCompare(right));
  if (
    fields.length === 0 ||
    new Set(fields).size !== fields.length ||
    canonicalizeAflTradeJson(fields) !== canonicalizeAflTradeJson(enabled) ||
    rebuilt.sourceRights.content.operations.derived_feature_creation !== 'allowed' ||
    rebuilt.sourceRights.content.operations.model_training !== 'blocked' ||
    rebuilt.sourceRights.content.operations.public_derived_output !== 'blocked' ||
    rebuilt.sourceRights.content.operations.public_fact_display !== 'blocked'
  )
    throw new TypeError('Retained HPN assessment exceeds exact private source fields.');
  const content = {
    schemaVersion: 'afl-trade-hpn-private-source-use-assessment/v2' as const,
    environment: 'non_production' as const,
    purpose: 'private_confirmed_realized_hpn_pav' as const,
    competition: 'AFLM' as const,
    seasonYear: 2020,
    valuationScopeKey: 'cameron-2020-private-pilot',
    source: input.source,
    state: 'permitted_private_calculation' as const,
    // The assessment names the rights that actually permit these fields, matching the sibling
    // assessment's semantics. The archive-only original rights stay in evidenceRefs, because they
    // block derived-feature creation by design.
    rightsArtifactId: rebuilt.sourceRights.rightsArtifactId,
    fields: fields.map((sourceField) => ({
      sourceField,
      state: 'permitted_private_calculation' as const,
      reasons: [],
    })),
    reasons: [],
    evidenceRefs: [input.originalRightsArtifact] as const,
    evaluatedAt: input.evaluatedAt,
    publicationEligible: false as const,
    publicationProhibited: true as const,
    limitation:
      'Retained source-use assessment only; current source, field-map review, and database authority remain required. No model training or publication authority.' as const,
  };
  return aflTradeHpnSourceFirstCalculationSourceUseAssessmentSchema.parse({
    assessmentId: createAflTradeContentAddress('hpn-private-source-use-assessment', content),
    content,
  });
}
