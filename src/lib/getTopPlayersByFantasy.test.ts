import { describe, expect, it } from 'vitest';

import type { Player } from '@/types/players';

import { getTopPlayersByFantasy } from './getTopPlayersByFantasy';

describe('getTopPlayersByFantasy', () => {
  const players: Player[] = [
    { id: '1', name: 'A', stats: { aflFantasy: 10 } },
    { id: '2', name: 'B', stats: { aflFantasy: 50 } },
    { id: '3', name: 'C', stats: { aflFantasy: 30 } },
    { id: '4', name: 'D', stats: { aflFantasy: 70 } },
    { id: '5', name: 'E', stats: { aflFantasy: 20 } },
    { id: '6', name: 'F', stats: { aflFantasy: 90 } },
  ];

  it('returns top n players by aflFantasy in descending order', () => {
    const top = getTopPlayersByFantasy(players, 3);
    expect(top.map((p) => p.name)).toEqual(['F', 'D', 'B']);
  });

  it('defaults to top 5 players', () => {
    const top = getTopPlayersByFantasy(players);
    expect(top).toHaveLength(5);
    expect(top.map((p) => p.name)).toEqual(['F', 'D', 'B', 'C', 'E']);
  });
});
