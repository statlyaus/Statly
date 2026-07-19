export type SocialMessageType = 'member' | 'system';
export type SocialChannel = 'chat' | 'board';
export type SocialModerationStatus = 'active' | 'removed';
export type SocialReportReason =
  | 'harassment'
  | 'hate'
  | 'spam'
  | 'threats'
  | 'unsafe-link'
  | 'other';

export interface SocialAuthor {
  userId: string;
  memberId?: string;
  teamId?: string;
  displayName: string;
  teamName: string;
  avatarUrl?: string;
}

export interface SocialMessage {
  id: string;
  leagueId: string;
  seasonId: string;
  type: SocialMessageType;
  content: string;
  author: SocialAuthor | null;
  relatedEntityId?: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  moderationStatus: SocialModerationStatus;
  isOwn: boolean;
}

export interface SocialBoardCategory {
  id: string;
  key: string;
  name: string;
  position: number;
}

export interface SocialPost {
  id: string;
  leagueId: string;
  seasonId: string;
  category: SocialBoardCategory;
  author: SocialAuthor | null;
  title: string;
  body: string;
  isPinned: boolean;
  isLocked: boolean;
  isAnnouncement: boolean;
  replyCount: number;
  latestActivityAt: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  deletedAt?: string;
  moderationStatus: SocialModerationStatus;
  isOwn: boolean;
}

export interface SocialReply {
  id: string;
  postId: string;
  leagueId: string;
  seasonId: string;
  author: SocialAuthor | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  deletedAt?: string;
  moderationStatus: SocialModerationStatus;
  isOwn: boolean;
}

export interface SocialCursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface LeagueSocialSummary {
  leagueId: string;
  seasonId: string;
  canManage: boolean;
  canPublish: boolean;
  standardsAccepted: boolean;
  mutedUntil: string | null;
  unread: {
    chat: number;
    board: number;
  };
  latestSequence: {
    chat: number;
    board: number;
  };
  preferences: SocialNotificationPreferences;
  categories: SocialBoardCategory[];
}

export interface SocialPostThread {
  post: SocialPost;
  replies: SocialCursorPage<SocialReply>;
}

export interface SocialNotificationPreferences {
  chatInApp: boolean;
  boardPosts: boolean;
  ownPostReplies: boolean;
  announcements: boolean;
  tradeDiscussions: boolean;
  mentions: boolean;
  systemActivityInApp: boolean;
}

export const DEFAULT_SOCIAL_NOTIFICATION_PREFERENCES: SocialNotificationPreferences = {
  chatInApp: true,
  boardPosts: false,
  ownPostReplies: true,
  announcements: true,
  tradeDiscussions: false,
  mentions: true,
  systemActivityInApp: true,
};

export interface CreateSocialMessageInput {
  content: string;
  idempotencyKey: string;
}

export interface CreateSocialPostInput {
  categoryId: string;
  title: string;
  body: string;
  isAnnouncement?: boolean;
  idempotencyKey: string;
}

export interface CreateSocialReplyInput {
  body: string;
  idempotencyKey: string;
}

export interface SocialRealtimeEnvelope {
  id: string;
  sequence: number;
  leagueId: string;
  seasonId: string;
  channel: SocialChannel;
  event:
    | 'social:message'
    | 'social:post'
    | 'social:reply'
    | 'social:moderation'
    | 'social:read-state';
  payload: SocialMessage | SocialPost | SocialReply | Record<string, unknown>;
  occurredAt: string;
}
