import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import {
  parseAflTradePrivateValuationEvaluationDecision,
  type AflTradePrivateValuationEvaluationDecision,
} from './privateValuationEvaluationDecision';

export interface AflTradePrivateValuationEvaluationAuthorization {
  readonly kind: 'private_nonproduction_derived_calculation';
  readonly decisionId: string;
  readonly valuationScopeKey: string;
  readonly factualReleaseId: string;
  readonly factualReleaseArtifact: AflTradeArtifactRef;
  readonly releaseMembershipArtifact: AflTradeArtifactRef;
  readonly sourceRightsEvidenceRefs: readonly AflTradeArtifactRef[];
  readonly publicationEligible: false;
  readonly publicationProhibited: true;
}

export type AflTradePrivateValuationEvaluationAdmission =
  | {
      readonly state: 'authorized';
      readonly authority: AflTradePrivateValuationEvaluationAuthorization;
    }
  | {
      readonly state: 'blocked';
      readonly reason: 'not_authorized' | 'withdrawn';
      readonly decisionId: string | null;
    };

/**
 * Converts only an exact current decision returned by the authority repository into the narrow
 * capability consumed by private calculation preparation. This interface intentionally carries no
 * model-training or publication capability.
 */
export function createAflTradePrivateValuationEvaluationAdmission(
  currentDecision: AflTradePrivateValuationEvaluationDecision | null
): AflTradePrivateValuationEvaluationAdmission {
  if (currentDecision === null) {
    return { state: 'blocked', reason: 'not_authorized', decisionId: null };
  }
  const decision = parseAflTradePrivateValuationEvaluationDecision(currentDecision);
  if (decision.content.status === 'withdrawn') {
    return { state: 'blocked', reason: 'withdrawn', decisionId: decision.decisionId };
  }
  return {
    state: 'authorized',
    authority: {
      kind: 'private_nonproduction_derived_calculation',
      decisionId: decision.decisionId,
      valuationScopeKey: decision.content.valuationScopeKey,
      factualReleaseId: decision.content.factualReleaseId,
      factualReleaseArtifact: decision.content.factualReleaseArtifact,
      releaseMembershipArtifact: decision.content.releaseMembershipArtifact,
      sourceRightsEvidenceRefs: decision.content.sourceRightsEvidenceRefs,
      publicationEligible: false,
      publicationProhibited: true,
    },
  };
}
