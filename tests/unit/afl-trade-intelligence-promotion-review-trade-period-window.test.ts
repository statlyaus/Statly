import { describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import {
  recordAflTradeExternalCanonicalPromotionReview,
  type AflTradeExternalCanonicalPromotionReviewRepository,
  type AflTradeReviewedTradePeriodWindow,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewService';

const evidenceId = `external-evidence:${'e'.repeat(64)}`;
const batchId = `external-evidence-batch:${'b'.repeat(64)}`;
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
const lineageId = createAflTradeContentAddress('external-pick-lineage', { transferId, selectionId });
const tradeWindow = {
  precision: 'window' as const,
  eventDate: null,
  earliestDate: '2025-10-06',
  latestDate: '2025-10-15',
};

// One undated 2025 trade (the source states the year only) with its pick resolved to a selection.
function candidate(occurredOn: string | null = null) {
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
        occurredOn,
        transactionType: 'trade',
        title: 'GWS and Western Bulldogs exchange picks',
        parties: ['club-gws', 'club-western-bulldogs'],
        transferIds: [transferId],
        status: 'single_source',
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
      { lineageId, pickId, transferId, selectionId, status: 'corroborated', evidenceIds: [evidenceId] },
    ],
    issues: [],
    reconciledAt: '2026-08-09T07:30:00.000Z',
    publicationEligible: false,
  });
}

function repository(
  windows: readonly AflTradeReviewedTradePeriodWindow[],
  source = candidate()
) {
  return {
    loadCandidate: vi.fn(async () => source),
    loadCurrentDecision: vi.fn(async () => null),
    loadReviewedTradePeriodWindows: vi.fn(async () => windows),
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

const input = (source = candidate()) => ({
  candidateId: source.candidateId,
  proposedAt: '2026-08-09T07:31:00.000Z',
  draftEvents: [
    {
      draftYear: 2025,
      draftType: 'national',
      eventDate: '2025-11-19',
      officialName: '2025 AFL National Draft',
    },
  ],
  transactionDates: [{ transactionId, occurredOn: null }],
  decision: 'approved' as const,
  rationale: 'Candidate is complete and ready for canonical promotion.',
  authorityEvidenceId: `reviewer-authority-evidence:${'a'.repeat(64)}`,
  decidedBy: 'operator:canonical-promoter',
  decidedAt: '2026-08-09T07:32:00.000Z',
});

// The review command takes a trade's window from the reviewed captures, never from the operator.
describe('promotion review and the reviewed trade-period window (issue 869)', () => {
  it('attaches the season window on record to an undated transaction', async () => {
    const target = repository([{ seasonYear: 2025, datePrecision: tradeWindow }]);
    await recordAflTradeExternalCanonicalPromotionReview(input(), target);
    expect(target.loadReviewedTradePeriodWindows).toHaveBeenCalledWith({
      environment: 'test_fixture',
      competition: 'AFLM',
      seasons: [2025],
    });
    const { proposal } = target.persistDecision.mock.calls[0]![0];
    expect(proposal.content.transactionDateCoverage).toEqual([
      { transactionId, seasonYear: 2025, occurredOn: null, datePrecision: tradeWindow },
    ]);
  });

  it('keeps year-only precision when no window is on record', async () => {
    const target = repository([]);
    await recordAflTradeExternalCanonicalPromotionReview(input(), target);
    const { proposal } = target.persistDecision.mock.calls[0]![0];
    expect(proposal.content.transactionDateCoverage).toEqual([
      { transactionId, seasonYear: 2025, occurredOn: null },
    ]);
  });

  it('never reads windows for a candidate whose transactions all state a day', async () => {
    const dated = candidate('2025-10-15');
    const target = repository([{ seasonYear: 2025, datePrecision: tradeWindow }], dated);
    await recordAflTradeExternalCanonicalPromotionReview(
      { ...input(dated), transactionDates: [{ transactionId, occurredOn: '2025-10-15' }] },
      target
    );
    expect(target.loadReviewedTradePeriodWindows).not.toHaveBeenCalled();
    const { proposal } = target.persistDecision.mock.calls[0]![0];
    expect(proposal.content.transactionDateCoverage).toEqual([
      { transactionId, seasonYear: 2025, occurredOn: '2025-10-15' },
    ]);
  });

  it('refuses an operator-typed window and a repository that returns two windows for one season', async () => {
    const target = repository([{ seasonYear: 2025, datePrecision: tradeWindow }]);
    await expect(
      recordAflTradeExternalCanonicalPromotionReview(
        {
          ...input(),
          transactionDates: [{ transactionId, occurredOn: null, datePrecision: tradeWindow }],
        } as never,
        target
      )
    ).rejects.toThrow();
    expect(target.persistDecision).not.toHaveBeenCalled();
    const doubled = repository([
      { seasonYear: 2025, datePrecision: tradeWindow },
      { seasonYear: 2025, datePrecision: { ...tradeWindow, latestDate: '2025-10-16' } },
    ]);
    await expect(recordAflTradeExternalCanonicalPromotionReview(input(), doubled)).rejects.toThrow(
      'more than one reviewed trade-period window'
    );
    const stray = repository([{ seasonYear: 2024, datePrecision: { ...tradeWindow, earliestDate: '2024-10-07', latestDate: '2024-10-16' } }]);
    await expect(recordAflTradeExternalCanonicalPromotionReview(input(), stray)).rejects.toThrow(
      'unrequested season'
    );
  });
});
