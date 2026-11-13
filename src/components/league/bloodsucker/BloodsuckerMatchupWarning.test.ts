import { describe, expect, it } from 'vitest';

import { shouldWarnOfBloodsucker } from './BloodsuckerMatchupWarning';

const base = {
  matchupStatus: 'SCHEDULED',
  phase: 'REGULAR',
  homeMemberId: 'bs',
  awayMemberId: 'me',
  bloodsuckerMemberId: 'bs',
  viewerMemberId: 'me',
};

describe('shouldWarnOfBloodsucker (US-8 AC2)', () => {
  it("warns the Bloodsucker's opponent before lock", () => {
    expect(shouldWarnOfBloodsucker(base)).toBe(true);
    expect(shouldWarnOfBloodsucker({ ...base, homeMemberId: 'me', awayMemberId: 'bs' })).toBe(true);
  });

  it('stays quiet once the matchup locks, in finals, for the Bloodsucker and for bystanders', () => {
    expect(shouldWarnOfBloodsucker({ ...base, matchupStatus: 'LIVE' })).toBe(false);
    expect(shouldWarnOfBloodsucker({ ...base, roundStatus: 'LOCKED' })).toBe(false);
    expect(shouldWarnOfBloodsucker({ ...base, roundStatus: 'SCHEDULED' })).toBe(true);
    expect(shouldWarnOfBloodsucker({ ...base, phase: 'FINALS' })).toBe(false);
    expect(shouldWarnOfBloodsucker({ ...base, viewerMemberId: 'bs' })).toBe(false);
    expect(shouldWarnOfBloodsucker({ ...base, viewerMemberId: 'someone-else' })).toBe(false);
    expect(shouldWarnOfBloodsucker({ ...base, bloodsuckerMemberId: null })).toBe(false);
  });
});
