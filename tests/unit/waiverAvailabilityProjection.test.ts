import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function createFirestoreMock() {
  const batches: Array<{
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
  }> = [];
  const collection = vi.fn();
  const doc = vi.fn();

  collection.mockReturnValue({ doc });
  doc.mockImplementation((id: string) => ({ id, collection }));

  return {
    batches,
    firestore: {
      batch: vi.fn(() => {
        const batch = {
          set: vi.fn(),
          delete: vi.fn(),
          commit: vi.fn().mockResolvedValue(undefined),
        };
        batches.push(batch);
        return batch;
      }),
      collection,
    },
  };
}

describe('WaiverAvailabilityProjectionService', () => {
  it('removes owned players from waiver availability and keeps undrafted players available', async () => {
    const { batches, firestore } = createFirestoreMock();
    const db = {
      leagueRosterPlayer: {
        findMany: vi.fn().mockResolvedValue([{ playerId: 'owned-1', memberId: 'member-1' }]),
      },
      player: {
        findMany: vi.fn().mockResolvedValue([{ id: 'owned-1' }, { id: 'free-1' }]),
      },
    };

    const service = new WaiverAvailabilityProjectionService(db as never, firestore as never);
    const result = await service.projectLeague({ leagueId: 'league-1' });

    expect(db.leagueRosterPlayer.findMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1' },
      select: { playerId: true, memberId: true },
    });
    expect(db.player.findMany).toHaveBeenCalledWith({ select: { id: true } });

    const setCalls = batches.flatMap((batch) => batch.set.mock.calls);
    const setPayloads = setCalls.map(([, data]) => data);
    const ownedPlayerSetCalls = setCalls.filter(([, data]) => {
      const payload = data as { playerId?: string; status?: string };
      return payload.playerId === 'owned-1' && payload.status === 'owned';
    });

    expect(ownedPlayerSetCalls).toEqual([
      [
        expect.objectContaining({ id: 'owned-1' }),
        expect.objectContaining({
          playerId: 'owned-1',
          memberId: 'member-1',
          status: 'owned',
          available: false,
        }),
        { merge: true },
      ],
    ]);
    expect(setPayloads).toContainEqual(
      expect.objectContaining({
        playerId: 'free-1',
        status: 'available',
        available: true,
      })
    );
    expect(batches.reduce((total, batch) => total + batch.delete.mock.calls.length, 0)).toBe(2);
    expect(batches.flatMap((batch) => batch.delete.mock.calls.map(([ref]) => ref))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'owned-1' }),
        expect.objectContaining({ id: 'free-1' }),
      ])
    );
    expect(batches.reduce((total, batch) => total + batch.commit.mock.calls.length, 0)).toBe(1);
    expect(result).toEqual({ owned: 1, available: 1 });
  });

  it('commits multiple Firestore batches when player projection exceeds one batch', async () => {
    const { batches, firestore } = createFirestoreMock();
    const players = Array.from({ length: 226 }, (_, index) => ({ id: `free-${index}` }));
    const db = {
      leagueRosterPlayer: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      player: {
        findMany: vi.fn().mockResolvedValue(players),
      },
    };

    const service = new WaiverAvailabilityProjectionService(db as never, firestore as never);
    const result = await service.projectLeague({ leagueId: 'league-1' });

    expect(firestore.batch).toHaveBeenCalledTimes(2);
    expect(batches).toHaveLength(2);
    expect(batches.every((batch) => batch.commit.mock.calls.length === 1)).toBe(true);
    expect(result).toEqual({ owned: 0, available: 226 });
  });

  it('refreshes waiver availability after roster ownership projection', () => {
    const source = read('src/server/rosters/RosterProjectionService.ts');

    expect(source).toContain('WaiverAvailabilityProjectionService');
    expect(source).toContain('waiverAvailabilityProjectionService');
    expect(source).toContain('projectLeague({ leagueId: input.leagueId })');
  });

  it('uses shared league membership helpers in waiver routes', () => {
    const submitSource = read('src/app/api/leagues/[id]/waivers/submit/route.ts');
    const processSource = read('src/app/api/leagues/[id]/waivers/process/route.ts');

    expect(submitSource).toContain('getLeagueMembershipAccess');
    expect(submitSource).not.toContain('verifyLeagueMembership');

    expect(processSource).toContain('canManageLeague');
    expect(processSource).not.toContain('getLeagueMembership');
    expect(processSource).not.toContain('isLeagueManagerRole');
  });
});
