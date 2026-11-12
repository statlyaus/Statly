import { DraftStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { hasDraftStarted } from '@/server/leagues/draftStarted';
import { getLeagueSettingsLocks } from '@/server/leagues/settingsLocks';

const scheduled = {
  status: DraftStatus.SCHEDULED,
  startedAt: null,
  lobbyStatus: 'COUNTDOWN',
  _count: { picks: 0 },
};

describe('hasDraftStarted', () => {
  it('is false for a league with no draft or a draft still forming', () => {
    expect(hasDraftStarted(null)).toBe(false);
    expect(hasDraftStarted(scheduled)).toBe(false);
  });

  it('is true for a LIVE draft rescheduled back to SCHEDULED with its picks kept', () => {
    expect(hasDraftStarted({ ...scheduled, _count: { picks: 3 } })).toBe(true);
  });

  it.each([
    ['left SCHEDULED', { status: DraftStatus.LIVE }],
    ['has a start time', { startedAt: new Date() }],
    ['opened a live room', { lobbyStatus: 'LIVE' }],
  ])('is true once the draft has %s', (_label, change) => {
    expect(hasDraftStarted({ ...scheduled, ...change })).toBe(true);
  });
});

describe('getLeagueSettingsLocks', () => {
  it('locks the draft structure exactly when the draft has started', () => {
    const rescheduled = { ...scheduled, _count: { picks: 1 } };
    expect(
      getLeagueSettingsLocks({
        scoringSettingsLockedAt: null,
        draftStarted: hasDraftStarted(rescheduled),
      }).draftStructure
    ).toMatch(/draft has started/);
    expect(
      getLeagueSettingsLocks({ scoringSettingsLockedAt: null, draftStarted: false }).draftStructure
    ).toBeNull();
  });
});
