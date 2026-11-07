import { describe, expect, it } from 'vitest';

import type { PoolPlayer } from '@/server/basketball/readModels/playerPool';
import type { BasketballCategoryId } from '@/types/basketball';

import { parsePlayersQuery, selectPlayers } from './playersView';

const categories: BasketballCategoryId[] = ['PTS', 'REB', 'AST'];

function player(id: string, extra: Partial<PoolPlayer> = {}): PoolPlayer {
  return {
    playerId: id,
    fullName: id,
    teamId: 'BOS',
    teamCode: 'BOS',
    positions: ['G'],
    injury: null,
    owner: { kind: 'FREE_AGENT', teamName: null },
    gamesThisSeason: 5,
    gamesLastSeason: 70,
    weightThisSeason: 1 / 3,
    minutesPerGame: 30,
    perGame: {} as PoolPlayer['perGame'],
    categoryZ: { FG_PCT: 0, FT_PCT: 0, THREES: 0, PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0, TO: 0 },
    value: 0,
    rank: 1,
    inPool: true,
    auctionDollars: null,
    ...extra,
  };
}

describe('parsePlayersQuery', () => {
  it('defaults to every player by value, league punts', () => {
    expect(parsePlayersQuery({}, categories)).toEqual({
      freeAgentsOnly: false,
      position: null,
      minMinutes: 0,
      search: '',
      sort: 'value',
      descending: true,
      limit: 100,
      punts: null,
    });
  });

  it('reads a punt what-if, keeping only league categories and at least one counted', () => {
    expect(parsePlayersQuery({ punts: 'AST,FT_PCT,junk' }, categories).punts).toEqual(['AST']);
    expect(parsePlayersQuery({ punts: 'none' }, categories).punts).toEqual([]);
    expect(parsePlayersQuery({ punts: 'PTS,REB,AST' }, categories).punts).toBeNull();
  });

  it('reads filters and sort, ignoring junk', () => {
    expect(
      parsePlayersQuery(
        { fa: '1', pos: 'C', mpg: '20', q: ' Jok ', sort: 'REB', dir: 'asc', limit: '300' },
        categories
      )
    ).toMatchObject({
      freeAgentsOnly: true,
      position: 'C',
      minMinutes: 20,
      search: 'Jok',
      sort: 'REB',
      descending: false,
      limit: 300,
    });
    expect(parsePlayersQuery({ pos: 'Z', sort: 'STL', mpg: 'x' }, categories)).toMatchObject({
      position: null,
      sort: 'value',
      minMinutes: 0,
    });
  });
});

describe('selectPlayers', () => {
  const players = [
    player('Nikola Jokić', {
      positions: ['C'],
      value: 9,
      rank: 1,
      owner: { kind: 'MINE', teamName: 'Me' },
    }),
    player('Jalen Brunson', { teamCode: 'NYK', value: 5, rank: 2 }),
    player('Bench Guy', { minutesPerGame: 12, value: -1, rank: 3 }),
  ];
  const base = parsePlayersQuery({}, categories);

  it('filters free agents, position, minutes and accent-insensitive name or team', () => {
    const names = (query: Partial<typeof base>) =>
      selectPlayers(players, { ...base, ...query }, () => 0).map((p) => p.fullName);

    expect(names({ freeAgentsOnly: true })).toEqual(['Jalen Brunson', 'Bench Guy']);
    expect(names({ position: 'C' })).toEqual(['Nikola Jokić']);
    expect(names({ minMinutes: 20 })).toEqual(['Nikola Jokić', 'Jalen Brunson']);
    expect(names({ search: 'jokic' })).toEqual(['Nikola Jokić']);
    expect(names({ search: 'nyk' })).toEqual(['Jalen Brunson']);
  });

  it('sorts by the chosen column in either direction', () => {
    const order = (query: Partial<typeof base>, gamesLeft = (_: PoolPlayer) => 0) =>
      selectPlayers(players, { ...base, ...query }, gamesLeft).map((p) => p.fullName);

    expect(order({ sort: 'value', descending: false })).toEqual([
      'Bench Guy',
      'Jalen Brunson',
      'Nikola Jokić',
    ]);
    expect(order({ sort: 'name', descending: false })[0]).toBe('Bench Guy');
    expect(order({ sort: 'gamesLeft' }, (p) => (p.fullName === 'Bench Guy' ? 4 : 2))[0]).toBe(
      'Bench Guy'
    );
  });
});
