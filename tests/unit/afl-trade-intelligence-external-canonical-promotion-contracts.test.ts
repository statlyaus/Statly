import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import {
  AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
  authenticateAflTradeExternalCanonicalPromotionProposal,
  createAflTradeExternalCanonicalPromotionProposal,
  createAflTradeExternalCanonicalPromotionRequest,
  deriveAflTradeExternalCanonicalPromotionProposal,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';

const evidenceId = `external-evidence:${'e'.repeat(64)}`;
const batchId = `external-evidence-batch:${'b'.repeat(64)}`;
const reviewDecisionId = `review-decision:${'a'.repeat(64)}`;
const transactionId = createAflTradeContentAddress('external-transaction', {
  provider: 'draftguru',
  nativeEventId: '2025-gws-bulldogs',
});
const transferId = createAflTradeContentAddress('external-transfer', {
  transactionId,
  nativeTransferId: 'pick-14',
});
const pickId = createAflTradeContentAddress('draft-pick', {
  draftYear: 2025,
  draftType: 'national',
  nominalPick: 14,
  nominalRound: 1,
});
const selectionId = createAflTradeContentAddress('external-draft-selection', {
  draftYear: 2025,
  draftType: 'national',
  selectionNumber: 14,
});
const custodyId = createAflTradeContentAddress('external-pick-custody', { evidenceId });
const lineageId = createAflTradeContentAddress('external-pick-lineage', {
  transferId,
  selectionId,
});

function candidate(overrides?: {
  issues?: 'blocking';
  transactionStatus?: 'disputed';
  undated?: boolean;
}) {
  return createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [batchId],
    identityResolutionIds: [],
    transactions: [
      {
        transactionId,
        providerEventId: '2025-gws-bulldogs',
        seasonYear: 2025,
        occurredOn: overrides?.undated ? null : '2025-10-15',
        transactionType: 'trade',
        title: 'GWS and Western Bulldogs exchange picks',
        parties: ['club-gws', 'club-western-bulldogs'],
        transferIds: [transferId],
        status: overrides?.transactionStatus ?? 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    transfers: [
      {
        transferId,
        transactionId,
        fromClubId: 'club-gws',
        toClubId: 'club-western-bulldogs',
        asset: {
          kind: 'pick_entitlement',
          pickId,
          draftYear: 2025,
          draftType: 'national',
          nominalRound: 1,
          nominalPick: 14,
          originalClubId: 'club-gws',
          recordedLabel: 'Pick 14',
        },
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
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
        status: 'corroborated',
        supportingProviders: ['draftguru', 'footywire'],
        evidenceIds: [evidenceId],
      },
    ],
    pickCustody: [
      {
        custodyId,
        pickId,
        observedAt: '2025-11-01T00:00:00.000Z',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 14,
        originalClubId: 'club-gws',
        currentClubId: 'club-western-bulldogs',
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    pickLineage: [
      {
        lineageId,
        pickId,
        transferId,
        selectionId,
        status: 'corroborated',
        evidenceIds: [evidenceId],
      },
    ],
    issues:
      overrides?.issues === 'blocking'
        ? [
            {
              code: 'transaction_incomplete',
              severity: 'blocking',
              subjectKey: transactionId,
              detail: 'The transaction is incomplete.',
              evidenceIds: [evidenceId],
            },
          ]
        : [],
    reconciledAt: '2026-08-09T07:30:00.000Z',
    publicationEligible: false,
  });
}

function proposal(selectionIds: string[] = [selectionId], source = candidate()) {
  return createAflTradeExternalCanonicalPromotionProposal({
    schemaVersion: AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
    candidateId: source.candidateId,
    candidateSha256: source.candidateId.split(':')[1],
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    draftEventCoverage: [
      {
        draftYear: 2025,
        draftType: 'national',
        eventDate: '2025-11-19',
        officialName: '2025 AFL National Draft',
        expectedSelectionCount: selectionIds.length,
        selectionIds,
        status: 'complete',
      },
    ],
    transactionDateCoverage: [{ transactionId, seasonYear: 2025, occurredOn: '2025-10-15' }],
    proposedAt: '2026-08-09T07:31:00.000Z',
    publicationEligible: false,
  });
}

describe('external canonical promotion contracts', () => {
  it('derives scope, counts and exact selection membership from the candidate', () => {
    const source = candidate();
    const derived = deriveAflTradeExternalCanonicalPromotionProposal({
      candidate: source,
      proposedAt: '2026-08-09T07:31:00.000Z',
      draftEvents: [
        {
          draftYear: 2025,
          draftType: 'national',
          eventDate: '2025-11-19',
          officialName: '2025 AFL National Draft',
        },
      ],
    });

    expect(derived).toEqual(proposal());
    expect(derived.content.draftEventCoverage[0]).toMatchObject({
      expectedSelectionCount: 1,
      selectionIds: [selectionId],
      status: 'complete',
    });
  });

  it('rejects missing, duplicate or unrelated draft-event metadata', () => {
    const source = candidate();
    const base = {
      candidate: source,
      proposedAt: '2026-08-09T07:31:00.000Z',
    } as const;
    const event = {
      draftYear: 2025,
      draftType: 'national',
      eventDate: '2025-11-19',
      officialName: '2025 AFL National Draft',
    } as const;

    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({ ...base, draftEvents: [] })
    ).toThrow(/exactly match/i);
    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({
        ...base,
        draftEvents: [event, event],
      })
    ).toThrow(/unique/i);
    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({
        ...base,
        draftEvents: [{ ...event, draftYear: 2024 }],
      })
    ).toThrow(/exactly match/i);
  });

  it('requires reviewed exact transaction dates when source evidence has no occurrence date', () => {
    const source = candidate({ undated: true });
    const base = {
      candidate: source,
      proposedAt: '2026-08-09T07:31:00.000Z',
      draftEvents: [
        {
          draftYear: 2025,
          draftType: 'national',
          eventDate: '2025-11-19',
          officialName: '2025 AFL National Draft',
        },
      ],
    } as const;

    expect(() => deriveAflTradeExternalCanonicalPromotionProposal(base)).toThrow(
      /transaction date/i
    );
    const derived = deriveAflTradeExternalCanonicalPromotionProposal({
      ...base,
      transactionDates: [{ transactionId, occurredOn: '2025-10-15' }],
    });
    expect(derived.content.transactionDateCoverage).toEqual([
      { transactionId, seasonYear: 2025, occurredOn: '2025-10-15' },
    ]);
    expect(
      authenticateAflTradeExternalCanonicalPromotionProposal({
        candidate: source,
        proposal: derived,
      })
    ).toMatchObject({ candidateId: source.candidateId });
  });

  it('rejects reviewed dates outside the transaction season or after proposal time', () => {
    const source = candidate({ undated: true });
    const base = {
      candidate: source,
      proposedAt: '2026-08-09T07:31:00.000Z',
      draftEvents: [
        {
          draftYear: 2025,
          draftType: 'national',
          eventDate: '2025-11-19',
          officialName: '2025 AFL National Draft',
        },
      ],
    } as const;

    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({
        ...base,
        transactionDates: [{ transactionId, occurredOn: '2024-10-15' }],
      })
    ).toThrow(/transaction season/i);
    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({
        ...base,
        transactionDates: [{ transactionId, occurredOn: '2099-01-01' }],
      })
    ).toThrow(/transaction season|postdate/i);
  });

  it('authenticates an issue-free candidate with exact complete draft-event coverage', () => {
    const source = candidate();
    const promotion = proposal();

    expect(
      authenticateAflTradeExternalCanonicalPromotionProposal({
        candidate: source,
        proposal: promotion,
      })
    ).toEqual({
      candidateId: source.candidateId,
      proposalId: promotion.proposalId,
      transactionCount: 1,
      transferCount: 1,
      draftSelectionCount: 1,
      pickCustodyCount: 1,
      pickRealizationCount: 1,
    });
  });

  it('rejects incomplete or substituted draft-event coverage', () => {
    expect(() =>
      authenticateAflTradeExternalCanonicalPromotionProposal({
        candidate: candidate(),
        proposal: proposal([]),
      })
    ).toThrow(/exact candidate selection set/i);
  });

  it('rejects blocking issues and disputed factual records', () => {
    const issueCandidate = candidate({ issues: 'blocking' });
    expect(() =>
      authenticateAflTradeExternalCanonicalPromotionProposal({
        candidate: issueCandidate,
        proposal: proposal([selectionId], issueCandidate),
      })
    ).toThrow(/blocking issue/i);
    const disputedCandidate = candidate({ transactionStatus: 'disputed' });
    expect(() =>
      authenticateAflTradeExternalCanonicalPromotionProposal({
        candidate: disputedCandidate,
        proposal: proposal([selectionId], disputedCandidate),
      })
    ).toThrow(/usable/i);
  });

  it('content-addresses the same approved request deterministically', () => {
    const first = createAflTradeExternalCanonicalPromotionRequest({
      candidateId: candidate().candidateId,
      proposalId: proposal().proposalId,
      approvalDecisionId: reviewDecisionId,
    });
    const second = createAflTradeExternalCanonicalPromotionRequest({
      candidateId: candidate().candidateId,
      proposalId: proposal().proposalId,
      approvalDecisionId: reviewDecisionId,
    });

    expect(second).toEqual(first);
    expect(first.promotionId).toMatch(/^external-canonical-promotion:[a-f0-9]{64}$/);
  });
});
