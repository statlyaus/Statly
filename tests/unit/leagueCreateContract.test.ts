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
      scoringMode: 'H2H_EACH_CATEGORY',
      fixtureGenerationMode: 'AUTOMATIC',
      lineupSlots: {
        FWD: 5,
        DEF: 5,
        MID: 5,
        RUC: 1,
        UTIL: 3,
      },
      categoryDirections: Object.fromEntries(
        REAL_DATA_NINE_CATEGORY_PRESET.map((category) => [category, 'HIGH_WINS'])
      ),
    });
  });

  it('normalizes scoring mode, lineup slots, and category direction overrides', () => {
    expect(
      normalizeCreateLeagueInput({
        name: 'Test Lab Alpha',
        scoringMode: 'H2H_MOST_CATEGORIES',
        fixtureGenerationMode: 'MANUAL',
        categories: ['goals', 'clangers'],
        lineupSlots: { FWD: 4, DEF: 4, MID: 5, RUC: 1, UTIL: 2 },
        categoryDirections: { clangers: 'LOW_WINS' },
      })
    ).toMatchObject({
      scoringMode: 'H2H_MOST_CATEGORIES',
      fixtureGenerationMode: 'MANUAL',
      lineupSlots: {
        FWD: 4,
        DEF: 4,
        MID: 5,
        RUC: 1,
        UTIL: 2,
      },
      categoryDirections: {
        goals: 'HIGH_WINS',
        clangers: 'LOW_WINS',
      },
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
