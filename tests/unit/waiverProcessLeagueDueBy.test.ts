import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { WaiverProcessingService } from '@/server/waivers/WaiverProcessingService';

describe('processing one league up to a cut-off', () => {
  it('loads only the claims due by the run it is catching up', async () => {
    const dueBy = new Date('2026-07-14T20:00:00Z');
    const claimStore = {
      acquireProcessingLease: vi.fn().mockResolvedValue(new Date()),
      releaseProcessingLease: vi.fn().mockResolvedValue(undefined),
      loadWaiverSettings: vi.fn().mockResolvedValue({}),
      loadPendingClaims: vi.fn().mockResolvedValue([]),
    };
    const service = new WaiverProcessingService({} as never, claimStore as never, {} as never);

    await service.processLeague({ leagueId: 'league-1', dueBy });

    expect(claimStore.loadPendingClaims).toHaveBeenCalledWith('league-1', dueBy);
  });

  it('still refuses to run while another run holds the league lease', async () => {
    const claimStore = {
      acquireProcessingLease: vi.fn().mockResolvedValue(null),
      loadPendingClaims: vi.fn(),
    };
    const service = new WaiverProcessingService({} as never, claimStore as never, {} as never);

    const result = await service.processLeague({
      leagueId: 'league-1',
      dueBy: new Date('2026-07-14T20:00:00Z'),
    });

    expect(result).toEqual({ processed: 0, results: [], alreadyRunning: true });
    expect(claimStore.loadPendingClaims).not.toHaveBeenCalled();
  });
});
