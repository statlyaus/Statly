import { describe, expect, it } from 'vitest';

import {
  biteStatusLabel,
  formatCountdown,
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
