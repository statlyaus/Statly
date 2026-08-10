import { describe, expect, it, vi } from 'vitest';

import { runAflTradeExternalHistoricalCompletionCommand } from '../../Scripts/complete-external-draft-trade-history';

const sha = (character: string) => character.repeat(64);

describe('external historical capture completion command', () => {
  it('seals one exact plan through the isolated outcomes repository and closes it', async () => {
    const completePlan = vi.fn(async (planId: string) => ({
      completionId: `external-historical-capture-completion:${sha('b')}`,
      planId,
      targetCount: 24,
      sourceBatchCount: 24,
      completedAt: '2026-08-10T00:10:00.000Z',
      idempotentReplay: false,
      publicationEligible: false as const,
    }));
    const close = vi.fn(async () => undefined);
    const output: string[] = [];
    const planId = `external-historical-capture-plan:${sha('a')}`;

    const result = await runAflTradeExternalHistoricalCompletionCommand(
      {
        argv: ['--plan', planId],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture.invalid/outcomes' },
      },
      {
        connect: async () => ({ repository: { completePlan }, close }),
        writeOutput: (line) => output.push(line),
      }
    );

    expect(result).toMatchObject({ planId, targetCount: 24, publicationEligible: false });
    expect(completePlan).toHaveBeenCalledWith(planId);
    expect(JSON.parse(output[0] ?? '{}')).toEqual(result);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects malformed command input before opening a database connection', async () => {
    const connect = vi.fn();

    await expect(
      runAflTradeExternalHistoricalCompletionCommand(
        {
          argv: ['--plan', 'not-a-plan'],
          env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture.invalid/outcomes' },
        },
        { connect, writeOutput: vi.fn() }
      )
    ).rejects.toThrow(/--plan/);
    expect(connect).not.toHaveBeenCalled();
  });
});
