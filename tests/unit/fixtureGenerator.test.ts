import { describe, expect, it } from 'vitest';

import { generateRoundRobinFixtures } from '@/server/leagues/fixtureGenerator';

describe('generateRoundRobinFixtures', () => {
  it('generates one round-robin meeting for even team counts', () => {
    const fixtures = generateRoundRobinFixtures(['a', 'b', 'c', 'd']);

    expect(new Set(fixtures.map((fixture) => fixture.round))).toEqual(new Set([1, 2, 3]));
    expect(fixtures).toHaveLength(6);
    expect(fixtures.some((fixture) => fixture.byeMemberId)).toBe(false);
  });

  it('adds bye fixtures for odd team counts', () => {
    const fixtures = generateRoundRobinFixtures(['a', 'b', 'c']);
    const byes = fixtures.filter((fixture) => fixture.byeMemberId);

    expect(new Set(fixtures.map((fixture) => fixture.round))).toEqual(new Set([1, 2, 3]));
    expect(byes).toHaveLength(3);
    expect(new Set(byes.map((fixture) => fixture.byeMemberId))).toEqual(new Set(['a', 'b', 'c']));
  });
});
