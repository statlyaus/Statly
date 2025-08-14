import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import type { 
  League, 
  CreateLeagueRequest, 
  LeagueMember,
} from '@/types/leagues';
import { 
  LEAGUE_CONSTRAINTS,
  DEFAULT_TRADE_SETTINGS,
  DEFAULT_WAIVER_SETTINGS 
} from '@/types/leagues';

// Generate unique league code
function generateLeagueCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Validate league creation request
function validateCreateLeagueRequest(data: unknown): CreateLeagueRequest {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid request data');
  }

  const body = data as Record<string, unknown>;
  const { name, type, maxTeams, categories, description, tradeSettings, waiverWire, draftDate } = body;

  // Validate required fields
  if (!name || typeof name !== 'string') {
    throw new Error('League name is required');
  }
  if (name.length < LEAGUE_CONSTRAINTS.name.minLength || name.length > LEAGUE_CONSTRAINTS.name.maxLength) {
    throw new Error(`League name must be between ${LEAGUE_CONSTRAINTS.name.minLength} and ${LEAGUE_CONSTRAINTS.name.maxLength} characters`);
  }

  if (!type || !['public', 'private'].includes(type)) {
    throw new Error('League type must be either "public" or "private"');
  }

  if (!maxTeams || typeof maxTeams !== 'number') {
    throw new Error('Max teams is required');
  }
  if (maxTeams < LEAGUE_CONSTRAINTS.maxTeams.min || maxTeams > LEAGUE_CONSTRAINTS.maxTeams.max) {
    throw new Error(`Max teams must be between ${LEAGUE_CONSTRAINTS.maxTeams.min} and ${LEAGUE_CONSTRAINTS.maxTeams.max}`);
  }

  if (!categories || !Array.isArray(categories)) {
    throw new Error('Categories are required');
  }
  if (categories.length < LEAGUE_CONSTRAINTS.categories.min || categories.length > LEAGUE_CONSTRAINTS.categories.max) {
    throw new Error(`Must select between ${LEAGUE_CONSTRAINTS.categories.min} and ${LEAGUE_CONSTRAINTS.categories.max} categories`);
  }

  // Validate optional fields
  if (description && description.length > LEAGUE_CONSTRAINTS.description.maxLength) {
    throw new Error(`Description must be less than ${LEAGUE_CONSTRAINTS.description.maxLength} characters`);
  }

  if (draftDate && isNaN(Date.parse(draftDate))) {
    throw new Error('Invalid draft date format');
  }

  return {
    name: name.trim(),
    type,
    maxTeams,
    categories,
    description: description?.trim(),
    tradeSettings,
    waiverWire,
    draftDate,
  };
}

// GET /api/leagues - List public leagues or user's leagues
export async function GET(req: NextRequest) {
  const tracer = withRequestTracing(req, { endpoint: 'leagues-list' });

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type'); // 'public' | 'my'
    const userId = req.headers.get('x-user-id'); // Assume auth middleware sets this

    let query = adminDb.collection('leagues');

    if (type === 'public') {
      // List public leagues that aren't full
      query = query.where('type', '==', 'public').where('status', '==', 'preseason');
    } else if (type === 'my' && userId) {
      // Get user's leagues through league members
      const memberSnapshot = await adminDb.collection('leagueMembers')
        .where('userId', '==', userId)
        .get();
      
      const leagueIds = memberSnapshot.docs.map(doc => doc.data().leagueId);
      
      if (leagueIds.length === 0) {
        return NextResponse.json({ success: true, data: [] });
      }

      // Firebase 'in' queries are limited to 10 items
      const leagues: League[] = [];
      for (let i = 0; i < leagueIds.length; i += 10) {
        const batch = leagueIds.slice(i, i + 10);
        const batchSnapshot = await adminDb.collection('leagues')
          .where('id', 'in', batch)
          .get();
        
        batchSnapshot.docs.forEach(doc => {
          leagues.push({ id: doc.id, ...doc.data() } as League);
        });
      }

      return NextResponse.json({ success: true, data: leagues });
    } else {
      // Default: return empty array if no specific type or user
      return NextResponse.json({ success: true, data: [] });
    }

    const snapshot = await query.orderBy('createdAt', 'desc').limit(50).get();
    const leagues = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    tracer.complete(200, { resultCount: leagues.length });
    return NextResponse.json({ success: true, data: leagues });

  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to fetch leagues');
  }
}

// POST /api/leagues - Create new league
export async function POST(req: NextRequest) {
  const tracer = withRequestTracing(req, { endpoint: 'leagues-create' });

  try {
    const body = await req.json();
    const userId = req.headers.get('x-user-id'); // Assume auth middleware sets this

    if (!userId) {
      return commonErrors.unauthorized('Must be logged in to create a league');
    }

    // Validate request
    const validatedData = validateCreateLeagueRequest(body);

    // Generate unique league code
    let code: string;
    let codeExists = true;
    let attempts = 0;
    
    do {
      code = generateLeagueCode();
      const existingLeague = await adminDb.collection('leagues')
        .where('code', '==', code)
        .limit(1)
        .get();
      codeExists = !existingLeague.empty;
      attempts++;
    } while (codeExists && attempts < 10);

    if (codeExists) {
      throw new Error('Failed to generate unique league code');
    }

    // Create league object
    const now = new Date().toISOString();
    const league: Omit<League, 'id'> = {
      name: validatedData.name,
      code,
      type: validatedData.type,
      ownerId: userId,
      maxTeams: validatedData.maxTeams,
      categories: validatedData.categories,
      tradeSettings: {
        ...DEFAULT_TRADE_SETTINGS,
        ...validatedData.tradeSettings,
      },
      waiverWire: {
        waiverOrder: [],
        waiverPeriodHours: DEFAULT_WAIVER_SETTINGS.waiverPeriodHours!,
        waiverResetPolicy: DEFAULT_WAIVER_SETTINGS.waiverResetPolicy!,
        ...validatedData.waiverWire,
      },
      createdAt: now,
      status: 'preseason',
      description: validatedData.description,
      draftDate: validatedData.draftDate,
    };

    // Save to database
    const leagueRef = await adminDb.collection('leagues').add(league);

    // Add creator as owner member
    const ownerMember: Omit<LeagueMember, 'id'> = {
      leagueId: leagueRef.id,
      userId,
      role: 'owner',
      teamName: `${validatedData.name} Owner`, // Default team name
      joinedAt: now,
      isActive: true,
    };

    await adminDb.collection('leagueMembers').add(ownerMember);

    const createdLeague: League = {
      id: leagueRef.id,
      ...league,
    };

    tracer.complete(201, { leagueId: createdLeague.id });
    return NextResponse.json({ 
      success: true, 
      data: createdLeague 
    }, { status: 201 });

  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 400);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }
    
    return commonErrors.internalServerError('Failed to create league');
  }
}
