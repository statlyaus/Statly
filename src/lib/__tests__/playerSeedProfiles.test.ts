import { describe, expect, it } from 'vitest';

import { buildSeedProfileKey } from '@/lib/playerSeedProfiles';

describe('playerSeedProfiles', () => {
  it('normalizes names for profile matching', () => {
    expect(buildSeedProfileKey("Connor O'Sullivan")).toBe('connor osullivan');
    expect(buildSeedProfileKey('  Alex N-Bullen ')).toBe('alex nbullen');
    expect(buildSeedProfileKey('Bailey J. Williams')).toBe('bailey j williams');
  });
});
