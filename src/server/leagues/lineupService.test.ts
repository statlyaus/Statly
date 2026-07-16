import { describe, expect, it } from 'vitest';

import {
  createSetupLineupRoundContext,
  resolveRequestedLineupRound,
} from './lineupService';

describe('lineup setup compatibility', () => {
  it('uses Round 1 while a setup league has no published competition', () => {
    expect(
      resolveRequestedLineupRound({
        requestedRound: 'current',
        publishedCurrentRound: null,
      })
    ).toBe(1);
    expect(createSetupLineupRoundContext(1)).toMatchObject({
      source: 'SETUP_FALLBACK',
      round: 1,
      lockState: 'PUBLISHED_PENDING',
      opponent: null,
    });
  });

  it('keeps a published current round as the source of truth', () => {
    expect(
      resolveRequestedLineupRound({
        requestedRound: 'current',
        publishedCurrentRound: 7,
      })
    ).toBe(7);
  });

  it('rejects invalid explicit rounds', () => {
    expect(
      resolveRequestedLineupRound({
        requestedRound: 'invalid',
        publishedCurrentRound: null,
      })
    ).toBeNull();
  });
});
