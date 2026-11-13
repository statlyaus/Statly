import { describe, expect, it } from 'vitest';

import { computeBiteDeadline, planBiteGrantChange } from './bloodsuckerBiteGrant';

const HOUR = 60 * 60 * 1000;
const GRANTED = new Date('2026-04-06T10:00:00.000Z');
const at = (hours: number) => new Date(GRANTED.getTime() + hours * HOUR);

describe('computeBiteDeadline (BR-27, E4, E9)', () => {
  it('is 48 hours after the grant when the next round starts later than that', () => {
    expect(computeBiteDeadline({ grantedAt: GRANTED, nextRoundFirstLockAt: at(100) })).toEqual(
      at(48)
    );
  });

  it('is 2 hours before the next round when that comes first', () => {
    expect(computeBiteDeadline({ grantedAt: GRANTED, nextRoundFirstLockAt: at(40) })).toEqual(
      at(38)
    );
  });

  it('is never less than 24 hours after the grant', () => {
    expect(computeBiteDeadline({ grantedAt: GRANTED, nextRoundFirstLockAt: at(10) })).toEqual(
      at(24)
    );
  });

  it('is 48 hours after the grant when there is no next regular round or its start is unknown', () => {
    expect(computeBiteDeadline({ grantedAt: GRANTED, nextRoundFirstLockAt: null })).toEqual(at(48));
  });
});

const BS = 'bloodsucker';
const VICTIM = 'victim';
const finalWin = {
  status: 'FINAL',
  phase: 'REGULAR',
  homeMemberId: BS,
  awayMemberId: VICTIM,
  winnerMemberId: BS,
} as const;

describe('planBiteGrantChange (BR-17 to BR-19, BR-33, E4, E5)', () => {
  it('grants a bite when the Bloodsucker wins a FINAL regular matchup', () => {
    expect(
      planBiteGrantChange({ bloodsuckerMemberId: BS, matchup: finalWin, existing: null })
    ).toEqual({ kind: 'GRANT', victimMemberId: VICTIM, trigger: 'FINAL' });
  });

  it('grants as a re-score when a FINAL loss is re-scored into a win', () => {
    expect(
      planBiteGrantChange({
        bloodsuckerMemberId: BS,
        matchup: finalWin,
        previousWinnerMemberId: VICTIM,
        existing: null,
      })
    ).toEqual({ kind: 'GRANT', victimMemberId: VICTIM, trigger: 'GRANTED_ON_RESCORE' });
  });

  it.each([
    ['a draw', { winnerMemberId: null }],
    ['a loss', { winnerMemberId: VICTIM }],
    ['a finals matchup', { phase: 'FINALS' }],
    ['a matchup that is not FINAL', { status: 'LIVE' }],
    ['a matchup without the Bloodsucker', { homeMemberId: 'other' }],
    ['a bye', { awayMemberId: null }],
  ])('grants nothing for %s', (_label, change) => {
    expect(
      planBiteGrantChange({
        bloodsuckerMemberId: BS,
        matchup: { ...finalWin, ...change },
        existing: null,
      })
    ).toBeNull();
  });

  it('does nothing when the bite already exists (re-running FINAL)', () => {
    for (const status of ['OPEN', 'WAITING_LOCK', 'EXECUTED', 'AUTO_EXECUTED'] as const) {
      expect(
        planBiteGrantChange({
          bloodsuckerMemberId: BS,
          matchup: finalWin,
          previousWinnerMemberId: BS,
          existing: { status, cancelledBy: null },
        })
      ).toBeNull();
    }
  });

  it('reactivates a bite a re-score cancelled when a later re-score wins it back', () => {
    expect(
      planBiteGrantChange({
        bloodsuckerMemberId: BS,
        matchup: finalWin,
        previousWinnerMemberId: VICTIM,
        existing: { status: 'CANCELLED', cancelledBy: 'RESULT_CHANGED' },
      })
    ).toEqual({ kind: 'REACTIVATE', victimMemberId: VICTIM, trigger: 'GRANTED_ON_RESCORE' });
  });

  it('never reactivates a bite a commissioner cancelled', () => {
    expect(
      planBiteGrantChange({
        bloodsuckerMemberId: BS,
        matchup: finalWin,
        previousWinnerMemberId: VICTIM,
        existing: { status: 'CANCELLED', cancelledBy: 'COMMISSIONER' },
      })
    ).toBeNull();
  });

  it('cancels an unexecuted bite when a re-score takes the win away', () => {
    for (const status of ['OPEN', 'WAITING_LOCK'] as const) {
      expect(
        planBiteGrantChange({
          bloodsuckerMemberId: BS,
          matchup: { ...finalWin, winnerMemberId: null },
          previousWinnerMemberId: BS,
          existing: { status, cancelledBy: null },
        })
      ).toEqual({ kind: 'CANCEL', victimMemberId: VICTIM });
    }
  });

  it('keeps an executed bite and records the changed result', () => {
    expect(
      planBiteGrantChange({
        bloodsuckerMemberId: BS,
        matchup: { ...finalWin, winnerMemberId: VICTIM },
        previousWinnerMemberId: BS,
        existing: { status: 'EXECUTED', cancelledBy: null },
      })
    ).toEqual({ kind: 'RESULT_CHANGED', victimMemberId: VICTIM });
  });

  it('records nothing when an executed bite is re-scored with the same winner', () => {
    expect(
      planBiteGrantChange({
        bloodsuckerMemberId: BS,
        matchup: { ...finalWin, winnerMemberId: VICTIM },
        previousWinnerMemberId: VICTIM,
        existing: { status: 'AUTO_EXECUTED', cancelledBy: null },
      })
    ).toBeNull();
  });

  it('leaves an unexecuted bite alone while its matchup is no longer FINAL (E5)', () => {
    expect(
      planBiteGrantChange({
        bloodsuckerMemberId: BS,
        matchup: { ...finalWin, status: 'LIVE', winnerMemberId: VICTIM },
        existing: { status: 'OPEN', cancelledBy: null },
      })
    ).toBeNull();
  });
});
