import { describe, expect, it } from 'vitest';
import {
  EIGHT_CATEGORY_PRESET,
  NINE_CATEGORY_PRESET,
  YAHOO_DEFAULT_ROSTER_SLOTS,
  countRosterSpots,
  countStarterSlots,
  formatNbaSeason,
  getBasketballCategory,
  isBasketballCategoryId,
} from './basketball';

describe('basketball catalog', () => {
  it('has nine categories, with turnovers the only low-wins one', () => {
    expect(NINE_CATEGORY_PRESET).toHaveLength(9);
    const lowWins = NINE_CATEGORY_PRESET.filter(
      (id) => getBasketballCategory(id).direction === 'LOW_WINS',
    );
    expect(lowWins).toEqual(['TO']);
  });

  it('builds the 8-category preset by removing turnovers', () => {
    expect(EIGHT_CATEGORY_PRESET).toHaveLength(8);
    expect(EIGHT_CATEGORY_PRESET).not.toContain('TO');
  });

  it('compares percentage categories as makes over attempts', () => {
    expect(getBasketballCategory('FG_PCT')).toMatchObject({
      kind: 'PERCENT',
      made: 'fieldGoalsMade',
      attempted: 'fieldGoalsAttempted',
    });
  });

  it('recognises only catalog ids', () => {
    expect(isBasketballCategoryId('BLK')).toBe(true);
    expect(isBasketballCategoryId('blk')).toBe(false);
    expect(isBasketballCategoryId(undefined)).toBe(false);
  });

  it('counts Yahoo default starters and roster spots', () => {
    expect(countStarterSlots(YAHOO_DEFAULT_ROSTER_SLOTS)).toBe(10);
    expect(countRosterSpots(YAHOO_DEFAULT_ROSTER_SLOTS)).toBe(13);
  });

  it('names a season by the year it ends', () => {
    expect(formatNbaSeason(2027)).toBe('2026-27');
    expect(formatNbaSeason(2000)).toBe('1999-00');
  });
});
