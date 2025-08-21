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
 * Check if roster management tables exist and create them if they don't
 */
export async function ensureRosterTables(): Promise<boolean> {
  try {
    // Check if LeagueRoster table exists
    const rosterExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'LeagueRoster'
      )
    `;
    
    // Check if TeamAction table exists
    const actionExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'TeamAction'
      )
    `;
    
    const hasRoster = (rosterExists as { exists: boolean }[])[0]?.exists;
    const hasAction = (actionExists as { exists: boolean }[])[0]?.exists;
    
    logger.info('Roster tables check', {
      hasRoster,
      hasAction
    });
    
    if (!hasRoster) {
      logger.info('Creating LeagueRoster table');
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "LeagueRoster" (
          "id" TEXT NOT NULL,
          "leagueId" TEXT NOT NULL,
          "memberId" TEXT NOT NULL,
          "playerIds" TEXT NOT NULL,
          "captainId" TEXT,
          "viceCaptainId" TEXT,
          "benchOrder" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "LeagueRoster_pkey" PRIMARY KEY ("id")
        )
      `;
      
      await prisma.$executeRaw`
        CREATE UNIQUE INDEX IF NOT EXISTS "LeagueRoster_leagueId_memberId_key" 
        ON "LeagueRoster"("leagueId", "memberId")
      `;
    }
    
    if (!hasAction) {
      logger.info('Creating TeamAction table');
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "TeamAction" (
          "id" TEXT NOT NULL,
          "leagueId" TEXT NOT NULL,
          "memberId" TEXT NOT NULL,
          "actionType" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'PENDING',
          "details" TEXT NOT NULL,
          "targetMemberId" TEXT,
          "processingAt" TIMESTAMP(3),
          "processedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "TeamAction_pkey" PRIMARY KEY ("id")
        )
      `;
    }
    
    // Add captain system columns to LeagueSettings if they don't exist
    try {
      await prisma.$executeRaw`
        ALTER TABLE "LeagueSettings" ADD COLUMN "enableCaptainSystem" BOOLEAN DEFAULT false
      `;
      logger.info('Added enableCaptainSystem column');
    } catch (error) {
      logger.warn('Failed to add enableCaptainSystem column (may already exist)', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      await prisma.$executeRaw`
        ALTER TABLE "LeagueSettings" ADD COLUMN "captainMultiplier" REAL DEFAULT 2.0
      `;
      logger.info('Added captainMultiplier column');
    } catch (error) {
      logger.warn('Failed to add captainMultiplier column (may already exist)', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      await prisma.$executeRaw`
        ALTER TABLE "LeagueSettings" ADD COLUMN "viceCaptainMultiplier" REAL DEFAULT 1.5
      `;
      logger.info('Added viceCaptainMultiplier column');
    } catch (error) {
      logger.warn('Failed to add viceCaptainMultiplier column (may already exist)', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    return true;
  } catch (error) {
    logger.error('Failed to ensure roster tables', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
