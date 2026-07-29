import { NextResponse, type NextRequest } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { adminDb } from '@/lib/firebaseAdmin';
import type { CreateLeagueRequest } from '@/types/leagues';
import { createLeague, LeagueCreationError } from '@/server/leagues/createLeagueService';

// GET /api/leagues - List leagues
export async function GET(_req: NextRequest) {
  try {
    const snapshot = await adminDb
      .collection('leagues')
      .where('type', '==', 'public')
      .limit(20)
      .get();

    const leagues = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({
      success: true,
      data: leagues,
    });
  } catch (error) {
    console.error('Error fetching leagues:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch leagues' }, { status: 500 });
  }
}

// POST /api/leagues - Create new league
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await req.json()) as CreateLeagueRequest;
    const creation = await createLeague({ userId, input: body });

    return NextResponse.json(
      {
        success: true,
        data: creation.league,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof LeagueCreationError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }
    console.error('Error creating league:', error);
    return NextResponse.json({ success: false, error: 'Failed to create league' }, { status: 500 });
  }
}
