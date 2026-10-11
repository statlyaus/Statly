import type { InjuryReturnStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: loggerMock }));

const { injuryBlocksSelection, loadCurrentInjuries, loadInjuryLookup } =
  await import('./injuryListReadModel');

const NOW = new Date('2026-10-11T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;

type Entry = {
  playerId: string | null;
  status: InjuryReturnStatus;
  injuryRaw: string;
  returnRaw: string;
};

function prismaReturning(
  snapshot: { id: string; confirmedAt: Date } | null,
  entries: Entry[] = []
) {
  const findFirst = vi.fn().mockResolvedValue(snapshot);
  const findMany = vi.fn().mockResolvedValue(entries);
  return {
    findFirst,
    findMany,
    prisma: { injuryListSnapshot: { findFirst }, injuryListEntry: { findMany } } as never,
  };
}

function snapshotConfirmed(hoursAgo: number) {
  return { id: 'snapshot-1', confirmedAt: new Date(NOW.getTime() - hoursAgo * HOUR) };
}

const KNEE: Entry = { playerId: 'p1', status: 'SEASON', injuryRaw: 'Knee', returnRaw: 'Season' };
const ANKLE: Entry = { playerId: 'p2', status: 'TEST', injuryRaw: 'Ankle', returnRaw: 'Test' };

afterEach(() => {
  loggerMock.warn.mockReset();
});

describe('loadCurrentInjuries', () => {
  it('reports none when no snapshot exists', async () => {
    const { prisma, findMany } = prismaReturning(null);
    await expect(loadCurrentInjuries({ prisma, now: NOW })).resolves.toEqual({
      ok: false,
      reason: 'none',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('reports stale, without loading entries, when the latest snapshot is over 48 hours old', async () => {
    const { prisma, findMany } = prismaReturning(snapshotConfirmed(49), [KNEE]);
    await expect(loadCurrentInjuries({ prisma, now: NOW })).resolves.toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns matched entries by player id from a fresh snapshot', async () => {
    const { prisma, findFirst, findMany } = prismaReturning(snapshotConfirmed(47), [KNEE, ANKLE]);

    const result = await loadCurrentInjuries({ prisma, now: NOW });

    expect(result).toEqual({
      ok: true,
      byPlayerId: new Map([
        ['p1', { status: 'SEASON', injuryRaw: 'Knee', returnRaw: 'Season' }],
        ['p2', { status: 'TEST', injuryRaw: 'Ankle', returnRaw: 'Test' }],
      ]),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { source: 'footywire' },
      orderBy: { confirmedAt: 'desc' },
      select: { id: true, confirmedAt: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { snapshotId: 'snapshot-1', matchStatus: 'MATCHED', playerId: { not: null } },
      select: { playerId: true, status: true, injuryRaw: true, returnRaw: true },
    });
  });

  it('keeps the blocking entry when two rows land on one player', async () => {
    const { prisma } = prismaReturning(snapshotConfirmed(1), [
      { playerId: 'p1', status: 'TEST', injuryRaw: 'Ankle', returnRaw: 'Test' },
      { playerId: 'p1', status: 'WEEKS', injuryRaw: 'Hamstring', returnRaw: '2-3 weeks' },
      { playerId: 'p1', status: 'TEST', injuryRaw: 'Ankle', returnRaw: 'Test' },
    ]);

    const result = await loadCurrentInjuries({ prisma, now: NOW });

    expect(result.ok && result.byPlayerId.get('p1')).toEqual({
      status: 'WEEKS',
      injuryRaw: 'Hamstring',
      returnRaw: '2-3 weeks',
    });
  });
});

describe('injuryBlocksSelection', () => {
  it('lets a TEST player be selected', () => {
    expect(injuryBlocksSelection('TEST')).toBe(false);
  });

  it.each(['TBC', 'SEASON', 'PROTOCOLS', 'WEEKS', 'DAYS', 'UNKNOWN'] as const)(
    'blocks %s',
    (status) => {
      expect(injuryBlocksSelection(status)).toBe(true);
    }
  );
});

describe('loadInjuryLookup', () => {
  const logContext = { leagueId: 'league-1', scope: 'test' };

  it('labels each listed player and blocks every status but TEST', async () => {
    const { prisma } = prismaReturning(snapshotConfirmed(1), [KNEE, ANKLE]);

    const injuryFor = await loadInjuryLookup({ prisma, now: NOW, logContext });

    expect(injuryFor({ playerId: 'p1' })).toEqual({
      label: 'Knee (Season)',
      blocksSelection: true,
    });
    expect(injuryFor({ playerId: 'p2' })).toEqual({
      label: 'Ankle (Test)',
      blocksSelection: false,
    });
    expect(injuryFor({ playerId: 'p3' })).toBeNull();
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('treats a stale list as nobody listed and warns once', async () => {
    const { prisma } = prismaReturning(snapshotConfirmed(49), [KNEE]);

    const injuryFor = await loadInjuryLookup({ prisma, now: NOW, logContext });

    expect(injuryFor({ playerId: 'p1' })).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith('Injury list unavailable', {
      ...logContext,
      reason: 'stale',
    });
  });

  it('treats a failed read as nobody listed and warns once', async () => {
    const findFirst = vi.fn().mockRejectedValue(new Error('database down'));
    const prisma = { injuryListSnapshot: { findFirst }, injuryListEntry: {} } as never;

    const injuryFor = await loadInjuryLookup({ prisma, now: NOW, logContext });

    expect(injuryFor({ playerId: 'p1' })).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith('Injury list unavailable', {
      ...logContext,
      reason: 'error',
      error: 'database down',
    });
  });
});
