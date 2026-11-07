import { describe, expect, it } from 'vitest';

import type { DraftPlayer } from '@/types/draft';

import { sortDraftPlayers } from './sortDraftPlayers';

function player(name: string, goals: number | null): DraftPlayer {
  return {
    id: name,
    name,
    position: 'MID',
    club: 'COL',
    stats: goals === null ? {} : { goals },
  } as unknown as DraftPlayer;
}

const players = [player('Avery', 2), player('Blake', 5), player('Casey', null), player('Drew', 1)];

describe('sortDraftPlayers by category', () => {
  it('puts the highest value first for a HIGH_WINS category', () => {
    const sorted = sortDraftPlayers(players, 'category:goals', { goals: 'HIGH_WINS' });
    expect(sorted.map((p) => p.name)).toEqual(['Blake', 'Avery', 'Drew', 'Casey']);
  });

  it('puts the lowest value first for a LOW_WINS category, with missing values last', () => {
    const sorted = sortDraftPlayers(players, 'category:goals', { goals: 'LOW_WINS' });
    expect(sorted.map((p) => p.name)).toEqual(['Drew', 'Avery', 'Blake', 'Casey']);
  });

  it('treats a category with no stored direction as HIGH_WINS', () => {
    const sorted = sortDraftPlayers(players, 'category:goals');
    expect(sorted.map((p) => p.name)).toEqual(['Blake', 'Avery', 'Drew', 'Casey']);
  });
});
