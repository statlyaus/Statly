import { describe, expect, it } from 'vitest';
import {
  normalizeRosterPlayerIds,
  parseRosterPlayerIds,
  summarizeRosterPlayerIdDuplicates,
} from '../rosterPlayerIds';

describe('roster player id helpers', () => {
  it('preserves first-seen order while removing duplicate player ids', () => {
    expect(normalizeRosterPlayerIds(['p3', 'p1', 'p3', 'p2', 'p1'])).toEqual([
      'p3',
      'p1',
      'p2',
    ]);
  });

  it('parses valid roster JSON and normalizes duplicate ids', () => {
    expect(parseRosterPlayerIds('["p1","p2","p1",3]')).toEqual(['p1', 'p2', '3']);
  });

  it('returns an empty list for invalid or non-array roster JSON', () => {
    expect(parseRosterPlayerIds('{"p1":true}')).toEqual([]);
    expect(parseRosterPlayerIds('not json')).toEqual([]);
    expect(parseRosterPlayerIds(null)).toEqual([]);
  });

  it('summarizes duplicate ids for diagnostics without exposing full rosters', () => {
    expect(summarizeRosterPlayerIdDuplicates(['p1', 'p2', 'p1', 'p3', 'p2'])).toEqual({
      duplicateCount: 2,
      duplicateIds: ['p1', 'p2'],
      originalCount: 5,
      uniqueCount: 3,
    });
  });
});
