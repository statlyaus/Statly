import { createHash } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

import {
  recordUnresolvedPlayerStatRow,
  resolvePlayerIdentity,
} from '@/server/playerIdentityResolver';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type ReplayOptions = {
  prisma: PrismaLike;
  firestore?: Pick<Firestore, 'bulkWriter' | 'collection'> | null;
  season?: number;
  limit?: number;
  dryRun: boolean;
};

function computeChecksum(data: unknown): string {
  return createHash('md5').update(JSON.stringify(data)).digest('hex');
}

export async function replayUnresolvedPlayerStatRows(options: ReplayOptions): Promise<{
  scanned: number;
  replayed: number;
  stillAmbiguous: number;
  stillUnresolved: number;
}> {
  const rows = await options.prisma.unresolvedPlayerStatRow.findMany({
    where: {
      status: {
        in: ['NEW', 'REVIEWED'],
      },
      ...(typeof options.season === 'number' ? { season: options.season } : {}),
    },
    orderBy: [{ season: 'asc' }, { createdAt: 'asc' }],
    take: options.limit,
  });

  const writer = options.dryRun ? null : (options.firestore?.bulkWriter() ?? null);
  let replayed = 0;
  let stillAmbiguous = 0;
  let stillUnresolved = 0;

  try {
    for (const row of rows) {
      const rawPayload = JSON.parse(row.rawPayloadJson) as Record<string, unknown>;
      const resolution = await resolvePlayerIdentity(options.prisma, {
        playerName: row.playerName,
        team: row.team,
        season: row.season,
        round: row.round,
        source: row.source,
        sourceDocumentId: row.sourceDocumentId,
        sourceMatchId: row.sourceMatchId,
        rawPayload,
      });

      if (resolution.outcome !== 'resolved') {
        if (!options.dryRun) {
          await recordUnresolvedPlayerStatRow(
            options.prisma,
            {
              playerName: row.playerName,
              team: row.team,
              season: row.season,
              round: row.round,
              source: row.source,
              sourceDocumentId: row.sourceDocumentId,
              sourceMatchId: row.sourceMatchId,
              rawPayload,
            },
            resolution
          );
        }

        if (resolution.outcome === 'ambiguous') stillAmbiguous += 1;
        else stillUnresolved += 1;
        continue;
      }

      if (!options.dryRun && options.firestore && writer) {
        const stats = (rawPayload.stats as Record<string, unknown> | undefined) ?? {};
        const rawRow = (rawPayload.raw_row as Record<string, unknown> | undefined) ?? {};
        const docData = {
          ...rawPayload,
          player_id: resolution.playerId,
          playerId: resolution.playerId,
          raw_checksum: computeChecksum(rawRow),
          last_seen_at: new Date().toISOString(),
          last_updated: FieldValue.serverTimestamp(),
        };

        writer.set(
          options.firestore.collection('player_match_stats').doc(row.sourceDocumentId),
          docData,
          {
            merge: true,
          }
        );

        void stats;

        await options.prisma.unresolvedPlayerStatRow.update({
          where: { id: row.id },
          data: {
            status: 'RESOLVED',
            resolvedPlayerId: resolution.playerId,
            resolvedAt: new Date(),
            candidatePlayerIdsJson: JSON.stringify([resolution.playerId]),
            resolutionNotes: `Replayed into canonical player_match_stats via ${resolution.matchedBy} resolution.`,
          },
        });
      }

      replayed += 1;
    }
  } finally {
    await writer?.close();
  }

  return {
    scanned: rows.length,
    replayed,
    stillAmbiguous,
    stillUnresolved,
  };
}
