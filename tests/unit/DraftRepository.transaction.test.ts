import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));

import { DraftRepository } from '@/server/draft/repository/DraftRepository';

describe('DraftRepository transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs draft commands at serializable isolation', async () => {
    const tx = { id: 'transaction-client' };
    prisma.$transaction.mockImplementation(async (work: (client: typeof tx) => unknown) =>
      work(tx)
    );

    const repository = new DraftRepository();
    const result = await repository.transaction(
      async (client) => (client as unknown as typeof tx).id
    );

    expect(result).toBe('transaction-client');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 20_000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('retries bounded Prisma write conflicts', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    prisma.$transaction
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce('committed');

    const repository = new DraftRepository();

    await expect(repository.transaction(async () => 'unused')).resolves.toBe('committed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('retries a SQLite timeout only when acquisition fails before application work starts', async () => {
    const timeout = new Prisma.PrismaClientKnownRequestError('database did not respond', {
      code: 'P1008',
      clientVersion: 'test',
    });
    const tx = { id: 'transaction-client' };
    prisma.$transaction
      .mockRejectedValueOnce(timeout)
      .mockImplementationOnce(async (work: (client: typeof tx) => unknown) => work(tx));
    const work = vi.fn(async () => 'committed');

    const repository = new DraftRepository();

    await expect(repository.transaction(work)).resolves.toBe('committed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledOnce();
  });

  it('does not replay application work after an ambiguous SQLite timeout', async () => {
    const timeout = new Prisma.PrismaClientKnownRequestError('database did not respond', {
      code: 'P1008',
      clientVersion: 'test',
    });
    const tx = { id: 'transaction-client' };
    prisma.$transaction.mockImplementation(async (work: (client: typeof tx) => unknown) =>
      work(tx)
    );
    const work = vi.fn().mockRejectedValue(timeout);

    const repository = new DraftRepository();

    await expect(repository.transaction(work)).rejects.toBe(timeout);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledOnce();
  });

  it('retries a post-callback SQLite timeout when the caller declares idempotent work', async () => {
    const timeout = new Prisma.PrismaClientKnownRequestError('database did not respond', {
      code: 'P1008',
      clientVersion: 'test',
    });
    const tx = { id: 'transaction-client' };
    prisma.$transaction.mockImplementation(async (work: (client: typeof tx) => unknown) =>
      work(tx)
    );
    const work = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce('committed');

    const repository = new DraftRepository();

    await expect(repository.transaction(work, { retryPolicy: 'idempotent' })).resolves.toBe(
      'committed'
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not retry unrelated transaction failures', async () => {
    prisma.$transaction.mockRejectedValue(new Error('boom'));

    const repository = new DraftRepository();

    await expect(repository.transaction(async () => 'unused')).rejects.toThrow('boom');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('removes a selected player from every queue in the draft', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const repository = new DraftRepository();

    await repository.removePlayerFromAllDraftQueues(
      { preDraftQueue: { deleteMany } } as never,
      'draft-1',
      'player-1'
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: { draftId: 'draft-1', playerId: 'player-1' },
    });
  });
});
