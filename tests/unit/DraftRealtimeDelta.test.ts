import { describe, expect, it } from 'vitest';

import {
  buildDraftLifecycleDelta,
  buildDraftPickDelta,
  toDraftBackfillDelta,
} from '@/server/draft/services/DraftRealtimeDelta';

const eventCreatedAt = new Date('2026-06-08T00:00:05.000Z');

function pickPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pick-3',
    overall: 3,
    round: 1,
    slot: 3,
    player: {
      id: 'player-3',
      name: 'Jordan Dawson',
      position: 'DEF',
      club: 'Adelaide',
    },
    member: {
      id: 'member-3',
      displayName: 'Footy Fanatics',
    },
    auto: false,
    madeAt: '2026-06-08T00:00:05.000Z',
    timestamp: eventCreatedAt,
    currentPick: 4,
    status: 'LIVE',
    nextRound: 1,
    nextDirection: 'FORWARD',
    pickStartedAt: '2026-06-08T00:00:05.000Z',
    pickDeadlineAt: '2026-06-08T00:02:05.000Z',
    schedulingVersion: 8,
    isComplete: false,
    privateQueue: ['player-secret'],
    ...overrides,
  };
}

function lifecyclePayload(overrides: Record<string, unknown> = {}) {
  return {
    status: 'LIVE',
    schedulingVersion: 8,
    durationSeconds: 120,
    serverNow: '2026-06-08T00:00:05.000Z',
    pickStartedAt: '2026-06-08T00:00:05.000Z',
    pickDeadlineAt: '2026-06-08T00:02:05.000Z',
    pausedRemainingSeconds: null,
    ...overrides,
  };
}

describe('DraftRealtimeDelta', () => {
  it('emits the same public pick shape for live delivery and persisted replay', () => {
    const payload = pickPayload();
    const liveDelta = buildDraftPickDelta(payload, eventCreatedAt.getTime());
    const replayDelta = toDraftBackfillDelta({
      event: 'draft:pick-made',
      payload: JSON.stringify(payload),
      createdAt: eventCreatedAt,
    });

    expect(replayDelta).toEqual(liveDelta);
    expect(liveDelta).toEqual({
      type: 'PICK_MADE',
      payload: {
        pick: {
          id: 'pick-3',
          overall: 3,
          round: 1,
          slot: 3,
          player: {
            id: 'player-3',
            name: 'Jordan Dawson',
            position: 'DEF',
            club: 'Adelaide',
          },
          member: {
            id: 'member-3',
            displayName: 'Footy Fanatics',
          },
          auto: false,
          madeAt: '2026-06-08T00:00:05.000Z',
          timestamp: '2026-06-08T00:00:05.000Z',
        },
        currentPick: 4,
        isComplete: false,
        status: 'LIVE',
        round: 1,
        direction: 'FORWARD',
        pickStartedAt: '2026-06-08T00:00:05.000Z',
        pickDeadlineAt: '2026-06-08T00:02:05.000Z',
        schedulingVersion: 8,
      },
      ts: eventCreatedAt.getTime(),
      revision: 8,
    });
    expect((liveDelta?.payload as { pick: Record<string, unknown> }).pick).not.toHaveProperty(
      'privateQueue'
    );
    expect((liveDelta?.payload as { pick: Record<string, unknown> }).pick).not.toHaveProperty(
      'currentPick'
    );
  });

  it.each(['draft:started', 'draft:resumed'])(
    'maps %s through the same revisioned LIVE clock contract',
    (event) => {
      const payload = lifecyclePayload();

      expect(
        toDraftBackfillDelta({
          event,
          payload: JSON.stringify(payload),
          createdAt: eventCreatedAt,
        })
      ).toEqual(buildDraftLifecycleDelta(payload, 'LIVE'));
    }
  );

  it('maps a persisted pause to a revisioned frozen clock', () => {
    const payload = lifecyclePayload({
      status: 'PAUSED',
      schedulingVersion: 9,
      pickStartedAt: null,
      pickDeadlineAt: null,
      pausedRemainingSeconds: 37,
    });

    expect(
      toDraftBackfillDelta({
        event: 'draft:paused',
        payload: JSON.stringify(payload),
        createdAt: eventCreatedAt,
      })
    ).toEqual({
      type: 'STATE_PATCH',
      payload: {
        draft: {
          status: 'PAUSED',
          pickDeadlineAt: null,
        },
        liveState: {
          clock: {
            status: 'PAUSED',
            revision: 9,
            durationSeconds: 120,
            serverNow: '2026-06-08T00:00:05.000Z',
            remainingSeconds: 37,
          },
          revision: 9,
        },
      },
      ts: eventCreatedAt.getTime(),
      revision: 9,
    });
  });

  it('fails closed for malformed or unrevisioned lifecycle events', () => {
    expect(
      toDraftBackfillDelta({
        event: 'draft:started',
        payload: JSON.stringify({ status: 'LIVE' }),
        createdAt: eventCreatedAt,
      })
    ).toBeNull();
    expect(
      toDraftBackfillDelta({
        event: 'draft:paused',
        payload: '{not-json',
        createdAt: eventCreatedAt,
      })
    ).toBeNull();
  });

  it('strips unknown persisted fields instead of replaying private state', () => {
    const replayDelta = toDraftBackfillDelta({
      event: 'draft:auto-pick',
      payload: JSON.stringify(pickPayload()),
      createdAt: eventCreatedAt,
    });

    expect(JSON.stringify(replayDelta)).not.toContain('player-secret');
    expect(replayDelta).toMatchObject({
      type: 'PICK_MADE',
      revision: 8,
    });
  });
});
