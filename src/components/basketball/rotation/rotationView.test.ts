import { describe, expect, it } from 'vitest';

import type { RotationPlayerView } from '@/server/basketball/readModels/rotationModel';

import { parseRotationQuery, selectRotationPlayers } from './rotationView';

function player(
  fullName: string,
  extra: {
    owner?: RotationPlayerView['owner']['kind'];
    teamCode?: string;
    level?: 'RED' | 'AMBER' | 'GREEN';
    minutesPerGame?: number;
  } = {}
): RotationPlayerView {
  return {
    playerId: fullName,
    fullName,
    teamCode: extra.teamCode ?? 'BOS',
    minutesPerGame: extra.minutesPerGame ?? 20,
    owner:
      extra.owner === 'MINE'
        ? { kind: 'MINE', teamName: 'Me' }
        : { kind: extra.owner === 'ELSEWHERE' ? 'ELSEWHERE' : 'FREE_AGENT', teamName: null },
    alert: extra.level ? { level: extra.level, text: '', marker: '', roleUp: null } : null,
  } as RotationPlayerView;
}

const players = [
  player('Ann', { level: 'GREEN', minutesPerGame: 30 }),
  player('Bea', { owner: 'MINE', teamCode: 'NYK', minutesPerGame: 25 }),
  player('Cat', { level: 'RED', owner: 'ELSEWHERE', minutesPerGame: 10 }),
  player('Dee', { level: 'AMBER', owner: 'MINE', minutesPerGame: 35 }),
  player('Eve', { minutesPerGame: 32 }),
];
const names = (list: RotationPlayerView[]) => list.map((entry) => entry.fullName);

describe('parseRotationQuery', () => {
  it('reads valid params and falls back to defaults otherwise', () => {
    expect(
      parseRotationQuery({ show: 'fa', team: 'NYK', sort: 'mpg', dir: 'asc', limit: '200' }, [
        'BOS',
        'NYK',
      ])
    ).toEqual({ show: 'FREE_AGENTS', team: 'NYK', sort: 'mpg', descending: false, limit: 200 });
    expect(
      parseRotationQuery({ show: 'x', team: 'ZZZ', sort: 'bad', limit: '-3' }, ['BOS'])
    ).toEqual({ show: 'ALL', team: null, sort: 'alert', descending: true, limit: 100 });
  });
});

describe('selectRotationPlayers', () => {
  it('puts the most serious alerts first, then the most minutes', () => {
    expect(names(selectRotationPlayers(players, parseRotationQuery({}, [])))).toEqual([
      'Cat',
      'Dee',
      'Ann',
      'Eve',
      'Bea',
    ]);
  });

  it('filters to my players, free agents or one team, and sorts by name', () => {
    const query = (params: Record<string, string>) => parseRotationQuery(params, ['BOS', 'NYK']);

    expect(names(selectRotationPlayers(players, query({ show: 'mine' })))).toEqual(['Dee', 'Bea']);
    expect(names(selectRotationPlayers(players, query({ show: 'fa', sort: 'name' })))).toEqual([
      'Ann',
      'Eve',
    ]);
    expect(names(selectRotationPlayers(players, query({ team: 'NYK' })))).toEqual(['Bea']);
  });
});
