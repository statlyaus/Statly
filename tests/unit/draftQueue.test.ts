import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelDraftStart,
  draftQueue,
  getDraftLobbyJobId,
  getDraftPickExpiryVersionedJobId,
  getDraftStartJobId,
  scheduleDraftPickExpiry,
} from '@/server/queue/draftQueue';

describe('draft queue scheduling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes both queued start phases when a draft schedule is cleared', async () => {
    const remove = vi.spyOn(draftQueue, 'remove').mockResolvedValue(1);

    await cancelDraftStart('league:1');

    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith(getDraftLobbyJobId('league:1'));
    expect(remove).toHaveBeenCalledWith(getDraftStartJobId('league:1'));
  });

  it('adds an immutable revisioned expiry job without deleting other revisions', async () => {
    const add = vi.spyOn(draftQueue, 'add');
    const remove = vi.spyOn(draftQueue, 'remove');
    const runAt = new Date(Date.now() + 30_000);

    await scheduleDraftPickExpiry(
      {
        kind: 'draft:pick-expiry',
        draftId: 'draft-1',
        leagueId: 'league-1',
        schedulingVersion: 8,
      },
      runAt
    );

    expect(remove).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      'draft:pick-expiry',
      expect.objectContaining({ draftId: 'draft-1', schedulingVersion: 8 }),
      expect.objectContaining({ jobId: getDraftPickExpiryVersionedJobId('draft-1', 8) })
    );
  });
});
