import { NextResponse, type NextRequest } from 'next/server';

import { z } from 'zod';

import { logger } from '@/lib/logger';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';
import type { CreateLeagueRequest, TradeReview } from '@/types/leagues';

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
    const leagues = await leagueApplicationService.listLeagues(
      type === 'public' || type === 'private' ? type : undefined
    );

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

    const createdLeague = await leagueApplicationService.createLeague({
      userId,
      name: body.name,
      type: body.type || 'public',
      maxTeams: body.maxTeams || 12,
      categories: body.categories,
      description: body.description,
      tradeSettings: body.tradeSettings,
      waiverWire: body.waiverWire,
      draftDate: body.draftDate,
    });

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
