import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { changeLeagueSeasonYear } from '@/server/leagues/changeSeasonYear';
import { canManageLeague } from '@/server/leagues/membership';
import { getAuthorizedLeagueSeasonState } from '@/server/leagues/seasonState';
import { isSelectableSeasonYear } from '@/server/leagues/seasonYear';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const { id: leagueId } = await params;
    const result = await getAuthorizedLeagueSeasonState({ leagueId, userId });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    return NextResponse.json(
      { success: true, data: result.data },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    logger.error('Failed to load league season state', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to load league season state' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}

/** Commissioner change of the AFL season the league plays; allowed only while in SETUP. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: NO_STORE }
      );
    }

    const { id: leagueId } = await params;
    if (!(await canManageLeague(leagueId, userId))) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403, headers: NO_STORE }
      );
    }

    const body = (await request.json().catch(() => ({}))) as { year?: unknown };
    if (!isSelectableSeasonYear(body.year, new Date())) {
      return NextResponse.json(
        { success: false, error: 'Season must be a year from 2000 to next season' },
        { status: 400, headers: NO_STORE }
      );
    }

    const result = await changeLeagueSeasonYear({ leagueId, year: body.year });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status, headers: NO_STORE }
      );
    }

    return NextResponse.json({ success: true, data: { year: result.year } }, { headers: NO_STORE });
  } catch (error) {
    logger.error('Failed to change league season', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to change league season' },
      { status: 500, headers: NO_STORE }
    );
  }
}
