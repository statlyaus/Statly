import 'server-only';

import { createHash } from 'node:crypto';

import { Prisma, type SocialChannel } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type {
  SocialMessage,
  SocialPost,
  SocialRealtimeEnvelope,
  SocialReply,
} from '@/types/social';

import {
  requireLeagueSocialAccess,
  requireSocialManager,
  requireSocialPublishingAccess,
  type LeagueSocialAccess,
} from './socialAccess';
import {
  socialMessageInclude,
  socialPostInclude,
  socialReplyInclude,
  toSocialMessage,
  toSocialPost,
  toSocialReply,
} from './socialDto';
import { SocialError } from './socialErrors';
import {
  createMessageSchema,
  createPostSchema,
  createReplySchema,
  editMessageSchema,
  editPostSchema,
  editReplySchema,
  markReadSchema,
  moderationActionSchema,
  reportContentSchema,
  socialPreferencesSchema,
} from './socialValidation';

type Transaction = Prisma.TransactionClient;
type SocialContentType = 'message' | 'post' | 'reply';

export async function createSocialMessage(
  leagueId: string,
  userId: string,
  input: unknown
): Promise<SocialMessage> {
  const parsed = createMessageSchema.safeParse(input);
  if (!parsed.success) {
    throw new SocialError('VALIDATION', 'Message is invalid', parsed.error.flatten());
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);
  requireSocialPublishingAccess(access);

  return executeIdempotentCommand(
    access,
    parsed.data.idempotencyKey,
    'CREATE_MESSAGE',
    parsed.data,
    async (tx) => {
      const record = await tx.socialMessage.create({
        data: {
          leagueId,
          seasonId: access.seasonId,
          authorUserId: userId,
          authorMemberId: access.memberId,
          content: parsed.data.content,
          contextJson: parsed.data.context ? JSON.stringify(parsed.data.context) : null,
        },
        include: socialMessageInclude,
      });
      const message = toSocialMessage(record, userId);
      await enqueueSocialEvent(tx, access, 'CHAT', 'social:message', 'message', record.id, message);
      return { resultType: 'message', resultId: record.id, value: message };
    }
  );
}

export async function editSocialMessage(
  leagueId: string,
  userId: string,
  messageId: string,
  input: unknown
): Promise<SocialMessage> {
  const parsed = editMessageSchema.safeParse(input);
  if (!parsed.success) {
    throw new SocialError('VALIDATION', 'Message is invalid', parsed.error.flatten());
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);
  requireSocialPublishingAccess(access);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.socialMessage.findFirst({
      where: { id: messageId, leagueId, seasonId: access.seasonId },
      select: { authorUserId: true, deletedAt: true },
    });
    if (!existing) throw new SocialError('NOT_FOUND', 'Message not found');
    if (existing.authorUserId !== userId) {
      throw new SocialError('FORBIDDEN', 'You can only edit your own messages');
    }
    if (existing.deletedAt) throw new SocialError('CONFLICT', 'Removed messages cannot be edited');

    const record = await tx.socialMessage.update({
      where: { id: messageId },
      data: {
        content: parsed.data.content,
        editedAt: new Date(),
      },
      include: socialMessageInclude,
    });
    const message = toSocialMessage(record, userId);
    await enqueueSocialEvent(
      tx,
      access,
      'CHAT',
      'social:moderation',
      'message',
      record.id,
      message
    );
    return message;
  });
}

export async function deleteSocialMessage(
  leagueId: string,
  userId: string,
  messageId: string,
  moderationReason?: string
): Promise<SocialMessage> {
  const access = await requireLeagueSocialAccess(leagueId, userId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.socialMessage.findFirst({
      where: { id: messageId, leagueId, seasonId: access.seasonId },
      include: socialMessageInclude,
    });
    if (!existing) throw new SocialError('NOT_FOUND', 'Message not found');
    if (existing.authorUserId !== userId && !access.canManage) {
      throw new SocialError('FORBIDDEN', 'You cannot remove this message');
    }
    if (existing.deletedAt) return toSocialMessage(existing, userId);

    const removedAt = new Date();
    const record = await tx.socialMessage.update({
      where: { id: messageId },
      data: {
        deletedAt: removedAt,
        moderationStatus: 'REMOVED',
      },
      include: socialMessageInclude,
    });
    await retainModerationRecord(tx, access, {
      contentType: 'message',
      contentId: messageId,
      action: existing.authorUserId === userId ? 'SELF_DELETE' : 'REMOVE',
      reason: moderationReason,
      targetUserId: existing.authorUserId,
      targetMemberId: existing.authorMemberId,
      retainedContent: { content: existing.content },
    });
    const message = toSocialMessage(record, userId);
    await enqueueSocialEvent(
      tx,
      access,
      'CHAT',
      'social:moderation',
      'message',
      record.id,
      message
    );
    return message;
  });
}

export async function createSocialPost(
  leagueId: string,
  userId: string,
  input: unknown
): Promise<SocialPost> {
  const parsed = createPostSchema.safeParse(input);
  if (!parsed.success) {
    throw new SocialError('VALIDATION', 'Post is invalid', parsed.error.flatten());
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);
  requireSocialPublishingAccess(access);
  if (parsed.data.isAnnouncement) requireSocialManager(access);

  return executeIdempotentCommand(
    access,
    parsed.data.idempotencyKey,
    'CREATE_POST',
    parsed.data,
    async (tx) => {
      const category = await tx.socialBoardCategory.findFirst({
        where: {
          id: parsed.data.categoryId,
          leagueId,
          seasonId: access.seasonId,
          archivedAt: null,
        },
        select: { id: true, slug: true },
      });
      if (!category) throw new SocialError('VALIDATION', 'Board category is invalid');
      if (parsed.data.isAnnouncement && category.slug !== 'announcements') {
        throw new SocialError('VALIDATION', 'Announcements must use the Announcements category');
      }

      const now = new Date();
      const record = await tx.socialPost.create({
        data: {
          leagueId,
          seasonId: access.seasonId,
          categoryId: category.id,
          authorUserId: userId,
          authorMemberId: access.memberId,
          title: parsed.data.title,
          body: parsed.data.body,
          isAnnouncement: parsed.data.isAnnouncement,
          isPinned: parsed.data.isAnnouncement,
          pinnedAt: parsed.data.isAnnouncement ? now : null,
          latestActivityAt: now,
        },
        include: socialPostInclude,
      });
      const post = toSocialPost(record, userId);
      await enqueueSocialEvent(tx, access, 'BOARD', 'social:post', 'post', record.id, post);
      return { resultType: 'post', resultId: record.id, value: post };
    }
  );
}

export async function editSocialPost(
  leagueId: string,
  userId: string,
  postId: string,
  input: unknown
): Promise<SocialPost> {
  const parsed = editPostSchema.safeParse(input);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    throw new SocialError(
      'VALIDATION',
      'Post update is invalid',
      parsed.success ? undefined : parsed.error.flatten()
    );
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);
  requireSocialPublishingAccess(access);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.socialPost.findFirst({
      where: { id: postId, leagueId, seasonId: access.seasonId },
      select: {
        authorUserId: true,
        deletedAt: true,
        isPinned: true,
        isLocked: true,
      },
    });
    if (!existing) throw new SocialError('NOT_FOUND', 'Discussion not found');
    const changesContent = parsed.data.title !== undefined || parsed.data.body !== undefined;
    const changesModeration =
      parsed.data.isPinned !== undefined || parsed.data.isLocked !== undefined;
    if (changesContent && existing.authorUserId !== userId && !access.canManage) {
      throw new SocialError('FORBIDDEN', 'You cannot edit this discussion');
    }
    if (changesModeration) requireSocialManager(access);
    if (existing.deletedAt && changesContent) {
      throw new SocialError('CONFLICT', 'Removed discussions cannot be edited');
    }

    const now = new Date();
    const record = await tx.socialPost.update({
      where: { id: postId },
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
        ...(changesContent ? { editedAt: now } : {}),
        ...(parsed.data.isPinned !== undefined
          ? {
              isPinned: parsed.data.isPinned,
              pinnedAt: parsed.data.isPinned ? now : null,
            }
          : {}),
        ...(parsed.data.isLocked !== undefined
          ? {
              isLocked: parsed.data.isLocked,
              lockedAt: parsed.data.isLocked ? now : null,
            }
          : {}),
      },
      include: socialPostInclude,
    });
    const post = toSocialPost(record, userId);
    await enqueueSocialEvent(
      tx,
      access,
      'BOARD',
      changesModeration ? 'social:moderation' : 'social:post',
      'post',
      record.id,
      post
    );
    return post;
  });
}

export async function deleteSocialPost(
  leagueId: string,
  userId: string,
  postId: string,
  moderationReason?: string
): Promise<SocialPost> {
  const access = await requireLeagueSocialAccess(leagueId, userId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.socialPost.findFirst({
      where: { id: postId, leagueId, seasonId: access.seasonId },
      include: socialPostInclude,
    });
    if (!existing) throw new SocialError('NOT_FOUND', 'Discussion not found');
    if (existing.authorUserId !== userId && !access.canManage) {
      throw new SocialError('FORBIDDEN', 'You cannot remove this discussion');
    }
    if (existing.deletedAt) return toSocialPost(existing, userId);

    const record = await tx.socialPost.update({
      where: { id: postId },
      data: {
        deletedAt: new Date(),
        moderationStatus: 'REMOVED',
        isPinned: false,
        pinnedAt: null,
        isLocked: true,
        lockedAt: new Date(),
      },
      include: socialPostInclude,
    });
    await retainModerationRecord(tx, access, {
      contentType: 'post',
      contentId: postId,
      action: existing.authorUserId === userId ? 'SELF_DELETE' : 'REMOVE',
      reason: moderationReason,
      targetUserId: existing.authorUserId,
      targetMemberId: existing.authorMemberId,
      retainedContent: { title: existing.title, body: existing.body },
    });
    const post = toSocialPost(record, userId);
    await enqueueSocialEvent(tx, access, 'BOARD', 'social:moderation', 'post', record.id, post);
    return post;
  });
}

export async function createSocialReply(
  leagueId: string,
  userId: string,
  postId: string,
  input: unknown
): Promise<SocialReply> {
  const parsed = createReplySchema.safeParse(input);
  if (!parsed.success) {
    throw new SocialError('VALIDATION', 'Reply is invalid', parsed.error.flatten());
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);
  requireSocialPublishingAccess(access);

  return executeIdempotentCommand(
    access,
    parsed.data.idempotencyKey,
    'CREATE_REPLY',
    { postId, ...parsed.data },
    async (tx) => {
      const post = await tx.socialPost.findFirst({
        where: { id: postId, leagueId, seasonId: access.seasonId },
        select: { id: true, isLocked: true, deletedAt: true },
      });
      if (!post) throw new SocialError('NOT_FOUND', 'Discussion not found');
      if (post.isLocked || post.deletedAt) {
        throw new SocialError('CONFLICT', 'This discussion is locked');
      }

      const now = new Date();
      const record = await tx.socialReply.create({
        data: {
          leagueId,
          seasonId: access.seasonId,
          postId,
          authorUserId: userId,
          authorMemberId: access.memberId,
          body: parsed.data.body,
        },
        include: socialReplyInclude,
      });
      await tx.socialPost.update({
        where: { id: postId },
        data: {
          replyCount: { increment: 1 },
          latestActivityAt: now,
        },
      });
      const reply = toSocialReply(record, userId);
      await enqueueSocialEvent(tx, access, 'BOARD', 'social:reply', 'reply', record.id, reply);
      return { resultType: 'reply', resultId: record.id, value: reply };
    }
  );
}

export async function editSocialReply(
  leagueId: string,
  userId: string,
  replyId: string,
  input: unknown
): Promise<SocialReply> {
  const parsed = editReplySchema.safeParse(input);
  if (!parsed.success) {
    throw new SocialError('VALIDATION', 'Reply is invalid', parsed.error.flatten());
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);
  requireSocialPublishingAccess(access);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.socialReply.findFirst({
      where: { id: replyId, leagueId, seasonId: access.seasonId },
      select: { authorUserId: true, deletedAt: true },
    });
    if (!existing) throw new SocialError('NOT_FOUND', 'Reply not found');
    if (existing.authorUserId !== userId) {
      throw new SocialError('FORBIDDEN', 'You can only edit your own replies');
    }
    if (existing.deletedAt) throw new SocialError('CONFLICT', 'Removed replies cannot be edited');

    const record = await tx.socialReply.update({
      where: { id: replyId },
      data: { body: parsed.data.body, editedAt: new Date() },
      include: socialReplyInclude,
    });
    const reply = toSocialReply(record, userId);
    await enqueueSocialEvent(tx, access, 'BOARD', 'social:moderation', 'reply', record.id, reply);
    return reply;
  });
}

export async function deleteSocialReply(
  leagueId: string,
  userId: string,
  replyId: string,
  moderationReason?: string
): Promise<SocialReply> {
  const access = await requireLeagueSocialAccess(leagueId, userId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.socialReply.findFirst({
      where: { id: replyId, leagueId, seasonId: access.seasonId },
      include: socialReplyInclude,
    });
    if (!existing) throw new SocialError('NOT_FOUND', 'Reply not found');
    if (existing.authorUserId !== userId && !access.canManage) {
      throw new SocialError('FORBIDDEN', 'You cannot remove this reply');
    }
    if (existing.deletedAt) return toSocialReply(existing, userId);

    const record = await tx.socialReply.update({
      where: { id: replyId },
      data: { deletedAt: new Date(), moderationStatus: 'REMOVED' },
      include: socialReplyInclude,
    });
    await retainModerationRecord(tx, access, {
      contentType: 'reply',
      contentId: replyId,
      action: existing.authorUserId === userId ? 'SELF_DELETE' : 'REMOVE',
      reason: moderationReason,
      targetUserId: existing.authorUserId,
      targetMemberId: existing.authorMemberId,
      retainedContent: { body: existing.body },
    });
    const reply = toSocialReply(record, userId);
    await enqueueSocialEvent(tx, access, 'BOARD', 'social:moderation', 'reply', record.id, reply);
    return reply;
  });
}

export async function markSocialChannelRead(
  leagueId: string,
  userId: string,
  input: unknown
): Promise<{ channel: 'chat' | 'board' | 'activity'; sequence: number }> {
  const parsed = markReadSchema.safeParse(input);
  if (!parsed.success) {
    throw new SocialError('VALIDATION', 'Read state is invalid', parsed.error.flatten());
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);
  const channel: SocialChannel =
    parsed.data.channel === 'chat'
      ? 'CHAT'
      : parsed.data.channel === 'board'
        ? 'BOARD'
        : 'ACTIVITY';

  return prisma.$transaction(async (tx) => {
    const requestedSequence =
      parsed.data.sequence ??
      (
        await tx.socialOutboxEvent.findFirst({
          where: {
            leagueId,
            seasonId: access.seasonId,
            channel,
            eventType: { not: 'social:read-state' },
          },
          orderBy: { sequence: 'desc' },
          select: { sequence: true },
        })
      )?.sequence ??
      0;

    if (requestedSequence > 0) {
      const event = await tx.socialOutboxEvent.findFirst({
        where: {
          sequence: requestedSequence,
          leagueId,
          seasonId: access.seasonId,
          channel,
          eventType: { not: 'social:read-state' },
        },
        select: { sequence: true },
      });
      if (!event) throw new SocialError('VALIDATION', 'Read sequence is invalid');
    }

    const existing = await tx.socialReadState.findUnique({
      where: {
        seasonId_userId_channel: {
          seasonId: access.seasonId,
          userId,
          channel,
        },
      },
      select: { id: true, lastReadSequence: true },
    });
    const sequence = Math.max(existing?.lastReadSequence ?? 0, requestedSequence);
    await tx.socialReadState.upsert({
      where: {
        seasonId_userId_channel: {
          seasonId: access.seasonId,
          userId,
          channel,
        },
      },
      update: {
        lastReadSequence: sequence,
        lastReadAt: new Date(),
        memberId: access.memberId,
      },
      create: {
        leagueId,
        seasonId: access.seasonId,
        userId,
        memberId: access.memberId,
        channel,
        lastReadSequence: sequence,
        lastReadAt: new Date(),
      },
    });
    await enqueueSocialEvent(
      tx,
      access,
      channel,
      'social:read-state',
      'read-state',
      `${access.memberId}:${parsed.data.channel}`,
      {
        userId,
        channel: parsed.data.channel,
        sequence,
      }
    );
    return { channel: parsed.data.channel, sequence };
  });
}

export async function reportSocialContent(
  leagueId: string,
  userId: string,
  input: unknown
): Promise<{ id: string; status: string }> {
  const parsed = reportContentSchema.safeParse(input);
  if (!parsed.success) {
    throw new SocialError('VALIDATION', 'Report is invalid', parsed.error.flatten());
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);

  return prisma.$transaction(async (tx) => {
    const content = await findSocialContentAuthor(
      tx,
      access,
      parsed.data.contentType,
      parsed.data.contentId
    );
    const report = await tx.socialReport.create({
      data: {
        leagueId,
        seasonId: access.seasonId,
        reporterUserId: userId,
        reporterMemberId: access.memberId,
        authorUserId: content.authorUserId,
        authorMemberId: content.authorMemberId,
        contentType: parsed.data.contentType,
        contentId: parsed.data.contentId,
        reason: parsed.data.reason,
        details: parsed.data.details,
      },
      select: { id: true, status: true },
    });
    return report;
  });
}

export async function updateSocialPreferences(leagueId: string, userId: string, input: unknown) {
  const parsed = socialPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    throw new SocialError('VALIDATION', 'Social notification preferences are invalid');
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);
  const member = await prisma.leagueMember.findFirst({
    where: { id: access.memberId, leagueId, isActive: true },
    select: { id: true, notificationSettingsJson: true },
  });
  if (!member) throw new SocialError('FORBIDDEN', 'Active league membership is required');

  let existing: Record<string, unknown> = {};
  if (member.notificationSettingsJson) {
    try {
      const parsedExisting = JSON.parse(member.notificationSettingsJson) as unknown;
      if (parsedExisting && typeof parsedExisting === 'object' && !Array.isArray(parsedExisting)) {
        existing = parsedExisting as Record<string, unknown>;
      }
    } catch {
      existing = {};
    }
  }
  await prisma.leagueMember.update({
    where: { id: member.id },
    data: {
      notificationSettingsJson: JSON.stringify({
        ...existing,
        social: parsed.data,
      }),
    },
  });
  return parsed.data;
}

export async function acceptSocialStandards(
  leagueId: string,
  userId: string
): Promise<{ acceptedAt: string }> {
  const access = await requireLeagueSocialAccess(leagueId, userId);
  const acceptedAt = new Date();
  const updated = await prisma.leagueMember.updateMany({
    where: {
      id: access.memberId,
      leagueId,
      userId,
      isActive: true,
    },
    data: { socialStandardsAcceptedAt: acceptedAt },
  });
  if (updated.count !== 1) {
    throw new SocialError('FORBIDDEN', 'Active league membership is required');
  }
  return { acceptedAt: acceptedAt.toISOString() };
}

export async function moderateSocialContent(
  leagueId: string,
  userId: string,
  input: unknown
): Promise<unknown> {
  const parsed = moderationActionSchema.safeParse(input);
  if (!parsed.success) {
    throw new SocialError('VALIDATION', 'Moderation action is invalid', parsed.error.flatten());
  }
  const access = await requireLeagueSocialAccess(leagueId, userId);
  requireSocialManager(access);

  if (parsed.data.action === 'mute' || parsed.data.action === 'unmute') {
    return moderateSocialMute(access, parsed.data);
  }
  const contentAction = parsed.data;

  const content = await findSocialContentAuthor(
    prisma,
    access,
    contentAction.contentType,
    contentAction.contentId
  );
  if (contentAction.action === 'remove') {
    if (contentAction.contentType === 'message') {
      return deleteSocialMessage(leagueId, userId, contentAction.contentId, contentAction.reason);
    }
    if (contentAction.contentType === 'post') {
      return deleteSocialPost(leagueId, userId, contentAction.contentId, contentAction.reason);
    }
    return deleteSocialReply(leagueId, userId, contentAction.contentId, contentAction.reason);
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    if (contentAction.contentType === 'message') {
      await tx.socialMessage.update({
        where: { id: contentAction.contentId },
        data: { deletedAt: null, moderationStatus: 'ACTIVE' },
      });
    } else if (contentAction.contentType === 'post') {
      await tx.socialPost.update({
        where: { id: contentAction.contentId },
        data: { deletedAt: null, moderationStatus: 'ACTIVE' },
      });
    } else {
      await tx.socialReply.update({
        where: { id: contentAction.contentId },
        data: { deletedAt: null, moderationStatus: 'ACTIVE' },
      });
    }
    await retainModerationRecord(tx, access, {
      contentType: contentAction.contentType,
      contentId: contentAction.contentId,
      action: 'RESTORE',
      reason: contentAction.reason,
      targetUserId: content.authorUserId,
      targetMemberId: content.authorMemberId,
    });
    await enqueueSocialEvent(
      tx,
      access,
      contentAction.contentType === 'message' ? 'CHAT' : 'BOARD',
      'social:moderation',
      contentAction.contentType,
      contentAction.contentId,
      {
        contentType: contentAction.contentType,
        contentId: contentAction.contentId,
        action: 'restore',
        occurredAt: now.toISOString(),
      }
    );
    return {
      contentType: contentAction.contentType,
      contentId: contentAction.contentId,
      action: 'restore',
    };
  });
}

async function moderateSocialMute(
  access: LeagueSocialAccess,
  action:
    | { action: 'mute'; userId: string; until: string; reason: string }
    | { action: 'unmute'; userId: string; reason: string }
): Promise<Record<string, unknown>> {
  if (action.userId === access.userId) {
    throw new SocialError('VALIDATION', 'Commissioners cannot mute themselves');
  }
  const target = await prisma.leagueMember.findFirst({
    where: {
      leagueId: access.leagueId,
      userId: action.userId,
      isActive: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  if (!target) throw new SocialError('NOT_FOUND', 'Active league member not found');

  if (action.action === 'mute') {
    const until = new Date(action.until);
    if (until <= new Date())
      throw new SocialError('VALIDATION', 'Mute expiry must be in the future');
    const mute = await prisma.socialMute.create({
      data: {
        leagueId: access.leagueId,
        seasonId: access.seasonId,
        mutedUserId: action.userId,
        mutedMemberId: target.id,
        createdByUserId: access.userId,
        createdByMemberId: access.memberId,
        reason: action.reason,
        expiresAt: until,
      },
      select: { id: true, expiresAt: true },
    });
    return {
      action: 'mute',
      userId: action.userId,
      muteId: mute.id,
      expiresAt: mute.expiresAt?.toISOString() ?? null,
    };
  }

  await prisma.socialMute.updateMany({
    where: {
      leagueId: access.leagueId,
      seasonId: access.seasonId,
      mutedUserId: action.userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedByUserId: access.userId,
    },
  });
  return { action: 'unmute', userId: action.userId };
}

async function executeIdempotentCommand<T>(
  access: LeagueSocialAccess,
  idempotencyKey: string,
  commandType: string,
  request: unknown,
  execute: (tx: Transaction) => Promise<{ resultType: string; resultId: string; value: T }>
): Promise<T> {
  const requestHash = createHash('sha256').update(stableStringify(request)).digest('hex');

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.socialCommand.findUnique({
        where: {
          leagueId_actorUserId_idempotencyKey: {
            leagueId: access.leagueId,
            actorUserId: access.userId,
            idempotencyKey,
          },
        },
      });
      if (existing) return readIdempotentResult<T>(existing, commandType, requestHash);

      const command = await tx.socialCommand.create({
        data: {
          leagueId: access.leagueId,
          seasonId: access.seasonId,
          actorUserId: access.userId,
          actorMemberId: access.memberId,
          idempotencyKey,
          commandType,
          requestHash,
        },
      });
      const result = await execute(tx);
      await tx.socialCommand.update({
        where: { id: command.id },
        data: {
          resultType: result.resultType,
          resultId: result.resultId,
          responseJson: JSON.stringify(result.value),
        },
      });
      return result.value;
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await prisma.socialCommand.findUnique({
      where: {
        leagueId_actorUserId_idempotencyKey: {
          leagueId: access.leagueId,
          actorUserId: access.userId,
          idempotencyKey,
        },
      },
    });
    if (!existing) throw error;
    return readIdempotentResult<T>(existing, commandType, requestHash);
  }
}

function readIdempotentResult<T>(
  command: {
    commandType: string;
    requestHash: string;
    responseJson: string | null;
  },
  commandType: string,
  requestHash: string
): T {
  if (command.commandType !== commandType || command.requestHash !== requestHash) {
    throw new SocialError('CONFLICT', 'Idempotency key was already used for another request');
  }
  if (!command.responseJson) {
    throw new SocialError('CONFLICT', 'The original request is still being processed');
  }
  return JSON.parse(command.responseJson) as T;
}

async function enqueueSocialEvent(
  tx: Transaction,
  access: LeagueSocialAccess,
  channel: SocialChannel,
  event: SocialRealtimeEnvelope['event'],
  aggregateType: string,
  aggregateId: string,
  payload: SocialRealtimeEnvelope['payload']
): Promise<void> {
  await tx.socialOutboxEvent.create({
    data: {
      leagueId: access.leagueId,
      seasonId: access.seasonId,
      channel,
      actorUserId: access.userId,
      eventType: event,
      aggregateType,
      aggregateId,
      payloadJson: JSON.stringify(payload),
    },
  });
}

async function retainModerationRecord(
  tx: Transaction,
  access: LeagueSocialAccess,
  input: {
    contentType: SocialContentType;
    contentId: string;
    action: string;
    reason?: string;
    targetUserId?: string | null;
    targetMemberId?: string | null;
    retainedContent?: unknown;
  }
): Promise<void> {
  await tx.socialModerationRecord.create({
    data: {
      leagueId: access.leagueId,
      seasonId: access.seasonId,
      actorUserId: access.userId,
      actorMemberId: access.memberId,
      targetUserId: input.targetUserId,
      targetMemberId: input.targetMemberId,
      contentType: input.contentType,
      contentId: input.contentId,
      action: input.action,
      reason: input.reason,
      retainedContentJson:
        input.retainedContent === undefined ? undefined : JSON.stringify(input.retainedContent),
    },
  });
}

async function findSocialContentAuthor(
  client: Pick<Transaction, 'socialMessage' | 'socialPost' | 'socialReply'>,
  access: LeagueSocialAccess,
  contentType: SocialContentType,
  contentId: string
): Promise<{ authorUserId: string | null; authorMemberId: string | null }> {
  const where = {
    id: contentId,
    leagueId: access.leagueId,
    seasonId: access.seasonId,
  };
  if (contentType === 'message') {
    const record = await client.socialMessage.findFirst({
      where,
      select: { authorUserId: true, authorMemberId: true },
    });
    if (!record) throw new SocialError('NOT_FOUND', 'Message not found');
    return record;
  }
  if (contentType === 'post') {
    const record = await client.socialPost.findFirst({
      where,
      select: { authorUserId: true, authorMemberId: true },
    });
    if (!record) throw new SocialError('NOT_FOUND', 'Discussion not found');
    return record;
  }
  const record = await client.socialReply.findFirst({
    where,
    select: { authorUserId: true, authorMemberId: true },
  });
  if (!record) throw new SocialError('NOT_FOUND', 'Reply not found');
  return record;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
