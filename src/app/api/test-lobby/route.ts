import type { NextRequest } from 'next/server';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { authorizeLocalOnlyRequest } from '@/lib/operationalAuth';

/**
 * Test endpoint to check and fix lobby setup
 * Development only - protected in production
 */
export async function GET(_request: NextRequest) {
  const authorization = authorizeLocalOnlyRequest();
  if (!authorization.ok) return authorization.response;

  if (process.env.NODE_ENV === 'production') {
    return errorResponse('This endpoint is only available in development', 403);
  }

  try {
    const [{ ensureLobbyColumns, ensureRosterTables }, { prisma }] = await Promise.all([
      import('@/lib/ensureLobbyColumns'),
      import('@/lib/prisma'),
    ]);

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

    return errorResponse('Lobby test failed', 500);
  }
}
