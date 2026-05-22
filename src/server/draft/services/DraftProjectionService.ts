import { DraftStatus, DraftType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { LiveDraftState } from '@/services/liveDraftEngine';

import { calculateDraftTurn } from '../domain/draftRules';
import type { DraftPickEventPayload } from '../domain/draftTypes';

export interface LegacyDraftUpdate {
  draftId: string;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: LiveDraftState['currentPick'] extends { slot: number } ? 'FORWARD' | 'REVERSE' : never;
  status: LiveDraftState['status'];
  picks: Array<{
    id: string;
    overall: number;
    round: number;
    slot: number;
    player: {
      id: string;
      name: string;
      position: string;
      club: string;
    };
    member: {
      id: string;
      displayName: string;
    };
    auto: boolean;
    madeAt: string;
  }>;
  participants: Array<{
    slot: number;
    member: {
      id: string;
      userId: string;
      displayName: string;
      email: string;
    };
  }>;
  completedAt?: string;
}

function mapDraftStatus(status: DraftStatus, lobbyStatus: string | null): LiveDraftState['status'] {
  if (status === DraftStatus.LIVE) return 'LIVE';
  if (status === DraftStatus.PAUSED) return 'PAUSED';
  if (status === DraftStatus.COMPLETED) return 'COMPLETED';
  if (status === DraftStatus.SCHEDULED && lobbyStatus === 'COUNTDOWN') return 'COUNTDOWN';
  if (status === DraftStatus.SCHEDULED && lobbyStatus === 'OPEN') return 'LOBBY';
  return 'SCHEDULED';
}

export class DraftProjectionService {
  async buildAuthoritativeDraftState(draftId: string): Promise<LiveDraftState | null> {
    const [draft, queueItems] = await Promise.all([
      prisma.draft.findUnique({
        where: { id: draftId },
        include: {
          league: {
            include: {
              settings: true,
            },
          },
          orders: {
            orderBy: { slot: 'asc' },
            include: {
              member: {
                include: {
                  user: {
                    select: {
                      id: true,
                      displayName: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
          picks: {
            orderBy: { overall: 'asc' },
            include: {
              player: {
                select: {
                  id: true,
                  name: true,
                  position: true,
                  club: true,
                },
              },
              member: {
                include: {
                  user: {
                    select: {
                      id: true,
                      displayName: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.preDraftQueue.findMany({
        where: { draftId },
        orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
        select: {
          memberId: true,
          playerId: true,
        },
      }),
    ]);

    if (!draft?.league?.settings) {
      return null;
    }

    const queueByMemberId = new Map<string, string[]>();
    for (const item of queueItems) {
      const existing = queueByMemberId.get(item.memberId) ?? [];
      existing.push(item.playerId);
      queueByMemberId.set(item.memberId, existing);
    }

    const participants = draft.orders.map((order) => ({
      userId: order.member.userId,
      memberId: order.memberId,
      slot: order.slot,
      displayName: order.member.user.displayName || order.member.user.email || 'Unknown',
      role: order.member.role,
    }));

    const totalTeams = participants.length;
    const totalRounds = draft.league.settings.rosterSize + draft.league.settings.benchSize;
    const totalPicks = totalTeams * totalRounds;
    const safePickNumber = Math.min(draft.currentPick, Math.max(totalPicks, 1));
    const draftType = draft.league.settings.draftType ?? DraftType.SNAKE;
    const turn = calculateDraftTurn(draftType, safePickNumber, participants);
    const timerAnchor = draft.pickStartedAt ?? draft.startedAt ?? draft.createdAt;
    const pickTimeLimit = draft.league.settings.pickSeconds;
    return {
      leagueId: draft.leagueId,
      draftId: draft.id,
      status: mapDraftStatus(draft.status, draft.lobbyStatus),
      currentPick: {
        userId: turn.participant.userId,
        memberId: turn.participant.memberId,
        pickNumber: draft.currentPick,
        round: draft.round,
        slot: turn.slot,
        expiresAt: draft.pickDeadlineAt ?? new Date(timerAnchor.getTime() + pickTimeLimit * 1000),
        startedAt: timerAnchor,
      },
      picks: draft.picks.map((pick) => ({
        playerId: pick.playerId,
        userId: pick.member.userId,
        memberId: pick.memberId,
        pickNumber: pick.overall,
        round: pick.round,
        slot: pick.slot,
        auto: pick.auto,
        timestamp: pick.madeAt,
      })),
      participants: participants.map((participant) => ({
        userId: participant.userId,
        memberId: participant.memberId,
        displayName: participant.displayName,
        draftOrder: participant.slot,
        isOnline: false,
        queue: queueByMemberId.get(participant.memberId) ?? [],
        autoPickEnabled: draft.league.settings.allowAutoPick,
        lastActivity: timerAnchor,
      })),
      timerSettings: {
        durationSeconds: pickTimeLimit,
        autopickAfterExpiry: draft.league.settings.allowAutoPick,
        ...(draft.status === DraftStatus.PAUSED && draft.pausedRemainingSeconds !== null
          ? { pausedTimeRemaining: draft.pausedRemainingSeconds }
          : {}),
      },
      draftSettings: {
        totalRounds,
        totalTeams,
        draftType,
        pickTimeLimit,
      },
      paused: draft.status === DraftStatus.PAUSED,
      createdAt: draft.createdAt,
      updatedAt: timerAnchor,
      lastActivity: timerAnchor,
    };
  }

  async buildLegacyDraftUpdate(draftId: string): Promise<LegacyDraftUpdate | null> {
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
          },
        },
        orders: {
          orderBy: { slot: 'asc' },
          include: {
            member: {
              include: {
                user: {
                  select: {
                    id: true,
                    displayName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        picks: {
          orderBy: { overall: 'asc' },
          include: {
            player: {
              select: {
                id: true,
                name: true,
                position: true,
                club: true,
              },
            },
            member: {
              include: {
                user: {
                  select: {
                    displayName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!draft?.league?.settings) {
      return null;
    }

    return {
      draftId: draft.id,
      currentPick: draft.currentPick,
      totalPicks: draft.totalPicks,
      round: draft.round,
      direction: draft.direction,
      status: mapDraftStatus(draft.status, draft.lobbyStatus),
      picks: draft.picks.map((pick) => ({
        id: pick.id,
        overall: pick.overall,
        round: pick.round,
        slot: pick.slot,
        player: {
          id: pick.player.id,
          name: pick.player.name,
          position: pick.player.position,
          club: pick.player.club,
        },
        member: {
          id: pick.memberId,
          displayName: pick.member.user.displayName || pick.member.user.email || 'Unknown',
        },
        auto: pick.auto,
        madeAt: pick.madeAt.toISOString(),
      })),
      participants: draft.orders.map((order) => ({
        slot: order.slot,
        member: {
          id: order.memberId,
          userId: order.member.userId,
          displayName: order.member.user.displayName || order.member.user.email || 'Unknown',
          email: order.member.user.email || '',
        },
      })),
      completedAt: draft.completedAt?.toISOString(),
    };
  }

  async emitAuthoritativeDraftState(draftId: string): Promise<LiveDraftState | null> {
    const { draftRealtimePublisher } = await import('./DraftRealtimePublisher');
    return draftRealtimePublisher.publishDraftState(draftId);
  }

  async emitAuthoritativeDraftEvent(
    draftId: string,
    event:
      | 'draft:pick-made'
      | 'draft:auto-pick'
      | 'draft:paused'
      | 'draft:resumed'
      | 'draft:completed',
    payload?: DraftPickEventPayload
  ): Promise<LiveDraftState | null> {
    const { draftRealtimePublisher } = await import('./DraftRealtimePublisher');
    return draftRealtimePublisher.publishDraftEvent(draftId, event, payload);
  }
}

export const draftProjectionService = new DraftProjectionService();
