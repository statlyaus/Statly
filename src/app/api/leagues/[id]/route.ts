import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DRAFT_PICK_SECONDS_OPTIONS } from '@/lib/draftClock';
import { logger } from '@/lib/logger';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { leagueDraftProvisioningService } from '@/server/draft/services/LeagueDraftProvisioningService';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';
import type { League, LeagueDetailResponse, LeagueMember } from '@/types/leagues';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';
export const runtime = 'nodejs';

const updateLeagueSchema = z.object({
  name: z.string().trim().min(3).max(50).optional(),
  type: z.enum(['public', 'private']).optional(),
  description: z.string().trim().max(500).optional(),
  maxTeams: z.number().int().min(4).max(20).optional(),
  regenerateInviteCode: z.boolean().optional(),
  categories: z.array(z.string()).min(1).optional(),
  draftDate: z.string().optional(),
  draftType: z.enum(['snake', 'linear']).optional(),
  timePerPick: z
    .number()
    .int()
    .refine(
      (value) =>
        DRAFT_PICK_SECONDS_OPTIONS.includes(value as (typeof DRAFT_PICK_SECONDS_OPTIONS)[number]),
      `Time per pick must be one of: ${DRAFT_PICK_SECONDS_OPTIONS.join(', ')} seconds`
    )
    .optional(),
  allowAutoPick: z.boolean().optional(),
  enableReminders: z.boolean().optional(),
  rosterSize: z.number().int().positive().optional(),
  benchSize: z.number().int().nonnegative().optional(),
  enableCaptainSystem: z.boolean().optional(),
  captainMultiplier: z.number().positive().optional(),
  viceCaptainMultiplier: z.number().positive().optional(),
  tradeLimit: z.number().int().nonnegative().optional(),
  tradeReview: z.enum(['none', 'admin', 'veto']).optional(),
  tradeVetoPeriodHours: z.number().int().min(1).max(336).optional(),
  tradeDeadline: z.string().optional(),
  waiverPeriodHours: z.number().int().positive().optional(),
  waiverResetPolicy: z.enum(['weekly', 'rolling']).optional(),
  waiverSystem: z.enum(['ROLLING_LIST', 'FAAB']).optional(),
  waiverPriorityMode: z.enum(['ROLLING', 'REVERSE_LADDER']).optional(),
  waiverFaabBudget: z.number().int().nonnegative().optional(),
  waiverMinimumBid: z.number().int().nonnegative().optional(),
  waiverMaxWeekAcquisitions: z.number().int().nonnegative().nullable().optional(),
  waiverMaxSeasonAcquisitions: z.number().int().nonnegative().nullable().optional(),
  waiverMoveWinnerToBack: z.boolean().optional(),
  waiverAcquisitionLocked: z.boolean().optional(),
  cantDropList: z.array(z.string().trim().min(1)).optional(),
  seasonWeeks: z.number().int().positive().optional(),
  matchupsPerOpponent: z.union([z.literal(1), z.literal(2)]).optional(),
  playoffsEnabled: z.boolean().optional(),
  playoffTeams: z.number().int().nonnegative().optional(),
  playoffLegLengthWeeks: z.number().int().positive().optional(),
  playoffReseedEachRound: z.boolean().optional(),
  playoffIncludeConsolation: z.boolean().optional(),
});

// GET /api/leagues/[id] - Get specific league details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;

    if (!leagueId || typeof leagueId !== 'string' || leagueId.trim().length === 0) {
      logger.warn('Invalid league ID in request', { params });
      return NextResponse.json({ success: false, error: 'Invalid league ID' }, { status: 400 });
    }

    const prismaLeague = await leagueApplicationService.getLeagueDetail(leagueId);

    if (prismaLeague) {
      const leagueData = prismaLeague.league;
      const memberData = prismaLeague.members;

      logger.info('League retrieved from Prisma', {
        leagueId,
        memberCount: memberData.length,
      });

      return NextResponse.json<LeagueDetailResponse>(
        {
          success: true,
          data: {
            league: leagueData,
            members: memberData,
            scoringCategories: leagueData.categories,
          },
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=60',
          },
        }
      );
    }

    // Handle test league for development
    if (leagueId === 'test-league-id') {
      const testLeague: League = {
        id: 'test-league-id',
        name: 'Test AFL Champions League',
        description: 'Test league for development and demonstration',
        type: 'public',
        code: '123ABC',
        maxTeams: 12,
        currentTeams: 12,
        ownerId: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
        categories: ['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s'],
        status: 'active',
        draftDate: new Date(Date.now() + 86400000 * 3).toISOString(), // 3 days from now
        createdAt: new Date().toISOString(),
        tradeSettings: {
          tradeLimit: 10,
          tradeReview: 'none',
        },
        waiverWire: {
          waiverOrder: [],
          waiverPeriodHours: 24,
          waiverResetPolicy: 'weekly',
        },
      };

      const testMembers: LeagueMember[] = [
        {
          id: 'test-member-1',
          leagueId: 'test-league-id',
          userId: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
          teamName: 'Robbo Rockers',
          joinedAt: new Date().toISOString(),
          isActive: true,
          role: 'owner',
        },
        {
          id: 'bot-member-1',
          leagueId: 'test-league-id',
          userId: 'bot-user-1',
          teamName: 'AFL Legends',
          joinedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-2',
          leagueId: 'test-league-id',
          userId: 'bot-user-2',
          teamName: 'Footy Fanatics',
          joinedAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-3',
          leagueId: 'test-league-id',
          userId: 'bot-user-3',
          teamName: 'Goal Getters',
          joinedAt: new Date(Date.now() - 259200000).toISOString(), // 3 days ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-4',
          leagueId: 'test-league-id',
          userId: 'bot-user-4',
          teamName: 'Mark Masters',
          joinedAt: new Date(Date.now() - 345600000).toISOString(), // 4 days ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-5',
          leagueId: 'test-league-id',
          userId: 'bot-user-5',
          teamName: 'Tackle Titans',
          joinedAt: new Date(Date.now() - 432000000).toISOString(), // 5 days ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-6',
          leagueId: 'test-league-id',
          userId: 'bot-user-6',
          teamName: 'Disposal Dynamos',
          joinedAt: new Date(Date.now() - 518400000).toISOString(), // 6 days ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-7',
          leagueId: 'test-league-id',
          userId: 'bot-user-7',
          teamName: 'Inside 50 Kings',
          joinedAt: new Date(Date.now() - 604800000).toISOString(), // 7 days ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-8',
          leagueId: 'test-league-id',
          userId: 'bot-user-8',
          teamName: 'Brownlow Medalists',
          joinedAt: new Date(Date.now() - 691200000).toISOString(), // 8 days ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-9',
          leagueId: 'test-league-id',
          userId: 'bot-user-9',
          teamName: 'Grand Final Heroes',
          joinedAt: new Date(Date.now() - 777600000).toISOString(), // 9 days ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-10',
          leagueId: 'test-league-id',
          userId: 'bot-user-10',
          teamName: 'Rising Stars',
          joinedAt: new Date(Date.now() - 864000000).toISOString(), // 10 days ago
          isActive: true,
          role: 'member',
        },
        {
          id: 'bot-member-11',
          leagueId: 'test-league-id',
          userId: 'bot-user-11',
          teamName: 'Elite Defenders',
          joinedAt: new Date(Date.now() - 950400000).toISOString(), // 11 days ago
          isActive: true,
          role: 'member',
        },
      ];

      return NextResponse.json<LeagueDetailResponse>(
        {
          success: true,
          data: {
            league: testLeague,
            members: testMembers,
            scoringCategories: testLeague.categories,
          },
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=60',
          },
        }
      );
    }

    logger.warn('League not found', { leagueId });
    return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 });
  } catch (error) {
    logger.error('Failed to fetch league', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return NextResponse.json(
      { success: false, error: 'Failed to fetch league details' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    if (!leagueId || typeof leagueId !== 'string' || leagueId.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid league ID' }, { status: 400 });
    }

    const userId = await getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = updateLeagueSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid league update payload' },
        { status: 400 }
      );
    }

    const validKeys = new Set(Object.keys(FANTASY_CATEGORIES) as FantasyCategoryKey[]);
    const categories = parsedBody.data.categories?.filter(
      (category): category is FantasyCategoryKey => validKeys.has(category as FantasyCategoryKey)
    );

    const updated = await leagueApplicationService.updateLeagueSetup({
      leagueId,
      actorUserId: userId,
      name: parsedBody.data.name,
      type: parsedBody.data.type,
      description: parsedBody.data.description,
      maxTeams: parsedBody.data.maxTeams,
      regenerateInviteCode: parsedBody.data.regenerateInviteCode,
      categories,
      draftDate: parsedBody.data.draftDate,
      draftType: parsedBody.data.draftType,
      timePerPick: parsedBody.data.timePerPick,
      allowAutoPick: parsedBody.data.allowAutoPick,
      enableReminders: parsedBody.data.enableReminders,
      rosterSize: parsedBody.data.rosterSize,
      benchSize: parsedBody.data.benchSize,
      enableCaptainSystem: parsedBody.data.enableCaptainSystem,
      captainMultiplier: parsedBody.data.captainMultiplier,
      viceCaptainMultiplier: parsedBody.data.viceCaptainMultiplier,
      tradeLimit: parsedBody.data.tradeLimit,
      tradeReview: parsedBody.data.tradeReview,
      tradeVetoPeriodHours: parsedBody.data.tradeVetoPeriodHours,
      tradeDeadline: parsedBody.data.tradeDeadline,
      waiverPeriodHours: parsedBody.data.waiverPeriodHours,
      waiverResetPolicy: parsedBody.data.waiverResetPolicy,
      waiverSystem: parsedBody.data.waiverSystem,
      waiverPriorityMode: parsedBody.data.waiverPriorityMode,
      waiverFaabBudget: parsedBody.data.waiverFaabBudget,
      waiverMinimumBid: parsedBody.data.waiverMinimumBid,
      waiverMaxWeekAcquisitions: parsedBody.data.waiverMaxWeekAcquisitions ?? undefined,
      waiverMaxSeasonAcquisitions: parsedBody.data.waiverMaxSeasonAcquisitions ?? undefined,
      waiverMoveWinnerToBack: parsedBody.data.waiverMoveWinnerToBack,
      waiverAcquisitionLocked: parsedBody.data.waiverAcquisitionLocked,
      cantDropList: parsedBody.data.cantDropList,
      seasonWeeks: parsedBody.data.seasonWeeks,
      matchupsPerOpponent: parsedBody.data.matchupsPerOpponent,
      playoffsEnabled: parsedBody.data.playoffsEnabled,
      playoffTeams: parsedBody.data.playoffTeams,
      playoffLegLengthWeeks: parsedBody.data.playoffLegLengthWeeks,
      playoffReseedEachRound: parsedBody.data.playoffReseedEachRound,
      playoffIncludeConsolation: parsedBody.data.playoffIncludeConsolation,
    });

    const shouldSyncDraft =
      parsedBody.data.draftDate !== undefined ||
      parsedBody.data.draftType !== undefined ||
      parsedBody.data.timePerPick !== undefined ||
      parsedBody.data.enableReminders !== undefined ||
      parsedBody.data.rosterSize !== undefined ||
      parsedBody.data.benchSize !== undefined;

    const draftProvisioning = shouldSyncDraft
      ? await leagueDraftProvisioningService.syncFromLeagueSettings(leagueId)
      : undefined;

    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        ...(draftProvisioning ? { draftProvisioning } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('not_found:')) {
      return NextResponse.json(
        { success: false, error: message.replace('not_found:', '') },
        { status: 404 }
      );
    }

    if (message.startsWith('forbidden:')) {
      return NextResponse.json(
        { success: false, error: message.replace('forbidden:', '') },
        { status: 403 }
      );
    }

    logger.error('Failed to update league', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return NextResponse.json(
      { success: false, error: 'Failed to update league details' },
      { status: 500 }
    );
  }
}
