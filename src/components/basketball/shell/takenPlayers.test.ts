import { describe, expect, it } from 'vitest';

import { takenPlayersCheck, takenPlayersSummary } from './takenPlayers';

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

  it('counts players on other entered teams, and the opponent’s team only without a matchup', () => {
    const spots = ['bench-mob', 'bench-mob', null, 'rival', 'mine'];

    expect(takenPlayersCheck(league(4, spots), 'rival')).toMatchObject({ taken: 3, expected: 16 });
    // With no opponent set, every team but mine needs its players entered.
    expect(takenPlayersCheck(league(4, spots), null)).toMatchObject({ taken: 4, expected: 24 });
  });

  it('describes the count and the floor', () => {
    expect(takenPlayersSummary({ taken: 1, expected: 80, enough: false })).toBe(
      '1 player on other teams (at least 80 needed)'
    );
    expect(takenPlayersSummary({ taken: 0, expected: 80, enough: false })).toBe(
      '0 players on other teams (at least 80 needed)'
    );
  });

  it('expects nothing in a two-team league', () => {
    expect(takenPlayersCheck(league(2, ['mine']), 'rival')).toEqual({
      taken: 0,
      expected: 0,
      enough: true,
    });
  });
});
