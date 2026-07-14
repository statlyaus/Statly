import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { loadLeagueMatchupReadModel } from '@/server/leagues/matchupReadModel';

function parseRound(request: NextRequest): number | undefined {
  const value = request.nextUrl.searchParams.get('round');
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const membership = await getLeagueMembership(id, userId);
  if (!membership.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const data = await loadLeagueMatchupReadModel({
    leagueId: id,
    userId,
    round: parseRound(request),
    canManage: isLeagueManagerRole(membership.data?.role),
  });
  if (!data) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  return NextResponse.json(
    { success: true, data },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const membership = await getLeagueMembership(id, userId);
  if (!membership.isMember || !isLeagueManagerRole(membership.data?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(
    {
      error:
        'Fixtures are published from Competition Rules. Save the configuration and publish a new fixture version from League Settings.',
    },
    { status: 409 }
  );
}
