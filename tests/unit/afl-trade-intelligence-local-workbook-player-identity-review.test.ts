import { describe, expect, it } from 'vitest';

import {
  createLocalWorkbookPlayerIdentityReview,
  parseLocalWorkbookPlayerIdentityReview,
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
});
