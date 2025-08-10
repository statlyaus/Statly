import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { createPlayerStore, type PlayerStore } from './createPlayerStore';

type Side = 'left' | 'right';
interface TestPlayer {
  id: string;
  name: string;
}

const createTestStore = () =>
  create<PlayerStore<Side, TestPlayer>>(createPlayerStore<Side, TestPlayer>(['left', 'right']));

describe('createPlayerStore', () => {
  it('adds and removes players per side without duplicates', () => {
    const store = createTestStore();
    const p1 = { id: '1', name: 'A' };
    const p2 = { id: '2', name: 'B' };

    store.getState().add('left', p1);
    store.getState().add('left', p1); // duplicate ignored
    store.getState().add('right', p2);

    expect(store.getState().left).toHaveLength(1);
    expect(store.getState().right).toHaveLength(1);

    store.getState().remove('left', '1');
    expect(store.getState().left).toHaveLength(0);
  });

  it('clears all sides', () => {
    const store = createTestStore();
    store.getState().add('left', { id: '1', name: 'A' });
    store.getState().add('right', { id: '2', name: 'B' });

    store.getState().clear();
    expect(store.getState().left).toHaveLength(0);
    expect(store.getState().right).toHaveLength(0);
  });
});
