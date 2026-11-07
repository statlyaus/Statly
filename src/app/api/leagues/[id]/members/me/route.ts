import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getLeagueMembership } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  normalizeTeamSymbolPosition,
  normalizeTeamSymbolUrl,
  normalizeTeamSymbolZoom,
} from '@/lib/teamSymbol';
import type { LeagueMemberNotificationSettings } from '@/types/leagues';
import {
  DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES,
  type SocialNotificationPreferences,
} from '@/types/social';

const DEFAULT_NOTIFICATION_SETTINGS: LeagueMemberNotificationSettings = {
  tradePush: true,
  waiverPush: true,
  draftReminder: true,
  scoringAlerts: true,
};

function hasBodyField(body: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function hasTeamLogoPatch(body: Record<string, unknown>): boolean {
  return (
    hasBodyField(body, 'teamLogoUrl') ||
    hasBodyField(body, 'teamLogoPositionX') ||
    hasBodyField(body, 'teamLogoPositionY') ||
    hasBodyField(body, 'teamLogoZoom')
  );
}

function parseTeamName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Team name is required');
  }

  const teamName = value.trim();
  if (teamName.length < 2) {
    throw new Error('Team name must be at least 2 characters');
  }
  if (teamName.length > 60) {
    throw new Error('Team name must be 60 characters or fewer');
  }

  return teamName;
}

function parseTeamLogoPatch(body: Record<string, unknown>) {
  return {
    teamLogoUrl: normalizeTeamSymbolUrl(body.teamLogoUrl),
    teamLogoPositionX: normalizeTeamSymbolPosition(body.teamLogoPositionX),
    teamLogoPositionY: normalizeTeamSymbolPosition(body.teamLogoPositionY),
    teamLogoZoom: normalizeTeamSymbolZoom(body.teamLogoZoom),
  };
}

function parseNotificationSettings(value: unknown): LeagueMemberNotificationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Notification settings are invalid');
  }

  const settings = value as Record<string, unknown>;
  const social = parseSocialNotificationSettings(settings.social);
  return {
    tradePush:
      typeof settings.tradePush === 'boolean'
        ? settings.tradePush
        : DEFAULT_NOTIFICATION_SETTINGS.tradePush,
    waiverPush:
      typeof settings.waiverPush === 'boolean'
        ? settings.waiverPush
        : DEFAULT_NOTIFICATION_SETTINGS.waiverPush,
    draftReminder:
      typeof settings.draftReminder === 'boolean'
        ? settings.draftReminder
        : DEFAULT_NOTIFICATION_SETTINGS.draftReminder,
    scoringAlerts:
      typeof settings.scoringAlerts === 'boolean'
        ? settings.scoringAlerts
        : DEFAULT_NOTIFICATION_SETTINGS.scoringAlerts,
    social,
  };
}

function parseSocialNotificationSettings(value: unknown): SocialNotificationPreferences {
  const settings =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    chatInApp:
      typeof settings.chatInApp === 'boolean'
        ? settings.chatInApp
        : DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES.chatInApp,
    boardPosts:
      typeof settings.boardPosts === 'boolean'
        ? settings.boardPosts
        : DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES.boardPosts,
    ownPostReplies:
      typeof settings.ownPostReplies === 'boolean'
        ? settings.ownPostReplies
        : DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES.ownPostReplies,
    announcements:
      typeof settings.announcements === 'boolean'
        ? settings.announcements
        : DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES.announcements,
    tradeDiscussions:
      typeof settings.tradeDiscussions === 'boolean'
        ? settings.tradeDiscussions
        : DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES.tradeDiscussions,
    mentions:
      typeof settings.mentions === 'boolean'
        ? settings.mentions
        : DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES.mentions,
    systemActivityInApp:
      typeof settings.systemActivityInApp === 'boolean'
        ? settings.systemActivityInApp
        : DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES.systemActivityInApp,
  };
}

function parseStoredNotificationSettings(
  value: unknown
): LeagueMemberNotificationSettings | undefined {
  if (!value) return undefined;

  try {
    return parseNotificationSettings(value);
  } catch {
    return undefined;
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }

    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Prisma owns leagues and membership. A league with no Prisma row is legacy data and is not
    // found; Firestore never decides who may change a team.
    const league = await prisma.league.findUnique({ where: { id }, select: { id: true } });
    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const membership = await getLeagueMembership(id, userId);
    if (!membership.isMember || membership.source !== 'prisma' || !membership.memberDocId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const memberId = membership.memberDocId;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const prismaData: {
      teamName?: string;
      teamLogoUrl?: string | null;
      teamLogoPositionX?: number;
      teamLogoPositionY?: number;
      teamLogoZoom?: number;
      notificationSettingsJson?: LeagueMemberNotificationSettings;
    } = {};
    const shouldUpdateTeamLogo = hasTeamLogoPatch(body);

    try {
      if (hasBodyField(body, 'teamName')) {
        prismaData.teamName = parseTeamName(body.teamName);
      }

      if (shouldUpdateTeamLogo) {
        Object.assign(prismaData, parseTeamLogoPatch(body));
      }

      if (hasBodyField(body, 'notificationSettings')) {
        const rawSettings = body.notificationSettings as Record<string, unknown>;
        const notificationSettings = parseNotificationSettings(rawSettings);
        if (!hasBodyField(rawSettings, 'social')) {
          const existingSettings = parseStoredNotificationSettings(
            (
              await prisma.leagueMember.findUnique({
                where: { id: memberId },
                select: { notificationSettingsJson: true },
              })
            )?.notificationSettingsJson
          );
          if (existingSettings?.social) {
            notificationSettings.social = existingSettings.social;
          }
        }
        prismaData.notificationSettingsJson = notificationSettings;
      }
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ error: 'Invalid team settings' }, { status: 400 });
    }

    if (Object.keys(prismaData).length === 0) {
      return NextResponse.json({ error: 'No team settings provided' }, { status: 400 });
    }

    const updatedMember = await prisma.leagueMember.update({
      where: { id: memberId },
      data: prismaData,
      select: {
        id: true,
        leagueId: true,
        userId: true,
        role: true,
        teamName: true,
        teamLogoUrl: true,
        teamLogoPositionX: true,
        teamLogoPositionY: true,
        teamLogoZoom: true,
        notificationSettingsJson: true,
        joinedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        member: {
          id: updatedMember.id,
          leagueId: updatedMember.leagueId,
          userId: updatedMember.userId,
          role: String(updatedMember.role).toLowerCase(),
          teamName: updatedMember.teamName,
          teamLogoUrl: updatedMember.teamLogoUrl ?? undefined,
          teamLogoPositionX: updatedMember.teamLogoPositionX ?? undefined,
          teamLogoPositionY: updatedMember.teamLogoPositionY ?? undefined,
          teamLogoZoom: updatedMember.teamLogoZoom ?? undefined,
          notificationSettings: parseStoredNotificationSettings(
            updatedMember.notificationSettingsJson
          ),
          joinedAt: updatedMember.joinedAt.toISOString(),
          isActive: true,
        },
      },
    });
  } catch (error) {
    logger.error('Error updating league member settings:', error);
    return NextResponse.json({ error: 'Failed to update team settings' }, { status: 500 });
  }
}
