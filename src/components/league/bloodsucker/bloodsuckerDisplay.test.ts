import { describe, expect, it } from 'vitest';

import { commissionerBiteActions } from '@/server/leagues/biteCommissionerActions';

import {
  biteStatusLabel,
  formatCountdown,
  formatRefusal,
  isBiteOpen,
  readRefusal,
  refusalHeading,
  revealFrame,
  SLOT_GROUP_LABELS,
} from './bloodsuckerDisplay';

const candidates = ['m-a', 'm-b', 'm-c', 'm-d'];
const draw = {
  drawId: 'draw-1',
  drawnAt: '2026-11-14T00:00:00.000Z',
  winnerMemberId: 'm-c',
  candidates: candidates.map((memberId) => ({ memberId, teamName: memberId })),
  revealMs: 6000,
};
const at = (ms: number) => Date.parse(draw.drawnAt) + ms;

describe('revealFrame (BR-04b)', () => {
  it('shows every client the same frame at the same server time', () => {
    for (const ms of [0, 400, 2500, 5900]) {
      expect(revealFrame(draw, at(ms))).toEqual(revealFrame({ ...draw }, at(ms)));
    }
  });

  it('spins through the candidates, then settles on the committed winner', () => {
    const shown = new Set(
      [0, 300, 700, 1200, 1800, 2600].map((ms) => revealFrame(draw, at(ms)).memberId)
    );
    expect(shown.size).toBeGreaterThan(1);
    expect(revealFrame(draw, at(5999)).done).toBe(false);
    expect(revealFrame(draw, at(6000))).toEqual({ memberId: 'm-c', done: true });
  });

  it('shows the winner at once to a client that arrives after the reveal', () => {
    expect(revealFrame(draw, at(60 * 60 * 1000))).toEqual({ memberId: 'm-c', done: true });
  });

  it('lands on the winner in its last spinning frame', () => {
    expect(revealFrame(draw, at(5990)).memberId).toBe('m-c');
  });
});

describe('formatCountdown', () => {
  it('reads as words for a screen reader', () => {
    expect(formatCountdown(((26 * 60 + 5) * 60 + 9) * 1000)).toBe('1 day, 2 hours and 5 minutes');
    expect(formatCountdown((3 * 60 + 1) * 60 * 1000)).toBe('3 hours and 1 minute');
    expect(formatCountdown(45 * 1000)).toBe('less than a minute');
    expect(formatCountdown(-1)).toBe('now');
  });
});

describe('labels', () => {
  it('names each slot group and bite state without the word Vampire', () => {
    expect(SLOT_GROUP_LABELS.NON_SCORING).toBe('Interchange and bench');
    expect(biteStatusLabel('WAITING_LOCK')).toBe('Waiting for the round to end');
    const words = [...Object.values(SLOT_GROUP_LABELS), biteStatusLabel('OPEN')].join(' ');
    expect(words).not.toMatch(/vampire/i);
  });
});

describe('refusalHeading (NFR-5, #1343)', () => {
  it('gives each refusal its own honest heading', () => {
    expect(refusalHeading('EARLIER_BITE_PENDING')).toBe('An earlier bite comes first');
    expect(refusalHeading('BITE_SUSPENDED')).toBe('This bite is on hold');
    expect(refusalHeading('ROUND_IN_PROGRESS')).toBe('A round is in progress');
    expect(refusalHeading('BITE_PENDING')).toBe('A bite is waiting on your team');
    expect(refusalHeading('BLOODSUCKER_WINDOW_OPEN')).toBe(
      "The Bloodsucker's exclusive window is open"
    );
    expect(refusalHeading('BLOODSUCKER_SELF_OVERRIDE')).toBe('You are part of this matchup');
    expect(refusalHeading('LEAGUE_BUSY')).toBe('The league is busy. Nothing changed, so try again');
    expect(refusalHeading('LAST_PLAYER_BITE_HELD')).toBe(
      'Your last player stays while you hold a bite'
    );
  });

  it('never calls a refusal a player lock when it is not one', () => {
    for (const code of ['EARLIER_BITE_PENDING', 'BITE_SUSPENDED', 'ROUND_IN_PROGRESS']) {
      expect(refusalHeading(code)).not.toMatch(/locked/i);
    }
  });

  it('falls back to a generic heading for a code it does not know', () => {
    expect(refusalHeading('SOMETHING_NEW')).toBe('The server refused this');
    expect(refusalHeading('')).toBe('The server refused this');
    expect(refusalHeading('toString')).toBe('The server refused this');
  });
});

describe('readRefusal and formatRefusal', () => {
  it('reads the flat shape and the nested shape, keeping the code', () => {
    expect(readRefusal({ error: 'Wait.', code: 'BITE_PENDING' }, 409, 'Drop failed.')).toEqual({
      code: 'BITE_PENDING',
      message: 'Wait.',
    });
    expect(
      readRefusal({ error: { message: 'Closed.', code: 'TRANSACTIONS_CLOSED' } }, 409, 'x')
    ).toEqual({ code: 'TRANSACTIONS_CLOSED', message: 'Closed.' });
  });

  it('names the HTTP status when the server sent no code or no body', () => {
    expect(readRefusal(null, 500, 'Drop failed.')).toEqual({
      code: 'HTTP_500',
      message: 'Drop failed.',
    });
    expect(readRefusal({ message: 'Nope.' }, 400, 'Drop failed.')).toEqual({
      code: 'HTTP_400',
      message: 'Nope.',
    });
  });

  it('formats a refusal as heading, code and reason', () => {
    expect(formatRefusal({ code: 'BITE_PENDING', message: 'Wait for the bite.' })).toBe(
      'A bite is waiting on your team (BITE_PENDING). Wait for the bite.'
    );
  });
});

describe('bite status display tolerates a status it does not know', () => {
  it('labels a new status without throwing and treats it as not open', () => {
    expect(biteStatusLabel('UNPAIRABLE')).toBe('Ended without a swap');
    expect(biteStatusLabel('SOMETHING_NEW')).toBe('Something new');
    expect(isBiteOpen('OPEN')).toBe(true);
    expect(isBiteOpen('WAITING_LOCK')).toBe(true);
    expect(isBiteOpen('UNPAIRABLE')).toBe(false);
  });
});

describe('commissionerBiteActions (BR-35, E1)', () => {
  const bite = { status: 'EXECUTED', bloodsuckerMemberId: 'bs', victimMemberId: 'victim' };
  const owner = { memberId: 'owner', isCommissioner: true };

  it('offers cancel and redo on an executed bite, cancel only on an open one', () => {
    expect(commissionerBiteActions(bite, owner)).toEqual(['cancel', 'redo']);
    expect(commissionerBiteActions({ ...bite, status: 'AUTO_EXECUTED' }, owner)).toEqual([
      'cancel',
      'redo',
    ]);
    expect(commissionerBiteActions({ ...bite, status: 'OPEN' }, owner)).toEqual(['cancel']);
    expect(commissionerBiteActions({ ...bite, status: 'WAITING_LOCK' }, owner)).toEqual(['cancel']);
  });

  it('offers nothing on a finished bite, to a non-commissioner, or to either side of the bite', () => {
    expect(commissionerBiteActions({ ...bite, status: 'CANCELLED' }, owner)).toEqual([]);
    expect(commissionerBiteActions({ ...bite, status: 'UNPAIRABLE' }, owner)).toEqual([]);
    expect(commissionerBiteActions(bite, { memberId: 'owner', isCommissioner: false })).toEqual([]);
    expect(commissionerBiteActions(bite, { memberId: 'bs', isCommissioner: true })).toEqual([]);
    expect(commissionerBiteActions(bite, { memberId: 'victim', isCommissioner: true })).toEqual([]);
  });
});
