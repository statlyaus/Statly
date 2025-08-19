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
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      await prisma.$executeRaw`
        ALTER TABLE "Draft" ADD COLUMN "lobbyOpenAt" TIMESTAMP(3)
      `;
      logger.info('Added lobbyOpenAt column');
    } catch (error) {
      logger.warn('Failed to add lobbyOpenAt column (may already exist)', {
        error: error instanceof Error ? error.message : String(error)
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

/**
 * Check if lobby tables exist and create them if they don't
 */
export async function ensureLobbyTables(): Promise<boolean> {
  try {
    // Check if DraftWatchlist table exists
    const watchlistExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'DraftWatchlist'
      )
    `;
    
    // Check if PreDraftQueue table exists
    const queueExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'PreDraftQueue'
      )
    `;
    
    const hasWatchlist = (watchlistExists as { exists: boolean }[])[0]?.exists;
    const hasQueue = (queueExists as { exists: boolean }[])[0]?.exists;
    
    logger.info('Lobby tables check', {
      hasWatchlist,
      hasQueue
    });
    
    if (!hasWatchlist) {
      logger.info('Creating DraftWatchlist table');
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "DraftWatchlist" (
          "id" TEXT NOT NULL,
          "draftId" TEXT NOT NULL,
          "memberId" TEXT NOT NULL,
          "playerId" TEXT NOT NULL,
          "priority" INTEGER NOT NULL DEFAULT 1,
          "notes" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "DraftWatchlist_pkey" PRIMARY KEY ("id")
        )
      `;
    }
    
    if (!hasQueue) {
      logger.info('Creating PreDraftQueue table');
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "PreDraftQueue" (
          "id" TEXT NOT NULL,
          "draftId" TEXT NOT NULL,
          "memberId" TEXT NOT NULL,
          "playerId" TEXT NOT NULL,
          "rank" INTEGER NOT NULL,
          "notes" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "PreDraftQueue_pkey" PRIMARY KEY ("id")
        )
      `;
    }
    
    return true;
  } catch (error) {
    logger.error('Failed to ensure lobby tables', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
