import { describe, expect, it, vi } from 'vitest';

import {
  DraftRealtimeJoinAckSchema,
  DraftRealtimeV2EventEnvelopeSchema,
  type DraftRealtimeJoinAck,
  type DraftRealtimeV2EventEnvelope,
} from '@/services/realtime/draftRealtimeV2';
import {
  DraftRealtimeV2Client,
  toDraftRealtimeV2ClientDelta,
  type DraftRealtimeV2ClientCommit,
} from '@/services/realtime/draftRealtimeV2Client';

const draftId = 'draft-1';
const leagueId = 'league-1';
const serverNow = '2026-08-01T10:00:00.000Z';

function event(
  sequence: number,
  eventId = `event-${sequence}`,
  stateRevision = sequence,
  targetLeagueId = leagueId
): DraftRealtimeV2EventEnvelope {
  return DraftRealtimeV2EventEnvelopeSchema.parse({
    v: 2,
    kind: 'event',
    eventId,
    draftId,
    leagueId: targetLeagueId,
    event: 'draft:resumed',
    sequence,
    stateRevision,
    occurredAt: serverNow,
    data: {
      event: {
        status: 'LIVE',
        schedulingVersion: stateRevision,
        durationSeconds: 120,
        serverNow,
        pickStartedAt: serverNow,
        pickDeadlineAt: '2026-08-01T10:02:00.000Z',
        pausedRemainingSeconds: null,
      },
    },
  });
}

function pickEvent(sequence: number): DraftRealtimeV2EventEnvelope {
  return DraftRealtimeV2EventEnvelopeSchema.parse({
    v: 2,
    kind: 'event',
    eventId: `pick-${sequence}`,
    draftId,
    leagueId,
    event: 'draft:pick-made',
    sequence,
    stateRevision: 11,
    occurredAt: '2026-08-01T10:00:08.000Z',
    data: {
      event: {
        id: 'pick-1',
        overall: 1,
        round: 1,
        slot: 1,
        player: { id: 'player-1', name: 'Player One', position: 'MID', club: 'Sydney' },
        member: { id: 'member-1', displayName: 'Tester' },
        auto: false,
        madeAt: '2026-08-01T10:00:08.000Z',
        timestamp: '2026-08-01T10:00:08.000Z',
        currentPick: 2,
        status: 'LIVE',
        nextRound: 1,
        nextDirection: 'FORWARD',
        pickStartedAt: '2026-08-01T10:00:08.000Z',
        pickDeadlineAt: '2026-08-01T10:01:45.000Z',
        schedulingVersion: 11,
        durationSeconds: 97,
        serverNow: '2026-08-01T10:00:09.250Z',
        isComplete: false,
      },
    },
  });
}

function acknowledgement(
  generation: number,
  replayEvents: DraftRealtimeV2EventEnvelope[] = [],
  snapshotIdentity: { sequence: number; revision: number; leagueId?: string } = {
    sequence: 0,
    revision: 0,
  }
): DraftRealtimeJoinAck {
  const throughSequence = replayEvents.at(-1)?.sequence ?? snapshotIdentity.sequence;
  const acknowledgementLeagueId = snapshotIdentity.leagueId ?? leagueId;
  return DraftRealtimeJoinAckSchema.parse({
    ok: true,
    draftId,
    leagueId: acknowledgementLeagueId,
    protocol: 2,
    generation,
    snapshot: {
      schemaVersion: 2,
      draftId,
      leagueId: acknowledgementLeagueId,
      revision: snapshotIdentity.revision,
      throughSequence: snapshotIdentity.sequence,
      serverNow,
      state: {
        name: 'Test Draft',
        status: 'LIVE',
        currentPick: 1,
        totalPicks: 24,
        round: 1,
        direction: 'FORWARD',
        clock: {
          status: 'LIVE',
          revision: snapshotIdentity.revision,
          durationSeconds: 120,
          serverNow,
          startedAt: serverNow,
          deadlineAt: '2026-08-01T10:02:00.000Z',
        },
        onClockMemberId: 'member-1',
        participants: [],
        picks: [],
      },
    },
    replay: {
      afterSequence: snapshotIdentity.sequence,
      throughSequence,
      events: replayEvents,
    },
  });
}

function makeClient() {
  const commits: DraftRealtimeV2ClientCommit[] = [];
  const onResyncRequired = vi.fn();
  const client = new DraftRealtimeV2Client({
    onCommit: (commit) => {
      commits.push(commit);
    },
    onResyncRequired,
  });
  return { client, commits, onResyncRequired };
}

describe('DraftRealtimeV2Client', () => {
  it('atomically commits snapshot, replay, and live events buffered before acknowledgement', () => {
    const harness = makeClient();
    const generation = harness.client.begin(draftId);
    harness.client.markJoinSent(generation);
    harness.client.receive(event(2));

    expect(
      harness.client.acceptJoinAcknowledgement(acknowledgement(generation, [event(1)]), generation)
    ).toEqual({
      status: 'ready',
    });
    expect(harness.commits).toHaveLength(1);
    expect(harness.commits[0]).toMatchObject({
      draftId,
      generation,
      snapshot: { throughSequence: 0 },
      throughSequence: 2,
    });
    expect(harness.commits[0]?.events.map((envelope) => envelope.sequence)).toEqual([1, 2]);
    expect(harness.client.getPhase()).toBe('ready');
  });

  it('deduplicates retries and requests resync on a live sequence gap', () => {
    const harness = makeClient();
    const generation = harness.client.begin(draftId);
    harness.client.markJoinSent(generation);
    harness.client.acceptJoinAcknowledgement(acknowledgement(generation, [event(1)]), generation);

    harness.client.receive(event(1));
    expect(harness.commits).toHaveLength(1);
    harness.client.receive(event(3));

    expect(harness.onResyncRequired).toHaveBeenCalledWith('sequence-gap');
    expect(harness.client.getPhase()).toBe('resyncing');
  });

  it('rejects conflicting duplicate identities at the same sequence', () => {
    const harness = makeClient();
    const generation = harness.client.begin(draftId);
    harness.client.markJoinSent(generation);
    harness.client.acceptJoinAcknowledgement(acknowledgement(generation, [event(1)]), generation);

    harness.client.receive(event(1, 'conflicting-event'));

    expect(harness.onResyncRequired).toHaveBeenCalledWith('conflicting-duplicate');
  });

  it('rejects a buffered event that conflicts with replay at the same sequence', () => {
    const harness = makeClient();
    const generation = harness.client.begin(draftId);
    harness.client.markJoinSent(generation);
    harness.client.receive(event(1, 'buffered-event'));

    expect(
      harness.client.acceptJoinAcknowledgement(
        acknowledgement(generation, [event(1, 'replayed-event')]),
        generation
      )
    ).toEqual({ status: 'resync' });
    expect(harness.commits).toHaveLength(0);
    expect(harness.onResyncRequired).toHaveBeenCalledWith('conflicting-duplicate');
  });

  it('ignores stale acknowledgements from an older generation', () => {
    const harness = makeClient();
    const first = harness.client.begin(draftId);
    const second = harness.client.begin(draftId);
    harness.client.markJoinSent(second);

    expect(harness.client.acceptJoinAcknowledgement(acknowledgement(first), first)).toEqual({
      status: 'stale',
    });
    expect(harness.commits).toHaveLength(0);
    expect(harness.client.acceptJoinAcknowledgement(acknowledgement(second), second)).toEqual({
      status: 'ready',
    });
  });

  it('allows bounded fallback only before the first v2 commit', () => {
    const harness = makeClient();
    const first = harness.client.begin(draftId);
    expect(harness.client.abandon(first)).toEqual({ draftId, generation: first });

    const second = harness.client.begin(draftId);
    harness.client.markJoinSent(second);
    harness.client.acceptJoinAcknowledgement(acknowledgement(second), second);
    const third = harness.client.begin(draftId);

    expect(harness.client.abandon(third)).toBeNull();
    expect(harness.client.isV2Owned()).toBe(true);
  });

  it('cannot accept a late acknowledgement after abandoning to v1', () => {
    const harness = makeClient();
    const generation = harness.client.begin(draftId);
    harness.client.markJoinSent(generation);
    harness.client.abandon(generation);

    expect(
      harness.client.acceptJoinAcknowledgement(acknowledgement(generation), generation)
    ).toEqual({ status: 'stale' });
    expect(harness.commits).toHaveLength(0);
  });

  it('rejects an equal-sequence resync snapshot with a lower state revision', () => {
    const harness = makeClient();
    const first = harness.client.begin(draftId);
    harness.client.markJoinSent(first);
    expect(
      harness.client.acceptJoinAcknowledgement(
        acknowledgement(first, [], { sequence: 5, revision: 7 }),
        first
      )
    ).toEqual({ status: 'ready' });

    const second = harness.client.begin(draftId);
    harness.client.markJoinSent(second);
    expect(
      harness.client.acceptJoinAcknowledgement(
        acknowledgement(second, [], { sequence: 5, revision: 6 }),
        second
      )
    ).toEqual({ status: 'resync' });

    expect(harness.commits).toHaveLength(1);
    expect(harness.onResyncRequired).toHaveBeenCalledWith('invalid-join');
  });

  it('pins league scope across same-draft resync acknowledgements', () => {
    const harness = makeClient();
    const first = harness.client.begin(draftId);
    harness.client.markJoinSent(first);
    harness.client.acceptJoinAcknowledgement(acknowledgement(first), first);
    const second = harness.client.begin(draftId);
    harness.client.markJoinSent(second);

    expect(
      harness.client.acceptJoinAcknowledgement(
        acknowledgement(second, [], { sequence: 0, revision: 0, leagueId: 'league-2' }),
        second
      )
    ).toEqual({ status: 'resync' });
    expect(harness.commits).toHaveLength(1);
    expect(harness.onResyncRequired).toHaveBeenCalledWith('invalid-join');
  });

  it('does not reapply a snapshot whose sequence and revision are already owned', () => {
    const harness = makeClient();
    const first = harness.client.begin(draftId);
    harness.client.markJoinSent(first);
    harness.client.acceptJoinAcknowledgement(
      acknowledgement(first, [], { sequence: 5, revision: 7 }),
      first
    );
    const second = harness.client.begin(draftId);
    harness.client.markJoinSent(second);

    expect(
      harness.client.acceptJoinAcknowledgement(
        acknowledgement(second, [], { sequence: 5, revision: 7 }),
        second
      )
    ).toEqual({ status: 'ready' });
    expect(harness.commits).toHaveLength(2);
    expect(harness.commits[1]?.snapshot).toBeUndefined();
  });

  it('retains applied event identities across an equal-boundary rejoin', () => {
    const harness = makeClient();
    const first = harness.client.begin(draftId);
    harness.client.markJoinSent(first);
    harness.client.acceptJoinAcknowledgement(acknowledgement(first), first);
    harness.client.receive(event(1, 'event-a', 1));

    const second = harness.client.begin(draftId);
    harness.client.markJoinSent(second);
    expect(
      harness.client.acceptJoinAcknowledgement(
        acknowledgement(second, [], { sequence: 1, revision: 1 }),
        second
      )
    ).toEqual({ status: 'ready' });
    expect(harness.commits[2]?.snapshot).toBeUndefined();

    harness.client.receive(event(1, 'event-b', 1));

    expect(harness.onResyncRequired).toHaveBeenCalledWith('conflicting-duplicate');
  });

  it('uses an equal-boundary snapshot to repair state after an applied event identity conflict', () => {
    const harness = makeClient();
    const first = harness.client.begin(draftId);
    harness.client.markJoinSent(first);
    harness.client.acceptJoinAcknowledgement(acknowledgement(first), first);
    harness.client.receive(event(1, 'event-a', 1));

    harness.client.receive(event(1, 'event-b', 1));
    expect(harness.onResyncRequired).toHaveBeenCalledWith('conflicting-duplicate');

    const second = harness.client.begin(draftId);
    harness.client.markJoinSent(second);
    expect(
      harness.client.acceptJoinAcknowledgement(
        acknowledgement(second, [], { sequence: 1, revision: 1 }),
        second
      )
    ).toEqual({ status: 'ready' });

    expect(harness.commits).toHaveLength(3);
    expect(harness.commits[2]?.snapshot).toMatchObject({
      throughSequence: 1,
      revision: 1,
    });
  });

  it('rejects live events from another league after accepting the baseline scope', () => {
    const harness = makeClient();
    const generation = harness.client.begin(draftId);
    harness.client.markJoinSent(generation);
    harness.client.acceptJoinAcknowledgement(acknowledgement(generation), generation);

    harness.client.receive(event(1, 'wrong-league-event', 1, 'league-2'));

    expect(harness.commits).toHaveLength(1);
    expect(harness.onResyncRequired).toHaveBeenCalledWith('invalid-event');
  });

  it('does not advance the live cursor when the consumer rejects a commit', () => {
    const commits: DraftRealtimeV2ClientCommit[] = [];
    const onResyncRequired = vi.fn();
    const client = new DraftRealtimeV2Client({
      onCommit: (commit) => {
        commits.push(commit);
        return Boolean(commit.snapshot) || commit.events.length === 0;
      },
      onResyncRequired,
    });
    const first = client.begin(draftId);
    client.markJoinSent(first);
    client.acceptJoinAcknowledgement(acknowledgement(first), first);

    client.receive(event(1));
    const second = client.begin(draftId);
    client.markJoinSent(second);

    expect(
      client.acceptJoinAcknowledgement(
        acknowledgement(second, [], { sequence: 0, revision: 0 }),
        second
      )
    ).toEqual({ status: 'ready' });
    expect(onResyncRequired).toHaveBeenCalledWith('invalid-event');
  });

  it('bounds the pre-acknowledgement buffer and notifies resync once per generation', () => {
    const harness = makeClient();
    const generation = harness.client.begin(draftId);
    harness.client.markJoinSent(generation);

    for (let sequence = 1; sequence <= 514; sequence += 1) {
      harness.client.receive(event(sequence));
    }

    expect(harness.onResyncRequired).toHaveBeenCalledTimes(1);
    expect(harness.onResyncRequired).toHaveBeenCalledWith('buffer-overflow');
    expect(harness.client.getPhase()).toBe('resyncing');
  });

  it('requests resync for malformed live input before applying a cursor', () => {
    const harness = makeClient();
    const generation = harness.client.begin(draftId);
    harness.client.markJoinSent(generation);

    harness.client.receive({ v: 2, draftId, sequence: 1 });

    expect(harness.onResyncRequired).toHaveBeenCalledWith('invalid-event');
    expect(harness.commits).toHaveLength(0);
  });

  it('maps lifecycle envelopes into the single context delta path', () => {
    expect(toDraftRealtimeV2ClientDelta(event(1))).toMatchObject({
      type: 'STATE_PATCH',
      revision: 1,
      payload: {
        draft: { status: 'LIVE' },
        liveState: { clock: { status: 'LIVE', revision: 1 } },
      },
    });
  });

  it('preserves the persisted pick duration and server-time anchor in the context delta', () => {
    expect(toDraftRealtimeV2ClientDelta(pickEvent(1))).toMatchObject({
      type: 'PICK_MADE',
      revision: 11,
      payload: {
        schedulingVersion: 11,
        durationSeconds: 97,
        serverNow: '2026-08-01T10:00:09.250Z',
        pickStartedAt: '2026-08-01T10:00:08.000Z',
        pickDeadlineAt: '2026-08-01T10:01:45.000Z',
      },
    });
  });
});
