import { describe, expect, it, vi } from 'vitest';

import { getTransactionWindow, transactionsClosedResponse } from './transactionWindow';

function dbWithDraft(draft: { status: string } | null) {
  return { draft: { findUnique: vi.fn().mockResolvedValue(draft) } };
}

describe('getTransactionWindow', () => {
  it('opens transactions once the league draft is COMPLETED', async () => {
    const db = dbWithDraft({ status: 'COMPLETED' });

    await expect(getTransactionWindow('league-1', db as never)).resolves.toEqual({ open: true });
    expect(db.draft.findUnique).toHaveBeenCalledWith({
      where: { leagueId: 'league-1' },
      select: { status: true },
    });
  });

  it.each(['SCHEDULED', 'LIVE', 'PAUSED'])(
    'keeps transactions closed while the draft is %s',
    async (status) => {
      await expect(
        getTransactionWindow('league-1', dbWithDraft({ status }) as never)
      ).resolves.toEqual({
        open: false,
        code: 'DRAFT_NOT_COMPLETE',
        reason: 'Adds, waiver claims and trades open once the league draft is complete.',
      });
    }
  );

  it('keeps transactions closed when the league has no draft', async () => {
    await expect(
      getTransactionWindow('league-1', dbWithDraft(null) as never)
    ).resolves.toMatchObject({ open: false, code: 'DRAFT_NOT_COMPLETE' });
  });
});

describe('transactionsClosedResponse', () => {
  it('answers 409 with the reason and code', async () => {
    const response = transactionsClosedResponse({
      open: false,
      code: 'DRAFT_NOT_COMPLETE',
      reason: 'Adds, waiver claims and trades open once the league draft is complete.',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Adds, waiver claims and trades open once the league draft is complete.',
      code: 'DRAFT_NOT_COMPLETE',
    });
  });
});
