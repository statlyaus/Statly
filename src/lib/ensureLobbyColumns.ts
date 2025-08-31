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
    
    const rosterPlayerExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'LeagueRosterPlayer'
      )
    `;
    
    const hasRoster = (rosterExists as { exists: boolean }[])[0]?.exists;
    const hasAction = (actionExists as { exists: boolean }[])[0]?.exists;
    const hasRosterPlayer = (rosterPlayerExists as { exists: boolean }[])[0]?.exists;
    
    logger.info('Roster tables check', {
      hasRoster,
      hasAction,
      hasRosterPlayer
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

    // Normalized join table for roster players (optional, for scalable rosters)
    if (!hasRosterPlayer) {
      logger.info('Creating LeagueRosterPlayer table');
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "LeagueRosterPlayer" (
          "id" TEXT NOT NULL,
          "leagueId" TEXT NOT NULL,
          "memberId" TEXT NOT NULL,
          "playerId" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "LeagueRosterPlayer_pkey" PRIMARY KEY ("id")
        )
      `;
      await prisma.$executeRaw`
        CREATE UNIQUE INDEX IF NOT EXISTS "LeagueRosterPlayer_unique" 
        ON "LeagueRosterPlayer"("leagueId", "memberId", "playerId")
      `;
      
      // Add foreign key constraints with proper namespace checking
      try {
        const constraintExists = await prisma.$queryRaw`
          SELECT EXISTS (
            SELECT 1 
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE t.relname = 'LeagueRosterPlayer'
              AND n.nspname = current_schema()
              AND c.conname = 'LeagueRosterPlayer_league_fk'
          )
        `;
        const hasConstraint = (constraintExists as { exists: boolean }[])[0]?.exists;
        
        if (!hasConstraint) {
          await prisma.$executeRaw`
            ALTER TABLE "LeagueRosterPlayer"
            ADD CONSTRAINT "LeagueRosterPlayer_league_fk"
            FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE
          `;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('already exists')) {
          logger.info('FK constraint already exists: LeagueRosterPlayer.leagueId -> League.id');
        } else {
          logger.warn('Failed to add FK constraint: LeagueRosterPlayer.leagueId -> League.id', {
            error: errorMsg,
            hint: 'This may be due to PostgreSQL version incompatibility or database permissions',
          });
        }
      }
      
      try {
        const memberConstraintExists = await prisma.$queryRaw`
          SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE t.relname = 'LeagueRosterPlayer'
              AND n.nspname = current_schema()
              AND c.conname = 'LeagueRosterPlayer_member_fk'
          )
        `;
        const hasMemberConstraint = (memberConstraintExists as { exists: boolean }[])[0]?.exists;
        
        if (!hasMemberConstraint) {
          await prisma.$executeRaw`
            ALTER TABLE "LeagueRosterPlayer"
            ADD CONSTRAINT "LeagueRosterPlayer_member_fk"
            FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE
          `;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('already exists')) {
          logger.info('FK constraint already exists: LeagueRosterPlayer.memberId -> LeagueMember.id');
        } else {
          logger.warn('Failed to add FK constraint: LeagueRosterPlayer.memberId -> LeagueMember.id', {
            error: errorMsg,
            hint: 'This may be due to PostgreSQL version incompatibility or database permissions',
          });
        }
      }
      
      try {
        const playerConstraintExists = await prisma.$queryRaw`
          SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE t.relname = 'LeagueRosterPlayer'
              AND n.nspname = current_schema()
              AND c.conname = 'LeagueRosterPlayer_player_fk'
          )
        `;
        const hasPlayerConstraint = (playerConstraintExists as { exists: boolean }[])[0]?.exists;
        
        if (!hasPlayerConstraint) {
          await prisma.$executeRaw`
            ALTER TABLE "LeagueRosterPlayer"
            ADD CONSTRAINT "LeagueRosterPlayer_player_fk"
            FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE
          `;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('already exists')) {
          logger.info('FK constraint already exists: LeagueRosterPlayer.playerId -> Player.id');
        } else {
          logger.warn('Failed to add FK constraint: LeagueRosterPlayer.playerId -> Player.id', {
            error: errorMsg,
            hint: 'This may be due to PostgreSQL version incompatibility or database permissions',
          });
        }
      }
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