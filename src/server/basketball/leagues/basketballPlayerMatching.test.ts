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
