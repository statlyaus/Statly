import { describe, expect, it } from 'vitest';

import {
  createMessageSchema,
  createPostSchema,
  decodeSocialCursor,
  encodeSocialCursor,
  markReadSchema,
  socialPreferencesSchema,
} from '@/server/leagues/social/socialValidation';

describe('league social validation', () => {
  it('rejects empty and over-limit chat messages', () => {
    expect(
      createMessageSchema.safeParse({ content: '   ', idempotencyKey: 'message:12345678' }).success
    ).toBe(false);
    expect(
      createMessageSchema.safeParse({
        content: 'x'.repeat(1_001),
        idempotencyKey: 'message:12345678',
      }).success
    ).toBe(false);
  });

  it('accepts the documented chat and board limits', () => {
    expect(
      createMessageSchema.safeParse({
        content: 'x'.repeat(1_000),
        idempotencyKey: 'message:12345678',
      }).success
    ).toBe(true);
    expect(
      createPostSchema.safeParse({
        categoryId: 'general',
        title: 'x'.repeat(150),
        body: 'x'.repeat(10_000),
        idempotencyKey: 'post:12345678',
      }).success
    ).toBe(true);
  });

  it('round-trips stable pagination cursors and rejects malformed cursors', () => {
    const cursor = {
      createdAt: '2026-07-19T12:00:00.000Z',
      id: 'message-1',
    };
    expect(decodeSocialCursor(encodeSocialCursor(cursor))).toEqual(cursor);
    expect(decodeSocialCursor('not-a-cursor')).toBeNull();
  });

  it('allows read-state updates to derive the latest sequence server-side', () => {
    expect(markReadSchema.parse({ channel: 'chat' })).toEqual({ channel: 'chat' });
    expect(markReadSchema.safeParse({ channel: 'chat', sequence: -1 }).success).toBe(false);
  });

  it('requires a complete social notification preference contract', () => {
    expect(
      socialPreferencesSchema.safeParse({
        chatInApp: true,
        boardPosts: false,
        ownPostReplies: true,
        announcements: true,
        tradeDiscussions: false,
        mentions: true,
        systemActivityInApp: true,
      }).success
    ).toBe(true);
    expect(socialPreferencesSchema.safeParse({ chatInApp: true }).success).toBe(false);
  });
});
