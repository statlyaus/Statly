import { NextResponse, type NextRequest } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { pruneOutboxes } from '@/server/outbox/outboxRetention';

// Daily cron endpoint, called by the hosting scheduler
// - Runs on Node.js runtime so firebase-admin and other Node libs work
// - Protected by CRON_SECRET via isCronRequestAuthorized (fails closed outside development)
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronRequestAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const outbox = await pruneOutboxes();

    const ranAt = new Date().toISOString();
    const durationMs = Date.now() - started;
    console.log('[CRON] Daily job ran', { ranAt, durationMs, outbox });

    return NextResponse.json(
      { ok: true, ranAt, durationMs, outbox },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isProd = process.env.NODE_ENV === 'production';
    const errorLog: Record<string, unknown> = { message };
    if (!isProd && err instanceof Error && err.stack) {
      errorLog.stack = err.stack;
    }
    // Log details server-side; stack only in non-production
    console.error('[CRON] Daily job failed', errorLog);

    return NextResponse.json(
      { ok: false, error: message, ranAt: new Date().toISOString() },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
