import { describe, expect, it } from 'vitest';

import { takenPlayersCheck } from './takenPlayers';

function league(teamCount: number, teamIds: (string | null)[]) {
  return {
    teamCount,
    myTeamId: 'mine',
    rosterSpots: teamIds.map((teamId) => ({ teamId })),
  };
}

describe('takenPlayersCheck', () => {
  it('expects eight players per team other than mine and this week’s opponent', () => {
    const spots = [...Array(79).fill(null), ...Array(13).fill('mine'), ...Array(13).fill('rival')];

    expect(takenPlayersCheck(league(12, spots), 'rival')).toEqual({
      taken: 79,
      expected: 80,
      enough: false,
    });
    expect(takenPlayersCheck(league(12, [...spots, null]), 'rival')).toEqual({
      taken: 80,
      expected: 80,
      enough: true,
    });
  });

  it('counts players on other entered teams as taken, and the opponent’s only without a matchup', () => {
    const spots = ['bench-mob', 'bench-mob', null, 'rival', 'mine'];

    expect(takenPlayersCheck(league(4, spots), 'rival').taken).toBe(3);
    expect(takenPlayersCheck(league(4, spots), null).taken).toBe(4);
  });

  it('expects nothing in a two-team league', () => {
    expect(takenPlayersCheck(league(2, ['mine']), 'rival')).toEqual({
      taken: 0,
      expected: 0,
      enough: true,
    });
  });
});
