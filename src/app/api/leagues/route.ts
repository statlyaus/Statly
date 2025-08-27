import { NextResponse, type NextRequest } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { adminDb } from '@/lib/firebaseAdmin';
import type { League, CreateLeagueRequest, LeagueMember } from '@/types/leagues';

// Generate unique league code
function generateLeagueCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /api/leagues - List leagues
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type');

    let snapshot;
    if (type === 'public') {
      // Get public leagues only
      snapshot = await adminDb.collection('leagues').where('type', '==', 'public').limit(20).get();
    } else {
      // Get all leagues without ordering for now (to avoid index requirement)
      snapshot = await adminDb.collection('leagues').limit(20).get();
    }

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
  console.log('🎯 League creation API called');

  try {
    const body = (await req.json()) as CreateLeagueRequest;
    const userId = await getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    console.log('📝 Received data:', { body, userId });

    // Basic validation
    if (!body.name || body.name.length < 3) {
      console.log('❌ Validation failed: League name too short');
      return NextResponse.json(
        { success: false, error: 'League name must be at least 3 characters' },
        { status: 400 }
      );
    }

    if (!body.categories || body.categories.length < 3) {
      console.log('❌ Validation failed: Not enough categories');
      return NextResponse.json(
        { success: false, error: 'Must select at least 3 categories' },
        { status: 400 }
      );
    }

    // Generate unique league code
    let code: string;
    let attempts = 0;
    do {
      code = generateLeagueCode();
      const existingLeague = await adminDb
        .collection('leagues')
        .where('code', '==', code)
        .limit(1)
        .get();
      attempts++;
      if (existingLeague.empty) break;
    } while (attempts < 10);

    // Create league object
    const now = new Date().toISOString();
    const league: Omit<League, 'id'> = {
      name: body.name,
      code,
      type: body.type || 'public',
      ownerId: userId,
      maxTeams: body.maxTeams || 10,
      categories: body.categories,
      tradeSettings: {
        tradeLimit: body.tradeSettings?.tradeLimit || 10,
        tradeReview: body.tradeSettings?.tradeReview || 'none',
        ...(body.tradeSettings?.tradeDeadline && {
          tradeDeadline: body.tradeSettings.tradeDeadline,
        }),
      },
      waiverWire: {
        waiverOrder: [],
        waiverPeriodHours: body.waiverWire?.waiverPeriodHours || 24,
        waiverResetPolicy: body.waiverWire?.waiverResetPolicy || 'weekly',
      },
      createdAt: now,
      status: 'preseason',
      ...(body.description && { description: body.description }),
      ...(body.draftDate && { draftDate: body.draftDate }),
    };

    // Save to database
    const leagueRef = await adminDb.collection('leagues').add(league);

    // Add creator as owner member
    const ownerMember: Omit<LeagueMember, 'id'> = {
      leagueId: leagueRef.id,
      userId,
      role: 'owner',
      teamName: `${body.name} Owner`,
      joinedAt: now,
      isActive: true,
    };

    await adminDb.collection('league_members').add(ownerMember);

    const createdLeague: League = {
      id: leagueRef.id,
      ...league,
    };

    return NextResponse.json(
      {
        success: true,
        data: createdLeague,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating league:', error);
    return NextResponse.json({ success: false, error: 'Failed to create league' }, { status: 500 });
  }
}
