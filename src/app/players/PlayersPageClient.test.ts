import { describe, expect, it } from 'vitest';

import { mergeLeaguePlayerRows } from './PlayersPageClient';

describe('mergeLeaguePlayerRows', () => {
  it('overlays league metadata onto global player rows', () => {
    const merged = mergeLeaguePlayerRows(
      [
        {
          id: 'player-1',
          name: 'Player One',
          team: 'AAA',
          position: 'MID',
          ownership: 0,
          stats: { tackles: 4.2 },
        },
      ],
      [
        {
          id: 'player-1',
          name: 'Player One',
          team: 'AAA',
          position: 'MID',
          ownership: 50,
          ownershipStatus: 'Owned',
          ownerTeamName: 'Alpha',
          statsSummary: { disposals: 22.3, tackles: 5.1 },
        },
      ]
    );

    expect(merged).toEqual([
      expect.objectContaining({
        id: 'player-1',
        ownership: 50,
        ownershipStatus: 'Owned',
        ownerTeam: 'Alpha',
        ownerTeamName: 'Alpha',
        stats: expect.objectContaining({
          disposals: 22.3,
          tackles: 4.2,
        }),
      }),
    ]);
  });

  it('retains league-only players instead of dropping them', () => {
    const merged = mergeLeaguePlayerRows([], [
      {
        id: 'player-2',
        name: 'Player Two',
        team: 'BBB',
        position: 'DEF',
        ownership: 0,
        ownershipStatus: 'Available',
        statsSummary: { marks: 6.4 },
      },
    ]);

    expect(merged).toEqual([
      expect.objectContaining({
        id: 'player-2',
        name: 'Player Two',
        team: 'BBB',
        position: 'DEF',
        ownershipStatus: 'Available',
        stats: expect.objectContaining({
          marks: 6.4,
        }),
      }),
    ]);
  });

  it('does not duplicate players when league and global sources use different ids', () => {
    const merged = mergeLeaguePlayerRows(
      [
        {
          id: 'nick-blakey-sydney',
          name: 'Nick Blakey',
          team: 'Sydney',
          position: 'DEF',
          stats: { tackles: 3.1 },
        },
      ],
      [
        {
          id: 'nick_blakey',
          name: 'Nick Blakey',
          team: 'Sydney',
          position: 'DEF',
          ownership: 50,
          ownershipStatus: 'Owned',
          ownerTeamName: 'Alpha',
          statsSummary: { disposals: 24.4 },
        },
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: 'nick-blakey-sydney',
        name: 'Nick Blakey',
        team: 'Sydney',
        ownership: 50,
        ownershipStatus: 'Owned',
        ownerTeam: 'Alpha',
        stats: expect.objectContaining({
          disposals: 24.4,
          tackles: 3.1,
        }),
      })
    );
  });
});
