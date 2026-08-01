import { describe, expect, it } from 'vitest';

import { getDraftPickCoordinate, type DraftOrderType } from '@/lib/draftOrder';

describe('getDraftPickCoordinate', () => {
  it('reverses slot order on even snake rounds', () => {
    expect(getDraftPickCoordinate('SNAKE', 6, 6)).toEqual({
      round: 1,
      slot: 6,
      direction: 'FORWARD',
    });
    expect(getDraftPickCoordinate('SNAKE', 7, 6)).toEqual({
      round: 2,
      slot: 6,
      direction: 'REVERSE',
    });
    expect(getDraftPickCoordinate('SNAKE', 12, 6)).toEqual({
      round: 2,
      slot: 1,
      direction: 'REVERSE',
    });
  });

  it('keeps slot order forward on every linear round', () => {
    expect(getDraftPickCoordinate('LINEAR', 7, 6)).toEqual({
      round: 2,
      slot: 1,
      direction: 'FORWARD',
    });
    expect(getDraftPickCoordinate('LINEAR', 12, 6)).toEqual({
      round: 2,
      slot: 6,
      direction: 'FORWARD',
    });
  });

  it('supports one-team drafts while preserving the configured order direction', () => {
    expect(getDraftPickCoordinate('SNAKE', 2, 1)).toEqual({
      round: 2,
      slot: 1,
      direction: 'REVERSE',
    });
    expect(getDraftPickCoordinate('LINEAR', 2, 1)).toEqual({
      round: 2,
      slot: 1,
      direction: 'FORWARD',
    });
  });

  it.each([
    ['SNAKE', 0, 6],
    ['SNAKE', 1.5, 6],
    ['LINEAR', 1, 0],
    ['LINEAR', 1, 2.5],
  ] as const)('rejects invalid coordinates for %s pick %s with %s teams', (type, pick, teams) => {
    expect(() => getDraftPickCoordinate(type, pick, teams)).toThrow();
  });

  it('rejects an unsupported runtime draft type', () => {
    expect(() => getDraftPickCoordinate('AUCTION' as DraftOrderType, 1, 6)).toThrow(
      'Unsupported draft order type: AUCTION'
    );
  });
});
