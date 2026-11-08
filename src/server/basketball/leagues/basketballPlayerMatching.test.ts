import { describe, expect, it } from 'vitest';

import {
  cleanPastedLine,
  matchPlayerNames,
  normalisePlayerName,
  searchPlayersByName,
  type MatchablePlayer,
} from './basketballPlayerMatching';

function player(
  id: string,
  fullName: string,
  lastName: string | null = null,
  active = true
): MatchablePlayer {
  return { id, fullName, lastName, active };
}

describe('normalisePlayerName', () => {
  it.each([
    ['Nikola Jokić', 'nikola jokic'],
    ['Luka Dončić', 'luka doncic'],
    ['Dario Šarić', 'dario saric'],
    ['Nikola Đurišić', 'nikola durisic'],
    ["De'Aaron Fox", 'deaaron fox'],
    ['P.J. Washington', 'pj washington'],
    ['Shai Gilgeous-Alexander', 'shai gilgeous alexander'],
    ['Jaren Jackson Jr.', 'jaren jackson'],
    ['Gary Payton II', 'gary payton'],
    ['Tim Hardaway Sr', 'tim hardaway'],
    ['  KEVIN   durant ', 'kevin durant'],
  ])('%s → %s', (input, expected) => {
    expect(normalisePlayerName(input)).toBe(expected);
  });
});

describe('cleanPastedLine', () => {
  it.each([
    ['Stephen Curry GS - PG,SG', 'Stephen Curry'],
    ['PG Stephen Curry GS - PG,SG DTD', 'Stephen Curry'],
    ['Util Jaren Jackson Jr. Mem - PF,C O', 'Jaren Jackson Jr.'],
    ['BN #30 Stephen Curry', 'Stephen Curry'],
    ['IL+ Joel Embiid Phi - C INJ', 'Joel Embiid'],
    ['Nikola Jokić DEN C', 'Nikola Jokić'],
    ['Victor Wembanyama (SAS)', 'Victor Wembanyama'],
    ['PG\tTyrese Haliburton Ind - PG\t@Bos\t7:30 pm', 'Tyrese Haliburton'],
    ['Luka Doncic', 'Luka Doncic'],
    ['LeBron James SF, PF', 'LeBron James'],
    ['LeBron James LAL - SF; PF', 'LeBron James'],
  ])('%s → %s', (line, expected) => {
    expect(cleanPastedLine(line)).toBe(expected);
  });

  it('drops lines that are only clutter', () => {
    for (const line of ['BN', 'PG,SG', 'DTD', '  ', '#7', 'Den']) {
      expect(cleanPastedLine(line)).toBe('');
    }
  });

  it('drops header, stat, date and acquisition lines from a whole rosters page', () => {
    for (const line of [
      'Pos\tPlayer\tOpp\tStatus',
      'Pos Player Opp Status',
      'Pos\tPlayer\tOpp\tStatus\tMIN*\tFGM/A*\tFG%\tFTM/A*\tFT%\t3PTM\tPTS\tREB\tAST\tST\tBLK\tTO',
      'SLOT\tPLAYER\tACQ',
      'STARTERS',
      'Totals\t\t\t\t31:40\t38/81\t.469\t17/21\t.810\t11\t104\t44\t25\t7\t5\t13',
      '34:12  7/15  .467  2/2  1.000  3  24',
      '(5-2-0)',
      'Week 3 (Nov 9 - 15)',
      'Mon, Nov 9',
      'vs LAL',
      '@Bos',
      '7:30 pm',
      'Draft',
      'No new player Notes',
      'W',
    ]) {
      expect(cleanPastedLine(line)).toBe('');
    }
  });

  it('strips Yahoo note labels and stat cells around a name', () => {
    expect(cleanPastedLine('No new player Notes Ravi Okafor Bos - PG')).toBe('Ravi Okafor');
    expect(cleanPastedLine('SG\tNew Player Note\tTheo Lindqvist Den - SG,SF\tvs LAL\tGTD')).toBe(
      'Theo Lindqvist'
    );
    expect(cleanPastedLine('Bram Okonkwo Utah - C 31:05 6/11 .545 24')).toBe('Bram Okonkwo');
    expect(cleanPastedLine('Hugo Mbeki Sac - C SSPD')).toBe('Hugo Mbeki');
  });

  it('reads only the players from hand-made whole-page Yahoo and ESPN pastes', () => {
    const names = (page: string) => page.split('\n').map(cleanPastedLine).filter(Boolean);
    const yahoo = [
      'Rosters',
      'Week 3 (Nov 9 - 15)',
      'Rim Runners',
      'Pos\tPlayer\tOpp\tStatus',
      'PG\tNo new player Notes\tRavi Okafor Bos - PG\t@NYK\t',
      'SG\tTheo Lindqvist Den - SG,SF\tvs LAL\tGTD',
      'Util\tMarco Bellamy Jr. Ind - PG,SG\t\t',
      'BN\tSilas Ferreira-Diaz Phi - PF,C\t@Bos\tINJ',
      'IL+\tHugo Mbeki Sac - C\t\tO',
      'Paint Patrol',
      'Pos\tPlayer\tOpp\tStatus',
      'C\tBram Okonkwo Utah - C\t7:30 pm\t',
    ].join('\n');
    const espn = [
      'Paint Patrol',
      '(PP)',
      '(5-2-0)',
      'SLOT\tPLAYER\tACQ',
      'STARTERS',
      'PG',
      'Elliot Park',
      'Chi',
      'PG',
      'DTD',
      'Draft',
      'C',
      'Desmond Vuković',
      'Mia',
      'SF, PF',
      'Trade',
      'BENCH',
      'IR',
    ].join('\n');

    expect(names(yahoo)).toEqual([
      'Rim Runners',
      'Ravi Okafor',
      'Theo Lindqvist',
      'Marco Bellamy Jr.',
      'Silas Ferreira-Diaz',
      'Hugo Mbeki',
      'Paint Patrol',
      'Bram Okonkwo',
    ]);
    // Team names and ESPN's team abbreviation are kept: they come back as "No match".
    expect(names(espn)).toEqual(['Paint Patrol', '(PP)', 'Elliot Park', 'Desmond Vuković']);
  });

  it('never strips a name token from the middle', () => {
    expect(cleanPastedLine('Mo Bamba')).toBe('Mo Bamba');
    expect(cleanPastedLine('C.J. McCollum NO - SG')).toBe('C.J. McCollum');
  });
});

describe('matchPlayerNames', () => {
  const players = [
    player('jokic', 'Nikola Jokić', 'Jokić'),
    player('curry', 'Stephen Curry', 'Curry'),
    player('seth', 'Seth Curry', 'Curry'),
    player('jjj', 'Jaren Jackson Jr.', 'Jackson Jr.'),
    player('josh-jackson-old', 'Josh Jackson', 'Jackson', false),
    player('ant', 'Anthony Edwards', 'Edwards'),
    player('kessler-old', 'Kessler Edwards', 'Edwards', false),
    player('keon', 'Keon Johnson', 'Johnson'),
    player('keldon', 'Keldon Johnson', 'Johnson'),
    player('kj-old', 'Kevin Johnson', 'Johnson', false),
    player('twin-a', 'Marcus Morris', 'Morris', false),
    player('twin-b', 'Marcus Morris', 'Morris', true),
  ];

  it('matches an exact normalised full name, accents and suffixes ignored', () => {
    const [jokic, jjj] = matchPlayerNames(['nikola jokic', 'Jaren Jackson'], players);

    expect(jokic).toMatchObject({ status: 'matched', candidates: [{ id: 'jokic' }] });
    expect(jjj).toMatchObject({ status: 'matched', candidates: [{ id: 'jjj' }] });
  });

  it('prefers the active player when an exact name is shared', () => {
    expect(matchPlayerNames(['Marcus Morris'], players)[0]).toMatchObject({
      status: 'matched',
      candidates: [{ id: 'twin-b' }],
    });
  });

  it('suggests the one player with the same first initial and surname', () => {
    expect(matchPlayerNames(['Nik Jokic'], players)[0]).toMatchObject({
      status: 'suggested',
      candidates: [{ id: 'jokic' }],
    });
    expect(matchPlayerNames(['A. Edwards'], players)[0]).toMatchObject({
      status: 'suggested',
      candidates: [{ id: 'ant' }],
    });
  });

  it('lists every active candidate when the initial and surname are shared', () => {
    const [johnson, curry] = matchPlayerNames(['K Johnson', 'Steph Curry'], players);

    expect(johnson.status).toBe('ambiguous');
    expect(johnson.candidates.map((candidate) => candidate.id)).toEqual(['keldon', 'keon']);
    expect(curry.status).toBe('ambiguous');
    expect(curry.candidates.map((candidate) => candidate.id)).toEqual(['seth', 'curry']);
  });

  it('caps ambiguous candidates at five', () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      player(`j${index}`, `J${'a'.repeat(index + 1)} Smith`, 'Smith')
    );
    const [result] = matchPlayerNames(['J Smith'], many);

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(5);
  });

  it('reports no match rather than guessing', () => {
    expect(matchPlayerNames(['Michael Jordan', 'Curry'], players)).toEqual([
      { name: 'Michael Jordan', status: 'none', candidates: [] },
      { name: 'Curry', status: 'none', candidates: [] },
    ]);
  });
});

describe('searchPlayersByName', () => {
  const players = [
    player('jokic', 'Nikola Jokić', 'Jokić'),
    player('jovic', 'Nikola Jović', 'Jović'),
    player('jokic-fan', 'Jokicson Smith', 'Smith'),
    player('kj', 'Nikola Vučević', 'Vučević'),
  ];

  it('finds accented names from plain text', () => {
    expect(searchPlayersByName('jokic', players, 10).map((p) => p.id)).toEqual([
      'jokic-fan',
      'jokic',
    ]);
  });

  it('ranks an exact name, then name prefixes, then word prefixes', () => {
    expect(searchPlayersByName('Nikola Jokic', players, 10).map((p) => p.id)).toEqual(['jokic']);
    expect(searchPlayersByName('nikola', players, 10).map((p) => p.id)).toEqual([
      'jokic',
      'jovic',
      'kj',
    ]);
    expect(searchPlayersByName('nikola', players, 2)).toHaveLength(2);
  });

  it('returns nothing for a query that normalises to under two characters', () => {
    expect(searchPlayersByName('..', players, 10)).toEqual([]);
  });
});
