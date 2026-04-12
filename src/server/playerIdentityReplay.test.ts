import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

import { createFirestoreMock, createTransactionClientMock } from '@/testUtils';

const { recordUnresolvedPlayerStatRow, resolvePlayerIdentity, serverTimestamp } = vi.hoisted(
  () => ({
    recordUnresolvedPlayerStatRow: vi.fn(),
    resolvePlayerIdentity: vi.fn(),
    serverTimestamp: vi.fn(() => 'server-timestamp'),
  })
);

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp,
  },
}));

vi.mock('@/server/playerIdentityResolver', () => ({
  recordUnresolvedPlayerStatRow,
  resolvePlayerIdentity,
}));

import { replayUnresolvedPlayerStatRows } from '@/server/playerIdentityReplay';

describe('replayUnresolvedPlayerStatRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not write to Firestore or Prisma during dry-run replay', async () => {
    resolvePlayerIdentity.mockResolvedValue({
      outcome: 'resolved',
      playerId: 'aaron_naughton',
      playerName: 'Aaron Naughton',
      matchedBy: 'player',
      candidates: ['aaron_naughton'],
    });

    const prisma = createTransactionClientMock({
      unresolvedPlayerStatRow: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'row-1',
            source: 'footywire_fitzroy',
            sourceDocumentId: 'doc-1',
            sourceMatchId: '2026-R1-WBD-CAR',
            season: 2026,
            round: 1,
            playerName: 'Aaron Naughton',
            team: 'Western Bulldogs',
            rawPayloadJson: JSON.stringify({
              raw_row: { kicks: 10 },
              stats: { kicks: 10 },
            }),
          },
        ]),
        update: vi.fn(),
      },
    });

    const { firestore, spies } = createFirestoreMock();

    const result = await replayUnresolvedPlayerStatRows({
      prisma,
      firestore,
      dryRun: true,
    });

    expect(result).toEqual({
      scanned: 1,
      replayed: 1,
      stillAmbiguous: 0,
      stillUnresolved: 0,
    });
    expect(spies.bulkWriter).not.toHaveBeenCalled();
    expect(prisma.unresolvedPlayerStatRow.update).not.toHaveBeenCalled();
    expect(recordUnresolvedPlayerStatRow).not.toHaveBeenCalled();
  });

  it('marks rows resolved and writes canonical docs during replay', async () => {
    resolvePlayerIdentity.mockResolvedValue({
      outcome: 'resolved',
      playerId: 'aaron_naughton',
      playerName: 'Aaron Naughton',
      matchedBy: 'alias',
      candidates: ['aaron_naughton'],
    });

    const set = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const prisma = createTransactionClientMock({
      unresolvedPlayerStatRow: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'row-1',
            source: 'footywire_fitzroy',
            sourceDocumentId: 'doc-1',
            sourceMatchId: '2026-R1-WBD-CAR',
            season: 2026,
            round: 1,
            playerName: 'Aaron Naughton',
            team: 'Western Bulldogs',
            rawPayloadJson: JSON.stringify({
              raw_row: { kicks: 10 },
              stats: { kicks: 10 },
            }),
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });

    const { firestore } = createFirestoreMock({
      bulkWriterFactory: (() => ({
        set,
        close,
      })) as unknown as Pick<Firestore, 'bulkWriter'>['bulkWriter'],
      docFactory: (id) => ({ id }),
    });

    const result = await replayUnresolvedPlayerStatRows({
      prisma,
      firestore,
      dryRun: false,
    });

    expect(result).toEqual({
      scanned: 1,
      replayed: 1,
      stillAmbiguous: 0,
      stillUnresolved: 0,
    });
    expect(set).toHaveBeenCalledOnce();
    expect(prisma.unresolvedPlayerStatRow.update).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(serverTimestamp).toHaveBeenCalledOnce();
  });
});
