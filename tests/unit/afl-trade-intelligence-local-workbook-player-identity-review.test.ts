import { describe, expect, it } from 'vitest';

import {
  assertExactLocalWorkbookPlayerIdentityReview,
  createLocalWorkbookPlayerIdentityReview,
  parseLocalWorkbookPlayerIdentityReview,
  prepareLocalWorkbookPlayerIdentityReviews,
} from '@/server/aflTradeIntelligence/development/localWorkbookPlayerIdentityReview';

const input = {
  workbookSha256: '1'.repeat(64),
  tradeId: 'workbook-2025-c64962fd1891b951',
  assetId: 'workbook-2025-c64962fd1891b951-st-kilda-2',
  sourcePlayerName: 'Flanders',
  sourceAssetText: 'Flanders (0 games)',
  receivingClubName: 'St Kilda',
  canonicalPlayerId: 'local-afl-player:afl-tables:12824',
  recordedName: 'Sam Flanders',
  evidenceBundleId: `private-reviewed-evidence-bundle:${'2'.repeat(64)}`,
  reviewerId: 'local-workbook-player-identity-reviewer',
  rationale:
    'Approved exact private workbook asset identity after local transaction and player review.',
  reviewedAt: '2026-08-16T14:30:00.000Z',
} as const;

describe('local workbook player identity review', () => {
  it('content-addresses an exact private-only player asset decision', () => {
    const review = createLocalWorkbookPlayerIdentityReview(input);

    expect(review.decisionId).toMatch(/^local-workbook-player-identity:[a-f0-9]{64}$/);
    expect(review.content).toMatchObject({
      ...input,
      authority: 'private_local_workbook_player_identity_review',
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(parseLocalWorkbookPlayerIdentityReview(review)).toEqual(review);
  });

  it('rejects a changed asset identity or publication authority', () => {
    const review = createLocalWorkbookPlayerIdentityReview(input);

    expect(() =>
      parseLocalWorkbookPlayerIdentityReview({
        ...review,
        content: { ...review.content, canonicalPlayerId: 'local-afl-player:other' },
      })
    ).toThrow(/failed exact authentication/i);
    expect(() =>
      parseLocalWorkbookPlayerIdentityReview({
        ...review,
        content: { ...review.content, publicationEligible: true },
      })
    ).toThrow(/failed exact authentication/i);
  });

  it('rejects retained conflict rows whose rationale or review time changed', () => {
    const retained = createLocalWorkbookPlayerIdentityReview(input);
    const changedRationale = createLocalWorkbookPlayerIdentityReview({
      ...input,
      rationale: 'A different review rationale.',
    });
    const changedReviewTime = createLocalWorkbookPlayerIdentityReview({
      ...input,
      reviewedAt: '2026-08-16T14:31:00.000Z',
    });

    expect(() =>
      assertExactLocalWorkbookPlayerIdentityReview(retained, changedRationale)
    ).toThrow('retained local workbook player identity review conflicts');
    expect(() =>
      assertExactLocalWorkbookPlayerIdentityReview(retained, changedReviewTime)
    ).toThrow('retained local workbook player identity review conflicts');
  });

  it('prepares every promoted Dawson player identity from the exact reviewed membership', () => {
    const reviews = prepareLocalWorkbookPlayerIdentityReviews({
      workbookSha256: '1'.repeat(64),
      valuationScopeKey: 'afl-men:2021-trades',
      tradeId: 'workbook-2021-e7f7d1484744f855',
      tradeYear: 2021,
      tradeTitle: '2021 Trade for Jordan Dawson',
      workbookPlayerAssets: [
        {
          assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
          sourcePlayerName: 'Dawson',
          sourceAssetText: 'Jordan Dawson',
          receivingClubName: 'Adelaide',
        },
      ],
      promotedPlayerAssets: [
        {
          assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
          sourceAssetText: 'Jordan\u00a0Dawson',
          canonicalPlayerId: 'local-afl-player:afl-tables:12516',
        },
      ],
      reviewedProviderIdentities: [
        {
          canonicalPlayerId: 'local-afl-player:afl-tables:12516',
          recordedName: 'Jordan Dawson',
        },
      ],
      evidenceBundleId: `private-reviewed-evidence-bundle:${'2'.repeat(64)}`,
      reviewerId: 'local-workbook-player-identity-reviewer',
      reviewedAt: '2026-08-16T14:30:00.000Z',
    });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.content).toMatchObject({
      assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
      canonicalPlayerId: 'local-afl-player:afl-tables:12516',
      recordedName: 'Jordan Dawson',
      rationale:
        'Approved the exact Jordan Dawson identity for this pinned private workbook asset after local identity, match, and factual review.',
      publicationEligible: false,
    });
  });

  it('rejects omitted promoted player membership', () => {
    expect(() =>
      prepareLocalWorkbookPlayerIdentityReviews({
        workbookSha256: '1'.repeat(64),
        valuationScopeKey: 'afl-men:2021-trades',
        tradeId: 'workbook-2021-e7f7d1484744f855',
        tradeYear: 2021,
        tradeTitle: '2021 Trade for Jordan Dawson',
        workbookPlayerAssets: [
          {
            assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
            sourcePlayerName: 'Dawson',
            sourceAssetText: 'Jordan Dawson',
            receivingClubName: 'Adelaide',
          },
        ],
        promotedPlayerAssets: [],
        reviewedProviderIdentities: [],
        evidenceBundleId: `private-reviewed-evidence-bundle:${'2'.repeat(64)}`,
        reviewerId: 'local-workbook-player-identity-reviewer',
        reviewedAt: '2026-08-16T14:30:00.000Z',
      })
    ).toThrow('membership is incomplete or ambiguous');
  });
});
