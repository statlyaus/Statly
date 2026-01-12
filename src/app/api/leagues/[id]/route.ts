import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { successResponse } from '@/lib/apiResponse';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import type { League, LeagueMember } from '@/types/leagues';
export const runtime = 'nodejs';

const ALLOWED_CATEGORIES = new Set([
  'goals',
  'kicks',
  'handballs',
  'marks',
  'tackles',
  'hitouts',
  'clearances',
  'inside50s',
  'rebound50s',
  'clangers',
  'contestedPossessions',
  'uncontestedPossessions',
  'freesFor',
  'freesAgainst',
  'onePercenters',
  'goalAssists',
  'timeOnGroundPct',
  'disposalEffPct',
  'turnovers',
  'intercepts',
  'metresGained',
  'contestedMarks',
  'effectiveDisposals',
  'scoreInvolvements',
]);

const CATEGORY_ALIASES: Record<string, string> = {
  inside_50s: 'inside50s',
  rebound_50s: 'rebound50s',
  contested_possessions: 'contestedPossessions',
  uncontested_possessions: 'uncontestedPossessions',
  effective_disposals: 'effectiveDisposals',
  disposal_eff_pct: 'disposalEffPct',
  time_on_ground_pct: 'timeOnGroundPct',
  goal_assists: 'goalAssists',
  frees_for: 'freesFor',
  frees_against: 'freesAgainst',
  one_percenters: 'onePercenters',
  metres_gained: 'metresGained',
  contested_marks: 'contestedMarks',
  score_involvements: 'scoreInvolvements',
};

function normalizeCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const mapped = raw
    .map((value) => (typeof value === 'string' ? value : ''))
    .map((value) => CATEGORY_ALIASES[value] || value)
    .filter((value) => ALLOWED_CATEGORIES.has(value));
  return Array.from(new Set(mapped));
}

function normalizeTradeSettings(raw: unknown) {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    tradeLimit: typeof obj.tradeLimit === 'number' ? obj.tradeLimit : 10,
    tradeReview: obj.tradeReview === 'admin' || obj.tradeReview === 'veto' ? obj.tradeReview : 'none',
    tradeDeadline: typeof obj.tradeDeadline === 'string' ? obj.tradeDeadline : undefined,
  };
}

function normalizeWaiverWire(raw: unknown) {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    waiverOrder: Array.isArray(obj.waiverOrder) ? (obj.waiverOrder as string[]) : [],
    waiverPeriodHours: typeof obj.waiverPeriodHours === 'number' ? obj.waiverPeriodHours : 24,
    waiverResetPolicy: obj.waiverResetPolicy === 'rolling' ? 'rolling' : 'weekly',
  };
}

// GET /api/leagues/[id] - Get specific league details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolvedParams = await params;
    const leagueId = resolvedParams?.id;
    
    if (!leagueId || typeof leagueId !== 'string' || leagueId.trim().length === 0) {
      logger.warn('Invalid league ID in request', { params: resolvedParams });
      return NextResponse.json(
        { success: false, error: 'Invalid league ID' },
        { status: 400 }
      );
    }

    // First try to get from Prisma database
    const prismaLeague = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        settings: true,
        members: {
          include: {
            user: true,
          },
          orderBy: { joinedAt: 'asc' },
        },
        drafts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (prismaLeague) {
      // Convert Prisma data to the expected format
      const leagueData = {
        id: prismaLeague.id,
        name: prismaLeague.name,
        code: prismaLeague.inviteCode,
        ownerId: prismaLeague.ownerId,
        maxTeams: prismaLeague.settings?.maxTeams || 12,
        currentTeams: prismaLeague.members.length,
        status: prismaLeague.drafts[0]?.status || 'preseason',
        type: 'private', // Default for Prisma leagues
        description: `${prismaLeague.name} Fantasy League`,
        categories: ['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s'],
        draftDate: prismaLeague.drafts[0]?.createdAt?.toISOString(),
        createdAt: prismaLeague.createdAt.toISOString(),
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

      const memberData = prismaLeague.members.map((member) => ({
        id: member.id,
        leagueId: member.leagueId,
        userId: member.userId,
        teamName: member.teamName,
        joinedAt: member.joinedAt.toISOString(),
        isActive: true,
        role: member.userId === prismaLeague.ownerId ? 'owner' : 'member',
      }));

      logger.info('League retrieved from Prisma', {
        leagueId,
        memberCount: memberData.length,
      });

      return NextResponse.json(
        { success: true, data: { league: leagueData, members: memberData } },
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

      return NextResponse.json(
        { success: true, data: { league: testLeague, members: testMembers } },
        {
          headers: {
            'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=60',
          },
        }
      );
    }

    // Fallback to Firebase for existing leagues
    // Get league data
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();

    if (!leagueDoc.exists) {
      logger.warn('League not found', { leagueId });
      return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 });
    }

    const leagueData = leagueDoc.data();
    const league: League = {
      id: leagueDoc.id,
      ...(leagueData as Omit<League, 'id'>),
      categories: normalizeCategories(leagueData?.categories),
      tradeSettings: normalizeTradeSettings(leagueData?.tradeSettings),
      waiverWire: normalizeWaiverWire(leagueData?.waiverWire),
    } as League;

    // Get league members
    const membersSnapshot = await adminDb
      .collection('leagues')
      .doc(leagueId)
      .collection('members')
      .where('isActive', '==', true)
      .get();

    const members = membersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as LeagueMember[];

    logger.info('League retrieved from Firebase', {
      leagueId,
      memberCount: members.length,
    });

    return NextResponse.json(
      { success: true, data: { league, members } },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=60' } }
    );
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
