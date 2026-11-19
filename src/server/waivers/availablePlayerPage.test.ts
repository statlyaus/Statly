import { describe, expect, it } from 'vitest';

import { pageAvailablePlayers } from './availablePlayerPage';

const players = Array.from({ length: 5 }, (_, index) => ({
  id: `p${index + 1}`,
  name: ['Nick Daicos', 'Josh Daicos', 'Max Gawn', 'Tim English', 'Sam Walsh'][index]!,
}));

describe('waiver available-player page', () => {
  it('pages by id after the cursor', () => {
    expect(pageAvailablePlayers(players, { limit: 2 })).toEqual({
      page: [players[0], players[1]],
      hasMore: true,
    });
    expect(pageAvailablePlayers(players, { limit: 2, cursor: 'p4' }).page).toEqual([players[4]]);
  });

  it('searches every available player by name before paging', () => {
    expect(pageAvailablePlayers(players, { limit: 1, search: 'daicos' })).toEqual({
      page: [players[0]],
      hasMore: true,
    });
    expect(pageAvailablePlayers(players, { limit: 10, search: 'GAWN' }).page).toEqual([players[2]]);
  });

  it('puts a deep-linked player first on the first page when he is beyond it', () => {
    const result = pageAvailablePlayers(players, { limit: 2, requestedPlayerId: 'p5' });

    expect(result.page.map(({ id }) => id)).toEqual(['p5', 'p1', 'p2']);
  });

  it('ignores a deep-linked player who is already on the page, unavailable, or on a later page request', () => {
    expect(pageAvailablePlayers(players, { limit: 2, requestedPlayerId: 'p2' }).page).toHaveLength(
      2
    );
    expect(
      pageAvailablePlayers(players, { limit: 2, requestedPlayerId: 'rostered' }).page
    ).toHaveLength(2);
    expect(
      pageAvailablePlayers(players, { limit: 2, cursor: 'p2', requestedPlayerId: 'p5' }).page.map(
        ({ id }) => id
      )
    ).toEqual(['p3', 'p4']);
  });
});
