import { describe, expect, it, vi } from 'vitest';

import { runInspectLocalAflTradeWorkbookTransactionReviewCommand } from '../../Scripts/dev/inspect-local-afl-trade-workbook-transaction-review';

const reviewSetId = `workbook-transaction-review-set:${'a'.repeat(64)}`;
const reviewSubjectId = `workbook-transaction-review-subject:${'b'.repeat(64)}`;
const environment = {
  AFL_OUTCOMES_DATABASE_URL:
    'postgresql://statly_test:statly_test@127.0.0.1:5432/statly_outcomes_test',
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: 'd'.repeat(64),
};
const reviewSet = {
  reviewSetId,
  content: {
    transactions: [
      {
        reviewSubjectId,
        seasonYear: 2025,
        sourceTitle: 'Trade 1',
        parties: [
          { clubLabel: 'St Kilda', assetText: 'Player' },
          { clubLabel: 'Gold Coast', assetText: 'Pick 8' },
        ],
      },
    ],
  },
};

describe('inspect local workbook transaction review command', () => {
  it('exports pending subjects and current decisions without creating authority', async () => {
    const close = vi.fn(async () => undefined);
    const writeOutput = vi.fn();

    await runInspectLocalAflTradeWorkbookTransactionReviewCommand(
      { argv: ['--review-set', reviewSetId], env: environment },
      {
        connect: async () => ({
          loadReviewSet: async () => reviewSet as never,
          loadCurrentDecisions: async () => [],
          assess: async () => ({
            reviewSetId,
            total: 1,
            approved: 0,
            rejected: 0,
            pending: 1,
            readyForShadowOracle: false,
          }),
          close,
        }),
        writeOutput,
      }
    );

    expect(JSON.parse(writeOutput.mock.calls[0]![0])).toEqual({
      mode: 'private_local_workbook_transaction_review_inspection',
      productionAuthority: 'none',
      publicationAuthority: 'none',
      assessment: {
        reviewSetId,
        total: 1,
        approved: 0,
        rejected: 0,
        pending: 1,
        readyForShadowOracle: false,
      },
      subjects: [
        {
          reviewSubjectId,
          seasonYear: 2025,
          sourceTitle: 'Trade 1',
          parties: [
            { clubLabel: 'St Kilda', assetText: 'Player' },
            { clubLabel: 'Gold Coast', assetText: 'Pick 8' },
          ],
          currentDecision: null,
        },
      ],
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed and closes when the exact review set is unavailable', async () => {
    const close = vi.fn(async () => undefined);
    await expect(
      runInspectLocalAflTradeWorkbookTransactionReviewCommand(
        { argv: ['--review-set', reviewSetId], env: environment },
        {
          connect: async () => ({
            loadReviewSet: async () => null,
            loadCurrentDecisions: vi.fn(),
            assess: vi.fn(),
            close,
          }),
          writeOutput: vi.fn(),
        }
      )
    ).rejects.toThrow(/unavailable/i);
    expect(close).toHaveBeenCalledOnce();
  });
});
