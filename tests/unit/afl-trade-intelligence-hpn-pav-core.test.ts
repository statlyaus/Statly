import { describe, expect, it } from 'vitest';

import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';

const player = (playerId: string, sourceRowId: string, inside50s: number) => ({
  spellVersionId: `spell:${sourceRowId}`,
  playerId,
  sourceRowIds: [sourceRowId],
  totalPoints: 12,
  hitOuts: 1,
  goalAssists: 1,
  inside50s,
  marks: 4,
  marksInside50: 1,
  freeKicksFor: 2,
  freeKicksAgainst: 1,
  rebound50s: 2,
  onePercenters: 2,
  clearances: 3,
  tackles: 4,
});

const teams = [
  {
    teamId: 'club:a',
    pointsFor: 100,
    pointsAgainst: 80,
    inside50sFor: 50,
    inside50sAgainst: 40,
    players: [player('player:mover', 'row:a:mover', 6), player('player:a', 'row:a', 4)],
  },
  {
    teamId: 'club:b',
    pointsFor: 80,
    pointsAgainst: 100,
    inside50sFor: 40,
    inside50sAgainst: 50,
    players: [player('player:mover', 'row:b:mover', 5), player('player:b', 'row:b', 3)],
  },
] as const;

describe('HPN PAV calculation core', () => {
  it('allocates three 100-PAV component pools per team and preserves player-club spells', () => {
    const result = calculateAflTradeHpnPavCore(teams);

    expect(result.league.componentPools).toEqual({
      offensivePav: 200,
      midfieldPav: 200,
      defensivePav: 200,
    });
    expect(result.league.totalPav).toBe(600);
    expect(result.teams.reduce((sum, team) => sum + team.totalPav, 0)).toBeCloseTo(600, 8);
    expect(result.players.filter(({ playerId }) => playerId === 'player:mover')).toHaveLength(2);
    expect(result.players.map(({ playerId, teamId }) => `${playerId}|${teamId}`)).toEqual([
      'player:a|club:a',
      'player:mover|club:a',
      'player:b|club:b',
      'player:mover|club:b',
    ]);
  });

  it('preserves repeated spells for the same player and club as separate auditable values', () => {
    const repeatSpellTeams = [
      {
        ...teams[0],
        players: [
          player('player:mover', 'row:a:first-spell', 3),
          player('player:mover', 'row:a:second-spell', 3),
          player('player:a', 'row:a', 4),
        ],
      },
      teams[1],
    ] as const;

    const result = calculateAflTradeHpnPavCore(repeatSpellTeams);
    const repeated = result.players.filter(
      ({ playerId, teamId }) => playerId === 'player:mover' && teamId === 'club:a'
    );

    expect(repeated).toHaveLength(2);
    expect(repeated.map(({ spellVersionId }) => spellVersionId)).toEqual([
      'spell:row:a:first-spell',
      'spell:row:a:second-spell',
    ]);
    expect(result.teams.reduce((sum, team) => sum + team.totalPav, 0)).toBeCloseTo(600, 8);
  });

  it('is invariant to team and player input ordering', () => {
    const reversed = teams
      .map((team) => ({ ...team, players: [...team.players].reverse() }))
      .reverse();
    expect(calculateAflTradeHpnPavCore(reversed)).toEqual(calculateAflTradeHpnPavCore(teams));
  });

  it('rejects non-conserved league totals and non-positive component denominators', () => {
    expect(() =>
      calculateAflTradeHpnPavCore([{ ...teams[0], pointsAgainst: 79 }, teams[1]])
    ).toThrow(/conserve/i);
    const zeroPlayer = {
      ...teams[0].players[0],
      totalPoints: 0,
      hitOuts: 0,
      goalAssists: 0,
      inside50s: 0,
      marks: 0,
      marksInside50: 0,
      freeKicksFor: 0,
      freeKicksAgainst: 0,
      rebound50s: 0,
      onePercenters: 0,
      clearances: 0,
      tackles: 0,
    };
    expect(() =>
      calculateAflTradeHpnPavCore([{ ...teams[0], players: [zeroPlayer] }, teams[1]])
    ).toThrow(/denominator/i);
  });
});
