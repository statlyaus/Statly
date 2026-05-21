import type { NextRequest } from 'next/server';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { authorizeCronRequest } from '@/lib/operationalAuth';
import { processPendingReminders } from '@/lib/reminders';

/**
 * Cron job endpoint to process pending draft reminders
 * Should be called every minute by a cron service (e.g., Vercel Cron, GitHub Actions, etc.)
 *
 * Example cron schedule: "* * * * *" (every minute)
 *
 * For Vercel, add to vercel.json:
 * {
 *   "crons": [
 *     {
 *       "path": "/api/cron/reminders",
 *       "schedule": "* * * * *"
 *     }
 *   ]
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const authorization = authorizeCronRequest(request);
    if (!authorization.ok) return authorization.response;

    logger.info('Processing draft reminders cron job');

    await processPendingReminders();

    return successResponse({
      message: 'Draft reminders processed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to process draft reminders', {
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to process reminders', 500);
  }
}

// Also support POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request);
}
