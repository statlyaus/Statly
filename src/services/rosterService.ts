// Roster management service

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { executeDbSafely } from '@/lib/errorHandling';

/**
 * Simple JSON-array storage for playerIds in LeagueRoster.playerIds (TEXT).
 * We store a JSON string of [playerId, ...]. This avoids advanced migrations.
 */

function parseIds(text?: string | null): string[] {
  if (!text) return [];
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function stringifyIds(ids: string[]): string {
  return JSON.stringify(Array.from(new Set(ids)));
}

export const rosterService = {
  /** Ensure a roster row exists for (leagueId, memberId), returns its id */
  async ensureRoster(leagueId: string, memberId: string): Promise<string> {
    const existing = await prisma.leagueRoster.findFirst({ where: { leagueId, memberId } });
    if (existing) return existing.id;
    const created = await prisma.leagueRoster.create({
      data: {
        id: `${leagueId}:${memberId}`,
        leagueId,
        memberId,
        playerIds: stringifyIds([]),
      },
    });
    logger.info('Created LeagueRoster row', { leagueId, memberId });
    return created.id;
  },

  /** Add a player to a roster, idempotent */
  async addPlayer(leagueId: string, memberId: string, playerId: string): Promise<void> {
    const id = await this.ensureRoster(leagueId, memberId);
    const row = await prisma.leagueRoster.findUnique({ where: { id } });
    const ids = parseIds(row?.playerIds);
    if (!ids.includes(playerId)) ids.push(playerId);
    await prisma.leagueRoster.update({ where: { id }, data: { playerIds: stringifyIds(ids) } });

    // Also upsert into normalized join table if present
    await executeDbSafely(
      () => prisma.$executeRaw`
        INSERT INTO "LeagueRosterPlayer" ("id", "leagueId", "memberId", "playerId")
        VALUES (${`${leagueId}:${memberId}:${playerId}`}, ${leagueId}, ${memberId}, ${playerId})
        ON CONFLICT ("leagueId", "memberId", "playerId") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
      `,
      'insert into normalized roster table',
      { leagueId, memberId, playerId, service: 'rosterService' }
    );

    logger.info('Added player to roster', { leagueId, memberId, playerId, count: ids.length });
  },

  /** Remove a player from a roster */
  async removePlayer(leagueId: string, memberId: string, playerId: string): Promise<void> {
    const id = `${leagueId}:${memberId}`;
    const row = await prisma.leagueRoster.findUnique({ where: { id } });
    if (!row) return;
    const ids = parseIds(row.playerIds).filter((p) => p !== playerId);
    await prisma.leagueRoster.update({ where: { id }, data: { playerIds: stringifyIds(ids) } });

    await executeDbSafely(
      () => prisma.$executeRaw`
        DELETE FROM "LeagueRosterPlayer" WHERE "leagueId" = ${leagueId} AND "memberId" = ${memberId} AND "playerId" = ${playerId}
      `,
      'delete from normalized roster table',
      { leagueId, memberId, playerId, service: 'rosterService' }
    );

    logger.info('Removed player from roster', { leagueId, memberId, playerId, count: ids.length });
  },
};
