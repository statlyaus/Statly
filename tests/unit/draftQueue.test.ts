import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelDraftStart,
  draftQueue,
  getDraftLobbyJobId,
  getDraftStartJobId,
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
});
