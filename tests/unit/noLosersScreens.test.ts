import { describe, expect, it } from 'vitest';

import {
  buildNoLosersClubStrip,
  clubRecordFor,
  clubSeasonRecords,
  countCountedPlayersByClub,
  storedNoLosersPlayerView,
} from '@/server/leagues/noLosersScreens';
import type { StoredAflMatchResult } from '@/server/leagues/noLosersScoring';

const result = (
  matchUid: string,
  homeClub: string,
  awayClub: string,
  homePoints: number | null,
  awayPoints: number | null,
  status: 'FINAL' | 'ABANDONED' = 'FINAL'
): StoredAflMatchResult => ({
  id: `result-${matchUid}`,
  matchUid,
  homeClub,
  awayClub,
  homePoints,
  awayPoints,
  status,
});

describe('No Losers club-result strip (BR-41)', () => {
  it('shows a result whose home/away order differs from the fixture on its game, once (#1315)', () => {
    const games = buildNoLosersClubStrip({
      matches: [{ match_uid: '2025-R18-GEE-HAW', home_team: 'Geelong', away_team: 'Hawthorn' }],
      results: [result('2025-R18-HAW-GEE', 'Hawthorn', 'Geelong', 60, 90)],
    });
    expect(games.map((game) => [game.homeClub, game.state, game.homePoints])).toEqual([
      ['Hawthorn', 'FINAL', 60],
    ]);
  });

  const matches = [
    { match_uid: '2025-R18-GEE-HAW', home_team: 'Geelong', away_team: 'Hawthorn', status: 'final' },
    { match_uid: '2025-R18-SYD-CAR', home_team: 'Sydney', away_team: 'Carlton', status: 'final' },
    { match_uid: '2025-R18-ESS-RIC', home_team: 'Essendon', away_team: 'Richmond', status: 'live' },
    {
      match_uid: '2025-R18-COL-MEL',
      home_team: 'Collingwood',
      away_team: 'Melbourne',
      status: 'scheduled',
      start_time_utc: '2025-07-13T05:20:00.000Z',
    },
    { match_uid: '2025-R18-WCE-FRE', home_team: 'West Coast', away_team: 'Fremantle' },
  ];

  it('shows stored results, a pending result and unplayed games, never an in-game score', () => {
    const games = buildNoLosersClubStrip({
      matches,
      results: [
        result('2025-R18-GEE-HAW', 'Geelong', 'Hawthorn', 90, 60),
        // Not in the fixture list (stats feed down): still shown.
        result('2025-R18-ADE-POR', 'Adelaide', 'Port Adelaide', null, null, 'ABANDONED'),
      ],
      finishedMatchUids: new Set(['2025-R18-WCE-FRE']),
    });

    expect(
      games.map((game) => [game.matchUid, game.state, game.homePoints, game.awayPoints])
    ).toEqual([
      ['2025-R18-GEE-HAW', 'FINAL', 90, 60],
      ['2025-R18-SYD-CAR', 'RESULT_PENDING', null, null],
      ['2025-R18-ESS-RIC', 'IN_PROGRESS', null, null],
      ['2025-R18-COL-MEL', 'SCHEDULED', null, null],
      // No fixture status, but its stat rows prove it finished.
      ['2025-R18-WCE-FRE', 'RESULT_PENDING', null, null],
      ['2025-R18-ADE-POR', 'ABANDONED', null, null],
    ]);
    expect(games[3].startsAt).toBe('2025-07-13T05:20:00.000Z');
  });

  it("names a stored result's clubs as the player counts do, so the strip can match them", () => {
    // The result writer stores ETL names ("Brisbane Lions"); player counts use the app's name.
    const [game] = buildNoLosersClubStrip({
      matches: [],
      results: [result('2025-R18-BRL-GCS', 'Brisbane Lions', 'Gold Coast Suns', 80, 70)],
    });
    const counts = countCountedPlayersByClub(
      [{ slot: 'MID', club: 'Brisbane' }],
      [{ slot: 'MID', club: 'Gold Coast' }]
    );

    expect([game.homeClub, game.awayClub].sort()).toEqual(counts.map((count) => count.club).sort());
  });

  it("counts each manager's counted (on-field) players per club, not interchange or bench", () => {
    expect(
      countCountedPlayersByClub(
        [
          { slot: 'MID', club: 'Geelong' },
          { slot: 'INTERCHANGE', club: 'GEE' },
          { slot: 'BENCH', club: 'Geelong' },
          { slot: 'FWD', club: null },
        ],
        [{ slot: 'DEF', club: 'Hawthorn' }]
      )
    ).toEqual([
      { club: 'Geelong', home: 1, away: 0 },
      { club: 'Hawthorn', home: 0, away: 1 },
    ]);
  });
});

describe('No Losers stored breakdown view (BR-21, BR-40)', () => {
  const row = {
    memberId: 'home',
    playerId: 'p1',
    rawTotalsJson: { goals: 3 },
    countedTotalsJson: { goals: 0 },
  };

  it('reads a stored result row as the scoreboard view', () => {
    expect(
      storedNoLosersPlayerView({
        ...row,
        outcome: 'RESULT',
        clubResult: 'LOSS',
        margin: -20,
        multiplier: 0,
      })
    ).toEqual({ status: 'COUNTED', clubResult: 'LOSS', margin: -20, multiplier: 0 });
  });

  it('keeps pending and unresolved rows, drops a no-stat-row row, refuses a corrupt one', () => {
    const base = { ...row, clubResult: null, margin: null, multiplier: null };
    expect(storedNoLosersPlayerView({ ...base, outcome: 'RESULT_PENDING' })).toEqual({
      status: 'RESULT_PENDING',
    });
    expect(storedNoLosersPlayerView({ ...base, outcome: 'UNRESOLVED' })).toEqual({
      status: 'UNRESOLVED',
    });
    expect(storedNoLosersPlayerView({ ...base, outcome: 'NO_STAT_ROW' })).toBeNull();
    expect(
      storedNoLosersPlayerView({ ...base, outcome: 'RESULT', clubResult: 'WIN', multiplier: 2 })
    ).toEqual({ status: 'UNRESOLVED' });
  });
});

describe('No Losers club season record (BR-42)', () => {
  const records = clubSeasonRecords([
    result('2025-R1-GEE-HAW', 'Geelong', 'Hawthorn', 90, 60),
    result('2025-R2-HAW-GEE', 'Hawthorn', 'Geelong', 70, 70),
    result('2025-R3-GEE-SYD', 'Geelong', 'Sydney', 50, 80),
    result('2025-R4-GEE-CAR', 'Geelong', 'Carlton', null, null, 'ABANDONED'),
  ]);

  it('counts wins, losses and draws from stored results and leaves abandoned games out', () => {
    expect(records).toEqual({
      Geelong: { wins: 1, losses: 1, draws: 1 },
      Hawthorn: { wins: 0, losses: 1, draws: 1 },
      Sydney: { wins: 1, losses: 0, draws: 0 },
    });
  });

  it('matches a player club by canonical name and gives a club with no result 0-0-0', () => {
    expect(clubRecordFor(records, 'GEE')).toEqual({ wins: 1, losses: 1, draws: 1 });
    expect(clubRecordFor(records, 'Richmond')).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect(clubRecordFor(records, null)).toBeNull();
  });
});
