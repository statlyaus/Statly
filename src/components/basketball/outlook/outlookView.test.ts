import { describe, expect, it } from 'vitest';

import type { OutlookPlayer } from '@/server/basketball/readModels/roleOutlook';

import { outlookPanels, parseOutlookQuery, selectOutlookPlayers } from './outlookView';

type Kind = OutlookPlayer['owner']['kind'];

/** Only the fields the view reads; the rest of a real row is irrelevant here. */
function player(
  fullName: string,
  extra: {
    owner?: Kind;
    relevant?: boolean;
    usage?: number;
    pts?: number;
    rosPts?: number;
  } = {}
): OutlookPlayer {
  const kind = extra.owner ?? 'FREE_AGENT';
  return {
    playerId: fullName,
    fullName,
    owner:
      kind === 'FREE_AGENT' || kind === 'ELSEWHERE'
        ? { kind, teamName: null }
        : { kind, teamName: kind === 'MINE' ? 'Me' : 'Them' },
    relevant: extra.relevant ?? kind !== 'FREE_AGENT',
    role: { totalUsageNext5: extra.usage ?? 10 },
    next5: { stats: { pts: extra.pts ?? 10 } },
    restOfSeason: { minutes: 20, stats: { pts: extra.rosPts ?? 10 } },
  } as unknown as OutlookPlayer;
}

const names = (list: OutlookPlayer[]) => list.map((entry) => entry.fullName);

describe('parseOutlookQuery', () => {
  it('defaults to the next 5 games, the relevant players and total usage, most first', () => {
    expect(parseOutlookQuery({})).toEqual({
      view: 'NEXT5',
      show: 'RELEVANT',
      sort: 'usage',
      descending: true,
    });
  });

  it('reads valid params and keeps a sort only where its view has that column', () => {
    expect(parseOutlookQuery({ view: 'ros', show: 'fa', sort: 'pts', dir: 'asc' })).toEqual({
      view: 'ROS',
      show: 'FREE_AGENTS',
      sort: 'pts',
      descending: false,
    });
    // Total usage is a next-5 column: the rest-of-season view falls back to its minutes.
    expect(parseOutlookQuery({ view: 'ros', sort: 'usage' })).toMatchObject({
      sort: 'min',
      descending: true,
    });
    expect(parseOutlookQuery({ view: 'x', show: 'y', sort: 'z', dir: 'w' })).toEqual(
      parseOutlookQuery({})
    );
    expect(parseOutlookQuery({ sort: 'name' })).toMatchObject({ descending: false });
  });

  it('ignores object prototype names as sort keys', () => {
    for (const sort of ['valueOf', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(parseOutlookQuery({ sort })).toMatchObject({ sort: 'usage' });
      expect(parseOutlookQuery({ view: 'ros', sort })).toMatchObject({ sort: 'min' });
    }
  });
});

describe('selectOutlookPlayers', () => {
  // In the season order (total usage next 5, highest first), as the read model returns them.
  const players = [
    player('Ann', { owner: 'OPPONENT', usage: 30, pts: 20, rosPts: 15 }),
    player('Bea', { owner: 'MINE', usage: 25, pts: 25, rosPts: 22 }),
    player('Cat', { relevant: true, usage: 20, pts: 18, rosPts: 25 }),
    player('Dee', { owner: 'TEAM', usage: 15, pts: 12, rosPts: 12 }),
    player('Eve', { owner: 'ELSEWHERE', usage: 12, pts: 30, rosPts: 9 }),
    player('Fay', { usage: 8, pts: 5, rosPts: 5 }),
  ];
  const select = (params: Record<string, string>) =>
    names(selectOutlookPlayers(players, parseOutlookQuery(params)));

  it('shows rostered players and the top free agents, in the season order', () => {
    expect(select({})).toEqual(['Ann', 'Bea', 'Cat', 'Dee', 'Eve']);
    expect(select({ show: 'all' })).toEqual(['Ann', 'Bea', 'Cat', 'Dee', 'Eve', 'Fay']);
  });

  it('filters by owner', () => {
    expect(select({ show: 'mine' })).toEqual(['Bea']);
    expect(select({ show: 'opponent' })).toEqual(['Ann']);
    expect(select({ show: 'fa' })).toEqual(['Cat', 'Fay']);
    expect(select({ show: 'rostered' })).toEqual(['Ann', 'Bea', 'Dee', 'Eve']);
  });

  it("sorts by the chosen view's column, either way, or by name", () => {
    expect(select({ show: 'all', sort: 'pts' })).toEqual([
      'Eve',
      'Bea',
      'Ann',
      'Cat',
      'Dee',
      'Fay',
    ]);
    expect(select({ show: 'all', view: 'ros', sort: 'pts' })).toEqual([
      'Cat',
      'Bea',
      'Ann',
      'Dee',
      'Eve',
      'Fay',
    ]);
    expect(select({ show: 'mine', sort: 'usage', dir: 'asc' })).toEqual(['Bea']);
    expect(select({ sort: 'usage', dir: 'asc' })).toEqual(['Eve', 'Dee', 'Cat', 'Bea', 'Ann']);
    expect(select({ show: 'all', sort: 'name', dir: 'desc' })).toEqual([
      'Fay',
      'Eve',
      'Dee',
      'Cat',
      'Bea',
      'Ann',
    ]);
  });
});

describe('outlookPanels', () => {
  /** A row for the ranked lists: minutes last 5, change, injury shift, points vs average, games. */
  function row(
    fullName: string,
    [minutesLast5, minutesChange, injuryMinutesShift, ptsVsSeason, expectedGames = 4.5]: number[]
  ): OutlookPlayer {
    return {
      playerId: fullName,
      fullName,
      role: { minutesLast5, minutesChange, injuryMinutesShift },
      next5: { expectedGames, vsSeason: { pts: ptsVsSeason } },
    } as unknown as OutlookPlayer;
  }

  it("applies the sheet's chart rules: minutes floor, games floor, thresholds, biggest first", () => {
    const panels = outlookPanels([
      row('Ann', [30, 2.4, 0, -5.2]),
      row('Bea', [15, -6.8, -10.2, 1]),
      row('Cat', [14.9, 5, 0.5, 9]), // under 15 minutes: only the injury list
      row('Dee', [25, 3, 3, 3, 0.9]), // expected to miss most of the next 5: in no list
      row('Eve', [20, 2.4, -0.4, 0]), // ties Ann: after her, in the season order
      row('Fay', [20, 0, 0.6, -1]),
    ]);

    expect(names(panels.gaining)).toEqual(['Ann', 'Eve']);
    expect(names(panels.losing)).toEqual(['Bea']);
    expect(names(panels.injuryShifts)).toEqual(['Bea', 'Fay', 'Cat']);
    expect(names(panels.pointsVsAverage)).toEqual(['Ann', 'Bea', 'Fay', 'Eve']);
  });

  it('keeps 10 players either way for minutes and 15 for the other lists', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row(`P${i}`, [30, i % 2 ? i : -i - 1, i + 1, i + 1])
    );
    const panels = outlookPanels(many);

    expect(names(panels.gaining)).toEqual([
      'P19',
      'P17',
      'P15',
      'P13',
      'P11',
      'P9',
      'P7',
      'P5',
      'P3',
      'P1',
    ]);
    expect(panels.losing.map((p) => p.role.minutesChange)).toEqual([
      -19, -17, -15, -13, -11, -9, -7, -5, -3, -1,
    ]);
    expect(panels.injuryShifts).toHaveLength(15);
    expect(panels.injuryShifts[0].fullName).toBe('P19');
    expect(panels.pointsVsAverage).toHaveLength(15);
  });
});
