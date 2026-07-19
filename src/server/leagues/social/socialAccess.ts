import 'server-only';

import { prisma } from '@/lib/prisma';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';

import { SocialError } from './socialErrors';

const DEFAULT_BOARD_CATEGORIES = [
  {
    slug: 'announcements',
    name: 'Announcements',
    description: 'Official league updates from commissioners.',
    sortOrder: 0,
  },
  {
    slug: 'general',
    name: 'General discussion',
    description: 'League-wide conversation and coordination.',
    sortOrder: 1,
  },
  {
    slug: 'trades',
    name: 'Trades',
    description: 'Trade ideas, negotiations, and discussion.',
    sortOrder: 2,
  },
  {
    slug: 'rules',
    name: 'Rules and league decisions',
    description: 'League rules, proposals, and recorded decisions.',
    sortOrder: 3,
  },
] as const;

export interface LeagueSocialAccess {
  leagueId: string;
  seasonId: string;
  userId: string;
  memberId: string;
  canManage: boolean;
  mutedUntil: Date | null;
  standardsAccepted: boolean;
  canPublish: boolean;
}

export async function requireLeagueSocialAccess(
  leagueId: string,
  userId: string
): Promise<LeagueSocialAccess> {
  const membership = await getLeagueMembershipAccess(leagueId, userId);
  if (!membership.isMember) {
    throw new SocialError('FORBIDDEN', 'You are not an active member of this league');
  }
  if (!membership.memberId) {
    throw new SocialError(
      'CONFLICT',
      'Your league membership must finish syncing before social features are available'
    );
  }

  const seasonId = await ensureActiveLeagueSeason(leagueId);
  const now = new Date();
  const [mute, member] = await Promise.all([
    prisma.socialMute.findFirst({
      where: {
        leagueId,
        seasonId,
        mutedUserId: userId,
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
      select: { expiresAt: true },
    }),
    prisma.leagueMember.findFirst({
      where: { id: membership.memberId, leagueId, userId, isActive: true },
      select: { socialStandardsAcceptedAt: true },
    }),
  ]);
  if (!member) {
    throw new SocialError('FORBIDDEN', 'Active league membership is required');
  }

  return {
    leagueId,
    seasonId,
    userId,
    memberId: membership.memberId,
    canManage: membership.canManage,
    mutedUntil: mute?.expiresAt ?? null,
    standardsAccepted: Boolean(member.socialStandardsAcceptedAt),
    canPublish: !mute && Boolean(member.socialStandardsAcceptedAt),
  };
}

export function requireSocialPublishingAccess(access: LeagueSocialAccess): void {
  if (!access.canPublish) {
    if (!access.standardsAccepted) {
      throw new SocialError(
        'FORBIDDEN',
        'Accept the Statly community standards before publishing league social content'
      );
    }
    throw new SocialError(
      'MUTED',
      access.mutedUntil
        ? `You cannot publish league social content until ${access.mutedUntil.toISOString()}`
        : 'You cannot publish league social content'
    );
  }
}

export function requireSocialManager(access: LeagueSocialAccess): void {
  if (!access.canManage) {
    throw new SocialError('FORBIDDEN', 'Commissioner permission is required');
  }
}

export async function ensureActiveLeagueSeason(leagueId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const ensureDefaultCategories = async (seasonId: string): Promise<void> => {
      for (const category of DEFAULT_BOARD_CATEGORIES) {
        await tx.socialBoardCategory.upsert({
          where: {
            seasonId_slug: {
              seasonId,
              slug: category.slug,
            },
          },
          update: {
            name: category.name,
            description: category.description,
            sortOrder: category.sortOrder,
          },
          create: {
            leagueId,
            seasonId,
            ...category,
          },
        });
      }
    };

    const league = await tx.league.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        activeSeasonId: true,
        settings: { select: { startAt: true } },
      },
    });
    if (!league) {
      throw new SocialError('NOT_FOUND', 'League not found');
    }

    if (league.activeSeasonId) {
      const activeSeason = await tx.leagueSeason.findFirst({
        where: { id: league.activeSeasonId, leagueId },
        select: { id: true },
      });
      if (activeSeason) {
        await ensureDefaultCategories(activeSeason.id);
        return activeSeason.id;
      }
    }

    const year = (league.settings.startAt ?? new Date()).getUTCFullYear();
    const season = await tx.leagueSeason.upsert({
      where: { leagueId_year: { leagueId, year } },
      update: {},
      create: {
        leagueId,
        year,
        label: String(year),
        startsAt: league.settings.startAt,
      },
      select: { id: true },
    });

    await tx.league.update({
      where: { id: leagueId },
      data: { activeSeasonId: season.id },
    });

    await ensureDefaultCategories(season.id);

    return season.id;
  });
}
