import { describe, expect, it, vi } from 'vitest';

import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import {
  recordAflTradeExternalCanonicalPromotionReview,
  type AflTradeExternalCanonicalPromotionReviewRepository,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewService';

const batchId = `external-evidence-batch:${'b'.repeat(64)}`;
const evidenceId = `external-evidence:${'e'.repeat(64)}`;
const pickId = `draft-pick:${'d'.repeat(64)}`;
const selectionId = `external-draft-selection:${'f'.repeat(64)}`;

function candidate(reconciledAt = '2026-08-09T07:30:00.000Z') {
  return createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [batchId],
    identityResolutionIds: [],
    transactions: [],
    transfers: [],
    draftSelections: [
      {
        selectionId,
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 14,
        roundNumber: 1,
        pickId,
        playerId: 'player-harry-kyle',
        clubId: 'club-western-bulldogs',
        status: 'single_source',
        supportingProviders: ['draftguru'],
        evidenceIds: [evidenceId],
      },
    ],
    pickCustody: [],
    pickLineage: [],
    issues: [],
    reconciledAt,
    publicationEligible: false,
  });
}

function repository(
  current: Awaited<
    ReturnType<AflTradeExternalCanonicalPromotionReviewRepository['loadCurrentDecision']>
  > = null
) {
  return {
    loadCandidate: vi.fn(async () => candidate()),
    loadCurrentDecision: vi.fn(async () => current),
    persistDecision: vi.fn(async ({ decision }) => ({
      candidateId: decision.content.candidateId,
      proposalId: decision.content.proposalId,
      decisionId: decision.decisionId,
      revision: decision.content.revision,
      status: decision.content.decision,
      idempotentReplay: false,
    })),
  } satisfies AflTradeExternalCanonicalPromotionReviewRepository;
}

const input = {
  candidateId: candidate().candidateId,
  proposedAt: '2026-08-09T07:31:00.000Z',
  draftEvents: [
    {
      draftYear: 2025,
      draftType: 'national',
      eventDate: '2025-11-19',
      officialName: '2025 AFL National Draft',
    },
  ],
  decision: 'approved' as const,
  rationale: 'Candidate is complete and ready for canonical promotion.',
  authorityEvidenceId: `reviewer-authority-evidence:${'a'.repeat(64)}`,
  decidedBy: 'operator:canonical-promoter',
  decidedAt: '2026-08-09T07:32:00.000Z',
};

describe('external canonical promotion review service', () => {
  it('derives the proposal and first decision before persistence', async () => {
    const target = repository();
    const result = await recordAflTradeExternalCanonicalPromotionReview(input, target);

    expect(result.revision).toBe(1);
    expect(target.persistDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({ candidateId: input.candidateId }),
        decision: expect.objectContaining({
          content: expect.objectContaining({
            candidateId: input.candidateId,
            revision: 1,
            supersedesDecisionId: null,
          }),
        }),
      })
    );
  });

  it('derives the exact successor revision and predecessor from the current head', async () => {
    const firstRepository = repository();
    await recordAflTradeExternalCanonicalPromotionReview(input, firstRepository);
    const first = firstRepository.persistDecision.mock.calls[0]![0].decision;
    const successorRepository = repository(first);

    await recordAflTradeExternalCanonicalPromotionReview(
      { ...input, decision: 'withdrawn', decidedAt: '2026-08-09T07:33:00.000Z' },
      successorRepository
    );

    expect(successorRepository.persistDecision.mock.calls[0]![0].decision.content).toMatchObject({
      revision: 2,
      supersedesDecisionId: first.decisionId,
      decision: 'withdrawn',
    });
  });

  it('rejects a repository candidate substitution', async () => {
    const target = repository();
    target.loadCandidate.mockResolvedValueOnce(candidate('2026-08-09T07:30:01.000Z'));

    await expect(recordAflTradeExternalCanonicalPromotionReview(input, target)).rejects.toThrow(
      /requested candidate/i
    );
    expect(target.persistDecision).not.toHaveBeenCalled();
  });

  it('rejects a generic governed-evidence reference before loading the candidate', async () => {
    const target = repository();

    await expect(
      recordAflTradeExternalCanonicalPromotionReview(
        { ...input, authorityEvidenceId: `governed-evidence:${'a'.repeat(64)}` },
        target
      )
    ).rejects.toThrow();
    expect(target.loadCandidate).not.toHaveBeenCalled();
  });
});
