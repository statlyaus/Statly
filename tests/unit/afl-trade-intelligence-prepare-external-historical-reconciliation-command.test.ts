import { describe, expect, it, vi } from 'vitest';

import { runAflTradePrepareExternalHistoricalReconciliationCommand } from '../../Scripts/prepare-external-draft-trade-reconciliation';

const completionId = `external-historical-capture-completion:${'a'.repeat(64)}`;

describe('prepare external historical reconciliation command', () => {
  it('prepares from a completion without requiring copied batch IDs', async () => {
    const prepare = vi.fn(async () => ({
      candidateId: `external-reconciliation:${'b'.repeat(64)}`,
      completionId,
      status: 'finalized' as const,
      blockingIssueCount: 4,
      idempotentReplay: false,
      requiresReview: true,
      promotionEligible: false as const,
      publicationEligible: false as const,
    }));
    const close = vi.fn(async () => undefined);
    const output: string[] = [];

    const result = await runAflTradePrepareExternalHistoricalReconciliationCommand(
      {
        argv: ['--completion', completionId],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture' },
      },
      {
        connect: async () => ({ prepare, close }),
        writeOutput: (line) => output.push(line),
      }
    );

    expect(prepare).toHaveBeenCalledWith({ completionId });
    expect(result.requiresReview).toBe(true);
    expect(output).toEqual([JSON.stringify(result)]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects copied source batches or identity resolutions before connecting', async () => {
    const connect = vi.fn();
    for (const unsafe of [
      ['--completion', completionId, '--source-batches', '/unsafe.json'],
      ['--completion', completionId, '--identity-resolutions', '/unsafe.json'],
    ]) {
      await expect(
        runAflTradePrepareExternalHistoricalReconciliationCommand(
          {
            argv: unsafe,
            env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture' },
          },
          { connect, writeOutput: vi.fn() }
        )
      ).rejects.toThrow(/arguments/i);
    }
    expect(connect).not.toHaveBeenCalled();
  });
});
