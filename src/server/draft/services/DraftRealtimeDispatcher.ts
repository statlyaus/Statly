import { logger } from '@/lib/logger';
import {
  draftPubSub,
  type DraftRealtimeEnvelope,
  type DraftRealtimeEventType,
} from '@/services/realtime/pubsub';
import {
  DraftClockPayloadSchema,
  toDraftRealtimeStatePayload,
  type CanonicalLiveDraftState,
  type DraftClockPayload,
  type DraftRealtimeStatePayload,
} from '@/services/realtime/draftStateWire';
import type { LiveDraftState } from '@/services/liveDraftEngine';

import type { DraftLifecycleEventPayload, DraftPickEventPayload } from '../domain/draftTypes';
import type { Server as SocketIOServer } from 'socket.io';

type DraftStatusPayload = {
  draftId: string;
  status: 'PAUSED' | 'LIVE' | 'COMPLETED';
  timestamp: string;
};

type DraftTimerTickPayload = {
  timeRemaining: number;
};

type DraftAdminMessagePayload = {
  type: 'joined' | 'left';
  userId: string;
};

type DraftDelta =
  | {
      type: 'PICK_MADE';
      payload: { pick: DraftPickEventPayload };
      ts: number;
      revision?: number;
    }
  | {
      type: 'STATE_PATCH';
      payload: {
        draft?: {
          status?: LiveDraftState['status'];
          currentPick?: number;
          round?: number;
          direction?: 'FORWARD' | 'REVERSE';
          pickDeadlineAt?: string | null;
        };
        liveState?: {
          currentPick?: number;
          onClockTeamId?: string;
          clock?: DraftClockPayload;
          revision?: number;
        };
      };
      ts: number;
      revision?: number;
    };

export class DraftRealtimeDispatcher {
  private io: SocketIOServer | null = null;
  private subscriberStarted = false;

  attachSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  async startSubscription(): Promise<void> {
    if (this.subscriberStarted) {
      return;
    }

    this.subscriberStarted = true;
    await draftPubSub.start((msg) => {
      this.dispatchEnvelope(msg);
    });
  }

  async publishState(state: CanonicalLiveDraftState): Promise<void> {
    const payload = toDraftRealtimeStatePayload(state);
    this.dispatchToLocal(state.draftId, 'draft:state', payload);
    await draftPubSub.publish(state.draftId, 'draft:state', payload);
  }

  async publishDraftEvent(
    draftId: string,
    event:
      'draft:pick-made' | 'draft:auto-pick' | 'draft:paused' | 'draft:resumed' | 'draft:completed',
    payload?: DraftPickEventPayload | DraftLifecycleEventPayload
  ): Promise<void> {
    const eventPayload = payload ?? {};
    this.dispatchToLocal(draftId, event, eventPayload);
    await draftPubSub.publish(draftId, event, eventPayload);
  }

  async publishTimerTick(draftId: string, timeRemaining: number): Promise<void> {
    const payload = { timeRemaining };
    this.dispatchToLocal(draftId, 'draft:timer-tick', payload);
    await draftPubSub.publish(draftId, 'draft:timer-tick', payload);
  }

  async publishTimerExpired(draftId: string): Promise<void> {
    const payload = { draftId, timestamp: new Date().toISOString() };
    this.dispatchToLocal(draftId, 'draft:timer-expired', payload);
    await draftPubSub.publish(draftId, 'draft:timer-expired', payload);
  }

  async publishAdminMessage(
    draftId: string,
    type: 'joined' | 'left',
    userId: string
  ): Promise<void> {
    const payload = { type, userId };
    this.dispatchToLocal(draftId, 'draft:admin-message', payload);
    await draftPubSub.publish(draftId, 'draft:admin-message', payload);
  }

  private dispatchEnvelope(msg: DraftRealtimeEnvelope): void {
    this.dispatchToLocal(msg.draftId, msg.event, msg.payload);
  }

  private emitToDraftRooms(draftId: string, event: string, payload: unknown): void {
    this.io?.local.to(draftId).emit(event, payload);
    this.io?.local.to(`draft:${draftId}`).emit(event, payload);
  }

  private emitCompatDelta(draftId: string, delta: DraftDelta): void {
    this.emitToDraftRooms(draftId, 'draft:delta', delta);
  }

  private dispatchToLocal(draftId: string, event: DraftRealtimeEventType, payload: unknown): void {
    if (!this.io) {
      logger.debug('Skipping local realtime emit without attached Socket.IO server', {
        draftId,
        event,
      });
      return;
    }

    switch (event) {
      case 'draft:state': {
        const state = payload as DraftRealtimeStatePayload;
        this.emitToDraftRooms(draftId, 'draft:state', payload);
        this.emitToDraftRooms(draftId, 'draft:update', payload);
        this.emitCompatDelta(draftId, {
          type: 'STATE_PATCH',
          payload: {
            draft: {
              status: state.status,
              currentPick: state.currentPick.pickNumber,
              round: state.currentPick.round,
              direction:
                state.draftSettings.draftType === 'LINEAR'
                  ? 'FORWARD'
                  : state.currentPick.round % 2 === 1
                    ? 'FORWARD'
                    : 'REVERSE',
              pickDeadlineAt: state.clock.status === 'LIVE' ? state.clock.deadlineAt : null,
            },
            liveState: {
              currentPick: state.currentPick.pickNumber,
              onClockTeamId: state.currentPick.memberId,
              clock: state.clock,
              revision: state.revision,
            },
          },
          ts: Date.parse(state.serverNow),
          revision: state.revision,
        });
        return;
      }
      case 'draft:timer-tick': {
        const timerPayload = payload as DraftTimerTickPayload;
        this.emitToDraftRooms(draftId, 'draft:timer-tick', timerPayload);
        this.emitToDraftRooms(draftId, 'draft:timer', { draftId, ...timerPayload });
        return;
      }
      case 'draft:timer-expired': {
        this.emitToDraftRooms(draftId, 'draft:timer-expired', payload);
        this.emitToDraftRooms(draftId, 'draft:timer:expired', payload);
        return;
      }
      case 'draft:pick-made': {
        const pickPayload = payload as DraftPickEventPayload;
        this.emitToDraftRooms(draftId, 'draft:pick-made', payload);
        this.emitToDraftRooms(draftId, 'draft:pick', payload);
        this.emitToDraftRooms(draftId, 'pick:made', payload);
        this.emitCompatDelta(draftId, {
          type: 'PICK_MADE',
          payload: this.buildPickDeltaPayload(pickPayload),
          ts: Date.now(),
          revision: pickPayload.schedulingVersion,
        });
        return;
      }
      case 'draft:auto-pick': {
        const pickPayload = payload as DraftPickEventPayload;
        this.emitToDraftRooms(draftId, 'draft:auto-pick', payload);
        this.emitToDraftRooms(draftId, 'draft:pick', payload);
        this.emitCompatDelta(draftId, {
          type: 'PICK_MADE',
          payload: this.buildPickDeltaPayload(pickPayload),
          ts: Date.now(),
          revision: pickPayload.schedulingVersion,
        });
        return;
      }
      case 'draft:paused': {
        this.emitToDraftRooms(draftId, 'draft:paused', payload);
        this.emitToDraftRooms(draftId, 'draft:status', this.buildStatusPayload(draftId, 'PAUSED'));
        this.emitLifecycleDelta(draftId, payload, 'PAUSED');
        return;
      }
      case 'draft:resumed': {
        this.emitToDraftRooms(draftId, 'draft:resumed', payload);
        this.emitToDraftRooms(draftId, 'draft:status', this.buildStatusPayload(draftId, 'LIVE'));
        this.emitLifecycleDelta(draftId, payload, 'LIVE');
        return;
      }
      case 'draft:completed': {
        this.emitToDraftRooms(draftId, 'draft:completed', payload);
        this.emitToDraftRooms(
          draftId,
          'draft:status',
          this.buildStatusPayload(draftId, 'COMPLETED')
        );
        return;
      }
      case 'draft:admin-message': {
        const adminPayload = payload as DraftAdminMessagePayload;
        this.emitToDraftRooms(draftId, 'draft:admin-message', adminPayload);
        return;
      }
      default: {
        const exhaustiveCheck: never = event;
        return exhaustiveCheck;
      }
    }
  }

  private buildStatusPayload(
    draftId: string,
    status: DraftStatusPayload['status']
  ): DraftStatusPayload {
    return {
      draftId,
      status,
      timestamp: new Date().toISOString(),
    };
  }

  private emitLifecycleDelta(
    draftId: string,
    payload: unknown,
    expectedStatus: 'LIVE' | 'PAUSED'
  ): void {
    if (!payload || typeof payload !== 'object') return;

    const lifecycle = payload as Partial<DraftLifecycleEventPayload>;
    if (lifecycle.status !== expectedStatus) return;

    const clockResult = DraftClockPayloadSchema.safeParse(
      expectedStatus === 'LIVE'
        ? {
            status: 'LIVE',
            revision: lifecycle.schedulingVersion,
            durationSeconds: lifecycle.durationSeconds,
            serverNow: lifecycle.serverNow,
            startedAt: lifecycle.pickStartedAt,
            deadlineAt: lifecycle.pickDeadlineAt,
          }
        : {
            status: 'PAUSED',
            revision: lifecycle.schedulingVersion,
            durationSeconds: lifecycle.durationSeconds,
            serverNow: lifecycle.serverNow,
            remainingSeconds: lifecycle.pausedRemainingSeconds,
          }
    );
    if (!clockResult.success) return;

    this.emitCompatDelta(draftId, {
      type: 'STATE_PATCH',
      payload: {
        draft: {
          status: expectedStatus,
          pickDeadlineAt: clockResult.data.status === 'LIVE' ? clockResult.data.deadlineAt : null,
        },
        liveState: {
          clock: clockResult.data,
          revision: clockResult.data.revision,
        },
      },
      ts: Date.parse(clockResult.data.serverNow),
      revision: clockResult.data.revision,
    });
  }

  private buildPickDeltaPayload(pick: DraftPickEventPayload) {
    return {
      pick,
      currentPick: pick.currentPick,
      isComplete: pick.isComplete,
      status: pick.status,
      round: pick.nextRound,
      direction: pick.nextDirection,
      pickStartedAt: pick.pickStartedAt,
      pickDeadlineAt: pick.pickDeadlineAt,
      schedulingVersion: pick.schedulingVersion,
    };
  }
}

export const draftRealtimeDispatcher = new DraftRealtimeDispatcher();
