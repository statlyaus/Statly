import { logger } from '@/lib/logger';

import type { DraftRealtimeV2EventEnvelope } from '@/services/realtime/draftRealtimeV2';

import { draftRepository } from '../repository/DraftRepository';
import { draftAuthorizedReadService } from './DraftAuthorizedReadService';
import { buildDraftRealtimeV2Envelope } from './DraftRealtimeEnvelopeService';

export const DEFAULT_DRAFT_REPLAY_LIMIT = 100;
export const MAX_DRAFT_REPLAY_LIMIT = 250;

export type DraftReplayResyncReason =
  'cursor-ahead' | 'invalid-boundary' | 'sequence-gap' | 'invalid-event';

export type DraftReplayResult =
  | {
      status: 'ready';
      schemaVersion: 2;
      draftId: string;
      leagueId: string;
      afterSequence: number;
      throughSequence: number;
      nextAfterSequence: number;
      hasMore: boolean;
      events: DraftRealtimeV2EventEnvelope[];
    }
  | {
      status: 'resync-required';
      draftId: string;
      afterSequence: number;
      throughSequence: number;
      reason: DraftReplayResyncReason;
    }
  | {
      status: 'not-found';
      draftId: string;
    };

function normalizeReplayLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_DRAFT_REPLAY_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_DRAFT_REPLAY_LIMIT) {
    throw new Error(`Draft replay limit must be between 1 and ${MAX_DRAFT_REPLAY_LIMIT}`);
  }
  return limit;
}

export class DraftRealtimeReplayService {
  async replayForMember(input: {
    draftId: string;
    authenticatedUserId: string;
    afterSequence: number;
    throughSequence?: number;
    limit?: number;
  }): Promise<DraftReplayResult> {
    if (!Number.isInteger(input.afterSequence) || input.afterSequence < 0) {
      throw new Error('Draft replay cursor must be a non-negative integer');
    }
    if (
      input.throughSequence !== undefined &&
      (!Number.isInteger(input.throughSequence) || input.throughSequence < 0)
    ) {
      throw new Error('Draft replay boundary must be a non-negative integer');
    }

    await draftAuthorizedReadService.authorizeMember(input.draftId, input.authenticatedUserId);
    const limit = normalizeReplayLimit(input.limit);
    const window = await draftRepository.transaction((tx) =>
      draftRepository.getDraftEventReplayWindow(tx, {
        draftId: input.draftId,
        afterSequence: input.afterSequence,
        throughSequence: input.throughSequence,
        limit,
      })
    );

    if (!window) {
      return { status: 'not-found', draftId: input.draftId };
    }
    if (input.afterSequence > window.currentHeadSequence) {
      return this.resync(input, window.throughSequence, 'cursor-ahead');
    }
    if (
      window.throughSequence > window.currentHeadSequence ||
      window.throughSequence < input.afterSequence
    ) {
      return this.resync(input, window.throughSequence, 'invalid-boundary');
    }

    const envelopes: DraftRealtimeV2EventEnvelope[] = [];
    let expectedSequence = input.afterSequence + 1;
    const pageEvents = window.events.slice(0, limit);

    for (const event of pageEvents) {
      if (event.sequence !== expectedSequence) {
        return this.resync(input, window.throughSequence, 'sequence-gap');
      }

      try {
        const envelope = buildDraftRealtimeV2Envelope(event);
        if (!envelope) {
          return this.resync(input, window.throughSequence, 'invalid-event');
        }
        envelopes.push(envelope);
      } catch (error) {
        logger.warn('Draft replay encountered an invalid durable event', {
          draftId: input.draftId,
          eventId: event.id,
          sequence: event.sequence,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.resync(input, window.throughSequence, 'invalid-event');
      }

      expectedSequence += 1;
    }

    const nextAfterSequence = expectedSequence - 1;
    const sentinel = window.events[limit];
    if (sentinel && sentinel.sequence !== expectedSequence) {
      return this.resync(input, window.throughSequence, 'sequence-gap');
    }
    const hasMore = nextAfterSequence < window.throughSequence;
    if (hasMore && !sentinel) {
      return this.resync(input, window.throughSequence, 'sequence-gap');
    }

    return {
      status: 'ready',
      schemaVersion: 2,
      draftId: input.draftId,
      leagueId: window.leagueId,
      afterSequence: input.afterSequence,
      throughSequence: window.throughSequence,
      nextAfterSequence,
      hasMore,
      events: envelopes,
    };
  }

  private resync(
    input: { draftId: string; afterSequence: number },
    throughSequence: number,
    reason: DraftReplayResyncReason
  ): DraftReplayResult {
    return {
      status: 'resync-required',
      draftId: input.draftId,
      afterSequence: input.afterSequence,
      throughSequence,
      reason,
    };
  }
}

export const draftRealtimeReplayService = new DraftRealtimeReplayService();
