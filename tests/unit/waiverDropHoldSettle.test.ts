import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));

import { WaiverProcessingService } from '@/server/waivers/WaiverProcessingService';
import { previousWaiverRunAt } from '@/server/waivers/nextWaiverRun';

describe('the waiver run settles drop holds that have ended', () => {
  it('marks pending DROP_PLAYER rows processed once their hold is over', async () => {
    const now = new Date('2026-06-24T20:00:30.000Z');
    vi.useFakeTimers({ now });
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = { teamAction: { updateMany } };
    const claimStore = {
      acquireProcessingLease: vi.fn().mockResolvedValue(now),
      releaseProcessingLease: vi.fn().mockResolvedValue(undefined),
      loadWaiverSettings: vi.fn().mockResolvedValue({}),
      loadPendingClaims: vi.fn().mockResolvedValue([]),
    };
    const service = new WaiverProcessingService(
      db as never,
      claimStore as never,
      {
        projectLeague: vi.fn().mockResolvedValue({}),
      } as never
    );

    await service.processLeague({ leagueId: 'league-1' });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        leagueId: 'league-1',
        actionType: 'DROP_PLAYER',
        status: 'PENDING',
        processingAt: { lte: now },
        createdAt: { lt: previousWaiverRunAt(now) },
      },
      data: { status: 'PROCESSED', processedAt: now },
    });
    vi.useRealTimers();
  });
});
