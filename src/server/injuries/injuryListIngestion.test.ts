import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { parseFootywireInjuryList } from './footywireInjuryList';
import { ingestFootywireInjuryList, type InjuryListIngestionClient } from './injuryListIngestion';
import { contentSha256, matchInjuryRowsToPlayers } from './injuryListMatching';

const html = readFileSync(join(__dirname, '__fixtures__', 'footywire-injury-list.html'), 'utf8');
const rows = parseFootywireInjuryList(html);
const serving = (async () => new Response(html, { status: 200 })) as typeof fetch;
const NOW = new Date('2026-10-11T00:00:00.000Z');
// No players, so every row is unmatched.
const COUNTS = { rows: rows.length, matched: 0, unmatched: rows.length, ambiguous: 0 };

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function fakeClient({
  existing = [null],
  create = vi.fn().mockResolvedValue({ id: 'created' }),
}: {
  /** What each successive findUnique returns. */
  existing?: Array<{ id: string } | null>;
  create?: ReturnType<typeof vi.fn>;
} = {}) {
  const findUnique = vi.fn();
  for (const result of existing) findUnique.mockResolvedValueOnce(result);
  const tx = {
    injuryListSnapshot: { findUnique, create, update: vi.fn().mockResolvedValue({}) },
  };
  const client = {
    player: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { tx, client: client as unknown as InjuryListIngestionClient };
}

describe('ingestFootywireInjuryList', () => {
  it('creates a snapshot with every row and its player link', async () => {
    const { tx, client } = fakeClient();

    await expect(
      ingestFootywireInjuryList({ prisma: client, fetchImpl: serving, now: NOW })
    ).resolves.toEqual({ outcome: 'created', snapshotId: 'created', counts: COUNTS });

    const matched = matchInjuryRowsToPlayers(rows, []);
    expect(tx.injuryListSnapshot.create).toHaveBeenCalledWith({
      data: {
        source: 'footywire',
        sourceUrl: 'https://www.footywire.com/afl/footy/injury_list',
        contentSha256: contentSha256(matched),
        fetchedAt: NOW,
        confirmedAt: NOW,
        entries: { createMany: { data: matched } },
      },
      select: { id: true },
    });
    expect(tx.injuryListSnapshot.update).not.toHaveBeenCalled();
  });

  it('only confirms a snapshot it has stored before', async () => {
    const { tx, client } = fakeClient({ existing: [{ id: 'existing' }] });

    await expect(
      ingestFootywireInjuryList({ prisma: client, fetchImpl: serving, now: NOW })
    ).resolves.toEqual({ outcome: 'unchanged', snapshotId: 'existing', counts: COUNTS });

    expect(tx.injuryListSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'existing' },
      data: { confirmedAt: NOW },
    });
    expect(tx.injuryListSnapshot.create).not.toHaveBeenCalled();
  });

  it('confirms the snapshot a concurrent run created instead of failing', async () => {
    const { tx, client } = fakeClient({
      existing: [null, { id: 'winner' }],
      create: vi.fn().mockRejectedValue(uniqueViolation()),
    });

    await expect(
      ingestFootywireInjuryList({ prisma: client, fetchImpl: serving, now: NOW })
    ).resolves.toEqual({ outcome: 'unchanged', snapshotId: 'winner', counts: COUNTS });

    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.injuryListSnapshot.create).toHaveBeenCalledTimes(1);
    expect(tx.injuryListSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'winner' },
      data: { confirmedAt: NOW },
    });
  });

  it('rethrows any other insert failure without retrying', async () => {
    const failure = new Error('connection lost');
    const { tx, client } = fakeClient({ create: vi.fn().mockRejectedValue(failure) });

    await expect(
      ingestFootywireInjuryList({ prisma: client, fetchImpl: serving, now: NOW })
    ).rejects.toBe(failure);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.injuryListSnapshot.update).not.toHaveBeenCalled();
  });
});
