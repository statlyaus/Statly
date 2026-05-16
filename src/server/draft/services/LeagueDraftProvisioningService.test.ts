import { DraftStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  league: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
};

const scheduleDraftStartMock = vi.fn();
const createDraftRemindersMock = vi.fn();
const updateDraftRemindersMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/queue/draftQueue', () => ({
  scheduleDraftStart: scheduleDraftStartMock,
}));

vi.mock('@/lib/reminders', () => ({
  createDraftReminders: createDraftRemindersMock,
  updateDraftReminders: updateDraftRemindersMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}));

function buildProvisionableLeague(startAt: Date) {
  return {
    id: 'league-1',
    draftDate: startAt,
    settings: {
      startAt,
      rosterSize: 17,
      benchSize: 4,
      pickSeconds: 120,
      enableDraftReminders: true,
    },
    members: [
      {
        id: 'member-1',
        userId: 'user-1',
        draftSlot: 1,
        joinedAt: new Date('2026-05-01T00:00:00.000Z'),
        user: { id: 'user-1', displayName: 'User 1', email: 'user1@example.com' },
      },
      {
        id: 'member-2',
        userId: 'user-2',
        draftSlot: 2,
        joinedAt: new Date('2026-05-01T00:01:00.000Z'),
        user: { id: 'user-2', displayName: 'User 2', email: 'user2@example.com' },
      },
      {
        id: 'member-3',
        userId: 'user-3',
        draftSlot: 3,
        joinedAt: new Date('2026-05-01T00:02:00.000Z'),
        user: { id: 'user-3', displayName: 'User 3', email: 'user3@example.com' },
      },
      {
        id: 'member-4',
        userId: 'user-4',
        draftSlot: 4,
        joinedAt: new Date('2026-05-01T00:03:00.000Z'),
        user: { id: 'user-4', displayName: 'User 4', email: 'user4@example.com' },
      },
    ],
    drafts: [],
  };
}

describe('LeagueDraftProvisioningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T01:00:00.000Z'));
    prismaMock.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        draft: {
          create: vi.fn().mockResolvedValue({
            id: 'draft-1',
            status: DraftStatus.SCHEDULED,
            createdAt: new Date('2026-05-02T01:00:00.000Z'),
          }),
        },
        draftOrder: {
          create: vi.fn().mockResolvedValue({}),
        },
      })
    );
    scheduleDraftStartMock.mockResolvedValue(undefined);
    createDraftRemindersMock.mockResolvedValue(undefined);
    updateDraftRemindersMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a draft for an overdue saved schedule and queues immediate start', async () => {
    const startAt = new Date('2026-05-02T00:55:00.000Z');
    prismaMock.league.findUnique.mockResolvedValue(buildProvisionableLeague(startAt));

    const { leagueDraftProvisioningService } = await import('./LeagueDraftProvisioningService');

    const result = await leagueDraftProvisioningService.syncFromLeagueSettings('league-1');

    expect(result).toMatchObject({
      status: 'created',
      draft: {
        id: 'draft-1',
        status: DraftStatus.SCHEDULED,
        startAt: startAt.toISOString(),
      },
    });
    expect(scheduleDraftStartMock).toHaveBeenCalledWith('league-1', startAt, 120_000, true);
  });
});
