import { z } from 'zod';

import type { SocialReportReason } from '@/types/social';

export const SOCIAL_MESSAGE_MAX_LENGTH = 1_000;
export const SOCIAL_POST_TITLE_MAX_LENGTH = 150;
export const SOCIAL_POST_BODY_MAX_LENGTH = 10_000;
export const SOCIAL_REPLY_MAX_LENGTH = 10_000;
export const SOCIAL_PAGE_MAX_SIZE = 100;
export const SOCIAL_PAGE_DEFAULT_SIZE = 40;

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const nonEmptyText = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine((value) => value.trim().length > 0, 'Content cannot be empty')
    .transform((value) => value.trim());

const socialContextMetadataSchema = z
  .record(
    z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/),
    z.string().trim().min(1).max(200)
  )
  .refine((value) => Object.keys(value).length <= 6, 'Context metadata is limited to 6 fields');

export const socialDiscussionContextSchema = z
  .object({
    type: z.enum(['player', 'trade', 'activity']),
    id: z.string().trim().min(1).max(128),
    title: nonEmptyText(150),
    subtitle: nonEmptyText(300).optional(),
    metadata: socialContextMetadataSchema.optional(),
  })
  .strict();

export const createMessageSchema = z.object({
  content: nonEmptyText(SOCIAL_MESSAGE_MAX_LENGTH),
  context: socialDiscussionContextSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const editMessageSchema = z.object({
  content: nonEmptyText(SOCIAL_MESSAGE_MAX_LENGTH),
});

export const createPostSchema = z.object({
  categoryId: z.string().trim().min(1).max(128),
  title: nonEmptyText(SOCIAL_POST_TITLE_MAX_LENGTH),
  body: nonEmptyText(SOCIAL_POST_BODY_MAX_LENGTH),
  isAnnouncement: z.boolean().optional().default(false),
  idempotencyKey: idempotencyKeySchema,
});

export const editPostSchema = z.object({
  title: nonEmptyText(SOCIAL_POST_TITLE_MAX_LENGTH).optional(),
  body: nonEmptyText(SOCIAL_POST_BODY_MAX_LENGTH).optional(),
  isPinned: z.boolean().optional(),
  isLocked: z.boolean().optional(),
});

export const createReplySchema = z.object({
  body: nonEmptyText(SOCIAL_REPLY_MAX_LENGTH),
  idempotencyKey: idempotencyKeySchema,
});

export const editReplySchema = z.object({
  body: nonEmptyText(SOCIAL_REPLY_MAX_LENGTH),
});

export const markReadSchema = z.object({
  channel: z.enum(['chat', 'board', 'activity']),
  sequence: z.number().int().nonnegative().optional(),
});

export const reportContentSchema = z.object({
  contentType: z.enum(['message', 'post', 'reply']),
  contentId: z.string().trim().min(1).max(128),
  reason: z.enum(['harassment', 'hate', 'spam', 'threats', 'unsafe-link', 'other']),
  details: z.string().trim().max(2_000).optional(),
});

export const socialPreferencesSchema = z.object({
  chatInApp: z.boolean(),
  boardPosts: z.boolean(),
  ownPostReplies: z.boolean(),
  announcements: z.boolean(),
  tradeDiscussions: z.boolean(),
  mentions: z.boolean(),
  systemActivityInApp: z.boolean(),
});

export const moderationActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('remove'),
    contentType: z.enum(['message', 'post', 'reply']),
    contentId: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(2_000),
  }),
  z.object({
    action: z.literal('restore'),
    contentType: z.enum(['message', 'post', 'reply']),
    contentId: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(2_000),
  }),
  z.object({
    action: z.literal('mute'),
    userId: z.string().trim().min(1).max(128),
    until: z.iso.datetime(),
    reason: z.string().trim().min(1).max(2_000),
  }),
  z.object({
    action: z.literal('unmute'),
    userId: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(2_000),
  }),
]);

export interface SocialPageCursor {
  createdAt: string;
  id: string;
}

export function encodeSocialCursor(cursor: SocialPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeSocialCursor(value: string | null): SocialPageCursor | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed.id !== 'string' ||
      !parsed.id
    ) {
      return null;
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

export function parseSocialPageSize(value: string | null): number {
  if (!value) return SOCIAL_PAGE_DEFAULT_SIZE;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return SOCIAL_PAGE_DEFAULT_SIZE;
  return Math.min(parsed, SOCIAL_PAGE_MAX_SIZE);
}

export function isSocialReportReason(value: string): value is SocialReportReason {
  return ['harassment', 'hate', 'spam', 'threats', 'unsafe-link', 'other'].includes(value);
}
