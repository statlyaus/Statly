import { logger } from '@/lib/logger';
import { revalidateTags } from '@/lib/cache';
import { tags } from '@/lib/cacheTags';
import { publishLeagueSystemMessage } from '@/server/leagues/social/socialSystemEvents';

import { draftRepository } from '../repository/DraftRepository';
import { draftRealtimeDispatcher } from './DraftRealtimeDispatcher';
import { draftProjectionService } from './DraftProjectionService';

import type {
  DraftCommandEventType,
  DraftCommandResult,
  DraftLifecycleEventPayload,
  DraftOutboxEventRecord,
  DraftPickEventPayload,
} from '../domain/draftTypes';
import type { CanonicalLiveDraftState } from '@/services/realtime/draftStateWire';

function isDraftPickEventPayload(payload: unknown): payload is DraftPickEventPayload {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'player' in payload &&
    'member' in payload &&
    'overall' in payload
  );
}

function isDraftLifecycleEventPayload(payload: unknown): payload is DraftLifecycleEventPayload {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'status' in payload &&
    'schedulingVersion' in payload &&
    'durationSeconds' in payload &&
    'serverNow' in payload
  );
}

export class DraftRealtimePublisher {
  private readonly lockerId = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  private readonly claimTtlMs = Number(process.env.DRAFT_EVENT_CLAIM_TTL_MS || 15000);

  private async emitEvent(record: DraftOutboxEventRecord): Promise<void> {
    const { draftId, event, payload } = record;

    switch (event) {
      case 'draft:pick-made':
      case 'draft:auto-pick':
        if (isDraftPickEventPayload(payload)) {
          await draftRealtimeDispatcher.publishDraftEvent(draftId, event, payload);
        } else {
          logger.warn('Skipping draft pick event without payload', { draftId, event });
        }
        return;
      case 'draft:paused':
      case 'draft:resumed':
        await draftRealtimeDispatcher.publishDraftEvent(
          draftId,
          event,
          isDraftLifecycleEventPayload(payload) ? payload : undefined
        );
        return;
      case 'draft:completed':
        await draftRealtimeDispatcher.publishDraftEvent(draftId, event);
        return;
      case 'draft:started':
      case 'draft:queue-updated':
        return;
      default: {
        const exhaustiveCheck: never = event;
        return exhaustiveCheck;
      }
    }
  }

  private async loadOutboxEvents(eventIds: string[]): Promise<DraftOutboxEventRecord[]> {
    return draftRepository.transaction((tx) => draftRepository.listDraftEventsByIds(tx, eventIds));
  }

  private async claimDraftEventsByIds(eventIds: string[]): Promise<DraftOutboxEventRecord[]> {
    if (eventIds.length === 0) {
      return [];
    }

    return draftRepository.transaction(async (tx) => {
      await draftRepository.releaseStaleDraftEventClaims(
        tx,
        new Date(Date.now() - this.claimTtlMs)
      );
      await draftRepository.claimDraftEvents(tx, {
        eventIds,
        lockerId: this.lockerId,
        lockedAt: new Date(),
      });
      return draftRepository.listClaimedDraftEvents(tx, {
        lockerId: this.lockerId,
        eventIds,
      });
    });
  }

  private async claimPendingDraftEvents(draftId: string): Promise<DraftOutboxEventRecord[]> {
    return draftRepository.transaction(async (tx) => {
      await draftRepository.releaseStaleDraftEventClaims(
        tx,
        new Date(Date.now() - this.claimTtlMs)
      );
      const pending = await draftRepository.listPendingDraftEvents(tx, draftId);
      const eventIds = pending.map((event) => event.id);
      await draftRepository.claimDraftEvents(tx, {
        eventIds,
        lockerId: this.lockerId,
        lockedAt: new Date(),
      });
      return draftRepository.listClaimedDraftEvents(tx, {
        lockerId: this.lockerId,
        draftId,
      });
    });
  }

  private async claimPendingDraftEventsBatch(limit: number): Promise<DraftOutboxEventRecord[]> {
    return draftRepository.transaction(async (tx) => {
      await draftRepository.releaseStaleDraftEventClaims(
        tx,
        new Date(Date.now() - this.claimTtlMs)
      );
      const pending = await draftRepository.listPendingDraftEventsBatch(tx, limit);
      const eventIds = pending.map((event) => event.id);
      await draftRepository.claimDraftEvents(tx, {
        eventIds,
        lockerId: this.lockerId,
        lockedAt: new Date(),
      });
      return draftRepository.listClaimedDraftEvents(tx, {
        lockerId: this.lockerId,
        eventIds,
      });
    });
  }

  private async markOutboxPublished(eventIds: string[]): Promise<void> {
    await draftRepository.transaction((tx) =>
      draftRepository.markDraftEventsPublished(tx, eventIds)
    );
  }

  private async markOutboxFailed(eventIds: string[], errorMessage: string): Promise<void> {
    await draftRepository.transaction((tx) =>
      draftRepository.markDraftEventsFailed(tx, eventIds, errorMessage)
    );
  }

  private async publishSocialDraftActivity(events: DraftOutboxEventRecord[]): Promise<void> {
    const pickEvents = events.filter(
      (
        event
      ): event is DraftOutboxEventRecord & {
        payload: DraftPickEventPayload;
      } =>
        (event.event === 'draft:pick-made' || event.event === 'draft:auto-pick') &&
        isDraftPickEventPayload(event.payload)
    );
    if (pickEvents.length === 0) return;

    await Promise.all(
      pickEvents.map((event) =>
        publishLeagueSystemMessage({
          leagueId: event.leagueId,
          eventType: 'PLAYER_DRAFTED',
          relatedEntityId: event.payload.id || event.id,
          content: `${event.payload.member.displayName} drafted ${event.payload.player.name}.`,
        })
      )
    );
  }

  private async drainOutboxEvents(
    events: DraftOutboxEventRecord[]
  ): Promise<CanonicalLiveDraftState | null> {
    if (events.length === 0) {
      return null;
    }

    let publishedState: CanonicalLiveDraftState | null = null;

    for (const event of events) {
      await this.emitEvent(event);

      if (event.publishState) {
        const state = await draftProjectionService.buildAuthoritativeDraftState(event.draftId);
        if (!state) {
          throw new Error(`Draft state unavailable for outbox publish: ${event.draftId}`);
        }

        await draftRealtimeDispatcher.publishState(state);
        publishedState = state;
      }
    }

    return publishedState;
  }

  async publishCommandResult<TData>(
    result: DraftCommandResult<TData>
  ): Promise<CanonicalLiveDraftState | null> {
    const outboxEvents = await this.claimDraftEventsByIds(result.outboxEventIds);

    let state: CanonicalLiveDraftState | null = null;
    try {
      state = await this.drainOutboxEvents(outboxEvents);
      await this.publishSocialDraftActivity(outboxEvents);
      await this.markOutboxPublished(outboxEvents.map((event) => event.id));
    } catch (error) {
      await this.markOutboxFailed(
        outboxEvents.map((event) => event.id),
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }

    await revalidateTags([tags.draft(result.leagueId), tags.league(result.leagueId)]).catch(
      (error) => {
        logger.warn('Failed to revalidate draft realtime publisher tags', {
          draftId: result.draftId,
          leagueId: result.leagueId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    );

    return state;
  }

  async flushPendingDraftEvents(draftId: string): Promise<CanonicalLiveDraftState | null> {
    const outboxEvents = await this.claimPendingDraftEvents(draftId);
    if (outboxEvents.length === 0) {
      return null;
    }

    try {
      const state = await this.drainOutboxEvents(outboxEvents);
      await this.publishSocialDraftActivity(outboxEvents);
      await this.markOutboxPublished(outboxEvents.map((event) => event.id));
      return state;
    } catch (error) {
      await this.markOutboxFailed(
        outboxEvents.map((event) => event.id),
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async flushPendingDraftEventsBatch(limit = 50): Promise<number> {
    const outboxEvents = await this.claimPendingDraftEventsBatch(limit);
    if (outboxEvents.length === 0) {
      return 0;
    }

    try {
      await this.drainOutboxEvents(outboxEvents);
      await this.publishSocialDraftActivity(outboxEvents);
      await this.markOutboxPublished(outboxEvents.map((event) => event.id));
      return outboxEvents.length;
    } catch (error) {
      await this.markOutboxFailed(
        outboxEvents.map((event) => event.id),
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async publishDraftState(draftId: string): Promise<CanonicalLiveDraftState | null> {
    const state = await draftProjectionService.buildAuthoritativeDraftState(draftId);
    if (!state) {
      logger.warn('Unable to publish authoritative draft state', { draftId });
      return null;
    }

    await draftRealtimeDispatcher.publishState(state);
    return state;
  }

  async publishDraftEvent(
    draftId: string,
    event: Exclude<DraftCommandEventType, 'draft:started' | 'draft:queue-updated'>,
    payload?: DraftPickEventPayload | DraftLifecycleEventPayload
  ): Promise<CanonicalLiveDraftState | null> {
    if (event === 'draft:pick-made' || event === 'draft:auto-pick') {
      if (isDraftPickEventPayload(payload)) {
        await draftRealtimeDispatcher.publishDraftEvent(draftId, event, payload);
      } else {
        logger.warn('Skipping compatibility draft pick event without payload', { draftId, event });
      }
    } else if (event === 'draft:paused' || event === 'draft:resumed') {
      await draftRealtimeDispatcher.publishDraftEvent(
        draftId,
        event,
        isDraftLifecycleEventPayload(payload) ? payload : undefined
      );
    } else {
      await draftRealtimeDispatcher.publishDraftEvent(draftId, event);
    }

    return this.publishDraftState(draftId);
  }
}

export const draftRealtimePublisher = new DraftRealtimePublisher();
