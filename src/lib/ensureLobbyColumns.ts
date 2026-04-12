import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDuplicateColumnError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes('duplicate column name');
}

function isSqliteConstraintAlterError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return (
    msg.includes('near "constraint": syntax error') ||
    msg.includes("near 'constraint': syntax error")
  );
}

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

/**
 * Check if roster management tables exist and create them if they don't
 */
export async function ensureRosterTables(): Promise<boolean> {
  try {
    logger.info('Ensuring roster tables exist');

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "LeagueRoster" (
        "id" TEXT NOT NULL,
        "leagueId" TEXT NOT NULL,
        "memberId" TEXT NOT NULL,
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

    // Normalized join table for roster players (optional, for scalable rosters)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "LeagueRosterPlayer" (
        "id" TEXT NOT NULL,
        "leagueId" TEXT NOT NULL,
        "memberId" TEXT NOT NULL,
        "playerId" TEXT NOT NULL,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LeagueRosterPlayer_pkey" PRIMARY KEY ("id")
      )
    `;
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "LeagueRosterPlayer_unique" 
      ON "LeagueRosterPlayer"("leagueId", "memberId", "playerId")
    `;
    // SQLite doesn't support ALTER TABLE ... ADD CONSTRAINT, so skip noisy FK attempts there.
    if (!isSqlite) {
      // Add foreign key constraints (best-effort; ignore if already exist)
      try {
        await prisma.$executeRaw`
          ALTER TABLE "LeagueRosterPlayer"
          ADD CONSTRAINT IF NOT EXISTS "LeagueRosterPlayer_league_fk"
          FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE
        `;
      } catch (error) {
        if (!isSqliteConstraintAlterError(error)) {
          logger.warn('FK add failed or exists: LeagueRosterPlayer.leagueId -> League.id', {
            error: errorMessage(error),
          });
        }
      }
      try {
        await prisma.$executeRaw`
          ALTER TABLE "LeagueRosterPlayer"
          ADD CONSTRAINT IF NOT EXISTS "LeagueRosterPlayer_member_fk"
          FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE
        `;
      } catch (error) {
        if (!isSqliteConstraintAlterError(error)) {
          logger.warn('FK add failed or exists: LeagueRosterPlayer.memberId -> LeagueMember.id', {
            error: errorMessage(error),
          });
        }
      }
      try {
        await prisma.$executeRaw`
          ALTER TABLE "LeagueRosterPlayer"
          ADD CONSTRAINT IF NOT EXISTS "LeagueRosterPlayer_player_fk"
          FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE
        `;
      } catch (error) {
        if (!isSqliteConstraintAlterError(error)) {
          logger.warn('FK add failed or exists: LeagueRosterPlayer.playerId -> Player.id', {
            error: errorMessage(error),
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
      if (!isDuplicateColumnError(error)) {
        logger.warn('Failed to add enableCaptainSystem column (may already exist)', {
          error: errorMessage(error),
        });
      }
    }

    try {
      await prisma.$executeRaw`
        ALTER TABLE "LeagueSettings" ADD COLUMN "captainMultiplier" REAL DEFAULT 2.0
      `;
      logger.info('Added captainMultiplier column');
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        logger.warn('Failed to add captainMultiplier column (may already exist)', {
          error: errorMessage(error),
        });
      }
    }

    try {
      await prisma.$executeRaw`
        ALTER TABLE "LeagueSettings" ADD COLUMN "viceCaptainMultiplier" REAL DEFAULT 1.5
      `;
      logger.info('Added viceCaptainMultiplier column');
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        logger.warn('Failed to add viceCaptainMultiplier column (may already exist)', {
          error: errorMessage(error),
        });
      }
    }

    return true;
  } catch (error) {
    logger.error('Failed to ensure roster tables', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
