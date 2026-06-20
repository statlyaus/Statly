import { describe, expect, it } from 'vitest';

import {
  normalizeCreateLeagueInput,
  normalizeCreateLeagueResponse,
} from '../../src/server/leagues/createLeagueContract';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../src/types/fantasyCategories';

describe('league creation contract', () => {
  it('normalizes the current new-league form payload into canonical API input', () => {
    expect(
      normalizeCreateLeagueInput({
        name: 'Test Lab Alpha',
        teamCount: 12,
        scoringFormat: 'category',
        privacy: 'private',
      })
    ).toMatchObject({
      name: 'Test Lab Alpha',
      maxTeams: 12,
      categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
      visibility: 'PRIVATE',
      timeZone: 'UTC',
    });
  });

  it('keeps valid league creation time zones', () => {
    expect(
      normalizeCreateLeagueInput({
        name: 'Test Lab Alpha',
        timeZone: 'Australia/Melbourne',
      })
    ).toMatchObject({
      timeZone: 'Australia/Melbourne',
    });
  });

  it('defaults invalid league creation time zones to UTC', () => {
    expect(
      normalizeCreateLeagueInput({
        name: 'Test Lab Alpha',
        timeZone: 'Mars/Olympus_Mons',
      })
    ).toMatchObject({
      timeZone: 'UTC',
    });
  });

  it('extracts created league id from the API success envelope', () => {
    expect(normalizeCreateLeagueResponse({ success: true, data: { id: 'league-123' } })).toEqual({
      id: 'league-123',
    });
  });
});
