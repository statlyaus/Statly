import { describe, expect, it } from 'vitest';

import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import {
  aggregateLocalHpnPavCoreInput,
  type LocalHpnPavDecodedRow,
} from '@/server/aflTradeIntelligence/development/localHpnPavDirectCalculation';

const blank: LocalHpnPavDecodedRow = {
  player: null,
  playingFor: null,
  matchDate: null,
  homeTeam: null,
  awayTeam: null,
  homeScore: null,
  awayScore: null,
  goals: null,
  behinds: null,
  marks: null,
  tackles: null,
  hitOuts: null,
  rebounds: null,
  clearances: null,
  inside50s: null,
  goalAssists: null,
  freesFor: null,
  freesAgainst: null,
  onePercenters: null,
  marksInside50: null,
};

/** One player row in one match: `team` vs `opponent`, with the player's per-match stat line. */
function row(input: {
  player: string;
  team: string;
  home: boolean;
  opponent: string;
  date: string;
  scoreFor: number;
  scoreAgainst: number;
  inside50s: number;
  marks: number;
  goals: number;
  behinds: number;
  tackles: number;
  clearances: number;
}): LocalHpnPavDecodedRow {
  return {
    ...blank,
    player: input.player,
    playingFor: input.team,
    matchDate: input.date,
    homeTeam: input.home ? input.team : input.opponent,
    awayTeam: input.home ? input.opponent : input.team,
    homeScore: String(input.home ? input.scoreFor : input.scoreAgainst),
    awayScore: String(input.home ? input.scoreAgainst : input.scoreFor),
    inside50s: String(input.inside50s),
    marks: String(input.marks),
    goals: String(input.goals),
    behinds: String(input.behinds),
    tackles: String(input.tackles),
    clearances: String(input.clearances),
    rebounds: '1',
    onePercenters: '2',
    hitOuts: '3',
    goalAssists: '1',
    freesFor: '1',
    freesAgainst: '2',
    marksInside50: '0',
  };
}

const playerRow = (input: {
  player: string;
  team: string;
  home: boolean;
  opponent: string;
  date: string;
  scoreFor: number;
  scoreAgainst: number;
  inside50s: number;
  marks: number;
  goals: number;
  behinds: number;
  tackles: number;
  clearances: number;
}) => row(input);

const twoMatchSeason = [
  playerRow({ player: 'Alpha Ace', team: 'Alpha', home: true, opponent: 'Beta', date: '2025-03-01', scoreFor: 80, scoreAgainst: 60, inside50s: 10, marks: 8, goals: 3, behinds: 1, tackles: 4, clearances: 6 }),
  playerRow({ player: 'Alpha Two', team: 'Alpha', home: true, opponent: 'Beta', date: '2025-03-01', scoreFor: 80, scoreAgainst: 60, inside50s: 4, marks: 3, goals: 1, behinds: 0, tackles: 2, clearances: 2 }),
  playerRow({ player: 'Beta Best', team: 'Beta', home: false, opponent: 'Alpha', date: '2025-03-01', scoreFor: 60, scoreAgainst: 80, inside50s: 6, marks: 5, goals: 2, behinds: 0, tackles: 3, clearances: 4 }),
  playerRow({ player: 'Beta Two', team: 'Beta', home: false, opponent: 'Alpha', date: '2025-03-01', scoreFor: 60, scoreAgainst: 80, inside50s: 2, marks: 2, goals: 0, behinds: 1, tackles: 1, clearances: 1 }),
  playerRow({ player: 'Beta Best', team: 'Beta', home: true, opponent: 'Alpha', date: '2025-03-08', scoreFor: 70, scoreAgainst: 90, inside50s: 5, marks: 4, goals: 2, behinds: 1, tackles: 2, clearances: 3 }),
  playerRow({ player: 'Beta Two', team: 'Beta', home: true, opponent: 'Alpha', date: '2025-03-08', scoreFor: 70, scoreAgainst: 90, inside50s: 3, marks: 2, goals: 1, behinds: 0, tackles: 1, clearances: 1 }),
  playerRow({ player: 'Alpha Ace', team: 'Alpha', home: false, opponent: 'Beta', date: '2025-03-08', scoreFor: 90, scoreAgainst: 70, inside50s: 12, marks: 9, goals: 4, behinds: 2, tackles: 5, clearances: 7 }),
  playerRow({ player: 'Alpha Two', team: 'Alpha', home: false, opponent: 'Beta', date: '2025-03-08', scoreFor: 90, scoreAgainst: 70, inside50s: 5, marks: 4, goals: 1, behinds: 1, tackles: 3, clearances: 2 }),
];

describe('aggregateLocalHpnPavCoreInput', () => {
  it('conserves points and inside 50s across the league', () => {
    const teams = aggregateLocalHpnPavCoreInput({ season: 2025, rows: twoMatchSeason });

    expect(teams).toHaveLength(2);
    const sum = (field: 'pointsFor' | 'pointsAgainst' | 'inside50sFor' | 'inside50sAgainst') =>
      teams.reduce((total, team) => total + team[field], 0);
    expect(sum('pointsFor')).toBe(sum('pointsAgainst'));
    expect(sum('inside50sFor')).toBe(sum('inside50sAgainst'));
    // Inside-50 "against" derives from the opponent's player rows, not a guessed total.
    const alpha = teams.find((team) => team.teamId === 'Alpha')!;
    const beta = teams.find((team) => team.teamId === 'Beta')!;
    expect(alpha.inside50sFor).toBe(31);
    expect(beta.inside50sAgainst).toBe(31);
  });

  it('groups every player row under exactly one team and one season spell', () => {
    const teams = aggregateLocalHpnPavCoreInput({ season: 2025, rows: twoMatchSeason });

    const spells = teams.flatMap((team) => team.players.map((player) => player.spellVersionId));
    expect(new Set(spells).size).toBe(spells.length);
    for (const team of teams) {
      for (const player of team.players) {
        expect(player.spellVersionId).toBe(`spell:2025:${team.teamId}:${player.playerId}`);
      }
    }
  });

  it('produces a valid PAV result whose totals conserve', () => {
    const teams = aggregateLocalHpnPavCoreInput({ season: 2025, rows: twoMatchSeason });
    const result = calculateAflTradeHpnPavCore(teams);

    expect(result.league.teamCount).toBe(2);
    expect(result.league.componentPools).toEqual({
      offensivePav: 200,
      midfieldPav: 200,
      defensivePav: 200,
    });
    expect(result.league.totalPav).toBe(600);
    expect(result.teams.reduce((total, team) => total + team.totalPav, 0)).toBeCloseTo(
      result.league.totalPav,
      8
    );
    expect(result.players.reduce((total, player) => total + player.totalPav, 0)).toBeCloseTo(
      result.league.totalPav,
      8
    );
  });

  it('gives the player with the stronger stat line the higher PAV', () => {
    const teams = aggregateLocalHpnPavCoreInput({ season: 2025, rows: twoMatchSeason });
    const result = calculateAflTradeHpnPavCore(teams);

    const ace = result.players.find((player) => player.playerId === 'Alpha Ace')!;
    const two = result.players.find((player) => player.playerId === 'Alpha Two')!;
    expect(ace.totalPav).toBeGreaterThan(two.totalPav);
  });

  it('drops rows for a side that is neither home nor away rather than corrupting totals', () => {
    const stray: LocalHpnPavDecodedRow = {
      ...row({
        player: 'Stray', team: 'Nowhere', home: false, opponent: 'Alpha',
        date: '2025-03-01', scoreFor: 1, scoreAgainst: 1, inside50s: 50, marks: 0,
        goals: 0, behinds: 0, tackles: 0, clearances: 0,
      }),
      // The row helper derives awayTeam from the player's own side; override so the side is
      // genuinely neither home nor away.
      awayTeam: 'Beta',
    };
    const teams = aggregateLocalHpnPavCoreInput({ season: 2025, rows: [stray, ...twoMatchSeason] });

    expect(teams).toHaveLength(2);
    expect(
      teams.flatMap((team) => team.players).some((player) => player.playerId === 'Stray')
    ).toBe(false);
  });

  it('returns no teams for an empty season', () => {
    expect(aggregateLocalHpnPavCoreInput({ season: 2025, rows: [] })).toEqual([]);
  });
});
