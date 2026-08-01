import {
  DraftRealtimeJoinAckSchema,
  parseDraftRealtimeV2EventEnvelope,
  type DraftLifecycleEventPayloadV2,
  type DraftPickEventPayloadV2,
  type DraftRealtimeJoinAck,
  type DraftRealtimeSnapshotV2,
  type DraftRealtimeV2EventEnvelope,
} from '@/services/realtime/draftRealtimeV2';

export type DraftRealtimeV2ClientPhase = 'idle' | 'negotiating' | 'syncing' | 'ready' | 'resyncing';

export type DraftRealtimeV2ClientCommit = {
  draftId: string;
  generation: number;
  snapshot?: DraftRealtimeSnapshotV2;
  events: DraftRealtimeV2EventEnvelope[];
  throughSequence: number;
};

export type DraftRealtimeV2ClientDelta = {
  type: 'PICK_MADE' | 'STATE_PATCH';
  payload: unknown;
  ts: number;
  revision: number;
};

export type DraftRealtimeV2JoinOutcome =
  | { status: 'ready' }
  | { status: 'fallback'; reason: 'protocol-v1' | 'unsupported' }
  | { status: 'failed'; acknowledgement: Extract<DraftRealtimeJoinAck, { ok: false }> }
  | { status: 'stale' }
  | { status: 'resync' };

type DraftRealtimeV2ClientOptions = {
  onCommit: (commit: DraftRealtimeV2ClientCommit) => boolean | void;
  onResyncRequired: (reason: DraftRealtimeV2ResyncReason) => void;
};

type DraftRealtimeV2ResyncReason =
  'sequence-gap' | 'conflicting-duplicate' | 'invalid-join' | 'invalid-event' | 'buffer-overflow';

const MAX_TRACKED_EVENT_IDENTITIES = 512;
const MAX_BUFFERED_EVENTS = 512;

export class DraftRealtimeV2Client {
  private phase: DraftRealtimeV2ClientPhase = 'idle';
  private draftId: string | null = null;
  private leagueId: string | null = null;
  private generation = 0;
  private throughSequence = 0;
  private stateRevision = 0;
  private v2Owned = false;
  private requireSnapshotForCurrentJoin = false;
  private requireSnapshotForNextJoin = false;
  private resyncNotifiedGeneration = 0;
  private readonly buffered = new Map<number, DraftRealtimeV2EventEnvelope>();
  private readonly eventIdentityBySequence = new Map<number, string>();
  private readonly onCommit: DraftRealtimeV2ClientOptions['onCommit'];
  private readonly onResyncRequired: DraftRealtimeV2ClientOptions['onResyncRequired'];

  constructor(options: DraftRealtimeV2ClientOptions) {
    this.onCommit = options.onCommit;
    this.onResyncRequired = options.onResyncRequired;
  }

  begin(draftId: string): number {
    this.generation += 1;
    this.draftId = draftId;
    this.requireSnapshotForCurrentJoin = this.requireSnapshotForNextJoin;
    this.requireSnapshotForNextJoin = false;
    this.phase = this.v2Owned ? 'resyncing' : 'negotiating';
    this.resyncNotifiedGeneration = 0;
    this.buffered.clear();
    return this.generation;
  }

  markJoinSent(generation: number): void {
    if (generation !== this.generation || this.phase === 'idle') return;
    this.phase = this.v2Owned ? 'resyncing' : 'syncing';
  }

  receive(value: unknown): void {
    const envelope = parseDraftRealtimeV2EventEnvelope(value);
    if (!envelope) {
      if (this.phase !== 'idle') this.requireResync('invalid-event');
      return;
    }
    if (envelope.draftId !== this.draftId || this.phase === 'idle') return;
    if (this.leagueId && envelope.leagueId !== this.leagueId) {
      this.requireResync('invalid-event');
      return;
    }

    if (envelope.sequence <= this.throughSequence) {
      const knownEventId = this.eventIdentityBySequence.get(envelope.sequence);
      if (knownEventId && knownEventId !== envelope.eventId) {
        this.requireResync('conflicting-duplicate');
      }
      return;
    }

    if (this.phase !== 'ready') {
      const buffered = this.buffered.get(envelope.sequence);
      if (buffered && buffered.eventId !== envelope.eventId) {
        this.requireResync('conflicting-duplicate');
        return;
      }
      this.buffered.set(envelope.sequence, envelope);
      if (this.buffered.size > MAX_BUFFERED_EVENTS) this.requireResync('buffer-overflow');
      return;
    }

    if (envelope.sequence !== this.throughSequence + 1) {
      this.requireResync('sequence-gap');
      return;
    }
    if (envelope.stateRevision < this.stateRevision) {
      this.requireResync('invalid-event');
      return;
    }

    const accepted = this.onCommit({
      draftId: envelope.draftId,
      generation: this.generation,
      events: [envelope],
      throughSequence: envelope.sequence,
    });
    if (accepted === false) {
      this.requireResync('invalid-event');
      return;
    }
    this.throughSequence = envelope.sequence;
    this.stateRevision = envelope.stateRevision;
    this.rememberEvent(envelope);
  }

  acceptJoinAcknowledgement(value: unknown, generation: number): DraftRealtimeV2JoinOutcome {
    if (
      generation !== this.generation ||
      !this.draftId ||
      (this.phase !== 'syncing' && this.phase !== 'resyncing')
    ) {
      return { status: 'stale' };
    }
    const parsed = DraftRealtimeJoinAckSchema.safeParse(value);
    if (!parsed.success || parsed.data.draftId !== this.draftId) {
      this.requireResync('invalid-join');
      return { status: 'resync' };
    }

    const acknowledgement = parsed.data;
    if (!acknowledgement.ok) {
      if (!this.v2Owned && acknowledgement.code === 'UNSUPPORTED_PROTOCOL') {
        this.phase = 'idle';
        return { status: 'fallback', reason: 'unsupported' };
      }
      return { status: 'failed', acknowledgement };
    }
    if (acknowledgement.protocol === 1) {
      if (this.v2Owned) {
        this.requireResync('invalid-join');
        return { status: 'resync' };
      }
      this.phase = 'idle';
      return { status: 'fallback', reason: 'protocol-v1' };
    }
    if (acknowledgement.generation !== generation) return { status: 'stale' };
    if (this.v2Owned && this.leagueId && acknowledgement.leagueId !== this.leagueId) {
      this.requireResync('invalid-join');
      return { status: 'resync' };
    }
    if (
      this.v2Owned &&
      (acknowledgement.snapshot.throughSequence < this.throughSequence ||
        acknowledgement.snapshot.revision < this.stateRevision)
    ) {
      this.requireResync('invalid-join');
      return { status: 'resync' };
    }

    const stream = [...acknowledgement.replay.events];
    const buffered = [...this.buffered.values()].sort(
      (left, right) => left.sequence - right.sequence
    );
    const replayIdentityBySequence = new Map(
      acknowledgement.replay.events.map((envelope) => [envelope.sequence, envelope.eventId])
    );
    for (const envelope of buffered) {
      if (envelope.sequence <= acknowledgement.replay.throughSequence) {
        const replayEventId = replayIdentityBySequence.get(envelope.sequence);
        if (replayEventId && replayEventId !== envelope.eventId) {
          this.requireResync('conflicting-duplicate');
          return { status: 'resync' };
        }
        continue;
      }
      stream.push(envelope);
    }

    let expected = acknowledgement.snapshot.throughSequence + 1;
    let expectedRevision = acknowledgement.snapshot.revision;
    const uniqueStream: DraftRealtimeV2EventEnvelope[] = [];
    const sequenceIdentities = new Map<number, string>();
    for (const envelope of stream) {
      if (
        envelope.draftId !== acknowledgement.draftId ||
        envelope.leagueId !== acknowledgement.leagueId
      ) {
        this.requireResync('invalid-join');
        return { status: 'resync' };
      }
      const known = sequenceIdentities.get(envelope.sequence);
      if (known) {
        if (known !== envelope.eventId) {
          this.requireResync('conflicting-duplicate');
          return { status: 'resync' };
        }
        continue;
      }
      if (envelope.sequence !== expected) {
        this.requireResync('sequence-gap');
        return { status: 'resync' };
      }
      if (envelope.stateRevision < expectedRevision) {
        this.requireResync('invalid-event');
        return { status: 'resync' };
      }
      sequenceIdentities.set(envelope.sequence, envelope.eventId);
      uniqueStream.push(envelope);
      expected += 1;
      expectedRevision = envelope.stateRevision;
    }

    const shouldApplySnapshot = !(
      this.v2Owned &&
      !this.requireSnapshotForCurrentJoin &&
      acknowledgement.snapshot.throughSequence === this.throughSequence &&
      acknowledgement.snapshot.revision === this.stateRevision
    );
    const accepted = this.onCommit({
      draftId: acknowledgement.draftId,
      generation,
      ...(shouldApplySnapshot ? { snapshot: acknowledgement.snapshot } : {}),
      events: uniqueStream,
      throughSequence: expected - 1,
    });
    if (accepted === false) {
      this.requireResync('invalid-event');
      return { status: 'resync' };
    }
    this.buffered.clear();
    this.throughSequence = expected - 1;
    this.stateRevision = expectedRevision;
    this.leagueId = acknowledgement.leagueId;
    this.v2Owned = true;
    this.requireSnapshotForCurrentJoin = false;
    this.phase = 'ready';
    if (shouldApplySnapshot) this.eventIdentityBySequence.clear();
    for (const envelope of uniqueStream) this.rememberEvent(envelope);
    return { status: 'ready' };
  }

  abandon(generation: number): { draftId: string; generation: number } | null {
    if (generation !== this.generation || this.v2Owned || !this.draftId) return null;
    const abandoned = { draftId: this.draftId, generation };
    this.generation += 1;
    this.phase = 'idle';
    this.requireSnapshotForCurrentJoin = false;
    this.requireSnapshotForNextJoin = false;
    this.buffered.clear();
    return abandoned;
  }

  getPhase(): DraftRealtimeV2ClientPhase {
    return this.phase;
  }

  getGeneration(): number {
    return this.generation;
  }

  isV2Owned(): boolean {
    return this.v2Owned;
  }

  private requireResync(reason: DraftRealtimeV2ResyncReason): void {
    if (reason === 'conflicting-duplicate') {
      this.requireSnapshotForNextJoin = true;
    }
    this.phase = 'resyncing';
    this.buffered.clear();
    if (this.resyncNotifiedGeneration === this.generation) return;
    this.resyncNotifiedGeneration = this.generation;
    this.onResyncRequired(reason);
  }

  private rememberEvent(envelope: DraftRealtimeV2EventEnvelope): void {
    this.eventIdentityBySequence.set(envelope.sequence, envelope.eventId);
    while (this.eventIdentityBySequence.size > MAX_TRACKED_EVENT_IDENTITIES) {
      const oldest = this.eventIdentityBySequence.keys().next().value;
      if (oldest === undefined) break;
      this.eventIdentityBySequence.delete(oldest);
    }
  }
}

export function toDraftRealtimeV2ClientDelta(
  envelope: DraftRealtimeV2EventEnvelope
): DraftRealtimeV2ClientDelta | null {
  if (
    envelope.event === 'draft:pick-made' ||
    envelope.event === 'draft:auto-pick' ||
    envelope.event === 'draft:completed'
  ) {
    const event = envelope.data.event as DraftPickEventPayloadV2;
    return {
      type: 'PICK_MADE',
      payload: {
        pick: event,
        currentPick: event.currentPick,
        isComplete: event.isComplete,
        status: event.status,
        round: event.nextRound,
        direction: event.nextDirection,
        pickStartedAt: event.pickStartedAt,
        pickDeadlineAt: event.pickDeadlineAt,
        schedulingVersion: event.schedulingVersion,
        durationSeconds: event.durationSeconds,
        serverNow: event.serverNow,
      },
      ts: Date.parse(envelope.occurredAt),
      revision: envelope.stateRevision,
    };
  }

  const event = envelope.data.event as DraftLifecycleEventPayloadV2;
  const clock =
    event.status === 'LIVE' && event.pickStartedAt && event.pickDeadlineAt
      ? {
          status: 'LIVE' as const,
          revision: event.schedulingVersion,
          durationSeconds: event.durationSeconds,
          serverNow: event.serverNow,
          startedAt: event.pickStartedAt,
          deadlineAt: event.pickDeadlineAt,
        }
      : event.status === 'PAUSED' && event.pausedRemainingSeconds !== null
        ? {
            status: 'PAUSED' as const,
            revision: event.schedulingVersion,
            durationSeconds: event.durationSeconds,
            serverNow: event.serverNow,
            remainingSeconds: event.pausedRemainingSeconds,
          }
        : null;
  if (!clock) return null;

  return {
    type: 'STATE_PATCH',
    payload: {
      draft: {
        status: event.status,
        pickDeadlineAt: clock.status === 'LIVE' ? clock.deadlineAt : null,
      },
      liveState: {
        clock,
        revision: clock.revision,
      },
    },
    ts: Date.parse(envelope.occurredAt),
    revision: envelope.stateRevision,
  };
}
