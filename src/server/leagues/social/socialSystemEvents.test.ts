import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    socialCommand: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    socialMessage: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    socialOutboxEvent: {
      create: vi.fn(),
    },
  };
  return {
    ensureActiveLeagueSeason: vi.fn(),
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
  ensureActiveLeagueSeason: mocks.ensureActiveLeagueSeason,
}));

vi.mock('./socialDto', () => ({
  socialMessageInclude: {},
  toSocialMessage: vi.fn((record) => ({
    id: record.id,
    leagueId: record.leagueId,
    seasonId: record.seasonId,
    type: 'system',
    content: record.content,
    author: null,
    createdAt: record.createdAt.toISOString(),
    moderationStatus: 'active',
    isOwn: false,
  })),
}));

import { publishLeagueSystemMessage } from './socialSystemEvents';

describe('league social system activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureActiveLeagueSeason.mockResolvedValue('season-1');
    mocks.tx.socialCommand.findUnique.mockResolvedValue(null);
    mocks.tx.socialCommand.create.mockResolvedValue({ id: 'command-1' });
    mocks.tx.socialMessage.create.mockResolvedValue({
      id: 'message-1',
      leagueId: 'league-1',
      seasonId: 'season-1',
      content: 'Jordan Example was drafted.',
      createdAt: new Date('2026-07-19T10:00:00.000Z'),
    });
    mocks.tx.socialOutboxEvent.create.mockResolvedValue({ sequence: 12 });
    mocks.tx.socialCommand.update.mockResolvedValue({});
  });

  it('persists automated events as system messages routed only through Activity', async () => {
    await publishLeagueSystemMessage({
      leagueId: 'league-1',
      eventType: 'PLAYER_DRAFTED',
      relatedEntityId: 'pick-1',
      content: 'Jordan Example was drafted.',
    });

    expect(mocks.tx.socialCommand.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: '__system__',
        idempotencyKey: 'system:PLAYER_DRAFTED:pick-1',
      }),
    });
    expect(mocks.tx.socialCommand.create.mock.calls[0][0].data).not.toHaveProperty('actorMemberId');
    expect(mocks.tx.socialOutboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'ACTIVITY',
        eventType: 'social:activity',
        aggregateType: 'activity',
        actorUserId: null,
        payloadJson: expect.stringContaining('"type":"system"'),
      }),
    });
  });
});
