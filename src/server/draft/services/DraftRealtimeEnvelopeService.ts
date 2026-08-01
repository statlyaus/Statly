import {
  DraftRealtimeV2EventEnvelopeSchema,
  type DraftRealtimeV2EventEnvelope,
} from '@/services/realtime/draftRealtimeV2';
import {
  toDraftRealtimeStatePayload,
  type CanonicalLiveDraftState,
} from '@/services/realtime/draftStateWire';

import type { DraftOutboxEventRecord } from '../domain/draftTypes';

function readPersistedStateRevision(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || !('schedulingVersion' in payload)) {
    return null;
  }

  const revision = payload.schedulingVersion;
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0
    ? revision
    : null;
}

/**
 * Maps one durable public outbox row to exactly one sequenced v2 envelope. Legacy rows without a
 * sequence predate the v2 stream and intentionally have no representation in it.
 */
export function buildDraftRealtimeV2Envelope(
  record: DraftOutboxEventRecord,
  state: CanonicalLiveDraftState | null = null
): DraftRealtimeV2EventEnvelope | null {
  if (record.sequence == null) {
    return null;
  }
  if (record.event === 'draft:queue-updated') {
    throw new Error(`Private draft event cannot consume shared sequence ${record.sequence}`);
  }
  if (!record.payload) {
    throw new Error(`Sequenced draft event is missing its persisted payload: ${record.id}`);
  }
  if (record.publishState && record.clockRevision === null) {
    throw new Error(`Sequenced state intent is missing its clock revision: ${record.id}`);
  }

  const payloadRevision = readPersistedStateRevision(record.payload);
  const revisions = [payloadRevision, record.clockRevision, state?.clock.revision].filter(
    (revision): revision is number => revision !== null && revision !== undefined
  );
  const [stateRevision] = revisions;
  if (stateRevision === undefined) {
    throw new Error(`Sequenced draft event is missing its state revision: ${record.id}`);
  }
  if (revisions.some((revision) => revision !== stateRevision)) {
    throw new Error(`Sequenced draft event has conflicting state revisions: ${record.id}`);
  }

  return DraftRealtimeV2EventEnvelopeSchema.parse({
    v: 2,
    kind: 'event',
    eventId: record.id,
    draftId: record.draftId,
    leagueId: record.leagueId,
    event: record.event,
    sequence: record.sequence,
    stateRevision,
    occurredAt: record.createdAt.toISOString(),
    data: {
      event: record.payload,
      ...(state ? { state: toDraftRealtimeStatePayload(state) } : {}),
    },
  });
}
