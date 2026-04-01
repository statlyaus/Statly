import { describe, expect, it } from 'vitest';

import { getExactMappedPlayerPosition } from '@/lib/playerPositionMapping';

describe('getExactMappedPlayerPosition', () => {
  it('returns curated positions for exact known players only', () => {
    expect(getExactMappedPlayerPosition('Charlie Cameron')).toBe('FWD');
    expect(getExactMappedPlayerPosition('Isaac Heeney')).toBe('FWD');
    expect(getExactMappedPlayerPosition('Nick Blakey')).toBeNull();
  });
});
