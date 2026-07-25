import { describe, expect, it } from 'vitest';

import { containsPlayerIdentityReference } from '../../src/server/players/playerIdentityJsonReferences';

describe('player identity JSON references', () => {
  const aliases = new Set(['adam-treloar']);

  it('matches exact string leaves without treating substrings as aliases', () => {
    expect(
      containsPlayerIdentityReference(JSON.stringify({ playerId: 'adam-treloar' }), aliases)
    ).toBe(true);
    expect(
      containsPlayerIdentityReference(
        JSON.stringify({ playerId: 'adam-treloar-western-bulldogs' }),
        aliases
      )
    ).toBe(false);
    expect(
      containsPlayerIdentityReference(
        JSON.stringify({ note: 'watch adam-treloar closely' }),
        aliases
      )
    ).toBe(false);
  });

  it('falls back to a conservative substring scan for malformed legacy data', () => {
    expect(containsPlayerIdentityReference('malformed:adam-treloar', aliases)).toBe(true);
  });
});
