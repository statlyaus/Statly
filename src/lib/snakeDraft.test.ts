import { describe, it, expect } from 'vitest';

import { computeSnakeState, generateSnakeDraftOrder } from './snakeDraft';

describe('computeSnakeState', () => {
  it('handles odd and even rounds correctly', () => {
    expect(computeSnakeState(1, 3)).toEqual({ round: 1, direction: 'FORWARD', slot: 1 });
    expect(computeSnakeState(3, 3)).toEqual({ round: 1, direction: 'FORWARD', slot: 3 });
    expect(computeSnakeState(4, 3)).toEqual({ round: 2, direction: 'REVERSE', slot: 3 });
    expect(computeSnakeState(6, 3)).toEqual({ round: 2, direction: 'REVERSE', slot: 1 });
    expect(computeSnakeState(7, 3)).toEqual({ round: 3, direction: 'FORWARD', slot: 1 });
  });

  it('validates input', () => {
    expect(() => computeSnakeState(0, 3)).toThrow();
    expect(() => computeSnakeState(1, 0)).toThrow();
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

  it('includes bench rounds', () => {
    const order = generateSnakeDraftOrder(3, 2, 1);
    expect(order).toEqual([
      [1, 2, 3],
      [3, 2, 1],
      [1, 2, 3],
    ]);
  });

  it('validates input', () => {
    expect(() => generateSnakeDraftOrder(0, 1)).toThrow('teamCount must be positive');
    expect(() => generateSnakeDraftOrder(2, -1)).toThrow(
      'starterSize must be a non-negative integer'
    );
    expect(() => generateSnakeDraftOrder(2, 1, -1)).toThrow(
      'benchSize must be a non-negative integer'
    );
  });
});
