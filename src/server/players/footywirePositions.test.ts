import { describe, expect, it } from 'vitest';
import {
  combineFootywirePositions,
  mapFootywirePosition,
  parseFootywirePositionNdjson,
  parseLineupPositions,
  planPositionSync,
} from './footywirePositions';

describe('footywire positions', () => {
  it('maps Footywire labels to lineup positions', () => {
    expect(mapFootywirePosition('Defender')).toBe('DEF');
    expect(mapFootywirePosition(' midfield ')).toBe('MID');
    expect(mapFootywirePosition('Ruck')).toBe('RUC');
    expect(mapFootywirePosition('Forward')).toBe('FWD');
    expect(mapFootywirePosition('NA')).toBeNull();
    expect(mapFootywirePosition(null)).toBeNull();
  });

  it('combines primary and secondary positions, primary first', () => {
    expect(combineFootywirePositions('Midfield', 'Forward')).toBe('MID/FWD');
    expect(combineFootywirePositions('Forward', 'Forward')).toBe('FWD');
    expect(combineFootywirePositions('Ruck', null)).toBe('RUC');
    expect(combineFootywirePositions(null, null)).toBeNull();
  });

  it('parses stored positions', () => {
    expect(parseLineupPositions('MID/FWD')).toEqual(['MID', 'FWD']);
    expect(parseLineupPositions('Ruck')).toEqual(['RUC']);
    expect(parseLineupPositions('UTIL')).toEqual([]);
    expect(parseLineupPositions(null)).toEqual([]);
  });

  it('matches by name and club, then by unique name', () => {
    const players = [
      { id: 'p1', name: 'Patrick Cripps', club: 'Carlton', position: 'MID' },
      { id: 'p2', name: 'Charlie Curnow', club: 'Carlton', position: 'MID' },
      { id: 'p3', name: 'Lachie Neale', club: 'Brisbane', position: 'MID' },
      { id: 'p4', name: 'Josh Kelly', club: 'GWS', position: 'MID' },
      { id: 'p5', name: 'Josh Kelly', club: 'Essendon', position: 'MID' },
    ];
    const plan = planPositionSync(
      [
        { team: 'Carlton', first_name: 'Patrick', surname: 'Cripps', position_1: 'Midfield' },
        { team: 'Carlton', first_name: 'Charlie', surname: 'Curnow', position_1: 'Forward' },
        // Club differs (Footywire uses "Brisbane Lions"), still matched by alias.
        {
          team: 'Brisbane Lions',
          first_name: 'Lachie',
          surname: 'Neale',
          position_1: 'Midfield',
          position_2: 'Forward',
        },
        // Two players share the name and neither is at this club.
        { team: 'Hawthorn', first_name: 'Josh', surname: 'Kelly', position_1: 'Midfield' },
        { team: 'Sydney', first_name: 'Nobody', surname: 'Here', position_1: 'Ruck' },
        { team: 'Sydney', first_name: 'No', surname: 'Position', position_1: null },
      ],
      players
    );

    expect(plan.unchanged).toBe(1);
    expect(plan.updates).toEqual([
      { playerId: 'p2', name: 'Charlie Curnow', club: 'Carlton', from: 'MID', to: 'FWD' },
      { playerId: 'p3', name: 'Lachie Neale', club: 'Brisbane', from: 'MID', to: 'MID/FWD' },
    ]);
    expect(plan.ambiguous).toEqual([
      { name: 'Josh Kelly', team: 'Hawthorn', playerIds: ['p4', 'p5'] },
    ]);
    expect(plan.unmatched).toEqual([{ name: 'Nobody Here', team: 'Sydney' }]);
    expect(plan.withoutPosition).toEqual([{ name: 'No Position', team: 'Sydney' }]);
  });

  it('parses NDJSON and rejects invalid lines', () => {
    expect(
      parseFootywirePositionNdjson(
        '{"team":"Carlton","first_name":"A","surname":"B","position_1":"Ruck"}\n\n'
      )
    ).toHaveLength(1);
    expect(() => parseFootywirePositionNdjson('{oops')).toThrow('Line 1');
  });
});
