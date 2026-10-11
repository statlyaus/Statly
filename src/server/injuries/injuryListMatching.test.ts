import { describe, expect, it } from 'vitest';
import type { ParsedInjuryRow } from './footywireInjuryList';
import { contentSha256, matchInjuryRowsToPlayers } from './injuryListMatching';

function row(clubName: string, playerName: string, overrides: Partial<ParsedInjuryRow> = {}) {
  const slug = playerName.toLowerCase().replace(/[^a-z]+/g, '-');
  return {
    clubName,
    sourceKey: `pp-${clubName.toLowerCase().replace(/[^a-z]+/g, '-')}--${slug}`,
    playerName,
    injuryRaw: 'Knee',
    returnRaw: 'Season',
    status: 'SEASON',
    etaWeeksMin: null,
    etaWeeksMax: null,
    etaDaysMin: null,
    etaDaysMax: null,
    ...overrides,
  } satisfies ParsedInjuryRow;
}

describe('matchInjuryRowsToPlayers', () => {
  const players = [
    { id: 'p1', name: 'Jack Payne', club: 'Brisbane' },
    { id: 'p2', name: 'Josh Kelly', club: 'GWS' },
    { id: 'p3', name: 'Max King', club: 'St Kilda' },
    { id: 'p4', name: 'Max King', club: 'St Kilda' },
  ];

  it('matches on normalized name and club alias', () => {
    const [matched] = matchInjuryRowsToPlayers([row('Brisbane Lions', 'Jack  Payne')], players);
    expect(matched).toMatchObject({ playerId: 'p1', matchStatus: 'MATCHED' });
  });

  it('leaves a row with no player unmatched', () => {
    const [unmatched] = matchInjuryRowsToPlayers([row('Sydney Swans', 'Nobody Here')], players);
    expect(unmatched).toMatchObject({ playerId: null, matchStatus: 'UNMATCHED' });
  });

  it('never falls back to a name-only match at another club', () => {
    // Josh Kelly is the only Josh Kelly, but at GWS, not Essendon.
    const [unmatched] = matchInjuryRowsToPlayers([row('Essendon Bombers', 'Josh Kelly')], players);
    expect(unmatched).toMatchObject({ playerId: null, matchStatus: 'UNMATCHED' });
  });

  it('marks a row with several candidates ambiguous', () => {
    const [ambiguous] = matchInjuryRowsToPlayers([row('St Kilda Saints', 'Max King')], players);
    expect(ambiguous).toMatchObject({ playerId: null, matchStatus: 'AMBIGUOUS' });
  });

  it('keeps the parsed fields on every row', () => {
    const input = row('Brisbane Lions', 'Jack Payne', { returnRaw: 'Test', status: 'TEST' });
    const [matched] = matchInjuryRowsToPlayers([input], players);
    expect(matched).toEqual({ ...input, playerId: 'p1', matchStatus: 'MATCHED' });
  });
});

describe('contentSha256', () => {
  const rows = [
    row('Fremantle Dockers', 'Sam Sturt', { returnRaw: 'TBC', status: 'TBC' }),
    row('Brisbane Lions', 'Jack Payne'),
    row('Brisbane Lions', 'Henry Smith'),
  ];

  it('is stable under row order and ignores match results', () => {
    const hash = contentSha256(rows);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentSha256([...rows].reverse())).toBe(hash);
    expect(contentSha256(matchInjuryRowsToPlayers(rows, []))).toBe(hash);
  });

  it('changes when a parsed field changes', () => {
    const changed = rows.map((entry, index) =>
      index === 1 ? { ...entry, returnRaw: '2-3 weeks', status: 'WEEKS' as const } : entry
    );
    expect(contentSha256(changed)).not.toBe(contentSha256(rows));
  });
});
