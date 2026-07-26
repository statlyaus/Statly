import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Ensure lobby columns exist on the Draft table
 * This is a temporary function to handle the migration
 */
export async function ensureLobbyColumns(): Promise<boolean> {
  try {
    // Try to select lobby columns from a draft to see if they exist
    let hasLobbyColumns = false;
    try {
      await prisma.$queryRaw`SELECT "lobbyStatus", "lobbyOpenAt" FROM "Draft" LIMIT 1`;
      hasLobbyColumns = true;
      logger.info('Lobby columns already exist');
    } catch (_error) {
      logger.info('Lobby columns do not exist, will create them');
    }

    if (hasLobbyColumns) {
      return true;
    }

    logger.warn('Lobby columns missing, attempting to add them');

    // Add missing columns
    try {
      await prisma.$executeRaw`
        ALTER TABLE "Draft" ADD COLUMN "lobbyStatus" TEXT DEFAULT 'CLOSED'
      `;
      logger.info('Added lobbyStatus column');
    } catch (error) {
      logger.warn('Failed to add lobbyStatus column (may already exist)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await prisma.$executeRaw`
        ALTER TABLE "Draft" ADD COLUMN "lobbyOpenAt" TIMESTAMP(3)
      `;
      logger.info('Added lobbyOpenAt column');
    } catch (error) {
      logger.warn('Failed to add lobbyOpenAt column (may already exist)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return true;
  } catch (error) {
    logger.error('Failed to ensure lobby columns', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
