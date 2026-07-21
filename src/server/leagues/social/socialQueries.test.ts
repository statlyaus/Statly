import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireLeagueSocialAccess: vi.fn(),
  socialMessageFindMany: vi.fn(),
  socialBoardCategoryFindMany: vi.fn(),
  socialReadStateFindMany: vi.fn(),
  socialOutboxAggregate: vi.fn(),
  socialOutboxCount: vi.fn(),
  leagueMemberFindFirst: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('./socialAccess', () => ({
  requireLeagueSocialAccess: mocks.requireLeagueSocialAccess,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    socialMessage: { findMany: mocks.socialMessageFindMany },
    socialBoardCategory: { findMany: mocks.socialBoardCategoryFindMany },
    socialReadState: { findMany: mocks.socialReadStateFindMany },
    socialOutboxEvent: {
      aggregate: mocks.socialOutboxAggregate,
      count: mocks.socialOutboxCount,
    },
    leagueMember: { findFirst: mocks.leagueMemberFindFirst },
  },
}));

vi.mock('./socialDto', () => ({
  socialMessageInclude: {},
  socialPostInclude: {},
  socialReplyInclude: {},
  toSocialCategory: vi.fn((category) => category),
  toSocialMessage: vi.fn((message) => ({ ...message, type: message.type.toLowerCase() })),
  toSocialPost: vi.fn((post) => post),
  toSocialReply: vi.fn((reply) => reply),
}));

import { getLeagueSocialSummary, listSocialActivity, listSocialMessages } from './socialQueries';

describe('league social activity queries', () => {
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
    mocks.socialMessageFindMany.mockResolvedValue([]);
    mocks.socialBoardCategoryFindMany.mockResolvedValue([]);
    mocks.socialReadStateFindMany.mockResolvedValue([]);
    mocks.socialOutboxAggregate.mockImplementation(
      ({ where }: { where: { channel: 'CHAT' | 'BOARD' | 'ACTIVITY' } }) =>
        Promise.resolve({
          _max: {
            sequence: where.channel === 'CHAT' ? 10 : where.channel === 'BOARD' ? 20 : 30,
          },
        })
    );
    mocks.socialOutboxCount.mockImplementation(
      ({ where }: { where: { channel: 'CHAT' | 'BOARD' | 'ACTIVITY' } }) =>
        Promise.resolve(where.channel === 'CHAT' ? 1 : where.channel === 'BOARD' ? 2 : 3)
    );
    mocks.leagueMemberFindFirst.mockResolvedValue({ notificationSettingsJson: null });
  });

  it('keeps member chat and automated activity in separate league-season queries', async () => {
    await listSocialMessages('league-1', 'user-1', { limit: 25 });
    expect(mocks.socialMessageFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leagueId: 'league-1',
          seasonId: 'season-1',
          type: 'MEMBER',
        }),
      })
    );

    await listSocialActivity('league-1', 'user-1', { limit: 25 });
    expect(mocks.socialMessageFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leagueId: 'league-1',
          seasonId: 'season-1',
          type: 'SYSTEM',
        }),
      })
    );
  });

  it('reports independent chat, board, and activity cursors and unread counts', async () => {
    await expect(getLeagueSocialSummary('league-1', 'user-1')).resolves.toMatchObject({
      unread: { chat: 1, board: 2, activity: 3 },
      latestSequence: { chat: 10, board: 20, activity: 30 },
    });

    expect(mocks.socialOutboxAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ channel: 'ACTIVITY' }),
      })
    );
    expect(mocks.socialOutboxCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: 'ACTIVITY',
          sequence: { gt: 0 },
          eventType: { not: 'social:read-state' },
        }),
      })
    );
  });
});
