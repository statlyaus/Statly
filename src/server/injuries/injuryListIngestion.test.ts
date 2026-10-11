import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { parseFootywireInjuryList } from './footywireInjuryList';
import { ingestFootywireInjuryList, type InjuryListIngestionClient } from './injuryListIngestion';

const html = readFileSync(join(__dirname, '__fixtures__', 'footywire-injury-list.html'), 'utf8');
const rows = parseFootywireInjuryList(html);
const serving = (async () => new Response(html, { status: 200 })) as typeof fetch;
const NOW = new Date('2026-10-11T00:00:00.000Z');

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

// A client whose first transaction loses the insert race and whose second sees the winner's row.
function racingClient(createError: unknown) {
  const tx = {
    injuryListSnapshot: {
      findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ id: 'winner' }),
      create: vi.fn().mockRejectedValue(createError),
      update: vi.fn().mockResolvedValue({}),
    },
    injuryListEntry: {
      findMany: vi.fn().mockResolvedValue(
        rows.map((row, index) => ({
          id: `entry-${index}`,
          sourceKey: row.sourceKey,
          playerId: null,
          matchStatus: 'UNMATCHED',
        }))
      ),
      update: vi.fn(),
    },
  };
  const client = {
    player: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { tx, client: client as unknown as InjuryListIngestionClient };
}

describe('ingestFootywireInjuryList insert race', () => {
  it('confirms the snapshot a concurrent run created instead of failing', async () => {
    const { tx, client } = racingClient(uniqueViolation());

    await expect(
      ingestFootywireInjuryList({ prisma: client, fetchImpl: serving, now: NOW })
    ).resolves.toEqual({
      outcome: 'unchanged',
      snapshotId: 'winner',
      counts: {
        rowCount: rows.length,
        matchedCount: 0,
        unmatchedCount: rows.length,
        ambiguousCount: 0,
      },
      relinked: 0,
    });
    expect(tx.injuryListSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'winner' },
      data: expect.objectContaining({ confirmedAt: NOW }),
    });
    expect(tx.injuryListEntry.update).not.toHaveBeenCalled();
  });

  it('rethrows any other insert failure', async () => {
    const failure = new Error('connection lost');
    const { tx, client } = racingClient(failure);

    await expect(
      ingestFootywireInjuryList({ prisma: client, fetchImpl: serving, now: NOW })
    ).rejects.toBe(failure);
    expect(tx.injuryListSnapshot.update).not.toHaveBeenCalled();
  });
});
