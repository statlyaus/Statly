import { logger } from '@/lib/logger';
import {
  draftPubSub,
  type DraftRealtimeEnvelope,
  type DraftRealtimeEventType,
} from '@/services/realtime/pubsub';
import type { DraftRealtimeV2EventEnvelope } from '@/services/realtime/draftRealtimeV2';
import {
  toDraftRealtimeStatePayload,
  type CanonicalLiveDraftState,
  type DraftRealtimeStatePayload,
} from '@/services/realtime/draftStateWire';

import type { DraftLifecycleEventPayload, DraftPickEventPayload } from '../domain/draftTypes';
import {
  buildDraftLifecycleDelta,
  buildDraftPickDelta,
  type DraftRealtimeDelta,
} from './DraftRealtimeDelta';
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

export class DraftRealtimeDispatcher {
  private io: SocketIOServer | null = null;
  private subscriberStarted = false;
  private subscriptionPromise: Promise<void> | null = null;

  attachSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  async startSubscription(): Promise<void> {
    if (this.subscriberStarted) {
      return;
    }
    if (this.subscriptionPromise) {
      return this.subscriptionPromise;
    }

    const attempt = draftPubSub
      .start((msg) => {
        this.dispatchEnvelope(msg);
      })
      .then(() => {
        this.subscriberStarted = true;
      });
    this.subscriptionPromise = attempt;
    try {
      await attempt;
    } finally {
      if (this.subscriptionPromise === attempt) {
        this.subscriptionPromise = null;
      }
    }
  }

  async publishState(state: CanonicalLiveDraftState): Promise<void> {
    const payload = toDraftRealtimeStatePayload(state);
    this.dispatchToLocal(state.draftId, 'draft:state', payload);
    await draftPubSub.publish(state.draftId, 'draft:state', payload);
  }

  async publishV2Event(envelope: DraftRealtimeV2EventEnvelope): Promise<void> {
    this.dispatchV2ToLocal(envelope);
    await draftPubSub.publishV2(envelope);
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
    if (msg.v === 2) {
      this.dispatchV2ToLocal(msg.message);
      return;
    }

    this.dispatchToLocal(msg.draftId, msg.event, msg.payload);
  }

  private dispatchV2ToLocal(envelope: DraftRealtimeV2EventEnvelope): void {
    if (!this.io) {
      logger.debug('Skipping local sequenced realtime emit without attached Socket.IO server', {
        draftId: envelope.draftId,
        event: envelope.event,
        sequence: envelope.sequence,
      });
      return;
    }

    this.io.local.to(`draft:${envelope.draftId}`).emit('draft:event:v2', envelope);
  }

  private emitToDraftRooms(draftId: string, event: string, payload: unknown): void {
    this.io?.local.to(draftId).emit(event, payload);
    this.io?.local.to(`draft:${draftId}`).emit(event, payload);
  }

  private emitCompatDelta(draftId: string, delta: DraftRealtimeDelta): void {
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
        const delta = buildDraftPickDelta(pickPayload, Date.now());
        if (delta) this.emitCompatDelta(draftId, delta);
        return;
      }
      case 'draft:auto-pick': {
        const pickPayload = payload as DraftPickEventPayload;
        this.emitToDraftRooms(draftId, 'draft:auto-pick', payload);
        this.emitToDraftRooms(draftId, 'draft:pick', payload);
        const delta = buildDraftPickDelta(pickPayload, Date.now());
        if (delta) this.emitCompatDelta(draftId, delta);
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
    const delta = buildDraftLifecycleDelta(payload, expectedStatus);
    if (delta) this.emitCompatDelta(draftId, delta);
  }
}

export const draftRealtimeDispatcher = new DraftRealtimeDispatcher();
