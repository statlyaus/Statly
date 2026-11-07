import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelDraftStart,
  draftQueue,
  getDraftLobbyJobId,
  getDraftPickExpiryVersionedJobId,
  getDraftStartJobId,
  scheduleDraftPickExpiry,
  scheduleDraftStart,
} from '@/server/queue/draftQueue';

describe('draft queue scheduling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes both queued start phases when a draft schedule is cleared', async () => {
    const remove = vi.spyOn(draftQueue, 'remove').mockResolvedValue(1);

    await cancelDraftStart('draft:1');

    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith(getDraftLobbyJobId('draft:1'));
    expect(remove).toHaveBeenCalledWith(getDraftStartJobId('draft:1'));
  });

  it('gives two drafts in the same league distinct start and lobby job ids', () => {
    const ids = [
      getDraftLobbyJobId('draft-2025'),
      getDraftStartJobId('draft-2025'),
      getDraftLobbyJobId('draft-2026'),
      getDraftStartJobId('draft-2026'),
    ];

    expect(new Set(ids).size).toBe(4);
  });

  it('cancelling one draft never removes another draft in the same league', async () => {
    const remove = vi.spyOn(draftQueue, 'remove').mockResolvedValue(1);

    await cancelDraftStart('draft-2025');

    expect(remove).not.toHaveBeenCalledWith(getDraftLobbyJobId('draft-2026'));
    expect(remove).not.toHaveBeenCalledWith(getDraftStartJobId('draft-2026'));
    expect(remove).not.toHaveBeenCalledWith(expect.stringContaining('league-1'));
  });

  it('schedules the lobby job under the draft id and carries the draft id', async () => {
    const remove = vi.spyOn(draftQueue, 'remove').mockResolvedValue(1);
    const add = vi.spyOn(draftQueue, 'add');
    const startAt = new Date(Date.now() + 60 * 60 * 1000);

    await scheduleDraftStart({ draftId: 'draft-2026', leagueId: 'league-1' }, startAt, 90_000);

    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith(getDraftLobbyJobId('draft-2026'));
    expect(remove).toHaveBeenCalledWith(getDraftStartJobId('draft-2026'));
    expect(add).toHaveBeenCalledWith(
      'start',
      {
        kind: 'draft:start-lobby',
        draftId: 'draft-2026',
        leagueId: 'league-1',
        pickClock: 90_000,
      },
      expect.objectContaining({ jobId: getDraftLobbyJobId('draft-2026') })
    );
  });

  it('schedules an immediate start under the draft id and carries the draft id', async () => {
    vi.spyOn(draftQueue, 'remove').mockResolvedValue(1);
    const add = vi.spyOn(draftQueue, 'add');
    const startAt = new Date(Date.now() + 60_000);

    await scheduleDraftStart(
      { draftId: 'draft-2026', leagueId: 'league-1' },
      startAt,
      90_000,
      true
    );

    expect(add).toHaveBeenCalledWith(
      'start-draft',
      {
        kind: 'draft:start',
        draftId: 'draft-2026',
        leagueId: 'league-1',
        pickClock: 90_000,
      },
      expect.objectContaining({ jobId: getDraftStartJobId('draft-2026') })
    );
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
