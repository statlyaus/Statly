import { describe, expect, it, vi } from 'vitest';

import { computeBloodsuckerWindow } from './bloodsuckerWindow';
import { getTransactionWindow, transactionsClosedResponse } from './transactionWindow';

const HOUR = 60 * 60 * 1000;
const DRAFTED_AT = new Date('2026-03-01T02:00:00.000Z');
const after = (hours: number) => new Date(DRAFTED_AT.getTime() + hours * HOUR);

function dbWithDraft(draft: Record<string, unknown> | null, roundOne: unknown = null) {
  return {
    draft: { findUnique: vi.fn().mockResolvedValue(draft) },
    leagueCompetitionRound: { findFirst: vi.fn().mockResolvedValue(roundOne) },
  };
}

function bloodsuckerDraft(overrides: { member?: unknown; competitionRulesVersion?: number } = {}) {
  return {
    id: 'draft-1',
    status: 'COMPLETED',
    completedAt: DRAFTED_AT,
    league: {
      settings: {
        leagueFormat: 'BLOODSUCKER',
        competitionRulesVersion: overrides.competitionRulesVersion ?? 0,
        bloodsuckerMember:
          'member' in overrides
            ? overrides.member
            : { id: 'bloodsucker', isActive: true, status: 'ACTIVE' },
      },
    },
  };
}

describe('computeBloodsuckerWindow', () => {
  it('runs 24 hours from the draft when round 1 is a week away', () => {
    expect(
      computeBloodsuckerWindow({ completedAt: DRAFTED_AT, roundOneFirstLockAt: after(7 * 24) })
    ).toEqual({ opensAt: DRAFTED_AT, closesAt: after(24), skipped: false });
  });

  it('runs 24 hours when round 1 has no lock time yet', () => {
    expect(
      computeBloodsuckerWindow({ completedAt: DRAFTED_AT, roundOneFirstLockAt: null }).closesAt
    ).toEqual(after(24));
  });

  it('ends 8 hours after a draft that finishes 10 hours before round 1', () => {
    expect(
      computeBloodsuckerWindow({ completedAt: DRAFTED_AT, roundOneFirstLockAt: after(10) })
    ).toEqual({ opensAt: DRAFTED_AT, closesAt: after(8), skipped: false });
  });

  it('keeps a window of exactly one hour', () => {
    expect(
      computeBloodsuckerWindow({ completedAt: DRAFTED_AT, roundOneFirstLockAt: after(3) })
    ).toEqual({ opensAt: DRAFTED_AT, closesAt: after(1), skipped: false });
  });

  it.each([2.9, 1, -5])('skips the window when round 1 locks %s hours after the draft', (hours) => {
    expect(
      computeBloodsuckerWindow({ completedAt: DRAFTED_AT, roundOneFirstLockAt: after(hours) })
    ).toEqual({ opensAt: DRAFTED_AT, closesAt: DRAFTED_AT, skipped: true });
  });
});

describe('getTransactionWindow', () => {
  it('opens transactions once the league draft is COMPLETED', async () => {
    const db = dbWithDraft({ status: 'COMPLETED' });

    await expect(getTransactionWindow('league-1', db as never)).resolves.toEqual({ open: true });
    expect(db.draft.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'league-1' } })
    );
    expect(db.leagueCompetitionRound.findFirst).not.toHaveBeenCalled();
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

  describe('in a Bloodsucker league', () => {
    it('refuses every other member during the window, with the close time', async () => {
      const window = await getTransactionWindow(
        'league-1',
        dbWithDraft(bloodsuckerDraft()) as never,
        {
          memberId: 'rival',
          now: after(23),
        }
      );

      expect(window).toMatchObject({
        open: false,
        code: 'BLOODSUCKER_WINDOW_OPEN',
        closesAt: after(24).toISOString(),
        // 2 am UTC on 2 March is 1 pm in Melbourne (daylight saving). Punctuation varies by ICU version.
        reason: expect.stringMatching(
          /^The Bloodsucker has first pick of free agents until Mon,? 2 Mar,? 1:00\spm AEDT\. Adds, drops, waiver claims and trades open then\.$/
        ),
      });
    });

    it('refuses a caller with no member during the window', async () => {
      await expect(
        getTransactionWindow('league-1', dbWithDraft(bloodsuckerDraft()) as never, {
          now: after(1),
        })
      ).resolves.toMatchObject({ open: false, code: 'BLOODSUCKER_WINDOW_OPEN' });
    });

    it('lets the Bloodsucker through and marks the window exclusive', async () => {
      await expect(
        getTransactionWindow('league-1', dbWithDraft(bloodsuckerDraft()) as never, {
          memberId: 'bloodsucker',
          now: after(1),
        })
      ).resolves.toEqual({ open: true, bloodsuckerExclusive: true });
    });

    it('opens to everyone at the close time', async () => {
      await expect(
        getTransactionWindow('league-1', dbWithDraft(bloodsuckerDraft()) as never, {
          memberId: 'rival',
          now: after(24),
        })
      ).resolves.toEqual({ open: true });
    });

    it('closes 2 hours before round 1 of the published fixture', async () => {
      const db = dbWithDraft(bloodsuckerDraft({ competitionRulesVersion: 3 }), {
        startsAt: after(10),
        fallbackLockAt: null,
      });

      await expect(
        getTransactionWindow('league-1', db as never, { memberId: 'rival', now: after(7) })
      ).resolves.toMatchObject({
        code: 'BLOODSUCKER_WINDOW_OPEN',
        closesAt: after(8).toISOString(),
      });
      await expect(
        getTransactionWindow('league-1', db as never, { memberId: 'rival', now: after(8) })
      ).resolves.toEqual({ open: true });
      expect(db.leagueCompetitionRound.findFirst).toHaveBeenCalledWith({
        where: { leagueId: 'league-1', fixtureVersion: 3, round: 1 },
        select: { startsAt: true, fallbackLockAt: true },
      });
    });

    it('has no window when the draft finishes within 3 hours of round 1', async () => {
      const db = dbWithDraft(bloodsuckerDraft({ competitionRulesVersion: 1 }), {
        startsAt: after(2),
        fallbackLockAt: null,
      });

      await expect(
        getTransactionWindow('league-1', db as never, { memberId: 'rival', now: DRAFTED_AT })
      ).resolves.toEqual({ open: true });
    });

    it.each([null, { id: 'bloodsucker', isActive: false, status: 'LEFT' }])(
      'has no window without an active Bloodsucker (%j)',
      async (member) => {
        await expect(
          getTransactionWindow('league-1', dbWithDraft(bloodsuckerDraft({ member })) as never, {
            memberId: 'rival',
            now: after(1),
          })
        ).resolves.toEqual({ open: true });
      }
    );
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

  it('adds the close time for a Bloodsucker window', async () => {
    const response = transactionsClosedResponse({
      open: false,
      code: 'BLOODSUCKER_WINDOW_OPEN',
      reason: 'Closed.',
      closesAt: '2026-03-02T02:00:00.000Z',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Closed.',
      code: 'BLOODSUCKER_WINDOW_OPEN',
      closesAt: '2026-03-02T02:00:00.000Z',
    });
  });
});
