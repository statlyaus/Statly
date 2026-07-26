import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { loadLobbySchemaDiagnostic } from '@/server/diagnostics/lobbySchemaDiagnostic';

/**
 * Test endpoint to check lobby setup without mutating the schema.
 */
export async function GET(_request: NextRequest) {
  try {
    logger.info('Testing lobby setup');

    const result = await loadLobbySchemaDiagnostic();

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
