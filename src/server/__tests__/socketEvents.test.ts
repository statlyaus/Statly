import { describe, it, expect, afterEach } from 'vitest';
import { draftSocket, emitDraftPick, type DraftPick } from '../socketEvents';

afterEach(() => {
  draftSocket.removeAllListeners();
});

describe('draft socket events', () => {
  it('emits draftPick events with payload', () => {
    const received: DraftPick[] = [];
    draftSocket.on('draftPick', (pick) => received.push(pick));

    const pick = { team: 1, player: 'PlayerA' };
    emitDraftPick(pick);

    expect(received).toEqual([pick]);
  });
});
