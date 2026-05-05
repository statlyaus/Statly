import { describe, expect, it } from 'vitest';

import { getAflTeamAbbreviation, normalizeTeamName } from '../shared/player-identity/teamNames';

describe('AFL team identity helpers', () => {
  it.each([
    ['BRL', 'Brisbane'],
    ['BRIS', 'Brisbane'],
    ['Kangaroos', 'North Melbourne'],
    ['kangaroos', 'North Melbourne'],
    ['KAN', 'North Melbourne'],
    ['NTH', 'North Melbourne'],
    ['NOR', 'North Melbourne'],
    ['NM', 'North Melbourne'],
    ['WBD', 'Western Bulldogs'],
    ['DOGS', 'Western Bulldogs'],
  ])('normalizes %s to canonical team name', (input, expected) => {
    expect(normalizeTeamName(input)).toBe(expected);
  });

  it.each([
    ['Kangaroos', 'NOR'],
    ['KAN', 'NOR'],
    ['North Melbourne Kangaroos', 'NOR'],
    ['Port Adelaide Power', 'POR'],
    ['Western Bulldogs', 'BUL'],
  ])('returns canonical match abbreviation for %s', (input, expected) => {
    expect(getAflTeamAbbreviation(input)).toBe(expected);
  });
});
