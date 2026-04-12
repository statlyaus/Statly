import { describe, expect, it } from 'vitest';

import { buildCanonicalPlayerId, buildLegacyPlayerSlug } from '@/lib/playerIdentity';

describe('playerIdentity', () => {
  it('builds canonical ids that match prisma-compatible name keys', () => {
    expect(buildCanonicalPlayerId('Nick Blakey')).toBe('nick_blakey');
    expect(buildCanonicalPlayerId('Alex N-Bullen')).toBe('alex_nbullen');
    expect(buildCanonicalPlayerId("Connor O'Sullivan")).toBe('connor_osullivan');
  });

  it('builds legacy slugs for backward-compatible player lookups', () => {
    expect(buildLegacyPlayerSlug('Nick Blakey', 'Sydney')).toBe('nick-blakey-sydney');
    expect(buildLegacyPlayerSlug('Alex N-Bullen', 'Adelaide')).toBe('alex-n-bullen-adelaide');
  });
});
