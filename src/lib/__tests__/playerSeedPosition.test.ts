import { describe, expect, it } from 'vitest';

import {
  aggregatePlayerSeedStats,
  inferPositionFromSeedStats,
  normalizeAflPosition,
} from '@/lib/playerSeedPosition';

describe('playerSeedPosition', () => {
  it('normalizes supported AFL position labels', () => {
    expect(normalizeAflPosition('half back')).toBe('DEF');
    expect(normalizeAflPosition('forward')).toBe('FWD');
    expect(normalizeAflPosition('ruck')).toBe('RUC');
    expect(normalizeAflPosition('wing')).toBe('MID');
  });

  it('infers ruck from strong hitout volume', () => {
    const aggregate = aggregatePlayerSeedStats([
      { HO: 32, D: 14, T: 4 },
      { HO: 28, D: 11, T: 3 },
      { HO: 35, D: 13, T: 5 },
    ]);

    expect(inferPositionFromSeedStats(aggregate)).toBe('RUC');
  });

  it('infers lower-disposal second rucks from moderate hitout volume', () => {
    const aggregate = aggregatePlayerSeedStats([
      { HO: 16, D: 8, T: 2 },
      { HO: 18, D: 9, T: 3 },
      { HO: 15, D: 10, T: 2 },
    ]);

    expect(inferPositionFromSeedStats(aggregate)).toBe('RUC');
  });

  it('infers forward from scoring-heavy profile', () => {
    const aggregate = aggregatePlayerSeedStats([
      { G: 3, I50: 6, CM: 2, M: 7, D: 14 },
      { G: 2, I50: 5, CM: 1, M: 6, D: 13 },
      { G: 4, I50: 7, CM: 2, M: 8, D: 15 },
    ]);

    expect(inferPositionFromSeedStats(aggregate)).toBe('FWD');
  });

  it('infers small forwards from sustained goals and inside-50 presence', () => {
    const aggregate = aggregatePlayerSeedStats([
      { G: 2, I50: 4, M: 4, D: 12 },
      { G: 1, I50: 3, M: 5, D: 13 },
      { G: 2, I50: 4, M: 3, D: 11 },
    ]);

    expect(inferPositionFromSeedStats(aggregate)).toBe('FWD');
  });

  it('infers defender from intercept and rebound profile', () => {
    const aggregate = aggregatePlayerSeedStats([
      { ITC: 7, R50: 6, M: 8, G: 0, D: 23 },
      { ITC: 6, R50: 5, M: 7, G: 0, D: 21 },
      { ITC: 8, R50: 7, M: 9, G: 0, D: 24 },
    ]);

    expect(inferPositionFromSeedStats(aggregate)).toBe('DEF');
  });
});
