import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { logger } from '@/lib/logger';
import {
  loadStoredTradeStoryBundle,
  storeApprovedTradeStoryBundle,
} from '@/server/aflTradeIntelligence/publication/publicTradeBundleStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Puts the owner-approved trade story bundle into the site's private blob store, and reports whether
 * it is there. The caller presents `Authorization: Bearer <CRON_SECRET>`. The secret alone cannot
 * change what readers see: only the bundle whose id is `AFL_TRADE_STORY_PUBLIC_BUNDLE_ID` is stored.
 *
 *   gzip -c bundle.json | curl -X POST --data-binary @- \
 *     -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/admin/afl-trade-story-bundle
 */

const noStore = { 'Cache-Control': 'no-store' } as const;
const environment = () => ({
  AFL_TRADE_STORY_PUBLIC_BUNDLE_ID: process.env.AFL_TRADE_STORY_PUBLIC_BUNDLE_ID,
});
const unauthorized = () =>
  NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: noStore });

export async function POST(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) return unauthorized();
  try {
    const result = await storeApprovedTradeStoryBundle(
      new Uint8Array(await request.arrayBuffer()),
      environment()
    );
    if (!result.stored)
      return NextResponse.json(
        { ok: false, error: result.reason },
        { status: result.reason === 'no_approved_bundle_id' ? 409 : 422, headers: noStore }
      );
    logger.info('Stored the approved trade story bundle', {
      bundleId: result.bundleId,
      bytes: result.bytes,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: noStore });
  } catch (error) {
    logger.error('Failed to store the trade story bundle', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: 'storage_unavailable' },
      { status: 503, headers: noStore }
    );
  }
}

/** Whether the approved bundle is in the store. */
export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) return unauthorized();
  const approvedId = environment().AFL_TRADE_STORY_PUBLIC_BUNDLE_ID?.trim() ?? '';
  try {
    const stored = approvedId ? (await loadStoredTradeStoryBundle(approvedId, {})) !== null : false;
    return NextResponse.json(
      { ok: true, approvedBundleId: approvedId || null, stored },
      { headers: noStore }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'storage_unavailable' },
      { status: 503, headers: noStore }
    );
  }
}
