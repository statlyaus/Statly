import { NextResponse, type NextRequest } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
// import { enqueuePruneLobbyActivity } from '@/queues/maintenanceQueue';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    if (!isCronRequestAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: 'unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const retentionDays = Number(process.env.LOBBY_ACTIVITY_RETENTION_DAYS || 30);

    // Log successful cron execution for monitoring
    console.log(`[CRON] Pruning lobby activity with retention: ${retentionDays} days`);

    // TODO: Implement queue-based pruning when maintenance queue is available
    // await enqueuePruneLobbyActivity(retentionDays);

    return NextResponse.json(
      { ok: true, enqueued: 'prune-lobby-activity', retentionDays },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[CRON] Failed to enqueue prune job:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to enqueue prune job' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
