import { beforeEach, describe, expect, it } from 'vitest';
import { useTradeStore } from './tradeStore';
import type { Player } from '@/types/players';

const createPlayer = (id: string, name = 'Player'): Player => ({ id, name });

describe('tradeStore', () => {
  beforeEach(() => {
    useTradeStore.setState({
      myTeamKey: null,
      targetTeamKey: null,
      rosters: {},
      incoming: [],
      outgoing: [],
    });
  });

  it('setMyTeam and setTargetTeam update keys correctly', () => {
    const store = useTradeStore.getState();
    store.setMyTeam('team1');
    store.setTargetTeam('team2');

    expect(useTradeStore.getState().myTeamKey).toBe('team1');
    expect(useTradeStore.getState().targetTeamKey).toBe('team2');
  });

  it('seedRoster populates the rosters map', () => {
    const players = [createPlayer('1'), createPlayer('2')];
    const store = useTradeStore.getState();
    store.seedRoster('t1', players);

    expect(useTradeStore.getState().rosters['t1']).toEqual(players);
  });

  it('clearAll resets store state', () => {
    const p = createPlayer('1');
    const store = useTradeStore.getState();
    store.setMyTeam('mine');
    store.setTargetTeam('yours');
    store.seedRoster('mine', [p]);
    store.add('incoming', p);
    store.add('outgoing', p);

    store.clearAll();

    const state = useTradeStore.getState();
    expect(state.myTeamKey).toBeNull();
    expect(state.targetTeamKey).toBeNull();
    expect(state.rosters).toEqual({});
    expect(state.incoming).toHaveLength(0);
    expect(state.outgoing).toHaveLength(0);
  });
});
