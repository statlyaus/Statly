import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
  createAflTradeExternalCanonicalPromotionProposal,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import {
  createAflTradeExternalCanonicalPromotionReviewDecision,
  parseAflTradeExternalCanonicalPromotionReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';

const candidateId = `external-reconciliation:${'c'.repeat(64)}`;
const proposal = createAflTradeExternalCanonicalPromotionProposal({
  schemaVersion: AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
  candidateId,
  candidateSha256: 'c'.repeat(64),
  environment: 'test_fixture',
  competition: 'AFLM',
  anchorSeasonYear: 2025,
  draftEventCoverage: [],
  transactionDateCoverage: [],
  proposedAt: '2026-08-09T07:31:00.000Z',
  publicationEligible: false,
});

function content(overrides: Record<string, unknown> = {}) {
  return {
    candidateId,
    proposalId: proposal.proposalId,
    proposalSha256: proposal.proposalId.split(':')[1]!,
    proposal,
    revision: 1,
    supersedesDecisionId: null,
    decision: 'approved' as const,
    rationale: 'Exact candidate is complete and suitable for canonical promotion.',
    authorityEvidenceId: `reviewer-authority-evidence:${'a'.repeat(64)}`,
    decidedBy: 'operator:canonical-promoter',
    decidedAt: '2026-08-09T07:32:00.000Z',
    ...overrides,
  };
}

describe('external canonical promotion review contracts', () => {
  it('content-addresses one exact proposal review deterministically', () => {
    const first = createAflTradeExternalCanonicalPromotionReviewDecision(content());
    const second = createAflTradeExternalCanonicalPromotionReviewDecision(content());

    expect(second).toEqual(first);
    expect(parseAflTradeExternalCanonicalPromotionReviewDecision(first)).toEqual(first);
    expect(first.decisionId).toMatch(/^review-decision:[a-f0-9]{64}$/);
    expect(first.content.publicationEligible).toBe(false);
  });

  it('requires an exact proposal and a linear revision shape', () => {
    expect(() =>
      createAflTradeExternalCanonicalPromotionReviewDecision(
        content({ proposalSha256: 'd'.repeat(64) })
      )
    ).toThrow(/exact candidate proposal/i);
    expect(() =>
      createAflTradeExternalCanonicalPromotionReviewDecision(
        content({ revision: 2, supersedesDecisionId: null })
      )
    ).toThrow(/revision one/i);
  });

  it('rejects review chronology before the proposal', () => {
    expect(() =>
      createAflTradeExternalCanonicalPromotionReviewDecision(
        content({ decidedAt: '2026-08-09T07:30:00.000Z' })
      )
    ).toThrow(/cannot predate/i);
  });

  it('rejects a generic governed-evidence reference in place of reviewer authority', () => {
    expect(() =>
      createAflTradeExternalCanonicalPromotionReviewDecision(
        content({ authorityEvidenceId: `governed-evidence:${'a'.repeat(64)}` })
      )
    ).toThrow();
  });
});
