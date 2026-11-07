import { describe, expect, it } from 'vitest';

import { YAHOO_DEFAULT_ROSTER_SLOTS } from '@/types/basketball';

import {
  createLeagueSchema,
  leaguePatchSchema,
  leagueSettingsSchema,
  parseInput,
  playerSearchSchema,
  rosterEntriesSchema,
  rosterSpotPatchSchema,
  teamsSchema,
  weekSchema,
} from './basketballLeagueValidation';

const validCreate = {
  name: 'REC Bible',
  platform: 'YAHOO',
  format: 'H2H_MOST_CATEGORIES',
  categories: ['FG_PCT', 'FT_PCT', 'THREES', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'],
  teamCount: 12,
  rosterSlots: YAHOO_DEFAULT_ROSTER_SLOTS,
  weekOneStartsOn: '2026-10-19',
  regularSeasonEndsOn: '2027-04-11',
  myTeamName: 'Bobby Buckets',
};

function fieldErrorsOf(run: () => unknown): Record<string, string[]> {
  try {
    run();
  } catch (error) {
    return (error as { details: { fieldErrors: Record<string, string[]> } }).details.fieldErrors;
  }
  throw new Error('expected a validation error');
}

function formErrorsOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    return (error as { details: { formErrors: string[] } }).details.formErrors;
  }
  throw new Error('expected a validation error');
}

describe('createLeagueSchema', () => {
  it('accepts a standard Yahoo 9-cat league and fills the optional fields', () => {
    const parsed = parseInput(createLeagueSchema, validCreate);

    expect(parsed.puntCategories).toEqual([]);
    expect(parsed.otherTeamNames).toEqual([]);
    expect(parsed.auctionBudget).toBeNull();
  });

  it('trims names and rejects blank or over-long ones', () => {
    expect(parseInput(createLeagueSchema, { ...validCreate, name: '  REC  ' }).name).toBe('REC');
    expect(
      fieldErrorsOf(() => parseInput(createLeagueSchema, { ...validCreate, name: '   ' }))
    ).toHaveProperty('name');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, myTeamName: 'x'.repeat(61) })
      )
    ).toHaveProperty('myTeamName');
  });

  it('rejects roto and unknown platforms', () => {
    const errors = fieldErrorsOf(() =>
      parseInput(createLeagueSchema, { ...validCreate, format: 'ROTO', platform: 'CBS' })
    );
    expect(Object.keys(errors).sort()).toEqual(['format', 'platform']);
  });

  it('needs at least one known category, each listed once', () => {
    expect(
      fieldErrorsOf(() => parseInput(createLeagueSchema, { ...validCreate, categories: [] }))
    ).toHaveProperty('categories');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, categories: ['PTS', 'DD'] })
      )
    ).toHaveProperty('categories.1');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, categories: ['PTS', 'PTS'] })
      )
    ).toHaveProperty('categories');
  });

  it('only punts categories the league counts, and never all of them', () => {
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, {
          ...validCreate,
          categories: ['PTS', 'REB'],
          puntCategories: ['TO'],
        })
      )
    ).toHaveProperty('puntCategories');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, {
          ...validCreate,
          categories: ['PTS', 'REB'],
          puntCategories: ['PTS', 'REB'],
        })
      )
    ).toHaveProperty('puntCategories');
    expect(
      parseInput(createLeagueSchema, { ...validCreate, puntCategories: ['FT_PCT', 'TO'] })
        .puntCategories
    ).toEqual(['FT_PCT', 'TO']);
  });

  it('keeps team count between 2 and 30', () => {
    for (const teamCount of [1, 31, 12.5]) {
      expect(
        fieldErrorsOf(() => parseInput(createLeagueSchema, { ...validCreate, teamCount }))
      ).toHaveProperty('teamCount');
    }
  });

  it('bounds roster slots: 0–10 each, at least one starter, 25 in total', () => {
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, {
          ...validCreate,
          rosterSlots: { ...YAHOO_DEFAULT_ROSTER_SLOTS, BN: 11 },
        })
      )
    ).toHaveProperty('rosterSlots.BN');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, {
          ...validCreate,
          rosterSlots: { PG: 0, SG: 0, G: 0, SF: 0, PF: 0, F: 0, C: 0, UTIL: 0, BN: 10, IL: 3 },
        })
      )
    ).toHaveProperty('rosterSlots');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, {
          ...validCreate,
          rosterSlots: { ...YAHOO_DEFAULT_ROSTER_SLOTS, UTIL: 10, BN: 10 },
        })
      )
    ).toHaveProperty('rosterSlots');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, {
          ...validCreate,
          rosterSlots: { ...YAHOO_DEFAULT_ROSTER_SLOTS, BENCH: 1 },
        })
      )
    ).toHaveProperty('rosterSlots');
  });

  it('needs every roster slot type, so a partial update cannot zero the rest', () => {
    const errors = fieldErrorsOf(() =>
      parseInput(createLeagueSchema, { ...validCreate, rosterSlots: { UTIL: 10, BN: 3 } })
    );
    expect(errors).toHaveProperty(['rosterSlots.PG']);
    expect(errors).toHaveProperty(['rosterSlots.IL']);
    expect(
      fieldErrorsOf(() => parseInput(leaguePatchSchema, { rosterSlots: { PG: 2 } }))
    ).toHaveProperty(['rosterSlots.SG']);
  });

  it('needs real dates with week one before the season end, at most 200 days apart', () => {
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, weekOneStartsOn: '2026-02-30' })
      )
    ).toHaveProperty('weekOneStartsOn');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, regularSeasonEndsOn: '2026-10-19' })
      )
    ).toHaveProperty('regularSeasonEndsOn');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, regularSeasonEndsOn: '2027-05-08' })
      )
    ).toHaveProperty('regularSeasonEndsOn');
    expect(
      parseInput(createLeagueSchema, { ...validCreate, regularSeasonEndsOn: '2027-05-07' })
        .regularSeasonEndsOn
    ).toBe('2027-05-07');
  });

  it('accepts up to three distinct two-week matchups inside the season', () => {
    // 2026-10-19 to 2027-04-11 is 175 dates: weeks 1–25 with one-week matchups, 1–24 with one
    // two-week matchup.
    expect(
      parseInput(createLeagueSchema, { ...validCreate, twoWeekMatchups: [18] }).twoWeekMatchups
    ).toEqual([18]);
    expect(parseInput(createLeagueSchema, validCreate).twoWeekMatchups).toEqual([]);
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, twoWeekMatchups: [18, 25] })
      )
    ).toHaveProperty('twoWeekMatchups.1');
    expect(
      parseInput(createLeagueSchema, { ...validCreate, twoWeekMatchups: [24] }).twoWeekMatchups
    ).toEqual([24]);
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, twoWeekMatchups: [3, 3] })
      )
    ).toHaveProperty('twoWeekMatchups.1');
    expect(
      fieldErrorsOf(() => parseInput(createLeagueSchema, { ...validCreate, twoWeekMatchups: [0] }))
    ).toHaveProperty('twoWeekMatchups.0');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, twoWeekMatchups: [1, 2, 3, 4] })
      )
    ).toHaveProperty('twoWeekMatchups');
  });

  it('bounds the auction budget when one is given', () => {
    expect(
      parseInput(createLeagueSchema, { ...validCreate, auctionBudget: 200 }).auctionBudget
    ).toBe(200);
    expect(
      fieldErrorsOf(() => parseInput(createLeagueSchema, { ...validCreate, auctionBudget: 0 }))
    ).toHaveProperty('auctionBudget');
    expect(
      fieldErrorsOf(() => parseInput(createLeagueSchema, { ...validCreate, auctionBudget: 10_001 }))
    ).toHaveProperty('auctionBudget');
  });

  it('allows other team names up to the league size, each name used once', () => {
    expect(
      parseInput(createLeagueSchema, {
        ...validCreate,
        teamCount: 3,
        otherTeamNames: ['Second', ' Third '],
      }).otherTeamNames
    ).toEqual(['Second', 'Third']);
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, {
          ...validCreate,
          teamCount: 2,
          otherTeamNames: ['Second', 'Third'],
        })
      )
    ).toHaveProperty('otherTeamNames');
    expect(
      fieldErrorsOf(() =>
        parseInput(createLeagueSchema, {
          ...validCreate,
          otherTeamNames: ['bobby buckets'],
        })
      )
    ).toHaveProperty('otherTeamNames.0');
  });

  it('rejects fields it does not know', () => {
    expect(
      formErrorsOf(() =>
        parseInput(createLeagueSchema, { ...validCreate, ownerId: 'someone-else' })
      ).length
    ).toBeGreaterThan(0);
  });
});

describe('leagueSettingsSchema', () => {
  it('applies the same cross-field rules to a merged update', () => {
    const { myTeamName: _mine, ...settings } = validCreate;
    expect(
      fieldErrorsOf(() =>
        parseInput(leagueSettingsSchema, {
          ...settings,
          puntCategories: ['TO'],
          auctionBudget: null,
          twoWeekMatchups: [],
          categories: ['PTS'],
        })
      )
    ).toHaveProperty('puntCategories');
  });
});

describe('teamsSchema', () => {
  it('accepts a list of kept and new teams with distinct names', () => {
    const parsed = parseInput(teamsSchema, {
      teams: [{ id: 'team-1', name: ' Mine ' }, { name: 'New' }],
    });
    expect(parsed.teams).toEqual([{ id: 'team-1', name: 'Mine' }, { name: 'New' }]);
  });

  it('rejects duplicate names and duplicate ids', () => {
    expect(
      fieldErrorsOf(() => parseInput(teamsSchema, { teams: [{ name: 'A' }, { name: 'a' }] }))
    ).toHaveProperty('teams.1.name');
    expect(
      fieldErrorsOf(() =>
        parseInput(teamsSchema, {
          teams: [
            { id: 'x', name: 'A' },
            { id: 'x', name: 'B' },
          ],
        })
      )
    ).toHaveProperty('teams.1.id');
  });
});

describe('rosterEntriesSchema', () => {
  it('accepts up to 30 distinct players with an explicit team or null', () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      playerId: `p${index}`,
      teamId: index % 2 ? 'team-1' : null,
    }));
    expect(parseInput(rosterEntriesSchema, { entries }).entries).toHaveLength(30);
    expect(
      fieldErrorsOf(() =>
        parseInput(rosterEntriesSchema, {
          entries: [...entries, { playerId: 'p30', teamId: null }],
        })
      )
    ).toHaveProperty('entries');
  });

  it('rejects a missing team key and a bad date', () => {
    const errors = fieldErrorsOf(() =>
      parseInput(rosterEntriesSchema, {
        entries: [{ playerId: 'p2' }, { playerId: 'p3', teamId: null, acquiredOn: '2026-13-01' }],
      })
    );
    expect(Object.keys(errors).sort()).toEqual(['entries.0.teamId', 'entries.1.acquiredOn']);
  });

  it('rejects a player listed twice', () => {
    const errors = fieldErrorsOf(() =>
      parseInput(rosterEntriesSchema, {
        entries: [
          { playerId: 'p1', teamId: null },
          { playerId: 'p1', teamId: 'team-1' },
        ],
      })
    );
    expect(Object.keys(errors)).toEqual(['entries.1.playerId']);
  });
});

describe('rosterSpotPatchSchema', () => {
  it('needs at least one change', () => {
    expect(formErrorsOf(() => parseInput(rosterSpotPatchSchema, {}))).toHaveLength(1);
    expect(parseInput(rosterSpotPatchSchema, { onInjuredList: true })).toEqual({
      onInjuredList: true,
    });
  });
});

describe('weekSchema', () => {
  it('reads a positive whole week from a number or a URL segment', () => {
    expect(parseInput(weekSchema, '3')).toBe(3);
    expect(parseInput(weekSchema, 3)).toBe(3);
    for (const week of ['0', '1.5', 'abc', '', 0, 1.5, null]) {
      expect(() => parseInput(weekSchema, week)).toThrow();
    }
  });
});

describe('playerSearchSchema', () => {
  it('needs two characters and caps the limit at 50', () => {
    expect(parseInput(playerSearchSchema, { q: ' jo ' })).toEqual({ q: 'jo', limit: 20 });
    expect(parseInput(playerSearchSchema, { q: 'jokic', limit: '5' }).limit).toBe(5);
    expect(fieldErrorsOf(() => parseInput(playerSearchSchema, { q: 'j' }))).toHaveProperty('q');
    expect(fieldErrorsOf(() => parseInput(playerSearchSchema, { q: null }))).toHaveProperty('q');
    expect(
      fieldErrorsOf(() => parseInput(playerSearchSchema, { q: 'jokic', limit: '51' }))
    ).toHaveProperty('limit');
  });
});
