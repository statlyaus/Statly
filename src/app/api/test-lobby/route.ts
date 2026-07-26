import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Test endpoint to check lobby setup without mutating the schema.
 */
export async function GET(_request: NextRequest) {
  try {
    logger.info('Testing lobby setup');

    const [draftCount] = await Promise.all([
      prisma.draft.count(),
      prisma.leagueRoster.count(),
      prisma.teamAction.count(),
      prisma.leagueRosterPlayer.count(),
    ]);
    const tablesReady = true;

    // Try to query with lobby columns
    let lobbyTest = null;
    try {
      const testDraft = await prisma.draft.findFirst({
        select: {
          id: true,
          status: true,
          lobbyStatus: true,
          lobbyOpenAt: true,
        },
      });
      lobbyTest = { success: true, draft: testDraft };
    } catch (error) {
      lobbyTest = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const columnsReady = lobbyTest.success;

    const result = {
      columnsReady,
      tablesReady,
      draftCount,
      lobbyTest,
      timestamp: new Date().toISOString(),
    };

    logger.info('Lobby test results', result);

    return successResponse(result);
  } catch (error) {
    logger.error('Lobby test failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse(
      `Lobby test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}
