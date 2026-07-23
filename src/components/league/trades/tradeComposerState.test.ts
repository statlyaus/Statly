import { describe, expect, it } from 'vitest';

import type { TradePlayerDto } from '@/server/leagues/trades/tradeContracts';

import {
  createTradeComposerState,
  getPositionCounts,
  getPositionDeltas,
  getSelectedPlayers,
  isTradeSelectionComplete,
  tradeComposerReducer,
} from './tradeComposerState';

const players: TradePlayerDto[] = [
  { id: 'mid-one', name: 'Mid One', club: 'AAA', position: 'MID' },
  { id: 'forward', name: 'Forward', club: 'BBB', position: 'FWD' },
  { id: 'mid-two', name: 'Mid Two', club: 'CCC', position: 'MID' },
  { id: 'defender', name: 'Defender', club: 'DDD', position: 'DEF' },
];

describe('trade composer state', () => {
  it('creates the default edit state', () => {
    expect(createTradeComposerState({ partnerId: 'partner-one' })).toEqual({
      partnerId: 'partner-one',
      sendingPlayerIds: [],
      receivingPlayerIds: [],
      message: '',
      activeRoster: 'sending',
      step: 'edit',
    });
  });

  it('copies supplied selection arrays', () => {
    const sendingPlayerIds = ['send-one'];
    const receivingPlayerIds = ['receive-one'];
    const state = createTradeComposerState({
      partnerId: 'partner-one',
      sendingPlayerIds,
      receivingPlayerIds,
      message: 'A fair offer',
    });

    expect(state.sendingPlayerIds).toEqual(['send-one']);
    expect(state.receivingPlayerIds).toEqual(['receive-one']);
    expect(state.sendingPlayerIds).not.toBe(sendingPlayerIds);
    expect(state.receivingPlayerIds).not.toBe(receivingPlayerIds);

    sendingPlayerIds.push('send-two');
    receivingPlayerIds.push('receive-two');
    expect(state.sendingPlayerIds).toEqual(['send-one']);
    expect(state.receivingPlayerIds).toEqual(['receive-one']);
  });

  it('adds and removes sending players immutably', () => {
    const initial = createTradeComposerState({ partnerId: 'partner-one' });
    const selected = tradeComposerReducer(initial, {
      type: 'toggleSendingPlayer',
      playerId: 'send-one',
    });
    const deselected = tradeComposerReducer(selected, {
      type: 'toggleSendingPlayer',
      playerId: 'send-one',
    });

    expect(selected.sendingPlayerIds).toEqual(['send-one']);
    expect(selected.sendingPlayerIds).not.toBe(initial.sendingPlayerIds);
    expect(deselected.sendingPlayerIds).toEqual([]);
    expect(initial.sendingPlayerIds).toEqual([]);
  });

  it('adds and removes receiving players without leaving duplicates', () => {
    const initial = createTradeComposerState({
      partnerId: 'partner-one',
      receivingPlayerIds: ['receive-one', 'receive-one'],
    });
    const deselected = tradeComposerReducer(initial, {
      type: 'toggleReceivingPlayer',
      playerId: 'receive-one',
    });
    const selected = tradeComposerReducer(deselected, {
      type: 'toggleReceivingPlayer',
      playerId: 'receive-one',
    });

    expect(deselected.receivingPlayerIds).toEqual([]);
    expect(selected.receivingPlayerIds).toEqual(['receive-one']);
  });

  it('changes partner while retaining the sending package and message', () => {
    const state = createTradeComposerState({
      partnerId: 'partner-one',
      sendingPlayerIds: ['send-one'],
      receivingPlayerIds: ['receive-one'],
      message: 'Keep this note',
    });
    const reviewing = tradeComposerReducer(state, { type: 'review' });

    expect(
      tradeComposerReducer(reviewing, { type: 'selectPartner', partnerId: 'partner-two' })
    ).toEqual({
      partnerId: 'partner-two',
      sendingPlayerIds: ['send-one'],
      receivingPlayerIds: [],
      message: 'Keep this note',
      activeRoster: 'sending',
      step: 'edit',
    });
  });

  it('updates the message and active roster', () => {
    const state = createTradeComposerState({ partnerId: 'partner-one' });
    const withMessage = tradeComposerReducer(state, {
      type: 'setMessage',
      message: 'Would you consider this?',
    });

    expect(withMessage.message).toBe('Would you consider this?');
    expect(
      tradeComposerReducer(withMessage, { type: 'showRoster', roster: 'receiving' }).activeRoster
    ).toBe('receiving');
  });

  it('reviews only complete selections and can return to editing', () => {
    const incomplete = createTradeComposerState({
      partnerId: 'partner-one',
      sendingPlayerIds: ['send-one'],
    });
    const complete = createTradeComposerState({
      partnerId: 'partner-one',
      sendingPlayerIds: ['send-one'],
      receivingPlayerIds: ['receive-one'],
    });

    expect(tradeComposerReducer(incomplete, { type: 'review' }).step).toBe('edit');

    const reviewing = tradeComposerReducer(complete, { type: 'review' });
    expect(reviewing.step).toBe('review');
    expect(tradeComposerReducer(reviewing, { type: 'edit' }).step).toBe('edit');
  });

  it('clears both selections while preserving the partner and message', () => {
    const state = tradeComposerReducer(
      createTradeComposerState({
        partnerId: 'partner-one',
        sendingPlayerIds: ['send-one'],
        receivingPlayerIds: ['receive-one'],
        message: 'Keep this note',
      }),
      { type: 'review' }
    );

    expect(tradeComposerReducer(state, { type: 'clearSelections' })).toEqual({
      partnerId: 'partner-one',
      sendingPlayerIds: [],
      receivingPlayerIds: [],
      message: 'Keep this note',
      activeRoster: 'sending',
      step: 'edit',
    });
  });

  it('synchronizes valid selections by copying arrays and preserving the draft workflow', () => {
    const state = {
      ...createTradeComposerState({
        partnerId: 'partner-one',
        sendingPlayerIds: ['send-one', 'stale-send'],
        receivingPlayerIds: ['receive-one', 'stale-receive'],
        message: 'Keep this draft',
      }),
      activeRoster: 'receiving' as const,
      step: 'review' as const,
    };
    const sendingPlayerIds = ['send-one'];
    const receivingPlayerIds = ['receive-one'];

    const synchronized = tradeComposerReducer(state, {
      type: 'syncSelections',
      sendingPlayerIds,
      receivingPlayerIds,
    });

    expect(synchronized).toEqual({
      ...state,
      sendingPlayerIds: ['send-one'],
      receivingPlayerIds: ['receive-one'],
    });
    expect(synchronized.sendingPlayerIds).not.toBe(sendingPlayerIds);
    expect(synchronized.receivingPlayerIds).not.toBe(receivingPlayerIds);

    sendingPlayerIds.push('later-send');
    receivingPlayerIds.push('later-receive');
    expect(synchronized.sendingPlayerIds).toEqual(['send-one']);
    expect(synchronized.receivingPlayerIds).toEqual(['receive-one']);
  });

  it('reinitializes the proposal atomically when the deep-link tuple changes', () => {
    const state = {
      ...createTradeComposerState({
        partnerId: 'partner-one',
        sendingPlayerIds: ['old-send'],
        receivingPlayerIds: ['old-receive'],
        message: 'Message for the previous proposal',
      }),
      activeRoster: 'receiving' as const,
      step: 'review' as const,
    };

    expect(
      tradeComposerReducer(state, {
        type: 'initializeDeepLink',
        partnerId: 'partner-two',
        sendingPlayerIds: [],
        receivingPlayerIds: ['new-receive'],
      })
    ).toEqual(
      createTradeComposerState({
        partnerId: 'partner-two',
        receivingPlayerIds: ['new-receive'],
      })
    );
  });

  it('resets the composer while preserving only the partner', () => {
    const state = {
      ...createTradeComposerState({
        partnerId: 'partner-one',
        sendingPlayerIds: ['send-one'],
        receivingPlayerIds: ['receive-one'],
        message: 'Remove this note',
      }),
      activeRoster: 'receiving' as const,
      step: 'review' as const,
    };

    expect(tradeComposerReducer(state, { type: 'reset' })).toEqual(
      createTradeComposerState({ partnerId: 'partner-one' })
    );
  });
});

describe('trade composer selectors', () => {
  it('reports whether both trade packages contain a player', () => {
    expect(isTradeSelectionComplete(createTradeComposerState({ partnerId: 'partner-one' }))).toBe(
      false
    );
    expect(
      isTradeSelectionComplete(
        createTradeComposerState({
          partnerId: 'partner-one',
          sendingPlayerIds: ['send-one'],
          receivingPlayerIds: ['receive-one'],
        })
      )
    ).toBe(true);
  });

  it('filters selected players while preserving roster order and inputs', () => {
    const selectedIds = ['defender', 'mid-one', 'missing'];
    const rosterSnapshot = [...players];

    expect(getSelectedPlayers(players, selectedIds)).toEqual([players[0], players[3]]);
    expect(players).toEqual(rosterSnapshot);
    expect(selectedIds).toEqual(['defender', 'mid-one', 'missing']);
  });

  it('counts players by position', () => {
    expect(getPositionCounts(players)).toEqual({ MID: 2, FWD: 1, DEF: 1 });
    expect(getPositionCounts([])).toEqual({});
  });

  it('counts prototype-named positions in package totals and deltas', () => {
    const specialPositions: TradePlayerDto[] = [
      { id: 'constructor', name: 'Constructor', club: 'AAA', position: 'constructor' },
      { id: 'to-string', name: 'To String', club: 'BBB', position: 'toString' },
      { id: 'proto', name: 'Proto', club: 'CCC', position: '__proto__' },
    ];

    expect(getPositionCounts(specialPositions)).toEqual(
      Object.fromEntries([
        ['constructor', 1],
        ['toString', 1],
        ['__proto__', 1],
      ])
    );
    expect(
      getPositionDeltas(specialPositions.slice(0, 2), [specialPositions[0], specialPositions[2]])
    ).toEqual(
      Object.fromEntries([
        ['constructor', 0],
        ['toString', -1],
        ['__proto__', 1],
      ])
    );
  });

  it('calculates incoming-minus-outgoing deltas across every position', () => {
    const outgoing = [players[0], players[1], players[2]];
    const incoming = [players[0], players[1], players[3], { ...players[3], id: 'defender-two' }];

    expect(getPositionDeltas(outgoing, incoming)).toEqual({
      MID: -1,
      FWD: 0,
      DEF: 2,
    });
  });
});
