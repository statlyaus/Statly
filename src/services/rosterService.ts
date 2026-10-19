// Roster management service
// Uses LeagueRosterPlayer as the sole roster authority (normalized, FK-enforced)

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const rosterService = {
  /** Add a player to a roster, idempotent */
  async addPlayer(leagueId: string, memberId: string, playerId: string): Promise<void> {
    const existing = await prisma.leagueRosterPlayer.findUnique({
      where: { leagueId_memberId_playerId: { leagueId, memberId, playerId } },
    });

    if (existing) {
      logger.debug('Player already on roster', { leagueId, memberId, playerId });
      return;
    }

    await prisma.leagueRosterPlayer.create({
      data: {
        leagueId,
        memberId,
        playerId,
        acquiredBy: 'MANUAL',
      },
    });

    const count = await prisma.leagueRosterPlayer.count({ where: { leagueId, memberId } });
    logger.info('Added player to roster', { leagueId, memberId, playerId, count });
  },

  /** Remove a player from a roster */
  async removePlayer(leagueId: string, memberId: string, playerId: string): Promise<void> {
    const deleted = await prisma.leagueRosterPlayer.deleteMany({
      where: { leagueId, memberId, playerId },
    });

    if (deleted.count === 0) {
      logger.debug('Player not on roster, nothing to remove', { leagueId, memberId, playerId });
      return;
    }

    const count = await prisma.leagueRosterPlayer.count({ where: { leagueId, memberId } });
    logger.info('Removed player from roster', { leagueId, memberId, playerId, count });
  },
};
