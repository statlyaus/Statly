import { logger } from '@/lib/logger';
import {
  draftPubSub,
  type DraftRealtimeEnvelope,
  type DraftRealtimeEventType,
} from '@/services/realtime/pubsub';
import type { LiveDraftState } from '@/services/liveDraftEngine';

import type { DraftPickEventPayload } from '../domain/draftTypes';
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

type DraftQueueUpdatedPayload = {
  userId: string;
  queue: string[];
};

type DraftDelta =
  | {
      type: 'PICK_MADE';
      payload: { pick: DraftPickEventPayload };
      ts: number;
    }
  | {
      type: 'QUEUE_UPDATED';
      payload: { userId: string; queue: string[] };
      ts: number;
    }
  | {
      type: 'STATE_PATCH';
      payload: {
        draft?: {
          status?: LiveDraftState['status'];
          currentPick?: number;
          round?: number;
          direction?: 'FORWARD' | 'REVERSE';
          pickDeadlineAt?: string;
        };
        liveState?: {
          currentPick?: number;
          onClockTeamId?: string;
        };
      };
      ts: number;
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

  async publishState(state: LiveDraftState): Promise<void> {
    this.dispatchToLocal(state.draftId, 'draft:state', state);
    await draftPubSub.publish(state.draftId, 'draft:state', state);
  }

  async publishDraftEvent(
    draftId: string,
    event:
      | 'draft:pick-made'
      | 'draft:auto-pick'
      | 'draft:paused'
      | 'draft:resumed'
      | 'draft:completed',
    payload?: DraftPickEventPayload
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

  async publishQueueUpdated(draftId: string, userId: string, queue: string[]): Promise<void> {
    const payload = { userId, queue };
    this.dispatchToLocal(draftId, 'draft:queue-updated', payload);
    await draftPubSub.publish(draftId, 'draft:queue-updated', payload);
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
    this.io?.to(draftId).emit(event, payload);
    this.io?.to(`draft:${draftId}`).emit(event, payload);
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
        const state = payload as LiveDraftState;
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
              pickDeadlineAt: state.currentPick.expiresAt.toISOString(),
            },
            liveState: {
              currentPick: state.currentPick.pickNumber,
              onClockTeamId: state.currentPick.memberId,
            },
          },
          ts: Date.now(),
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
        });
        return;
      }
      case 'draft:paused': {
        this.emitToDraftRooms(draftId, 'draft:paused', payload);
        this.emitToDraftRooms(draftId, 'draft:status', this.buildStatusPayload(draftId, 'PAUSED'));
        return;
      }
      case 'draft:resumed': {
        this.emitToDraftRooms(draftId, 'draft:resumed', payload);
        this.emitToDraftRooms(draftId, 'draft:status', this.buildStatusPayload(draftId, 'LIVE'));
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
      case 'draft:queue-updated': {
        const queuePayload = payload as DraftQueueUpdatedPayload;
        this.emitToDraftRooms(draftId, 'draft:queue-updated', { draftId, ...queuePayload });
        this.emitCompatDelta(draftId, {
          type: 'QUEUE_UPDATED',
          payload: queuePayload,
          ts: Date.now(),
        });
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
    };
  }
}

export const draftRealtimeDispatcher = new DraftRealtimeDispatcher();
