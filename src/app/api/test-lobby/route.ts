import type { NextRequest } from 'next/server';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ensureLobbyColumns, ensureRosterTables } from '@/lib/ensureLobbyColumns';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Test endpoint to check and fix lobby setup
 */
export async function GET(_request: NextRequest) {
  try {
    logger.info('Testing lobby setup');

    // Check and ensure columns exist
    const columnsReady = await ensureLobbyColumns();
    const tablesReady = await ensureRosterTables();

    // Test a simple query
    const draftCount = await prisma.draft.count();

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
