import { describe, expect, it, vi } from 'vitest';

import { runPrepareLocalAflTradeWorkbookTransactionReviewCommand } from '../../Scripts/dev/prepare-local-afl-trade-workbook-transaction-review';
import type { AflTradeWorkbookTransactionReviewSet } from '@/server/aflTradeIntelligence/source/workbookTransactionReviewSet';

const SHA = 'a'.repeat(64);
const importRunId = `workbook-import-run:${'b'.repeat(64)}`;
const reviewSet = {
  reviewSetId: `workbook-transaction-review-set:${'c'.repeat(64)}`,
  content: {
    schemaVersion: 'afl-trade-workbook-transaction-review-set/v1',
    stagingPackageId: `workbook-import:${'d'.repeat(64)}`,
    sourceArtifactId: `artifact:${SHA}`,
    sourceArtifactSha256: SHA,
    rawEvidenceSha256: SHA,
    authority: 'private_workbook_migration_oracle_review',
    publicationEligible: false,
    publicationProhibited: true,
    transactions: [],
    transactionCount: 975,
    transactionSetSha256: 'e'.repeat(64),
    pendingReviewCount: 975,
  },
} as unknown as AflTradeWorkbookTransactionReviewSet;

const environment = {
  AFL_OUTCOMES_DATABASE_URL:
    'postgresql://statly_test:statly_test@127.0.0.1:5432/statly_outcomes_test',
  AFL_OUTCOMES_DEV_WORKBOOK_PATH: '/private/workbook.xlsx',
  AFL_OUTCOMES_DEV_WORKBOOK_SHA256: SHA,
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: 'f'.repeat(64),
  NODE_ENV: 'development',
};

describe('prepare local workbook transaction review command', () => {
  it('admits the disposable runtime before reading private workbook evidence', async () => {
    const order: string[] = [];
    const close = vi.fn(async () => undefined);
    const writeOutput = vi.fn();

    await expect(
      runPrepareLocalAflTradeWorkbookTransactionReviewCommand(
        { argv: ['--import-run', importRunId], env: environment },
        {
          connect: async () => {
            order.push('admit-runtime');
            return {
              register: async () => {
                order.push('register-review-set');
                return reviewSet;
              },
              close,
            };
          },
          loadEvidence: async (input) => {
            order.push('load-private-workbook');
            expect(input).toEqual({
              workbookPath: environment.AFL_OUTCOMES_DEV_WORKBOOK_PATH,
              expectedSha256: environment.AFL_OUTCOMES_DEV_WORKBOOK_SHA256,
              runtimeEnvironment: 'development',
            });
            return { staging: { stagingPackageId: reviewSet.content.stagingPackageId } as never };
          },
          writeOutput,
        }
      )
    ).resolves.toEqual(reviewSet);

    expect(order).toEqual(['admit-runtime', 'load-private-workbook', 'register-review-set']);
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(writeOutput.mock.calls[0]![0])).toEqual({
      mode: 'private_local_workbook_transaction_review',
      productionAuthority: 'none',
      publicationAuthority: 'none',
      importRunId,
      reviewSetId: reviewSet.reviewSetId,
      transactionCount: 975,
      pendingReviewCount: 975,
    });
  });

  it('rejects incomplete authority configuration before connecting or reading the workbook', async () => {
    const connect = vi.fn();
    const loadEvidence = vi.fn();

    await expect(
      runPrepareLocalAflTradeWorkbookTransactionReviewCommand(
        { argv: ['--import-run', importRunId], env: {} },
        { connect, loadEvidence, writeOutput: vi.fn() }
      )
    ).rejects.toThrow(/AFL_OUTCOMES_DATABASE_URL/i);
    expect(connect).not.toHaveBeenCalled();
    expect(loadEvidence).not.toHaveBeenCalled();
  });

  it('closes the admitted connection if private workbook loading fails', async () => {
    const close = vi.fn(async () => undefined);

    await expect(
      runPrepareLocalAflTradeWorkbookTransactionReviewCommand(
        { argv: ['--import-run', importRunId], env: environment },
        {
          connect: async () => ({ register: vi.fn(), close }),
          loadEvidence: async () => {
            throw new Error('Pinned workbook digest mismatch.');
          },
          writeOutput: vi.fn(),
        }
      )
    ).rejects.toThrow(/digest mismatch/i);
    expect(close).toHaveBeenCalledOnce();
  });

  it('requires one exact content-addressed import run', async () => {
    await expect(
      runPrepareLocalAflTradeWorkbookTransactionReviewCommand(
        { argv: ['--import-run', 'workbook-import-run:fixture'], env: environment },
        { connect: vi.fn(), loadEvidence: vi.fn(), writeOutput: vi.fn() }
      )
    ).rejects.toThrow(/--import-run/i);
  });
});
