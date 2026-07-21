import 'server-only';

import { prisma } from '@/lib/prisma';
import type {
  LeagueSocialSummary,
  SocialCursorPage,
  SocialMessage,
  SocialPost,
  SocialPostThread,
  SocialReply,
} from '@/types/social';
import { DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES } from '@/types/social';

import { requireLeagueSocialAccess } from './socialAccess';
import {
  socialMessageInclude,
  socialPostInclude,
  socialReplyInclude,
  toSocialCategory,
  toSocialMessage,
  toSocialPost,
  toSocialReply,
} from './socialDto';
import { SocialError } from './socialErrors';
import { decodeSocialCursor, encodeSocialCursor, type SocialPageCursor } from './socialValidation';

interface ListSocialOptions {
  cursor?: string | null;
  limit: number;
}

interface SocialPostCursor extends SocialPageCursor {
  pinned: boolean;
}

export async function getLeagueSocialSummary(
  leagueId: string,
  userId: string
): Promise<LeagueSocialSummary> {
  const access = await requireLeagueSocialAccess(leagueId, userId);
  const [categories, readStates, latestChat, latestBoard, latestActivity, member] =
    await Promise.all([
      prisma.socialBoardCategory.findMany({
        where: {
          leagueId,
          seasonId: access.seasonId,
          archivedAt: null,
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      prisma.socialReadState.findMany({
        where: {
          leagueId,
          seasonId: access.seasonId,
          userId,
        },
        select: { channel: true, lastReadSequence: true },
      }),
      prisma.socialOutboxEvent.aggregate({
        where: {
          leagueId,
          seasonId: access.seasonId,
          channel: 'CHAT',
          eventType: { not: 'social:read-state' },
        },
        _max: { sequence: true },
      }),
      prisma.socialOutboxEvent.aggregate({
        where: {
          leagueId,
          seasonId: access.seasonId,
          channel: 'BOARD',
          eventType: { not: 'social:read-state' },
        },
        _max: { sequence: true },
      }),
      prisma.socialOutboxEvent.aggregate({
        where: {
          leagueId,
          seasonId: access.seasonId,
          channel: 'ACTIVITY',
          eventType: { not: 'social:read-state' },
        },
        _max: { sequence: true },
      }),
      prisma.leagueMember.findFirst({
        where: { id: access.memberId, leagueId, isActive: true },
        select: { notificationSettingsJson: true },
      }),
    ]);

  const readSequence = new Map(readStates.map((state) => [state.channel, state.lastReadSequence]));
  const [unreadChat, unreadBoard, unreadActivity] = await Promise.all([
    countUnreadEvents({
      leagueId,
      seasonId: access.seasonId,
      userId,
      channel: 'CHAT',
      lastReadSequence: readSequence.get('CHAT') ?? 0,
    }),
    countUnreadEvents({
      leagueId,
      seasonId: access.seasonId,
      userId,
      channel: 'BOARD',
      lastReadSequence: readSequence.get('BOARD') ?? 0,
    }),
    countUnreadEvents({
      leagueId,
      seasonId: access.seasonId,
      userId,
      channel: 'ACTIVITY',
      lastReadSequence: readSequence.get('ACTIVITY') ?? 0,
    }),
  ]);

  return {
    leagueId,
    seasonId: access.seasonId,
    canManage: access.canManage,
    canPublish: access.canPublish,
    standardsAccepted: access.standardsAccepted,
    mutedUntil: access.mutedUntil?.toISOString() ?? null,
    unread: {
      chat: unreadChat,
      board: unreadBoard,
      activity: unreadActivity,
    },
    latestSequence: {
      chat: latestChat._max.sequence ?? 0,
      board: latestBoard._max.sequence ?? 0,
      activity: latestActivity._max.sequence ?? 0,
    },
    preferences: parseSocialPreferences(member?.notificationSettingsJson),
    categories: categories.map(toSocialCategory),
  };
}

function parseSocialPreferences(value: string | null | undefined) {
  if (!value) return DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES;
  try {
    const stored = JSON.parse(value) as Record<string, unknown>;
    const social =
      stored.social && typeof stored.social === 'object' && !Array.isArray(stored.social)
        ? (stored.social as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      Object.entries(DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES).map(([key, fallback]) => [
        key,
        typeof social[key] === 'boolean' ? social[key] : fallback,
      ])
    ) as typeof DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES;
  } catch {
    return DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES;
  }
}

async function countUnreadEvents({
  leagueId,
  seasonId,
  userId,
  channel,
  lastReadSequence,
}: {
  leagueId: string;
  seasonId: string;
  userId: string;
  channel: 'CHAT' | 'BOARD' | 'ACTIVITY';
  lastReadSequence: number;
}): Promise<number> {
  return prisma.socialOutboxEvent.count({
    where: {
      leagueId,
      seasonId,
      channel,
      sequence: { gt: lastReadSequence },
      eventType: { not: 'social:read-state' },
      OR: [{ actorUserId: null }, { actorUserId: { not: userId } }],
    },
  });
}

export async function listSocialMessages(
  leagueId: string,
  userId: string,
  options: ListSocialOptions
): Promise<SocialCursorPage<SocialMessage>> {
  const access = await requireLeagueSocialAccess(leagueId, userId);
  const cursor = decodeSocialCursor(options.cursor ?? null);
  if (options.cursor && !cursor) {
    throw new SocialError('VALIDATION', 'Invalid message cursor');
  }

  const records = await prisma.socialMessage.findMany({
    where: {
      leagueId,
      seasonId: access.seasonId,
      type: 'MEMBER',
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: socialMessageInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
  });

  const hasMore = records.length > options.limit;
  if (hasMore) records.pop();
  const oldest = records.at(-1);

  return {
    items: records.reverse().map((record) => toSocialMessage(record, userId)),
    nextCursor:
      hasMore && oldest
        ? encodeSocialCursor({
            createdAt: oldest.createdAt.toISOString(),
            id: oldest.id,
          })
        : null,
  };
}

export async function listSocialActivity(
  leagueId: string,
  userId: string,
  options: ListSocialOptions
): Promise<SocialCursorPage<SocialMessage>> {
  const access = await requireLeagueSocialAccess(leagueId, userId);
  const cursor = decodeSocialCursor(options.cursor ?? null);
  if (options.cursor && !cursor) {
    throw new SocialError('VALIDATION', 'Invalid activity cursor');
  }

  const records = await prisma.socialMessage.findMany({
    where: {
      leagueId,
      seasonId: access.seasonId,
      type: 'SYSTEM',
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: socialMessageInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
  });

  const hasMore = records.length > options.limit;
  if (hasMore) records.pop();
  const oldest = records.at(-1);

  return {
    items: records.map((record) => toSocialMessage(record, '')),
    nextCursor:
      hasMore && oldest
        ? encodeSocialCursor({
            createdAt: oldest.createdAt.toISOString(),
            id: oldest.id,
          })
        : null,
  };
}

export async function listSocialPosts(
  leagueId: string,
  userId: string,
  options: ListSocialOptions & {
    categoryId?: string | null;
    sort?: 'latestActivity' | 'createdAt';
  }
): Promise<SocialCursorPage<SocialPost>> {
  const access = await requireLeagueSocialAccess(leagueId, userId);
  const sort = options.sort ?? 'latestActivity';
  const cursor = decodePostCursor(options.cursor ?? null);
  if (options.cursor && !cursor) {
    throw new SocialError('VALIDATION', 'Invalid post cursor');
  }

  const records = await prisma.socialPost.findMany({
    where: {
      leagueId,
      seasonId: access.seasonId,
      ...(options.categoryId ? { categoryId: options.categoryId } : {}),
      ...(cursor ? postCursorWhere(cursor, sort) : {}),
    },
    include: socialPostInclude,
    orderBy:
      sort === 'createdAt'
        ? [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
        : [{ isPinned: 'desc' }, { latestActivityAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
  });

  const hasMore = records.length > options.limit;
  if (hasMore) records.pop();
  const last = records.at(-1);

  return {
    items: records.map((record) => toSocialPost(record, userId)),
    nextCursor:
      hasMore && last
        ? encodePostCursor({
            pinned: last.isPinned,
            createdAt:
              sort === 'createdAt'
                ? last.createdAt.toISOString()
                : last.latestActivityAt.toISOString(),
            id: last.id,
          })
        : null,
  };
}

export async function getSocialPostThread(
  leagueId: string,
  userId: string,
  postId: string,
  options: ListSocialOptions
): Promise<SocialPostThread> {
  const access = await requireLeagueSocialAccess(leagueId, userId);
  const post = await prisma.socialPost.findFirst({
    where: {
      id: postId,
      leagueId,
      seasonId: access.seasonId,
    },
    include: socialPostInclude,
  });
  if (!post) throw new SocialError('NOT_FOUND', 'Discussion not found');

  const replies = await listSocialReplies(leagueId, userId, postId, options, access.seasonId);
  return {
    post: toSocialPost(post, userId),
    replies,
  };
}

export async function listSocialReplies(
  leagueId: string,
  userId: string,
  postId: string,
  options: ListSocialOptions,
  knownSeasonId?: string
): Promise<SocialCursorPage<SocialReply>> {
  const seasonId = knownSeasonId ?? (await requireLeagueSocialAccess(leagueId, userId)).seasonId;
  const cursor = decodeSocialCursor(options.cursor ?? null);
  if (options.cursor && !cursor) {
    throw new SocialError('VALIDATION', 'Invalid reply cursor');
  }

  const records = await prisma.socialReply.findMany({
    where: {
      postId,
      leagueId,
      seasonId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: socialReplyInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
  });

  const hasMore = records.length > options.limit;
  if (hasMore) records.pop();
  const oldest = records.at(-1);

  return {
    items: records.reverse().map((record) => toSocialReply(record, userId)),
    nextCursor:
      hasMore && oldest
        ? encodeSocialCursor({
            createdAt: oldest.createdAt.toISOString(),
            id: oldest.id,
          })
        : null,
  };
}

function postCursorWhere(cursor: SocialPostCursor, sort: 'latestActivity' | 'createdAt') {
  const orderCursor =
    sort === 'createdAt'
      ? [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ]
      : [
          { latestActivityAt: { lt: new Date(cursor.createdAt) } },
          { latestActivityAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ];
  return {
    OR: cursor.pinned
      ? [
          {
            isPinned: true,
            OR: orderCursor,
          },
          { isPinned: false },
        ]
      : [
          {
            isPinned: false,
            OR: orderCursor,
          },
        ],
  };
}

function encodePostCursor(cursor: SocialPostCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodePostCursor(value: string | null): SocialPostCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      typeof parsed.pinned !== 'boolean' ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed.id !== 'string' ||
      !parsed.id
    ) {
      return null;
    }
    return {
      pinned: parsed.pinned,
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}
