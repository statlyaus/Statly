import { describe, expect, it } from 'vitest';
import {
  excludeDraftedAvailablePlayers,
  shouldHydrateAvailablePlayers,
  shouldStartAvailablePlayerHydration,
} from '@/contexts/DraftContext';
import type { DraftPick, DraftPlayer } from '@/types/draft';

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

  it('does not start another player hydration while one is already running', () => {
    expect(shouldStartAvailablePlayerHydration([], true)).toBe(false);
  });

  it('does not re-add drafted players from late player hydration pages', () => {
    const picks = [
      {
        id: 'pick-1',
        playerId: 'player-1',
        player: { id: 'player-1' },
      },
    ] as unknown as DraftPick[];

    expect(
      excludeDraftedAvailablePlayers(
        [
          { ...basePlayer, statlyZScore: 1 },
          { ...basePlayer, id: 'player-2', statlyZScore: 0 },
        ],
        picks
      ).map((player) => player.id)
    ).toEqual(['player-2']);
  });
});
