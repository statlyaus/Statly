import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

// Daily cron endpoint triggered by Vercel (see vercel.json)
// - Runs on Node.js runtime so firebase-admin and other Node libs work
// - Requires CRON_SECRET outside local development (fails closed when unset). Vercel cron sends
//   `Authorization: Bearer <CRON_SECRET>`; `x-cron-secret` or `?token=` are also accepted.
export const runtime = 'nodejs';

function presentedSecret(req: NextRequest): string | null {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  return (
    bearer?.[1]?.trim() ||
    req.headers.get('x-cron-secret')?.trim() ||
    req.nextUrl.searchParams.get('token')
  );
}

// Hash both sides so the comparison is constant-time regardless of input length.
function secretsMatch(presented: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

function isAuthorized(req: NextRequest): boolean {
  const configured = process.env.CRON_SECRET?.trim();
  if (!configured) {
    return process.env.NODE_ENV === 'development';
  }
  const presented = presentedSecret(req);
  return presented !== null && secretsMatch(presented, configured);
}

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    // 👉 Put your daily job logic here (refresh stats, cleanup, reports, etc.)
    // Example:
    // const { db } = await import('@/lib/firebaseAdmin');
    // await db.collection('jobs').add({ job: 'daily', ranAt: Date.now() });

    const ranAt = new Date().toISOString();
    const durationMs = Date.now() - started;
    console.log('[CRON] Daily job ran', { ranAt, durationMs });

    return NextResponse.json(
      { ok: true, ranAt, durationMs },
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
