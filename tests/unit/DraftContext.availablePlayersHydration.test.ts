import { describe, expect, it } from 'vitest';
import { shouldHydrateAvailablePlayers } from '@/contexts/DraftContext';
import type { DraftPlayer } from '@/types/draft';

const basePlayer: DraftPlayer = {
  id: 'player-1',
  name: 'Test Player',
  position: 'MID',
  club: 'Adelaide',
  isAvailable: true,
};

describe('shouldHydrateAvailablePlayers', () => {
  it('hydrates when the player list is empty', () => {
    expect(shouldHydrateAvailablePlayers([])).toBe(true);
  });

  it('hydrates when snapshot players are missing Statly Z scores', () => {
    expect(shouldHydrateAvailablePlayers([basePlayer])).toBe(true);
  });

  it('does not hydrate once players include numeric Statly Z scores', () => {
    expect(
      shouldHydrateAvailablePlayers([
        {
          ...basePlayer,
          statlyZScore: 0,
        },
      ])
    ).toBe(false);
  });
});
