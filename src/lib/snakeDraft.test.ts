import { describe, it, expect } from 'vitest';
import { computeSnakeState, generateSnakeDraftOrder } from './snakeDraft';

describe('computeSnakeState', () => {
  it('computes round, direction and slot correctly', () => {
    expect(computeSnakeState(1, 3)).toEqual({ round: 1, direction: 'FORWARD', slot: 1 });
    expect(computeSnakeState(3, 3)).toEqual({ round: 1, direction: 'FORWARD', slot: 3 });
    expect(computeSnakeState(4, 3)).toEqual({ round: 2, direction: 'REVERSE', slot: 3 });
    expect(computeSnakeState(6, 3)).toEqual({ round: 2, direction: 'REVERSE', slot: 1 });
    expect(computeSnakeState(7, 3)).toEqual({ round: 3, direction: 'FORWARD', slot: 1 });
  });
});

describe('generateSnakeDraftOrder', () => {
  it('generates order for given teams and roster size', () => {
    const order = generateSnakeDraftOrder(3, 2);
    expect(order).toEqual([
      [1, 2, 3],
      [3, 2, 1],
    ]);
  });
});
