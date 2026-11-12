import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { rankAutoFillCandidates } from './bloodsuckerAutoFill';

const ids = (players: Array<{ id: string }>) => players.map((player) => player.id);

describe('rankAutoFillCandidates', () => {
  it('puts the highest Statly Z first', () => {
    const ranked = rankAutoFillCandidates(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      new Map([
        ['a', 0.4],
        ['b', 2.1],
        ['c', -1],
      ])
    );

    expect(ids(ranked)).toEqual(['b', 'a', 'c']);
  });

  it('breaks a tie with the lower player id, whatever order the players arrive in', () => {
    const scores = new Map([
      ['p-20', 1.5],
      ['p-10', 1.5],
      ['p-30', 1.5],
    ]);

    expect(
      ids(rankAutoFillCandidates([{ id: 'p-30' }, { id: 'p-20' }, { id: 'p-10' }], scores))
    ).toEqual(['p-10', 'p-20', 'p-30']);
    expect(
      ids(rankAutoFillCandidates([{ id: 'p-10' }, { id: 'p-30' }, { id: 'p-20' }], scores))
    ).toEqual(['p-10', 'p-20', 'p-30']);
  });

  it('ranks a player with no score below every scored player, then by id', () => {
    const ranked = rankAutoFillCandidates(
      [{ id: 'unscored-b' }, { id: 'negative' }, { id: 'unscored-a' }],
      new Map([['negative', -3]])
    );

    expect(ids(ranked)).toEqual(['negative', 'unscored-a', 'unscored-b']);
  });
});
