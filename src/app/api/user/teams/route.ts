import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const uid = await getUserIdFromRequest(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const members = await prisma.leagueMember.findMany({
    where: { userId: uid },
    select: { id: true, leagueId: true, teamName: true },
    orderBy: { id: 'asc' },
  });

  const activeLeague = request.cookies.get('active_league')?.value || null;
  const activeMember = request.cookies.get('active_member')?.value || null;

  return NextResponse.json({
    success: true,
    data: members.map((m) => ({ memberId: m.id, leagueId: m.leagueId, teamName: m.teamName })),
    active: { leagueId: activeLeague, memberId: activeMember },
  });
}

const PostSchema = z.object({
  leagueId: z.string().min(1),
  memberId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const uid = await getUserIdFromRequest(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Basic CSRF guard: check Origin against expected
  const origin = request.headers.get('origin') || request.headers.get('referer') || '';
  const host = request.headers.get('host') || '';
  const isLocal = host.includes('localhost') || host.startsWith('127.');
  const expectedOrigin = process.env.APP_URL || `http${isLocal ? '' : 's'}://${host}`;
  const sameSite = request.headers.get('sec-fetch-site');
  if (!origin || !origin.startsWith(expectedOrigin)) {
    if (sameSite !== 'same-origin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const json = await request.json();
  const body = PostSchema.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { error: 'Invalid payload', issues: body.error.issues },
      { status: 400 }
    );
  }

  // Verify membership
  const member = await prisma.leagueMember.findFirst({
    where: { id: body.data.memberId, leagueId: body.data.leagueId, userId: uid },
    select: { id: true },
  });
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Set cookies for active context
  const resp = NextResponse.json({ success: true });
  resp.cookies.set('active_league', body.data.leagueId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  resp.cookies.set('active_member', body.data.memberId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return resp;
}
