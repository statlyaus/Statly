import { describe, expect, it } from 'vitest';

import { toMatchupStatusFromRoundStatus } from '@/server/leagues/matchupReadModel';

describe('matchupReadModel helpers', () => {
  it('derives matchup status from live/final round status', () => {
    expect(toMatchupStatusFromRoundStatus({ anyLive: true, allFinal: false })).toBe('LIVE');
    expect(toMatchupStatusFromRoundStatus({ anyLive: false, allFinal: true })).toBe('FINAL');
    expect(toMatchupStatusFromRoundStatus({ anyLive: false, allFinal: false })).toBe('SCHEDULED');
  });
});
