import { describe, expect, it, vi } from 'vitest';

import { runAflTradeExternalCandidatePromotionCommand } from '../../Scripts/promote-external-draft-trade-candidate';

const candidateId = `external-reconciliation:${'c'.repeat(64)}`;
const approvalDecisionId = `review-decision:${'a'.repeat(64)}`;

describe('external canonical candidate promotion command', () => {
  it('passes only the reviewed candidate and approval decision to the durable repository', async () => {
    const promote = vi.fn().mockResolvedValue({
      promotionId: `external-canonical-promotion:${'p'.repeat(64)}`,
      candidateId,
      status: 'finalized',
      idempotentReplay: false,
      transactionCount: 2,
      transferCount: 4,
      draftSelectionCount: 1,
      draftPlayerAssetCount: 1,
      pickCustodyCount: 1,
      pickRealizationCount: 1,
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const output: string[] = [];

    await expect(
      runAflTradeExternalCandidatePromotionCommand(
        {
          argv: ['--candidate', candidateId, '--approval-decision', approvalDecisionId],
          env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture.invalid/outcomes' },
        },
        {
          connect: async () => ({ repository: { promote }, close }),
          writeOutput: (line) => output.push(line),
        }
      )
    ).resolves.toMatchObject({ candidateId, status: 'finalized' });

    expect(promote).toHaveBeenCalledWith({ candidateId, approvalDecisionId });
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      candidateId,
      status: 'finalized',
      idempotentReplay: false,
    });
  });

  it('rejects ambiguous arguments before opening PostgreSQL', async () => {
    const connect = vi.fn();

    await expect(
      runAflTradeExternalCandidatePromotionCommand(
        {
          argv: ['--candidate', candidateId],
          env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture.invalid/outcomes' },
        },
        { connect, writeOutput: vi.fn() }
      )
    ).rejects.toThrow('requires --candidate');

    expect(connect).not.toHaveBeenCalled();
  });
});
