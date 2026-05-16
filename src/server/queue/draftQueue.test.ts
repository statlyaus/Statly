import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('scheduleDraftStart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T01:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('queues immediate starts with zero delay when the scheduled time has passed', async () => {
    const { draftQueue, scheduleDraftStart } = await import('./draftQueue');
    const addSpy = vi.spyOn(draftQueue, 'add').mockResolvedValue({ id: 'job-1' } as never);
    const removeSpy = vi.spyOn(draftQueue, 'remove').mockResolvedValue(0 as never);

    await scheduleDraftStart(
      'league-1',
      new Date('2026-05-02T00:55:00.000Z'),
      120_000,
      true
    );

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenCalledWith(
      'start-draft',
      { kind: 'draft:start', leagueId: 'league-1', pickClock: 120_000 },
      expect.objectContaining({
        delay: 0,
        jobId: 'league-1-start',
      })
    );
  });
});
