import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_INJURY_LIST_MAX_AGE_MS,
  injuryBlocksSelection,
  loadCurrentInjuries,
} from './injuryListReadModel';

const NOW = new Date('2026-10-11T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;

type Entry = { playerId: string | null; status: string; injuryRaw: string; returnRaw: string };

function prismaReturning(
  snapshot: { id: string; confirmedAt: Date; fetchedAt: Date; entries: Entry[] } | null
) {
  const findFirst = vi.fn().mockResolvedValue(snapshot);
  return { findFirst, prisma: { injuryListSnapshot: { findFirst } } as never };
}

function snapshotConfirmed(hoursAgo: number, entries: Entry[] = []) {
  return {
    id: 'snapshot-1',
    confirmedAt: new Date(NOW.getTime() - hoursAgo * HOUR),
    fetchedAt: new Date(NOW.getTime() - 100 * HOUR),
    entries,
  };
}

describe('loadCurrentInjuries', () => {
  it('reports none when no snapshot exists', async () => {
    const { prisma } = prismaReturning(null);
    await expect(loadCurrentInjuries({ prisma, now: NOW })).resolves.toEqual({
      ok: false,
      reason: 'none',
    });
  });

  it('reports stale when the latest snapshot was confirmed more than 48 hours ago', async () => {
    const { prisma } = prismaReturning(
      snapshotConfirmed(49, [
        { playerId: 'p1', status: 'SEASON', injuryRaw: 'Knee', returnRaw: 'Season' },
      ])
    );
    await expect(loadCurrentInjuries({ prisma, now: NOW })).resolves.toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('honours a custom maxAgeMs', async () => {
    const { prisma } = prismaReturning(snapshotConfirmed(2));
    await expect(loadCurrentInjuries({ prisma, now: NOW, maxAgeMs: HOUR })).resolves.toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('returns matched entries by player id from a fresh snapshot', async () => {
    const snapshot = snapshotConfirmed(47, [
      { playerId: 'p1', status: 'SEASON', injuryRaw: 'Knee', returnRaw: 'Season' },
      { playerId: 'p2', status: 'TEST', injuryRaw: 'Ankle', returnRaw: 'Test' },
    ]);
    const { prisma, findFirst } = prismaReturning(snapshot);

    const result = await loadCurrentInjuries({ prisma, now: NOW });

    expect(result).toEqual({
      ok: true,
      snapshot: {
        id: 'snapshot-1',
        confirmedAt: snapshot.confirmedAt,
        fetchedAt: snapshot.fetchedAt,
      },
      byPlayerId: new Map([
        ['p1', { status: 'SEASON', injuryRaw: 'Knee', returnRaw: 'Season' }],
        ['p2', { status: 'TEST', injuryRaw: 'Ankle', returnRaw: 'Test' }],
      ]),
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: 'footywire' },
        orderBy: { confirmedAt: 'desc' },
        select: expect.objectContaining({
          entries: expect.objectContaining({
            where: { matchStatus: 'MATCHED', playerId: { not: null } },
          }),
        }),
      })
    );
  });

  it('keeps the blocking entry when two rows land on one player', async () => {
    const { prisma } = prismaReturning(
      snapshotConfirmed(1, [
        { playerId: 'p1', status: 'TEST', injuryRaw: 'Ankle', returnRaw: 'Test' },
        { playerId: 'p1', status: 'WEEKS', injuryRaw: 'Hamstring', returnRaw: '2-3 weeks' },
        { playerId: 'p1', status: 'TEST', injuryRaw: 'Ankle', returnRaw: 'Test' },
      ])
    );

    const result = await loadCurrentInjuries({ prisma, now: NOW });

    expect(result.ok && result.byPlayerId.get('p1')).toEqual({
      status: 'WEEKS',
      injuryRaw: 'Hamstring',
      returnRaw: '2-3 weeks',
    });
  });

  it('defaults to a 48 hour freshness window', () => {
    expect(DEFAULT_INJURY_LIST_MAX_AGE_MS).toBe(48 * HOUR);
  });
});

describe('injuryBlocksSelection', () => {
  it('lets a TEST player be selected', () => {
    expect(injuryBlocksSelection('TEST')).toBe(false);
  });

  it.each(['TBC', 'SEASON', 'PROTOCOLS', 'WEEKS', 'DAYS', 'UNKNOWN'])('blocks %s', (status) => {
    expect(injuryBlocksSelection(status)).toBe(true);
  });
});
