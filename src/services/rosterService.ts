import { ensureRosterTables } from '@/lib/ensureLobbyColumns';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Roster service: LeagueRosterPlayer is the source of truth for player ownership and order.
 * LeagueRoster remains only as the metadata record for captain/bench settings.
 */

export const rosterService = {
  _ensurePromise: null as Promise<void> | null,
  async ensureTablesOnce(): Promise<void> {
    if (!this._ensurePromise) {
      this._ensurePromise = (async () => {
        try {
          await ensureRosterTables();
        } catch (e) {
          logger.warn('ensureRosterTables failed (continuing with best effort)', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }
    await this._ensurePromise;
  },
  /** Ensure a roster row exists for (leagueId, memberId), returns its id */
  async ensureRoster(leagueId: string, memberId: string): Promise<string> {
    await this.ensureTablesOnce();
    const existing = await prisma.leagueRoster.findFirst({ where: { leagueId, memberId } });
    if (existing) return existing.id;
    const created = await prisma.leagueRoster.create({
      data: {
        id: `${leagueId}:${memberId}`,
        leagueId,
        memberId,
      },
    });
    logger.info('Created LeagueRoster row', { leagueId, memberId });
    return created.id;
  },

  /** Add a player to a roster, idempotent. LeagueRosterPlayer is source of truth. */
  async addPlayer(leagueId: string, memberId: string, playerId: string): Promise<void> {
    await this.ensureTablesOnce();
    await this.ensureRoster(leagueId, memberId);

    const existing = await prisma.leagueRosterPlayer.findUnique({
      where: {
        leagueId_memberId_playerId: { leagueId, memberId, playerId },
      },
    });
    if (existing) return;

    const maxOrder = await prisma.leagueRosterPlayer
      .aggregate({
        where: { leagueId, memberId },
        _max: { sortOrder: true },
      })
      .then((r) => (r._max.sortOrder ?? -1) + 1);

    await prisma.leagueRosterPlayer.create({
      data: {
        id: `${leagueId}:${memberId}:${playerId}`,
        leagueId,
        memberId,
        playerId,
        sortOrder: maxOrder,
      },
    });

    const count = await prisma.leagueRosterPlayer.count({
      where: { leagueId, memberId },
    });
    logger.info('Added player to roster', { leagueId, memberId, playerId, count });
  },

  /** Remove a player from a roster */
  async removePlayer(leagueId: string, memberId: string, playerId: string): Promise<void> {
    await this.ensureTablesOnce();
    const deleted = await prisma.leagueRosterPlayer.deleteMany({
      where: { leagueId, memberId, playerId },
    });
    if (deleted.count === 0) return;

    const count = await prisma.leagueRosterPlayer.count({
      where: { leagueId, memberId },
    });
    logger.info('Removed player from roster', { leagueId, memberId, playerId, count });
  },
};
