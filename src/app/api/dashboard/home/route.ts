import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { loadManagerHome } from '@/server/dashboard/managerHome';

const noStore = { 'Cache-Control': 'private, no-store' };

/** GET /api/dashboard/home: the signed-in manager's leagues and pending decisions. */
export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401, headers: noStore }
    );
  }

  try {
    const data = await loadManagerHome({ userId });
    return NextResponse.json({ success: true, data }, { status: 200, headers: noStore });
  } catch (error) {
    logger.error('Failed to load manager home', error);
    return NextResponse.json(
      { success: false, error: 'Could not load your leagues' },
      { status: 500, headers: noStore }
    );
  }
}
