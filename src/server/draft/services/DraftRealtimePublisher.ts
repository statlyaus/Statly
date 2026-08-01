import { logger } from '@/lib/logger';
import { revalidateTags } from '@/lib/cache';
import { tags } from '@/lib/cacheTags';
import { publishLeagueSystemMessage } from '@/server/leagues/social/socialSystemEvents';
import { incCounter, METRICS } from '@/server/metrics';
import type { CanonicalLiveDraftState } from '@/services/realtime/draftStateWire';

import { draftRepository } from '../repository/DraftRepository';
import { draftClockCoordinator } from './DraftClockCoordinator';
import { buildDraftRealtimeV2Envelope } from './DraftRealtimeEnvelopeService';
import { draftRealtimeDispatcher } from './DraftRealtimeDispatcher';
import { draftProjectionService } from './DraftProjectionService';

import type {
  DraftCommandEventType,
  DraftCommandResult,
  DraftLifecycleEventPayload,
  DraftOutboxEventRecord,
  DraftPickEventPayload,
} from '../domain/draftTypes';

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

  private recordFlush(
    source: 'command' | 'draft' | 'batch',
    outcome: 'empty' | 'success' | 'failed',
    eventCount: number
  ): void {
    incCounter(METRICS.draftOutboxFlushes, 1, { source, outcome });
    if (eventCount > 0 && outcome !== 'empty') {
      incCounter(METRICS.draftOutboxEvents, eventCount, {
        outcome: outcome === 'success' ? 'published' : 'failed',
      });
    }
  }

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
      case 'draft:clock-repaired':
      case 'draft:queue-updated':
        return;
      default: {
        const exhaustiveCheck: never = event;
        return exhaustiveCheck;
      }
    }
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

  private async buildSchedulingReadyState(
    draftId: string
  ): Promise<CanonicalLiveDraftState | null> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const ready = await draftClockCoordinator.ensureReady(draftId);
      const state = await draftProjectionService.buildAuthoritativeDraftState(draftId);
      if (!state || state.status !== 'LIVE') {
        return state;
      }
      if (ready.receipt?.token.stateRevision === state.clock.revision) {
        return state;
      }

      logger.info('Retrying realtime state preparation after a concurrent clock transition', {
        draftId,
        attempt,
        scheduledRevision: ready.receipt?.token.stateRevision,
        projectedRevision: state.clock.revision,
      });
      incCounter(METRICS.draftRealtimeStatePreparationRetries, 1, {
        reason: 'concurrent_clock_transition',
      });
    }

    throw new Error(`Draft changed while preparing schedulable realtime state: ${draftId}`);
  }

  private async prepareStateIntent(
    event: DraftOutboxEventRecord
  ): Promise<CanonicalLiveDraftState | null> {
    const state = await this.buildSchedulingReadyState(event.draftId);
    if (!state) {
      throw new Error(`Draft state unavailable for outbox publish: ${event.draftId}`);
    }

    if (event.clockRevision !== null && event.clockRevision !== state.clock.revision) {
      logger.info('Skipping stale outbox state intent after coordinating the current clock', {
        draftId: event.draftId,
        sequence: event.sequence,
        eventRevision: event.clockRevision,
        currentRevision: state.clock.revision,
      });
      return null;
    }

    return state;
  }

  private async drainOutboxEvents(
    events: DraftOutboxEventRecord[]
  ): Promise<CanonicalLiveDraftState | null> {
    if (events.length === 0) {
      return null;
    }

    let publishedState: CanonicalLiveDraftState | null = null;

    for (const event of events) {
      const state = event.publishState ? await this.prepareStateIntent(event) : null;
      await this.emitEvent(event);
      const envelope = buildDraftRealtimeV2Envelope(event, state);
      if (envelope) {
        await draftRealtimeDispatcher.publishV2Event(envelope);
      }

      if (state) {
        await draftRealtimeDispatcher.publishState(state);
        publishedState = state;
      }
    }

    return publishedState;
  }

  async publishCommandResult<TData>(
    result: DraftCommandResult<TData>
  ): Promise<CanonicalLiveDraftState | null> {
    const outboxEvents = await this.claimPendingDraftEvents(result.draftId);

    let state: CanonicalLiveDraftState | null = null;
    try {
      state = await this.drainOutboxEvents(outboxEvents);
      await this.publishSocialDraftActivity(outboxEvents);
      await this.markOutboxPublished(outboxEvents.map((event) => event.id));
      this.recordFlush(
        'command',
        outboxEvents.length === 0 ? 'empty' : 'success',
        outboxEvents.length
      );
    } catch (error) {
      this.recordFlush('command', 'failed', outboxEvents.length);
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
      this.recordFlush('draft', 'empty', 0);
      return null;
    }

    try {
      const state = await this.drainOutboxEvents(outboxEvents);
      await this.publishSocialDraftActivity(outboxEvents);
      await this.markOutboxPublished(outboxEvents.map((event) => event.id));
      this.recordFlush('draft', 'success', outboxEvents.length);
      return state;
    } catch (error) {
      this.recordFlush('draft', 'failed', outboxEvents.length);
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
      this.recordFlush('batch', 'empty', 0);
      return 0;
    }

    try {
      await this.drainOutboxEvents(outboxEvents);
      await this.publishSocialDraftActivity(outboxEvents);
      await this.markOutboxPublished(outboxEvents.map((event) => event.id));
      this.recordFlush('batch', 'success', outboxEvents.length);
      return outboxEvents.length;
    } catch (error) {
      this.recordFlush('batch', 'failed', outboxEvents.length);
      await this.markOutboxFailed(
        outboxEvents.map((event) => event.id),
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async publishDraftState(draftId: string): Promise<CanonicalLiveDraftState | null> {
    const state = await this.buildSchedulingReadyState(draftId);
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
    const state = await this.buildSchedulingReadyState(draftId);

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
    } else if (event !== 'draft:clock-repaired') {
      await draftRealtimeDispatcher.publishDraftEvent(draftId, event);
    }

    if (!state) {
      logger.warn('Unable to publish authoritative draft state after event', { draftId, event });
      return null;
    }

    await draftRealtimeDispatcher.publishState(state);
    return state;
  }
}

export const draftRealtimePublisher = new DraftRealtimePublisher();
