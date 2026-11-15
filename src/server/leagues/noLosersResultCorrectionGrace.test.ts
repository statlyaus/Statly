import { describe, expect, it } from 'vitest';

import {
  correctionIsOverdue,
  RESULT_CORRECTION_GRACE_HOURS,
} from './noLosersResultCorrectionGrace';

const HOUR = 60 * 60 * 1000;
const correctedAt = new Date('2026-07-01T00:00:00.000Z');

describe('a No Losers round waiting on a result correction', () => {
  it('waits quietly for 12 hours after the correction arrived', () => {
    expect(RESULT_CORRECTION_GRACE_HOURS).toBe(12);
    const atGrace = new Date(correctedAt.getTime() + 12 * HOUR);
    expect(correctionIsOverdue(correctedAt, atGrace)).toBe(false);
  });

  it('is overdue once the grace period has passed', () => {
    const after = new Date(correctedAt.getTime() + 12 * HOUR + 1);
    expect(correctionIsOverdue(correctedAt, after)).toBe(true);
  });
});
