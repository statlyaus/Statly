import { describe, expect, it } from 'vitest';

import { injuryOutlook, type PlayerInjury } from './injuryOutlook';

const TODAY = '2026-11-10';
/** The team's remaining games: today, then every other day. */
const UPCOMING = [
  '2026-11-10',
  '2026-11-12',
  '2026-11-14',
  '2026-11-16',
  '2026-11-18',
  '2026-11-20',
];

const injury = (overrides: Partial<PlayerInjury>): PlayerInjury => ({
  status: 'OUT',
  expectedReturnOn: null,
  seasonEnding: false,
  ...overrides,
});

describe('injuryOutlook', () => {
  it('counts the team games before the return date, at least one', () => {
    expect(injuryOutlook(injury({ expectedReturnOn: '2026-11-15' }), UPCOMING, TODAY)).toEqual({
      fracNext5: 0.6,
      gamesOut: 3,
    });
    expect(injuryOutlook(injury({ expectedReturnOn: '2026-11-11' }), UPCOMING, TODAY)).toEqual({
      fracNext5: 0.2,
      gamesOut: 1,
    });
    // Back before the team's next game: still at least one game.
    expect(
      injuryOutlook(injury({ expectedReturnOn: '2026-11-11' }), UPCOMING.slice(1), TODAY)
    ).toEqual({ fracNext5: 0.2, gamesOut: 1 });
    expect(
      injuryOutlook(
        injury({ status: 'DAY_TO_DAY', expectedReturnOn: '2026-11-20' }),
        UPCOMING,
        TODAY
      )
    ).toEqual({ fracNext5: 1, gamesOut: 5 });
  });

  it('is out for the season when it says so, or returns after the team’s last game', () => {
    const season = { fracNext5: 1, gamesOut: 999 };
    expect(injuryOutlook(injury({ seasonEnding: true }), UPCOMING, TODAY)).toEqual(season);
    expect(
      injuryOutlook(injury({ seasonEnding: true, expectedReturnOn: '2026-11-11' }), UPCOMING, TODAY)
    ).toEqual(season);
    expect(injuryOutlook(injury({ expectedReturnOn: '2026-11-21' }), UPCOMING, TODAY)).toEqual(
      season
    );
  });

  it('treats a return date of today or earlier as due back', () => {
    const due = { fracNext5: 0.1, gamesOut: 0.5 };
    expect(injuryOutlook(injury({ expectedReturnOn: TODAY }), UPCOMING, TODAY)).toEqual(due);
    expect(injuryOutlook(injury({ expectedReturnOn: '2026-11-01' }), UPCOMING, TODAY)).toEqual(due);
  });

  it('weights a missing return date by status', () => {
    expect(injuryOutlook(injury({ status: 'OUT' }), UPCOMING, TODAY)).toEqual({
      fracNext5: 0.4,
      gamesOut: 2,
    });
    expect(injuryOutlook(injury({ status: 'DAY_TO_DAY' }), UPCOMING, TODAY)).toEqual({
      fracNext5: 0.1,
      gamesOut: 0.5,
    });
  });
});
