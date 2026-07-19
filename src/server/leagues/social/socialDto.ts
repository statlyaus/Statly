import type { Prisma } from '@prisma/client';

import type {
  SocialAuthor,
  SocialBoardCategory,
  SocialMessage,
  SocialPost,
  SocialReply,
} from '@/types/social';

export const socialAuthorMemberSelect = {
  id: true,
  userId: true,
  teamName: true,
  teamLogoUrl: true,
  user: {
    select: {
      displayName: true,
    },
  },
} satisfies Prisma.LeagueMemberSelect;

export const socialMessageInclude = {
  authorMember: { select: socialAuthorMemberSelect },
} satisfies Prisma.SocialMessageInclude;

export const socialPostInclude = {
  category: true,
  authorMember: { select: socialAuthorMemberSelect },
} satisfies Prisma.SocialPostInclude;

export const socialReplyInclude = {
  authorMember: { select: socialAuthorMemberSelect },
} satisfies Prisma.SocialReplyInclude;

type AuthorMember = Prisma.LeagueMemberGetPayload<{
  select: typeof socialAuthorMemberSelect;
}>;

type MessageRecord = Prisma.SocialMessageGetPayload<{
  include: typeof socialMessageInclude;
}>;

type PostRecord = Prisma.SocialPostGetPayload<{
  include: typeof socialPostInclude;
}>;

type ReplyRecord = Prisma.SocialReplyGetPayload<{
  include: typeof socialReplyInclude;
}>;

export function toSocialAuthor(
  member: AuthorMember | null,
  userId?: string | null
): SocialAuthor | null {
  if (!member && !userId) return null;

  return {
    userId: member?.userId ?? userId ?? '',
    ...(member?.id ? { memberId: member.id, teamId: member.id } : {}),
    displayName: member?.user.displayName || 'Former league member',
    teamName: member?.teamName || 'Former team',
    ...(member?.teamLogoUrl ? { avatarUrl: member.teamLogoUrl } : {}),
  };
}

export function toSocialCategory(
  category: Pick<Prisma.SocialBoardCategoryGetPayload<object>, 'id' | 'slug' | 'name' | 'sortOrder'>
): SocialBoardCategory {
  return {
    id: category.id,
    key: category.slug,
    name: category.name,
    position: category.sortOrder,
  };
}

export function toSocialMessage(record: MessageRecord, currentUserId: string): SocialMessage {
  const isRemoved = record.deletedAt !== null || record.moderationStatus === 'REMOVED';
  return {
    id: record.id,
    leagueId: record.leagueId,
    seasonId: record.seasonId,
    type: record.type === 'SYSTEM' ? 'system' : 'member',
    content: isRemoved ? 'Message removed' : record.content,
    author: toSocialAuthor(record.authorMember, record.authorUserId),
    ...(record.relatedEntityId ? { relatedEntityId: record.relatedEntityId } : {}),
    createdAt: record.createdAt.toISOString(),
    ...(record.editedAt ? { editedAt: record.editedAt.toISOString() } : {}),
    ...(record.deletedAt ? { deletedAt: record.deletedAt.toISOString() } : {}),
    moderationStatus: isRemoved ? 'removed' : 'active',
    isOwn: record.authorUserId === currentUserId,
  };
}

export function toSocialPost(record: PostRecord, currentUserId: string): SocialPost {
  const isRemoved = record.deletedAt !== null || record.moderationStatus === 'REMOVED';
  return {
    id: record.id,
    leagueId: record.leagueId,
    seasonId: record.seasonId,
    category: toSocialCategory(record.category),
    author: toSocialAuthor(record.authorMember, record.authorUserId),
    title: isRemoved ? 'Post removed' : record.title,
    body: isRemoved ? 'Post removed' : record.body,
    isPinned: record.isPinned,
    isLocked: record.isLocked,
    isAnnouncement: record.isAnnouncement,
    replyCount: record.replyCount,
    latestActivityAt: record.latestActivityAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.editedAt ? { editedAt: record.editedAt.toISOString() } : {}),
    ...(record.deletedAt ? { deletedAt: record.deletedAt.toISOString() } : {}),
    moderationStatus: isRemoved ? 'removed' : 'active',
    isOwn: record.authorUserId === currentUserId,
  };
}

export function toSocialReply(record: ReplyRecord, currentUserId: string): SocialReply {
  const isRemoved = record.deletedAt !== null || record.moderationStatus === 'REMOVED';
  return {
    id: record.id,
    postId: record.postId,
    leagueId: record.leagueId,
    seasonId: record.seasonId,
    author: toSocialAuthor(record.authorMember, record.authorUserId),
    body: isRemoved ? 'Reply removed' : record.body,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.editedAt ? { editedAt: record.editedAt.toISOString() } : {}),
    ...(record.deletedAt ? { deletedAt: record.deletedAt.toISOString() } : {}),
    moderationStatus: isRemoved ? 'removed' : 'active',
    isOwn: record.authorUserId === currentUserId,
  };
}
