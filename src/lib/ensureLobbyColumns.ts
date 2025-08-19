import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Ensure lobby columns exist on the Draft table
 * This is a temporary function to handle the migration
 */
export async function ensureLobbyColumns(): Promise<boolean> {
  try {
    // Try to query a draft with lobby columns to see if they exist
    const testQuery = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Draft' 
      AND column_name IN ('lobbyStatus', 'lobbyOpenAt')
    `;
    
    const columns = testQuery as Array<{ column_name: string }>;
    const hasLobbyStatus = columns.some(col => col.column_name === 'lobbyStatus');
    const hasLobbyOpenAt = columns.some(col => col.column_name === 'lobbyOpenAt');
    
    logger.info('Lobby columns check', {
      hasLobbyStatus,
      hasLobbyOpenAt,
      foundColumns: columns.map(c => c.column_name)
    });
    
    if (!hasLobbyStatus || !hasLobbyOpenAt) {
      logger.warn('Lobby columns missing, attempting to add them');
      
      // Add missing columns
      if (!hasLobbyStatus) {
        await prisma.$executeRaw`
          ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "lobbyStatus" TEXT DEFAULT 'CLOSED'
        `;
        logger.info('Added lobbyStatus column');
      }
      
      if (!hasLobbyOpenAt) {
        await prisma.$executeRaw`
          ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "lobbyOpenAt" TIMESTAMP(3)
        `;
        logger.info('Added lobbyOpenAt column');
      }
      
      return true;
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
    
    const hasWatchlist = (watchlistExists as any[])[0]?.exists;
    const hasQueue = (queueExists as any[])[0]?.exists;
    
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
