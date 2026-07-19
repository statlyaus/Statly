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
    author: null,
    createdAt: record.createdAt.toISOString(),
    moderationStatus: 'active',
    isOwn: true,
  })),
  toSocialPost: vi.fn((record) => record),
  toSocialReply: vi.fn((record) => record),
}));

import { createSocialMessage, markSocialChannelRead } from './socialCommands';

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
