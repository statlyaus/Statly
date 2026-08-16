import { describe, expect, it, vi } from 'vitest';

import { runRecordLocalAflTradeWorkbookTransactionReviewCommand } from '../../Scripts/dev/record-local-afl-trade-workbook-transaction-review';

const reviewSetId = `workbook-transaction-review-set:${'a'.repeat(64)}`;
const subjectId = `workbook-transaction-review-subject:${'b'.repeat(64)}`;
const previousDecisionId = `workbook-transaction-review-decision:${'c'.repeat(64)}`;
const environment = {
  AFL_OUTCOMES_DATABASE_URL:
    'postgresql://statly_test:statly_test@127.0.0.1:5432/statly_outcomes_test',
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: 'd'.repeat(64),
};

describe('record local workbook transaction review command', () => {
  it('records an explicit approved identity and direction decision after runtime admission', async () => {
    const recordDecision = vi.fn(async (input) => ({
      decisionId: `workbook-transaction-review-decision:${'e'.repeat(64)}`,
      content: { ...input, revision: 2, decidedAt: '2026-08-16T01:00:00.000Z' },
    }));
    const close = vi.fn(async () => undefined);
    const writeOutput = vi.fn();

    await runRecordLocalAflTradeWorkbookTransactionReviewCommand(
      {
        argv: [
          '--review-set',
          reviewSetId,
          '--subject',
          subjectId,
          '--expected-current',
          previousDecisionId,
          '--decision',
          'approved',
          '--canonical-clubs',
          'afl-club:st-kilda,afl-club:gold-coast',
          '--direction',
          'listed-club-received-assets',
          '--reviewer',
          'local-reviewer:robert',
          '--rationale',
          'Exact identities and direction reviewed.',
        ],
        env: environment,
      },
      {
        connect: async () => ({ recordDecision, close }),
        writeOutput,
      }
    );

    expect(recordDecision).toHaveBeenCalledWith({
      reviewSetId,
      reviewSubjectId: subjectId,
      expectedCurrentDecisionId: previousDecisionId,
      outcome: 'approved',
      canonicalClubIds: ['afl-club:st-kilda', 'afl-club:gold-coast'],
      transferDirection: 'listed_club_received_assets',
      reviewerId: 'local-reviewer:robert',
      rationale: 'Exact identities and direction reviewed.',
    });
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(writeOutput.mock.calls[0]![0])).toMatchObject({
      mode: 'private_local_workbook_transaction_review_decision',
      productionAuthority: 'none',
      publicationAuthority: 'none',
      reviewSetId,
      reviewSubjectId: subjectId,
      outcome: 'approved',
      revision: 2,
    });
  });

  it('records a first rejected decision without inventing canonical clubs', async () => {
    const recordDecision = vi.fn(async (input) => ({
      decisionId: `workbook-transaction-review-decision:${'f'.repeat(64)}`,
      content: { ...input, revision: 1, decidedAt: '2026-08-16T01:00:00.000Z' },
    }));

    await runRecordLocalAflTradeWorkbookTransactionReviewCommand(
      {
        argv: [
          '--review-set',
          reviewSetId,
          '--subject',
          subjectId,
          '--expected-current',
          'none',
          '--decision',
          'rejected',
          '--reviewer',
          'local-reviewer:robert',
          '--rationale',
          'Direction is ambiguous.',
        ],
        env: environment,
      },
      {
        connect: async () => ({ recordDecision, close: async () => undefined }),
        writeOutput: vi.fn(),
      }
    );

    expect(recordDecision).toHaveBeenCalledWith({
      reviewSetId,
      reviewSubjectId: subjectId,
      expectedCurrentDecisionId: null,
      outcome: 'rejected',
      reviewerId: 'local-reviewer:robert',
      rationale: 'Direction is ambiguous.',
    });
  });

  it('rejects approvals without the explicit direction confirmation before connecting', async () => {
    const connect = vi.fn();
    await expect(
      runRecordLocalAflTradeWorkbookTransactionReviewCommand(
        {
          argv: [
            '--review-set',
            reviewSetId,
            '--subject',
            subjectId,
            '--expected-current',
            'none',
            '--decision',
            'approved',
            '--canonical-clubs',
            'afl-club:st-kilda,afl-club:gold-coast',
            '--reviewer',
            'local-reviewer:robert',
            '--rationale',
            'Missing direction confirmation.',
          ],
          env: environment,
        },
        { connect, writeOutput: vi.fn() }
      )
    ).rejects.toThrow(/--direction/i);
    expect(connect).not.toHaveBeenCalled();
  });
});
