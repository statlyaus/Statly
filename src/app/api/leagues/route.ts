import { NextResponse, type NextRequest } from 'next/server';

import { z } from 'zod';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import type { League, CreateLeagueRequest, LeagueMember, TradeReview } from '@/types/leagues';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Convert scoring format to categories array
function getCategoriesFromScoringFormat(scoringFormat: string): FantasyCategoryKey[] {
  switch (scoringFormat) {
    case 'nine-category':
      // Based on NINE_CATEGORY_IMPLEMENTATION_SUCCESS.md
      return [
        'goals',
        'tackles',
        'inside50s',
        'intercepts',
        'contestedMarks',
        'rebound50s',
        'contestedPossessions',
        'effectiveDisposals',
        'scoreInvolvements',
      ];
    case 'standard':
    case 'ppr':
    default:
      // Default standard categories
      return ['goals', 'kicks', 'handballs', 'marks', 'tackles', 'hitouts'];
  }
}

function normalizeCategories(
  categories: string[] | undefined,
  scoringFormat: string | undefined
): FantasyCategoryKey[] {
  const fallback = getCategoriesFromScoringFormat(scoringFormat || 'standard');
  const selected = categories && categories.length > 0 ? categories : fallback;
  const validKeys = new Set(Object.keys(FANTASY_CATEGORIES) as FantasyCategoryKey[]);
  return selected.filter((category): category is FantasyCategoryKey =>
    validKeys.has(category as FantasyCategoryKey)
  );
}

function normalizeTradeReview(value: string | undefined): TradeReview | undefined {
  switch (value) {
    case 'commissioner':
      return 'admin';
    case 'league':
      return 'veto';
    case 'none':
    case 'admin':
    case 'veto':
      return value;
    default:
      return undefined;
  }
}

// Generate unique league code
function generateLeagueCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Zod schema for league creation (supports both new and legacy formats)
const CreateLeagueSchema = z
  .object({
    name: z.string().min(3, 'League name must be at least 3 characters'),
    type: z.enum(['public', 'private']).optional().default('public'),
    maxTeams: z.number().int().min(4).max(20).optional(),
    categories: z.array(z.string()).min(3, 'Must select at least 3 categories').optional(),
    // Legacy format fields
    scoringFormat: z.enum(['standard', 'ppr', 'nine-category']).optional(),
    teamCount: z.number().int().min(4).max(20).optional(),
    commissionerId: z.string().optional(),
    tradeSettings: z
      .object({
        tradeLimit: z.number().int().nonnegative().optional(),
        tradeReview: z.enum(['none', 'league', 'commissioner']).optional(),
        tradeDeadline: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (data) => {
      // Either categories must be provided, or scoringFormat must be provided (legacy)
      return data.categories !== undefined || data.scoringFormat !== undefined;
    },
    {
      message: 'Either categories or scoringFormat must be provided',
    }
  );

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

    const leagues = snapshot.docs.map((doc) => {
      const data = doc.data();
      const categories = Array.isArray((data as any)?.categories)
        ? ((data as any).categories as string[])
        : [];
      return {
        id: doc.id,
        ...data,
        scoringCategories: categories,
      };
    });

    return NextResponse.json({
      success: true,
      data: leagues,
    });
  } catch (error) {
    logger.error('Error fetching leagues', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ success: false, error: 'Failed to fetch leagues' }, { status: 500 });
  }
}

// POST /api/leagues - Create new league
export async function POST(req: NextRequest) {
  logger.info('League creation API called');

  try {
    const rawBody = await req.json();
    const userId = await getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Validate with Zod
    const parsed = CreateLeagueSchema.safeParse(rawBody);
    if (!parsed.success) {
      logger.warn('Validation failed', { issues: parsed.error.flatten().fieldErrors });
      return NextResponse.json(
        { success: false, error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const validated = parsed.data;

    // Handle legacy format with scoringFormat/teamCount/commissionerId
    let body: CreateLeagueRequest;
    const normalizedTradeSettings = validated.tradeSettings
      ? {
          tradeLimit: validated.tradeSettings.tradeLimit,
          tradeReview: normalizeTradeReview(validated.tradeSettings.tradeReview),
          tradeDeadline: validated.tradeSettings.tradeDeadline,
        }
      : undefined;

    if (validated.scoringFormat || validated.teamCount || validated.commissionerId) {
      // Convert legacy format to new format
      const categories = normalizeCategories(validated.categories, validated.scoringFormat);
      if (categories.length < 3) {
        return NextResponse.json(
          { success: false, error: 'Must select at least 3 valid categories' },
          { status: 400 }
        );
      }
      body = {
        name: validated.name,
        type: validated.type || 'public',
        maxTeams: validated.maxTeams || validated.teamCount || 12,
        categories,
        tradeSettings: normalizedTradeSettings,
      };
      // Use commissionerId if provided, otherwise use authenticated userId
      if (validated.commissionerId && validated.commissionerId !== userId) {
        logger.warn('commissionerId differs from authenticated userId, using authenticated userId', {
          commissionerId: validated.commissionerId,
          authenticatedUserId: userId,
        });
      }
    } else {
      body = {
        name: validated.name,
        type: validated.type || 'public',
        maxTeams: validated.maxTeams || 12,
        categories: normalizeCategories(validated.categories, validated.scoringFormat),
        tradeSettings: normalizedTradeSettings,
      };
    }
    if (body.categories.length < 3) {
      return NextResponse.json(
        { success: false, error: 'Must select at least 3 valid categories' },
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

    // Save to database atomically with owner member via batch
    const leagueRef = adminDb.collection('leagues').doc();
    const batch = adminDb.batch();
    batch.set(leagueRef, league);

    // Add creator as owner member
    const ownerMember: Omit<LeagueMember, 'id'> = {
      leagueId: leagueRef.id,
      userId,
      role: 'owner',
      teamName: `${body.name} Owner`,
      joinedAt: now,
      isActive: true,
    };

    const ownerMemberRef = leagueRef.collection('members').doc(userId);
    batch.set(ownerMemberRef, ownerMember, { merge: true });
    const leagueMemberRef = adminDb.collection('leagueMembers').doc(`${leagueRef.id}_${userId}`);
    batch.set(leagueMemberRef, ownerMember, { merge: true });
    await batch.commit();

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
    logger.error('Error creating league', error instanceof Error ? error : new Error(String(error)), {
      userId: await getUserIdFromRequest(req).catch(() => null),
    });
    return NextResponse.json({ success: false, error: 'Failed to create league' }, { status: 500 });
  }
}
