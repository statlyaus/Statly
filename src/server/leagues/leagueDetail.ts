import 'server-only';

import { adminDb } from '@/lib/firebaseAdmin';
import { listActiveLeagueMembers } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getLeagueDraftOperationalReadiness } from '@/server/draft/services/DraftReadinessService';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';
import { REAL_DATA_NINE_CATEGORY_PRESET, type FantasyCategoryKey } from '@/types/fantasyCategories';
import type { League, LeagueMember } from '@/types/leagues';

const REAL_DATA_CATEGORY_KEYS = new Set<FantasyCategoryKey>(REAL_DATA_NINE_CATEGORY_PRESET);

export type LeagueDetailSuccess = {
  ok: true;
  league: League | null;
  members: LeagueMember[];
};

export type LeagueDetailFailure = {
  ok: false;
  status: 401 | 403 | 404 | 500;
  error: string;
};

export type LeagueDetailResult = LeagueDetailSuccess | LeagueDetailFailure;

export async function loadAuthorizedLeagueDetail(
  leagueId: string,
  userId: string | null
): Promise<LeagueDetailResult> {
  if (leagueId !== 'test-league-id') {
    if (!userId) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const access = await getLeagueMembershipAccess(leagueId, userId);
    if (!access.isMember) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
  }

  return loadLeagueDetail(leagueId);
}

async function loadLeagueDetail(leagueId: string): Promise<LeagueDetailResult> {
  try {
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
      const draftReadiness = await getLeagueDraftOperationalReadiness(prisma, { leagueId });
      const members = prismaLeague.members.map((member) => ({
        id: member.id,
        leagueId: member.leagueId,
        userId: member.userId,
        teamName: member.teamName,
        joinedAt: member.joinedAt.toISOString(),
        isActive: true,
        role: member.userId === prismaLeague.ownerId ? 'owner' : 'member',
      })) satisfies LeagueMember[];

      logger.info('League retrieved from Prisma', {
        leagueId,
        memberCount: members.length,
      });

      const categories = normalizeLeagueCategories(prismaLeague.categoriesJson);

      return {
        ok: true,
        league: {
          id: prismaLeague.id,
          name: prismaLeague.name,
          code: prismaLeague.inviteCode,
          ownerId: prismaLeague.ownerId,
          maxTeams: prismaLeague.settings?.maxTeams || 12,
          currentTeams: prismaLeague.members.length,
          status: toLeagueStatus(prismaLeague.drafts[0]?.status),
          type: 'private',
          description: `${prismaLeague.name} Fantasy League`,
          categories,
          draftDate: prismaLeague.settings?.startAt?.toISOString(),
          draftType: prismaLeague.settings?.draftType?.toLowerCase() as League['draftType'],
          pickOrder: prismaLeague.settings?.pickOrder?.toLowerCase() as League['pickOrder'],
          waiverRule: prismaLeague.settings?.waiverRule?.toLowerCase() as League['waiverRule'],
          draftReadiness,
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
        },
        members,
      };
    }

    if (leagueId === 'test-league-id') {
      return {
        ok: true,
        league: createTestLeague(),
        members: createTestMembers(),
      };
    }

    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();

    if (!leagueDoc.exists) {
      logger.warn('League not found', { leagueId });
      return { ok: false, status: 404, error: 'League not found' };
    }

    const league: League = {
      id: leagueDoc.id,
      ...leagueDoc.data(),
    } as League;
    const members = (await listActiveLeagueMembers(leagueId)).map(toApiLeagueMember);

    logger.info('League retrieved from Firebase', {
      leagueId,
      memberCount: members.length,
    });

    return { ok: true, league, members };
  } catch (error) {
    logger.error('Failed to load league detail', {
      leagueId,
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return { ok: false, status: 500, error: 'Failed to fetch league details' };
  }
}

function createTestLeague(): League {
  return {
    id: 'test-league-id',
    name: 'Test AFL Champions League',
    description: 'Test league for development and demonstration',
    type: 'public',
    code: '123ABC',
    maxTeams: 12,
    currentTeams: 12,
    ownerId: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
    categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
    status: 'active',
    draftDate: new Date(Date.now() + 86400000 * 3).toISOString(),
    draftType: 'snake',
    pickOrder: 'random',
    waiverRule: 'weekly',
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
}

function createTestMembers(): LeagueMember[] {
  return [
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
      joinedAt: new Date(Date.now() - 86400000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-2',
      leagueId: 'test-league-id',
      userId: 'bot-user-2',
      teamName: 'Footy Fanatics',
      joinedAt: new Date(Date.now() - 172800000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-3',
      leagueId: 'test-league-id',
      userId: 'bot-user-3',
      teamName: 'Goal Getters',
      joinedAt: new Date(Date.now() - 259200000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-4',
      leagueId: 'test-league-id',
      userId: 'bot-user-4',
      teamName: 'Mark Masters',
      joinedAt: new Date(Date.now() - 345600000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-5',
      leagueId: 'test-league-id',
      userId: 'bot-user-5',
      teamName: 'Tackle Titans',
      joinedAt: new Date(Date.now() - 432000000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-6',
      leagueId: 'test-league-id',
      userId: 'bot-user-6',
      teamName: 'Disposal Dynamos',
      joinedAt: new Date(Date.now() - 518400000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-7',
      leagueId: 'test-league-id',
      userId: 'bot-user-7',
      teamName: 'Inside 50 Kings',
      joinedAt: new Date(Date.now() - 604800000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-8',
      leagueId: 'test-league-id',
      userId: 'bot-user-8',
      teamName: 'Brownlow Medalists',
      joinedAt: new Date(Date.now() - 691200000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-9',
      leagueId: 'test-league-id',
      userId: 'bot-user-9',
      teamName: 'Grand Final Heroes',
      joinedAt: new Date(Date.now() - 777600000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-10',
      leagueId: 'test-league-id',
      userId: 'bot-user-10',
      teamName: 'Rising Stars',
      joinedAt: new Date(Date.now() - 864000000).toISOString(),
      isActive: true,
      role: 'member',
    },
    {
      id: 'bot-member-11',
      leagueId: 'test-league-id',
      userId: 'bot-user-11',
      teamName: 'Elite Defenders',
      joinedAt: new Date(Date.now() - 950400000).toISOString(),
      isActive: true,
      role: 'member',
    },
  ];
}

function toApiLeagueMember(member: Awaited<ReturnType<typeof listActiveLeagueMembers>>[number]) {
  return {
    id: member.id,
    leagueId: member.leagueId,
    userId: member.userId,
    role: member.role as LeagueMember['role'],
    teamName: member.teamName,
    joinedAt: toIsoDate(member.joinedAt),
    ...(member.leftAt ? { leftAt: toIsoDate(member.leftAt) } : {}),
    isActive: member.isActive,
  } satisfies LeagueMember;
}

function toLeagueStatus(status: unknown): League['status'] {
  if (typeof status !== 'string') return 'preseason';

  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'completed') return normalized;
  return 'preseason';
}

function normalizeLeagueCategories(value: unknown): FantasyCategoryKey[] {
  if (typeof value !== 'string') {
    return [...REAL_DATA_NINE_CATEGORY_PRESET];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [...REAL_DATA_NINE_CATEGORY_PRESET];
    }

    const selected = parsed.filter(
      (category): category is FantasyCategoryKey =>
        typeof category === 'string' && REAL_DATA_CATEGORY_KEYS.has(category as FantasyCategoryKey)
    );

    return selected.length === parsed.length && selected.length
      ? selected
      : [...REAL_DATA_NINE_CATEGORY_PRESET];
  } catch {
    return [...REAL_DATA_NINE_CATEGORY_PRESET];
  }
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : '';
}
