import { logger } from '@/lib/logger';
import {
  draftPubSub,
  type DraftRealtimeEnvelope,
  type DraftRealtimeEventType,
} from '@/services/realtime/pubsub';
import type { LiveDraftState } from '@/services/liveDraftEngine';

import { DRAFT_BEHAVIOR_CONTRACT } from '../domain/draftTypes';
import { appendDraftDelta } from '../realtime/draftDeltaLog';
import type {
  DraftPickEventPayload,
  DraftQueueUpdatedDeltaPayload,
  DraftRealtimeDelta,
  DraftStatePatchDeltaPayload,
  DraftTimerExpiredDeltaPayload,
} from '../domain/draftTypes';
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

function buildPickEventId(draftId: string, pick: DraftPickEventPayload): string {
  return `${draftId}:pick:${pick.overall}:${pick.player.id}`;
}

function buildStatePatchEventId(draftId: string, payload: DraftStatePatchDeltaPayload): string {
  const draftPatch = payload.draft ?? {};
  const livePatch = payload.liveState ?? {};

  return [
    draftId,
    'state',
    draftPatch.status,
    draftPatch.currentPick,
    draftPatch.round,
    draftPatch.direction,
    draftPatch.pickDeadlineAt,
    livePatch.currentPick,
    livePatch.onClockTeamId,
    livePatch.timeRemaining,
  ]
    .map((part) => (part == null ? '' : String(part)))
    .join(':');
}

function buildQueueUpdatedEventId(draftId: string, payload: DraftQueueUpdatedDeltaPayload): string {
  return `${draftId}:queue:${payload.userId}:${payload.queue.join(',')}`;
}

function buildTimerExpiredEventId(draftId: string, payload: DraftTimerExpiredDeltaPayload): string {
  return `${draftId}:timer-expired:${payload.timestamp}`;
}

function toRealtimeIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === 'string') {
    return Number.isNaN(Date.parse(value)) ? null : value;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

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
    await this.dispatchToLocal(state.draftId, 'draft:state', state);
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
    await this.dispatchToLocal(draftId, event, eventPayload);
    await draftPubSub.publish(draftId, event, eventPayload);
  }

  async publishTimerTick(draftId: string, timeRemaining: number): Promise<void> {
    const payload = { timeRemaining };
    await this.dispatchToLocal(draftId, 'draft:timer-tick', payload);
    await draftPubSub.publish(draftId, 'draft:timer-tick', payload);
  }

  async publishTimerExpired(draftId: string): Promise<void> {
    const payload = { draftId, timestamp: new Date().toISOString() };
    await this.dispatchToLocal(draftId, 'draft:timer-expired', payload);
    await draftPubSub.publish(draftId, 'draft:timer-expired', payload);
  }

  async publishQueueUpdated(draftId: string, userId: string, queue: string[]): Promise<void> {
    const payload = { userId, queue };
    await this.dispatchToLocal(draftId, 'draft:queue-updated', payload);
    await draftPubSub.publish(draftId, 'draft:queue-updated', payload);
  }

  async publishAdminMessage(
    draftId: string,
    type: 'joined' | 'left',
    userId: string
  ): Promise<void> {
    const payload = { type, userId };
    await this.dispatchToLocal(draftId, 'draft:admin-message', payload);
    await draftPubSub.publish(draftId, 'draft:admin-message', payload);
  }

  private dispatchEnvelope(msg: DraftRealtimeEnvelope): void {
    void this.dispatchToLocal(msg.draftId, msg.event, msg.payload);
  }

  private emitToDraftRooms(draftId: string, event: string, payload: unknown): void {
    this.io?.to(`draft:${draftId}`).emit(event, payload);
  }

  private async emitPrimaryDelta(draftId: string, delta: DraftRealtimeDelta): Promise<void> {
    if (DRAFT_BEHAVIOR_CONTRACT.realtime.deliveryModel !== 'SNAPSHOT_PLUS_DELTA') {
      throw new Error('bad_state:Unsupported draft realtime delivery model');
    }

    await appendDraftDelta(draftId, delta);
    this.emitToDraftRooms(draftId, 'draft:delta', delta);
  }

  private async emitStatePatch(
    draftId: string,
    payload: DraftStatePatchDeltaPayload
  ): Promise<void> {
    await this.emitPrimaryDelta(draftId, {
      type: 'STATE_PATCH',
      eventId: buildStatePatchEventId(draftId, payload),
      payload,
      ts: Date.now(),
    });
  }

  private async dispatchToLocal(
    draftId: string,
    event: DraftRealtimeEventType,
    payload: unknown
  ): Promise<void> {
    if (!this.io) {
      logger.warn('Skipping realtime dispatch without attached Socket.IO server', {
        draftId,
        event,
      });
      return;
    }

    switch (event) {
      case 'draft:state': {
        const state = payload as LiveDraftState;
        const statePatch: DraftStatePatchDeltaPayload = {
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
            pickDeadlineAt:
              state.status === 'LIVE' ? toRealtimeIsoString(state.currentPick.expiresAt) : null,
          },
          liveState: {
            currentPick: state.currentPick.pickNumber,
            onClockTeamId: state.currentPick.memberId,
          },
        };

        await this.emitStatePatch(draftId, statePatch);
        this.emitToDraftRooms(draftId, 'draft:state', payload);
        this.emitToDraftRooms(draftId, 'draft:update', payload);
        return;
      }
      case 'draft:timer-tick': {
        const timerPayload = payload as DraftTimerTickPayload;
        await this.emitStatePatch(draftId, {
          liveState: {
            timeRemaining: timerPayload.timeRemaining,
          },
        });
        this.emitToDraftRooms(draftId, 'draft:timer-tick', timerPayload);
        this.emitToDraftRooms(draftId, 'draft:timer', { draftId, ...timerPayload });
        return;
      }
      case 'draft:timer-expired': {
        const timerExpiredPayload = payload as DraftTimerExpiredDeltaPayload;
        await this.emitPrimaryDelta(draftId, {
          type: 'TIMER_EXPIRED',
          eventId: buildTimerExpiredEventId(draftId, timerExpiredPayload),
          payload: timerExpiredPayload,
          ts: Date.now(),
        });
        this.emitToDraftRooms(draftId, 'draft:timer-expired', timerExpiredPayload);
        this.emitToDraftRooms(draftId, 'draft:timer:expired', timerExpiredPayload);
        return;
      }
      case 'draft:pick-made': {
        const pickPayload = payload as DraftPickEventPayload;
        await this.emitPrimaryDelta(draftId, {
          type: 'PICK_MADE',
          eventId: buildPickEventId(draftId, pickPayload),
          payload: { pick: pickPayload },
          ts: Date.now(),
        });
        this.emitToDraftRooms(draftId, 'draft:pick-made', payload);
        this.emitToDraftRooms(draftId, 'draft:pick', payload);
        this.emitToDraftRooms(draftId, 'pick:made', payload);
        return;
      }
      case 'draft:auto-pick': {
        const pickPayload = payload as DraftPickEventPayload;
        await this.emitPrimaryDelta(draftId, {
          type: 'PICK_MADE',
          eventId: buildPickEventId(draftId, pickPayload),
          payload: { pick: pickPayload },
          ts: Date.now(),
        });
        this.emitToDraftRooms(draftId, 'draft:auto-pick', payload);
        this.emitToDraftRooms(draftId, 'draft:pick', payload);
        return;
      }
      case 'draft:paused': {
        await this.emitStatePatch(draftId, {
          draft: {
            status: 'PAUSED',
          },
        });
        this.emitToDraftRooms(draftId, 'draft:paused', payload);
        this.emitToDraftRooms(draftId, 'draft:status', this.buildStatusPayload(draftId, 'PAUSED'));
        return;
      }
      case 'draft:resumed': {
        await this.emitStatePatch(draftId, {
          draft: {
            status: 'LIVE',
          },
        });
        this.emitToDraftRooms(draftId, 'draft:resumed', payload);
        this.emitToDraftRooms(draftId, 'draft:status', this.buildStatusPayload(draftId, 'LIVE'));
        return;
      }
      case 'draft:completed': {
        await this.emitStatePatch(draftId, {
          draft: {
            status: 'COMPLETED',
          },
        });
        this.emitToDraftRooms(draftId, 'draft:completed', payload);
        this.emitToDraftRooms(
          draftId,
          'draft:status',
          this.buildStatusPayload(draftId, 'COMPLETED')
        );
        return;
      }
      case 'draft:queue-updated': {
        const queuePayload = payload as DraftQueueUpdatedDeltaPayload;
        this.emitToDraftRooms(draftId, 'draft:queue-updated', { draftId, ...queuePayload });
        await this.emitPrimaryDelta(draftId, {
          type: 'QUEUE_UPDATED',
          eventId: buildQueueUpdatedEventId(draftId, queuePayload),
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
}

export const draftRealtimeDispatcher = new DraftRealtimeDispatcher();
