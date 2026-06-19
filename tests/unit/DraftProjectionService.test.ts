import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  PickOrder,
  WaiverRule,
} from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DraftProjectionService } from '@/server/draft/services/DraftProjectionService';

const prismaMock = vi.hoisted(() => ({
  draft: {
    findUnique: vi.fn(),
  },
  preDraftQueue: {
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('DraftProjectionService', () => {
  it('preserves draft identity metadata in legacy socket updates', async () => {
    prismaMock.draft.findUnique.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: DraftStatus.LIVE,
      currentPick: 1,
      totalPicks: 264,
      round: 1,
      direction: DraftDirection.FORWARD,
      completedAt: null,
      lobbyStatus: null,
      league: {
        name: 'Test AFL Champions League',
        settings: {
          rosterSize: 18,
          benchSize: 4,
          maxTeams: 12,
          pickSeconds: 60,
          allowAutoPick: true,
          draftType: DraftType.SNAKE,
          pickOrder: PickOrder.RANDOM,
          waiverRule: WaiverRule.WEEKLY,
        },
      },
      orders: [
        {
          slot: 1,
          memberId: 'member-1',
          member: {
            userId: 'user-1',
            role: LeagueRole.MANAGER,
            user: {
              id: 'user-1',
              displayName: 'Robbo Rockers',
              email: 'robbo@example.com',
            },
          },
        },
      ],
      picks: [],
    });

    const update = await new DraftProjectionService().buildLegacyDraftUpdate('draft-1');

    expect(update).toMatchObject({
      draftId: 'draft-1',
      leagueId: 'league-1',
      name: 'Test AFL Champions League - LIVE',
    });
  });

  it('projects paused drafts with paused remaining time instead of a stale expired deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
    prismaMock.preDraftQueue.findMany.mockResolvedValue([]);
    prismaMock.draft.findUnique.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: DraftStatus.PAUSED,
      currentPick: 2,
      totalPicks: 264,
      round: 1,
      direction: DraftDirection.FORWARD,
      createdAt: new Date('2026-06-14T11:30:00.000Z'),
      startedAt: new Date('2026-06-14T11:45:00.000Z'),
      completedAt: null,
      pickStartedAt: null,
      pickDeadlineAt: null,
      pausedRemainingSeconds: 37,
      lobbyStatus: 'LIVE',
      league: {
        name: 'Test AFL Champions League',
        settings: {
          rosterSize: 18,
          benchSize: 4,
          maxTeams: 12,
          pickSeconds: 60,
          allowAutoPick: true,
          draftType: DraftType.SNAKE,
          pickOrder: PickOrder.RANDOM,
          waiverRule: WaiverRule.WEEKLY,
        },
      },
      orders: [
        {
          slot: 1,
          memberId: 'member-1',
          member: {
            userId: 'user-1',
            role: LeagueRole.OWNER,
            user: {
              id: 'user-1',
              displayName: 'Statly Dev Tester',
              email: 'statly@example.com',
            },
          },
        },
        {
          slot: 2,
          memberId: 'member-2',
          member: {
            userId: 'bot-1',
            role: LeagueRole.MANAGER,
            user: {
              id: 'bot-1',
              displayName: 'CPU Team 1',
              email: 'bot@example.com',
            },
          },
        },
      ],
      picks: [],
    });

    const state = await new DraftProjectionService().buildAuthoritativeDraftState('draft-1');

    expect(state?.status).toBe('PAUSED');
    expect(state?.paused).toBe(true);
    expect(state?.timerSettings.pausedTimeRemaining).toBe(37);
    expect(state?.currentPick.expiresAt.toISOString()).toBe('2026-06-14T12:00:37.000Z');
  });
});
