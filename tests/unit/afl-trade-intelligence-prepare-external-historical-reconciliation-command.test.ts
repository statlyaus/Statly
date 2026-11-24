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
      deferredIssueCount: 0,
      idempotentReplay: false,
      requiresReview: true,
      promotionEligible: false as const,
      publicationEligible: false as const,
      pickLineageDeferral: null,
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

  it('reads the owner’s --bid-ladder file and prepares with it, after any deferral', async () => {
    const prepare = vi.fn(async () => ({}) as never);
    const ladder = { schemaVersion: 'afl-trade-bid-ladder/v1', season: 2026 };
    const readTextFile = vi.fn(async () => JSON.stringify(ladder));
    const decisionId = `review-decision:${'c'.repeat(64)}`;
    await runAflTradePrepareExternalHistoricalReconciliationCommand(
      {
        argv: [
          '--completion',
          completionId,
          '--bid-ladder',
          '/owner/ladder-2026.json',
          '--defer-pick-lineage',
          decisionId,
        ],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture' },
      },
      {
        connect: async () => ({ prepare, close: async () => undefined }),
        writeOutput: vi.fn(),
        readTextFile,
      }
    );
    expect(readTextFile).toHaveBeenCalledWith('/owner/ladder-2026.json');
    expect(prepare).toHaveBeenCalledWith({
      completionId,
      pickLineageDeferral: { decisionId },
      bidLadder: ladder,
    });
  });

  it('refuses a relative or repeated --bid-ladder before reading or connecting', async () => {
    const connect = vi.fn();
    const readTextFile = vi.fn();
    for (const argv of [
      ['--completion', completionId, '--bid-ladder', 'ladder.json'],
      ['--completion', completionId, '--bid-ladder', '/a.json', '--bid-ladder', '/b.json'],
      ['--completion', completionId, '--bid-ladder'],
    ]) {
      await expect(
        runAflTradePrepareExternalHistoricalReconciliationCommand(
          { argv, env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture' } },
          { connect, writeOutput: vi.fn(), readTextFile }
        )
      ).rejects.toThrow(/arguments/i);
    }
    expect(readTextFile).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
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
