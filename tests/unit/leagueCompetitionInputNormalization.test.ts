import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/leagues/membership', () => ({}));

import { isValidLeagueMaxTeams } from '@/server/leagues/leagueCapacity';
import { parseLegacyPlayerIds } from '@/server/leagues/teamRosterReadModel';
import { normalizeFantasyCategoryKeys } from '@/types/fantasyCategories';

describe('league competition input normalization', () => {
  it('keeps only canonical, unique fantasy categories', () => {
    expect(normalizeFantasyCategoryKeys(['goals', 'unknown', 'goals', null, 'tackles'])).toEqual([
      'goals',
      'tackles',
    ]);
    expect(normalizeFantasyCategoryKeys(['unknown'], ['tackles'])).toEqual(['tackles']);
  });

  it('enforces the league-wide 4 to 18 team contract', () => {
    expect(isValidLeagueMaxTeams(4)).toBe(true);
    expect(isValidLeagueMaxTeams(18)).toBe(true);
    expect(isValidLeagueMaxTeams(19)).toBe(false);
  });

  it('drops invalid legacy roster IDs and preserves first-seen order', () => {
    expect(parseLegacyPlayerIds('[" player-2 ",null,"player-1","player-2","",42]')).toEqual([
      'player-2',
      'player-1',
    ]);
    expect(parseLegacyPlayerIds('not-json')).toEqual([]);
  });
});
