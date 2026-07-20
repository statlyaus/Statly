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

  it('accepts strict GIPHY attachments and allows GIF-only chat messages', () => {
    expect(
      createMessageSchema.parse({
        content: '   ',
        gif: { provider: 'giphy', id: 'xT9IgG50Fb7Mi0prBC' },
        idempotencyKey: 'message:giphy-1',
      })
    ).toEqual({
      content: '',
      gif: { provider: 'giphy', id: 'xT9IgG50Fb7Mi0prBC' },
      idempotencyKey: 'message:giphy-1',
    });

    expect(
      createMessageSchema.safeParse({
        content: '',
        gif: { provider: 'tenor', id: 'gif-1' },
        idempotencyKey: 'message:giphy-2',
      }).success
    ).toBe(false);
    expect(
      createMessageSchema.safeParse({
        content: '',
        gif: { provider: 'giphy', id: 'gif1', url: 'https://media.giphy.com/example.gif' },
        idempotencyKey: 'message:giphy-3',
      }).success
    ).toBe(false);
  });

  it('accepts narrow structured discussion context and rejects unbounded metadata or markup fields', () => {
    expect(
      createMessageSchema.safeParse({
        content: 'What do we think?',
        context: {
          type: 'player',
          id: 'player-1',
          title: 'Jordan Example',
          subtitle: 'MID · Melbourne',
          metadata: {
            status: 'Available',
            round: '12',
          },
        },
        idempotencyKey: 'message:context-1',
      }).success
    ).toBe(true);

    expect(
      createMessageSchema.safeParse({
        content: 'Unsafe extra field',
        context: {
          type: 'trade',
          id: 'trade-1',
          title: 'Trade proposal',
          html: '<strong>unsafe</strong>',
        },
        idempotencyKey: 'message:context-2',
      }).success
    ).toBe(false);

    expect(
      createMessageSchema.safeParse({
        content: 'Too much metadata',
        context: {
          type: 'activity',
          id: 'activity-1',
          title: 'Draft result',
          metadata: Object.fromEntries(
            Array.from({ length: 7 }, (_, index) => [`field_${index}`, String(index)])
          ),
        },
        idempotencyKey: 'message:context-3',
      }).success
    ).toBe(false);
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
    expect(markReadSchema.parse({ channel: 'activity' })).toEqual({ channel: 'activity' });
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
