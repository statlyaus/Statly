import { DraftStatus, DraftType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import {
  LEAGUE_MANAGER_MEMBER_SELECT,
  leagueManagerUserIds,
} from '@/server/leagues/activeMembership';
import {
  DraftRoomSnapshotPayloadSchema,
  type CanonicalLiveDraftState,
  type DraftClockPayload,
  type DraftRoomSnapshotPayload,
  type LiveDraftState,
} from '@/services/realtime/draftStateWire';

import { calculateDraftTurn } from '../domain/draftRules';

function mapDraftStatus(status: DraftStatus, lobbyStatus: string | null): LiveDraftState['status'] {
  if (status === DraftStatus.LIVE) return 'LIVE';
  if (status === DraftStatus.PAUSED) return 'PAUSED';
  if (status === DraftStatus.COMPLETED) return 'COMPLETED';
  if (status === DraftStatus.SCHEDULED && lobbyStatus === 'COUNTDOWN') return 'COUNTDOWN';
  if (status === DraftStatus.SCHEDULED && lobbyStatus === 'OPEN') return 'LOBBY';
  return 'SCHEDULED';
}

function resolveProjectedClockDuration(input: {
  status: DraftStatus;
  clockDurationSeconds: number | null;
  fallbackSeconds: number;
}): number {
  if (
    input.clockDurationSeconds &&
    Number.isInteger(input.clockDurationSeconds) &&
    input.clockDurationSeconds > 0
  ) {
    return input.clockDurationSeconds;
  }
  if (input.status === DraftStatus.LIVE) {
    throw new Error('LIVE draft is missing its immutable clock duration');
  }
  return input.fallbackSeconds;
}

export function buildDraftClockPayload(input: {
  status: DraftStatus;
  lobbyStatus: string | null;
  revision: number;
  durationSeconds: number;
  serverNow: string;
  pickStartedAt: Date | null;
  pickDeadlineAt: Date | null;
  pausedRemainingSeconds: number | null;
}): DraftClockPayload {
  const status = mapDraftStatus(input.status, input.lobbyStatus);
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error('Draft clock is missing its immutable duration');
  }
  const base = {
    revision: input.revision,
    durationSeconds: input.durationSeconds,
    serverNow: input.serverNow,
  };

  if (status === 'LIVE') {
    if (!input.pickStartedAt || !input.pickDeadlineAt) {
      throw new Error('LIVE draft is missing its persisted clock anchors');
    }

    return {
      ...base,
      status: 'LIVE',
      startedAt: input.pickStartedAt.toISOString(),
      deadlineAt: input.pickDeadlineAt.toISOString(),
    };
  }

  if (status === 'PAUSED') {
    if (input.pausedRemainingSeconds === null) {
      throw new Error('PAUSED draft is missing its persisted remaining time');
    }

    return {
      ...base,
      status: 'PAUSED',
      remainingSeconds: input.pausedRemainingSeconds,
    };
  }

  return { ...base, status };
}

export class DraftProjectionService {
  async buildRoomSnapshot(
    draftId: string,
    authenticatedUserId: string,
    expectedStateRevision?: number
  ): Promise<DraftRoomSnapshotPayload | null> {
    const loadDraft = () =>
      prisma.draft.findFirst({
        where: {
          id: draftId,
          ...(expectedStateRevision !== undefined
            ? { schedulingVersion: expectedStateRevision }
            : {}),
          league: {
            members: {
              some: {
                userId: authenticatedUserId,
                isActive: true,
                status: 'ACTIVE',
              },
            },
          },
        },
        include: {
          league: {
            include: {
              settings: true,
              members: { select: LEAGUE_MANAGER_MEMBER_SELECT },
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
      });

    const draft = await loadDraft();

    if (!draft?.league.settings) {
      return null;
    }

    const status = mapDraftStatus(draft.status, draft.lobbyStatus);
    const serverNow = new Date().toISOString();

    const turnParticipants = draft.orders.map((order) => ({
      userId: order.member.userId,
      memberId: order.memberId,
      slot: order.slot,
      displayName: order.member.user.displayName || order.member.user.email || 'Unknown',
      role: order.member.role,
    }));
    const onClockMemberId =
      (status === 'LIVE' || status === 'PAUSED') && turnParticipants.length > 0
        ? calculateDraftTurn(
            draft.league.settings.draftType ?? DraftType.SNAKE,
            Math.min(draft.currentPick, Math.max(draft.totalPicks, 1)),
            turnParticipants
          ).participant.memberId
        : null;
    const clock = buildDraftClockPayload({
      status: draft.status,
      lobbyStatus: draft.lobbyStatus,
      revision: draft.schedulingVersion,
      durationSeconds: resolveProjectedClockDuration({
        status: draft.status,
        clockDurationSeconds: draft.clockDurationSeconds,
        fallbackSeconds: draft.league.settings.pickSeconds,
      }),
      serverNow,
      pickStartedAt: draft.pickStartedAt,
      pickDeadlineAt: draft.pickDeadlineAt,
      pausedRemainingSeconds: draft.pausedRemainingSeconds,
    });

    return DraftRoomSnapshotPayloadSchema.parse({
      schemaVersion: 1,
      draftId: draft.id,
      leagueId: draft.leagueId,
      revision: draft.schedulingVersion,
      throughSequence: draft.eventSequence,
      serverNow,
      state: {
        name: `${draft.league.name || 'Draft'} - ${draft.status}`,
        status,
        currentPick: draft.currentPick,
        totalPicks: draft.totalPicks,
        round: draft.round,
        direction: draft.direction,
        draftType: draft.league.settings.draftType ?? DraftType.SNAKE,
        timeZone: draft.league.settings.timeZone,
        clock,
        onClockMemberId,
        participants: draft.orders.map((order) => ({
          id: order.memberId,
          userId: order.member.userId,
          displayName: order.member.user.displayName || order.member.user.email || 'Unknown',
          teamName: order.member.teamName,
          draftOrder: order.slot,
        })),
        managerUserIds: leagueManagerUserIds(draft.league),
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
            userId: pick.member.userId,
            displayName: pick.member.user.displayName || pick.member.user.email || 'Unknown',
            teamName: pick.member.teamName,
          },
          auto: pick.auto,
          madeAt: pick.madeAt.toISOString(),
        })),
      },
    });
  }

  async buildAuthoritativeDraftState(
    draftId: string,
    expectedStateRevision?: number
  ): Promise<CanonicalLiveDraftState | null> {
    const loadDraft = () =>
      prisma.draft.findFirst({
        where: {
          id: draftId,
          ...(expectedStateRevision !== undefined
            ? { schedulingVersion: expectedStateRevision }
            : {}),
        },
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
      });

    const draft = await loadDraft();

    if (!draft?.league?.settings) {
      return null;
    }

    const participants = draft.orders.map((order) => ({
      userId: order.member.userId,
      memberId: order.memberId,
      slot: order.slot,
      displayName: order.member.user.displayName || order.member.user.email || 'Unknown',
      role: order.member.role,
    }));

    const totalTeams = participants.length;
    // The stored total is capped by the player pool at setup; completion stops there too.
    const totalRounds = totalTeams > 0 ? Math.ceil(draft.totalPicks / totalTeams) : 0;
    const safePickNumber = Math.min(draft.currentPick, Math.max(draft.totalPicks, 1));
    const draftType = draft.league.settings.draftType ?? DraftType.SNAKE;
    const turn = calculateDraftTurn(draftType, safePickNumber, participants);
    const timerAnchor = draft.pickStartedAt ?? draft.startedAt ?? draft.createdAt;
    const pickTimeLimit = resolveProjectedClockDuration({
      status: draft.status,
      clockDurationSeconds: draft.clockDurationSeconds,
      fallbackSeconds: draft.league.settings.pickSeconds,
    });
    const pausedTimeRemaining =
      draft.status === DraftStatus.PAUSED
        ? (draft.pausedRemainingSeconds ?? pickTimeLimit)
        : undefined;
    const expiresAt = draft.pickDeadlineAt ?? timerAnchor;
    const clock = buildDraftClockPayload({
      status: draft.status,
      lobbyStatus: draft.lobbyStatus,
      revision: draft.schedulingVersion,
      durationSeconds: pickTimeLimit,
      serverNow: new Date().toISOString(),
      pickStartedAt: draft.pickStartedAt,
      pickDeadlineAt: draft.pickDeadlineAt,
      pausedRemainingSeconds: draft.pausedRemainingSeconds,
    });

    return {
      leagueId: draft.leagueId,
      draftId: draft.id,
      throughSequence: draft.eventSequence,
      clock,
      status: mapDraftStatus(draft.status, draft.lobbyStatus),
      currentPick: {
        userId: turn.participant.userId,
        memberId: turn.participant.memberId,
        pickNumber: draft.currentPick,
        round: draft.round,
        slot: turn.slot,
        expiresAt,
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
        autoPickEnabled: draft.league.settings.allowAutoPick,
        lastActivity: timerAnchor,
      })),
      timerSettings: {
        durationSeconds: pickTimeLimit,
        autopickAfterExpiry: draft.league.settings.allowAutoPick,
        ...(pausedTimeRemaining !== undefined ? { pausedTimeRemaining } : {}),
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
}

export const draftProjectionService = new DraftProjectionService();
