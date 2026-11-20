import { NextResponse, type NextRequest } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { parseRetentionDays, pruneLobbyActivity } from '@/server/draft/lobbyActivityRetention';

export const runtime = 'nodejs';

// Called daily by netlify/functions/cron-prune-lobby.mts. Deletes synchronously and reports what it deleted.
export async function GET(req: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!isCronRequestAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  }

  const retentionDays = parseRetentionDays(process.env.LOBBY_ACTIVITY_RETENTION_DAYS);
  if (retentionDays === null) {
    return NextResponse.json(
      { ok: false, error: 'LOBBY_ACTIVITY_RETENTION_DAYS must be a whole number from 1 to 3650' },
      { status: 400, headers }
    );
  }

  try {
    const { count } = await pruneLobbyActivity(retentionDays);
    console.log(`[CRON] Deleted ${count} lobby activity rows older than ${retentionDays} days`);
    return NextResponse.json({ ok: true, deleted: count, retentionDays }, { headers });
  } catch (error) {
    console.error('[CRON] Failed to prune lobby activity:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to prune lobby activity' },
      { status: 500, headers }
    );
  }
}
