import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    socialCommand: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    socialMessage: {
      create: vi.fn(),
    },
    socialOutboxEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    socialPost: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    socialModerationRecord: {
      create: vi.fn(),
    },
    socialReadState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
  return {
    requireLeagueSocialAccess: vi.fn(),
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    tx,
  };
});

vi.mock('server-only', () => ({}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

vi.mock('./socialAccess', () => ({
  requireLeagueSocialAccess: mocks.requireLeagueSocialAccess,
  requireSocialPublishingAccess: vi.fn(),
  requireSocialManager: vi.fn(),
}));

vi.mock('./socialDto', () => ({
  socialMessageInclude: {},
  socialPostInclude: {},
  socialReplyInclude: {},
  toSocialMessage: vi.fn((record) => ({
    id: record.id,
    leagueId: record.leagueId,
    seasonId: record.seasonId,
    type: 'member',
    content: record.content,
    context: record.contextJson ? JSON.parse(record.contextJson) : undefined,
    gif: record.giphyId ? { provider: 'giphy', id: record.giphyId } : undefined,
    author: null,
    createdAt: record.createdAt.toISOString(),
    moderationStatus: 'active',
    isOwn: true,
  })),
  toSocialPost: vi.fn((record) => record),
  toSocialReply: vi.fn((record) => record),
}));

import { createSocialMessage, deleteSocialPost, markSocialChannelRead } from './socialCommands';

describe('league social Activity commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLeagueSocialAccess.mockResolvedValue({
      leagueId: 'league-1',
      seasonId: 'season-1',
      userId: 'user-1',
      memberId: 'member-1',
      canManage: false,
      canPublish: true,
      standardsAccepted: true,
      mutedUntil: null,
    });
    mocks.tx.socialCommand.findUnique.mockResolvedValue(null);
    mocks.tx.socialCommand.create.mockResolvedValue({ id: 'command-1' });
    mocks.tx.socialCommand.update.mockResolvedValue({});
    mocks.tx.socialMessage.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'message-1',
        ...data,
        createdAt: new Date('2026-07-19T10:00:00.000Z'),
      })
    );
    mocks.tx.socialOutboxEvent.create.mockResolvedValue({ sequence: 22 });
    mocks.tx.socialReadState.findUnique.mockResolvedValue(null);
    mocks.tx.socialReadState.upsert.mockResolvedValue({});
  });

  it('removes a post without changing its lock, so restoring it leaves the lock as it was', async () => {
    mocks.requireLeagueSocialAccess.mockResolvedValue({
      leagueId: 'league-1',
      seasonId: 'season-1',
      userId: 'user-1',
      memberId: 'member-1',
      canManage: true,
    });
    mocks.tx.socialPost.findFirst.mockResolvedValue({
      id: 'post-1',
      authorUserId: 'user-2',
      authorMemberId: 'member-2',
      deletedAt: null,
      title: 'Title',
      body: 'Body',
    });
    mocks.tx.socialPost.update.mockImplementation(async ({ data }) => ({
      id: 'post-1',
      leagueId: 'league-1',
      seasonId: 'season-1',
      ...data,
    }));

    await deleteSocialPost('league-1', 'user-1', 'post-1');

    const data = mocks.tx.socialPost.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ moderationStatus: 'REMOVED' });
    expect(data).not.toHaveProperty('isLocked');
    expect(data).not.toHaveProperty('lockedAt');
  });

  it('persists validated discussion context with an idempotent member message', async () => {
    const context = {
      type: 'trade' as const,
      id: 'trade-1',
      title: 'Trade proposal',
      subtitle: 'Two-player swap',
      metadata: { status: 'Pending' },
    };

    await createSocialMessage('league-1', 'user-1', {
      content: 'Would you accept this?',
      context,
      idempotencyKey: 'message:context-1',
    });

    expect(mocks.tx.socialMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league-1',
        seasonId: 'season-1',
        authorUserId: 'user-1',
        contextJson: JSON.stringify(context),
      }),
      include: {},
    });
  });

  it('persists a GIF-only message and includes its identity in the realtime outbox', async () => {
    await createSocialMessage('league-1', 'user-1', {
      content: '',
      gif: { provider: 'giphy', id: 'xT9IgG50Fb7Mi0prBC' },
      idempotencyKey: 'message:giphy-1',
    });

    expect(mocks.tx.socialMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: '',
        giphyId: 'xT9IgG50Fb7Mi0prBC',
      }),
      include: {},
    });
    expect(mocks.tx.socialOutboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'CHAT',
        eventType: 'social:message',
        payloadJson: expect.stringContaining(
          '"gif":{"provider":"giphy","id":"xT9IgG50Fb7Mi0prBC"}'
        ),
      }),
    });
  });

  it('stores Activity read state and publishes its cross-device cursor on Activity', async () => {
    mocks.tx.socialOutboxEvent.findFirst.mockResolvedValueOnce({ sequence: 22 });

    await expect(
      markSocialChannelRead('league-1', 'user-1', {
        channel: 'activity',
        sequence: 22,
      })
    ).resolves.toEqual({ channel: 'activity', sequence: 22 });

    expect(mocks.tx.socialOutboxEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sequence: 22,
          channel: 'ACTIVITY',
        }),
      })
    );
    expect(mocks.tx.socialReadState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ channel: 'ACTIVITY', lastReadSequence: 22 }),
      })
    );
    expect(mocks.tx.socialOutboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'ACTIVITY',
        eventType: 'social:read-state',
        payloadJson: expect.stringContaining('"channel":"activity"'),
      }),
    });
  });
});
