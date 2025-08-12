import { describe, it, expect } from 'vitest';
import { computeSnakeState } from '../snakeDraft';

describe('computeSnakeState', () => {
  it('calculates round, direction and slot', () => {
    expect(computeSnakeState(1, 3)).toEqual({ round: 1, direction: 'FORWARD', slot: 1 });
    expect(computeSnakeState(3, 3)).toEqual({ round: 1, direction: 'FORWARD', slot: 3 });
    expect(computeSnakeState(4, 3)).toEqual({ round: 2, direction: 'REVERSE', slot: 3 });
  });

  it('throws on invalid input', () => {
    expect(() => computeSnakeState(0, 3)).toThrow();
    expect(() => computeSnakeState(1, 0)).toThrow();
  });
});
