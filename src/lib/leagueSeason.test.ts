import { describe, expect, it } from 'vitest';

import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import {
  buildLeagueSeasonState,
  detectLeagueSeasonStateDrift,
  deriveSeasonRoundsFromMatchDocuments,
  deriveLeagueScheduleSettings,
  determineCurrentLeagueRound,
  mapSeasonStatsByRound,
  type LeagueSeasonMember,
  type LeagueSeasonRound,
  shouldBootstrapLeagueSeasonState,
} from './leagueSeason';

const categories: FantasyCategoryKey[] = ['goals', 'tackles'];

const members: LeagueSeasonMember[] = [
  { userId: 'user-1', memberId: 'member-1', teamName: 'Alpha' },
  { userId: 'user-2', memberId: 'member-2', teamName: 'Bravo' },
  { userId: 'user-3', memberId: 'member-3', teamName: 'Charlie' },
  { userId: 'user-4', memberId: 'member-4', teamName: 'Delta' },
];

const rounds: LeagueSeasonRound[] = [
  { round: 0, label: 'Opening Round', status: 'final' },
  { round: 1, label: 'Round 1', status: 'in_progress' },
  { round: 2, label: 'Round 2', status: 'scheduled' },
];

describe('deriveLeagueScheduleSettings', () => {
  it('keeps larger leagues on a single round robin by default and pads to a 12-week season', () => {
    expect(deriveLeagueScheduleSettings(12)).toMatchObject({
      numTeams: 12,
      matchupsPerOpponent: 1,
      seasonWeeks: 12,
    });
  });

  it('uses a double round robin for smaller leagues', () => {
    expect(deriveLeagueScheduleSettings(8)).toMatchObject({
      numTeams: 8,
      matchupsPerOpponent: 2,
      seasonWeeks: 14,
    });
  });
});

describe('buildLeagueSeasonState', () => {
  it('builds schedule, current matchup state, and ladder data from live rounds', () => {
    const result = buildLeagueSeasonState({
      leagueId: 'league-1',
      season: 2026,
      members,
      categories,
      rounds,
      rostersByUserId: new Map([
        ['user-1', ['a', 'b']],
        ['user-2', ['c', 'd']],
        ['user-3', ['e', 'f']],
        ['user-4', ['g', 'h']],
      ]),
      statsByRound: new Map([
        [
          0,
          new Map([
            ['a', { playerId: 'a', playerName: 'A', stats: { goals: 2, tackles: 3 } }],
            ['b', { playerId: 'b', playerName: 'B', stats: { goals: 1, tackles: 1 } }],
            ['c', { playerId: 'c', playerName: 'C', stats: { goals: 1, tackles: 4 } }],
            ['d', { playerId: 'd', playerName: 'D', stats: { goals: 0, tackles: 2 } }],
            ['e', { playerId: 'e', playerName: 'E', stats: { goals: 3, tackles: 5 } }],
            ['f', { playerId: 'f', playerName: 'F', stats: { goals: 0, tackles: 1 } }],
            ['g', { playerId: 'g', playerName: 'G', stats: { goals: 1, tackles: 1 } }],
            ['h', { playerId: 'h', playerName: 'H', stats: { goals: 0, tackles: 0 } }],
          ]),
        ],
        [
          1,
          new Map([
            ['a', { playerId: 'a', playerName: 'A', stats: { goals: 2, tackles: 4 } }],
            ['b', { playerId: 'b', playerName: 'B', stats: { goals: 1, tackles: 2 } }],
            ['e', { playerId: 'e', playerName: 'E', stats: { goals: 1, tackles: 4 } }],
            ['f', { playerId: 'f', playerName: 'F', stats: { goals: 1, tackles: 1 } }],
            ['c', { playerId: 'c', playerName: 'C', stats: { goals: 0, tackles: 3 } }],
            ['d', { playerId: 'd', playerName: 'D', stats: { goals: 1, tackles: 2 } }],
            ['g', { playerId: 'g', playerName: 'G', stats: { goals: 0, tackles: 1 } }],
            ['h', { playerId: 'h', playerName: 'H', stats: { goals: 1, tackles: 0 } }],
          ]),
        ],
      ]),
      scheduleSettings: {
        numTeams: 4,
        seasonWeeks: 6,
        matchupsPerOpponent: 1,
        playoffs: {
          enabled: false,
          teams: 0,
          legLengthWeeks: 1,
          reseedEachRound: false,
          includeConsolation: false,
        },
      },
    });

    expect(result.scheduleWeeks).toHaveLength(6);
    expect(result.scheduleWeeks.slice(0, 3).map((week) => week.roundLabel)).toEqual([
      'Opening Round',
      'Round 1',
      'Round 2',
    ]);

    const openingRoundMatchups = result.matchups.filter((matchup) => matchup.week === 1);
    expect(openingRoundMatchups).toHaveLength(2);
    expect(openingRoundMatchups[0]).toMatchObject({
      season: 2026,
      aflRound: 0,
      roundLabel: 'Opening Round',
      status: 'final',
      completed: true,
      current: false,
    });

    const currentMatchups = result.matchups.filter((matchup) => matchup.current);
    expect(currentMatchups).toHaveLength(2);
    expect(currentMatchups.every((matchup) => matchup.roundLabel === 'Round 1')).toBe(true);

    const alphaVsCharlie = currentMatchups.find(
      (matchup) => matchup.homeUserId === 'user-1' || matchup.awayUserId === 'user-1'
    );
    expect(alphaVsCharlie).toBeDefined();
    expect(new Set([alphaVsCharlie?.homeUserId, alphaVsCharlie?.awayUserId])).toEqual(
      new Set(['user-1', 'user-3'])
    );
    expect(alphaVsCharlie?.categoryScores).toEqual(
      alphaVsCharlie?.homeUserId === 'user-1'
        ? [
            { key: 'goals', label: 'Goals', home: 3, away: 2, winner: 'home' },
            { key: 'tackles', label: 'Tackles', home: 6, away: 5, winner: 'home' },
          ]
        : [
            { key: 'goals', label: 'Goals', home: 2, away: 3, winner: 'away' },
            { key: 'tackles', label: 'Tackles', home: 5, away: 6, winner: 'away' },
          ]
    );

    expect(result.standings).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        teamName: 'Alpha',
        ladderRank: 1,
        record: { w: 1, l: 0, t: 0 },
        points: 2,
      }),
      expect.objectContaining({
        userId: 'user-3',
        teamName: 'Charlie',
        ladderRank: 2,
        record: { w: 1, l: 0, t: 0 },
        points: 1.5,
      }),
      expect.objectContaining({
        userId: 'user-2',
        teamName: 'Bravo',
        ladderRank: 3,
        record: { w: 0, l: 1, t: 0 },
        points: 0.5,
      }),
      expect.objectContaining({
        userId: 'user-4',
        teamName: 'Delta',
        ladderRank: 4,
        record: { w: 0, l: 1, t: 0 },
        points: 0,
      }),
    ]);

    expect(result.memberSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-1',
          currentOpponentUserId: 'user-3',
          currentOpponentTeamName: 'Charlie',
          scheduleWeek: 2,
        }),
        expect.objectContaining({
          userId: 'user-2',
          currentOpponentUserId: 'user-4',
          currentOpponentTeamName: 'Delta',
          scheduleWeek: 2,
        }),
      ])
    );
  });

  it('advances to a scheduled Round 2 and builds a 12-week schedule when only Round 1 is final', () => {
    const result = buildLeagueSeasonState({
      leagueId: 'league-1',
      season: 2026,
      members,
      categories,
      rounds: [{ round: 1, label: 'Round 1', status: 'final' }],
      rostersByUserId: new Map([
        ['user-1', ['a', 'b']],
        ['user-2', ['c', 'd']],
        ['user-3', ['e', 'f']],
        ['user-4', ['g', 'h']],
      ]),
      statsByRound: new Map([
        [
          1,
          new Map([
            ['a', { playerId: 'a', playerName: 'A', stats: { goals: 2, tackles: 3 } }],
            ['b', { playerId: 'b', playerName: 'B', stats: { goals: 1, tackles: 1 } }],
            ['c', { playerId: 'c', playerName: 'C', stats: { goals: 1, tackles: 4 } }],
            ['d', { playerId: 'd', playerName: 'D', stats: { goals: 0, tackles: 2 } }],
            ['e', { playerId: 'e', playerName: 'E', stats: { goals: 3, tackles: 5 } }],
            ['f', { playerId: 'f', playerName: 'F', stats: { goals: 0, tackles: 1 } }],
            ['g', { playerId: 'g', playerName: 'G', stats: { goals: 1, tackles: 1 } }],
            ['h', { playerId: 'h', playerName: 'H', stats: { goals: 0, tackles: 0 } }],
          ]),
        ],
      ]),
      scheduleSettings: {
        numTeams: 4,
        seasonWeeks: 12,
        matchupsPerOpponent: 1,
        playoffs: {
          enabled: false,
          teams: 0,
          legLengthWeeks: 1,
          reseedEachRound: false,
          includeConsolation: false,
        },
      },
    });

    expect(result.scheduleWeeks).toHaveLength(12);
    expect(result.scheduleWeeks[0]).toMatchObject({
      week: 1,
      aflRound: 1,
      roundLabel: 'Round 1',
      status: 'final',
      current: false,
    });
    expect(result.scheduleWeeks[1]).toMatchObject({
      week: 2,
      aflRound: 2,
      roundLabel: 'Round 2',
      status: 'scheduled',
      current: true,
    });
    expect(
      result.memberSnapshots.map((member) => ({
        userId: member.userId,
        currentOpponentUserId: member.currentOpponentUserId,
        scheduleWeek: member.scheduleWeek,
      }))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'user-1', scheduleWeek: 2 }),
        expect.objectContaining({ userId: 'user-2', scheduleWeek: 2 }),
        expect.objectContaining({ userId: 'user-3', scheduleWeek: 2 }),
        expect.objectContaining({ userId: 'user-4', scheduleWeek: 2 }),
      ])
    );
  });
});

describe('season round derivation', () => {
  it('treats mixed final and scheduled matches in the same round as in progress', () => {
    const roundsFromMatches = deriveSeasonRoundsFromMatchDocuments([
      { round_number: 1, round_label: 'Round 1', status: 'final' },
      { round_number: 1, round_label: 'Round 1', status: 'scheduled' },
      { round_number: 2, round_label: 'Round 2', status: 'scheduled' },
    ]);

    expect(roundsFromMatches).toEqual([
      { round: 1, label: 'Round 1', status: 'in_progress' },
      { round: 2, label: 'Round 2', status: 'scheduled' },
    ]);
    expect(determineCurrentLeagueRound(roundsFromMatches)).toBe(1);
  });

  it('forces older stale rounds final when a later round has already started', () => {
    const roundsFromMatches = deriveSeasonRoundsFromMatchDocuments([
      { round_number: 1, round_label: 'Round 1', status: 'in_progress' },
      { round_number: 2, round_label: 'Round 2', status: 'in_progress' },
    ]);

    expect(roundsFromMatches).toEqual([
      { round: 1, label: 'Round 1', status: 'final' },
      { round: 2, label: 'Round 2', status: 'in_progress' },
    ]);
    expect(determineCurrentLeagueRound(roundsFromMatches)).toBe(2);
  });
});

describe('shouldBootstrapLeagueSeasonState', () => {
  it('marks state stale when a finalized round no longer matches the materialized week status', () => {
    const freshness = shouldBootstrapLeagueSeasonState({
      rounds: [
        { round: 0, label: 'Opening Round', status: 'final' },
        { round: 1, label: 'Round 1', status: 'final' },
        { round: 2, label: 'Round 2', status: 'scheduled' },
      ],
      scheduleWeeks: [
        {
          week: 1,
          aflRound: 0,
          roundLabel: 'Opening Round',
          status: 'final',
          matchupIds: ['m1', 'm2'],
          current: false,
        },
        {
          week: 2,
          aflRound: 1,
          roundLabel: 'Round 1',
          status: 'in_progress',
          matchupIds: ['m3', 'm4'],
          current: true,
        },
        {
          week: 3,
          aflRound: 2,
          roundLabel: 'Round 2',
          status: 'scheduled',
          matchupIds: ['m5', 'm6'],
          current: false,
        },
      ],
      memberSnapshots: [
        { ladderRank: 1, currentOpponentUserId: 'user-2' },
        { ladderRank: 2, currentOpponentUserId: 'user-1' },
      ],
    });

    expect(freshness).toEqual({
      stale: true,
      reason: 'round_status_mismatch_week_2',
    });
  });

  it('marks state stale when current opponents are missing for the active week', () => {
    const freshness = shouldBootstrapLeagueSeasonState({
      rounds: [
        { round: 0, label: 'Opening Round', status: 'final' },
        { round: 1, label: 'Round 1', status: 'scheduled' },
      ],
      scheduleWeeks: [
        {
          week: 1,
          aflRound: 0,
          roundLabel: 'Opening Round',
          status: 'final',
          matchupIds: ['m1', 'm2'],
          current: false,
        },
        {
          week: 2,
          aflRound: 1,
          roundLabel: 'Round 1',
          status: 'scheduled',
          matchupIds: ['m3', 'm4'],
          current: true,
        },
      ],
      memberSnapshots: [{ ladderRank: 1 }, { ladderRank: 2 }],
    });

    expect(freshness).toEqual({
      stale: true,
      reason: 'missing_current_opponents',
    });
  });
});

describe('detectLeagueSeasonStateDrift', () => {
  it('marks season state stale when stored ladder totals no longer match finalized results', () => {
    const expected = buildLeagueSeasonState({
      leagueId: 'league-1',
      season: 2026,
      members,
      categories,
      rounds: [{ round: 1, label: 'Round 1', status: 'final' }],
      rostersByUserId: new Map([
        ['user-1', ['a', 'b']],
        ['user-2', ['c', 'd']],
        ['user-3', ['e', 'f']],
        ['user-4', ['g', 'h']],
      ]),
      statsByRound: new Map([
        [
          1,
          new Map([
            ['a', { playerId: 'a', playerName: 'A', stats: { goals: 2, tackles: 3 } }],
            ['b', { playerId: 'b', playerName: 'B', stats: { goals: 1, tackles: 1 } }],
            ['c', { playerId: 'c', playerName: 'C', stats: { goals: 1, tackles: 4 } }],
            ['d', { playerId: 'd', playerName: 'D', stats: { goals: 0, tackles: 2 } }],
            ['e', { playerId: 'e', playerName: 'E', stats: { goals: 3, tackles: 5 } }],
            ['f', { playerId: 'f', playerName: 'F', stats: { goals: 0, tackles: 1 } }],
            ['g', { playerId: 'g', playerName: 'G', stats: { goals: 1, tackles: 1 } }],
            ['h', { playerId: 'h', playerName: 'H', stats: { goals: 0, tackles: 0 } }],
          ]),
        ],
      ]),
      scheduleSettings: {
        numTeams: 4,
        seasonWeeks: 12,
        matchupsPerOpponent: 1,
        playoffs: {
          enabled: false,
          teams: 0,
          legLengthWeeks: 1,
          reseedEachRound: false,
          includeConsolation: false,
        },
      },
    });

    const materializedMembers = expected.memberSnapshots.map((member) =>
      member.userId === 'user-1'
        ? { ...member, points: member.points - 1, categoriesWon: member.categoriesWon - 1 }
        : member
    );

    expect(
      detectLeagueSeasonStateDrift({
        scheduleWeeks: expected.scheduleWeeks,
        memberSnapshots: materializedMembers,
        expected,
      })
    ).toEqual({
      stale: true,
      reason: 'member_snapshot_drift_user-1',
    });
  });
});

describe('mapSeasonStatsByRound', () => {
  it('maps imported stat records onto local roster player ids via normalized player names', () => {
    const statsByRound = mapSeasonStatsByRound(
      [
        {
          season: 2026,
          round_number: 2,
          player_id: 'ext-player-1',
          player_name: 'Marcus Bontempelli',
          team: 'WBD',
          position: 'MID',
          stats: { goals: 2, tackles: 7 },
        },
      ],
      ['local-player-99'],
      new Map([['local-player-99', 'Marcus Bontempelli']])
    );

    expect(statsByRound.get(2)?.get('local-player-99')).toMatchObject({
      playerId: 'local-player-99',
      playerName: 'Marcus Bontempelli',
      team: 'WBD',
      position: 'MID',
    });
    expect(statsByRound.get(2)?.get('local-player-99')?.stats.goals).toBe(2);
    expect(statsByRound.get(2)?.get('local-player-99')?.stats.tackles).toBe(7);
  });

  it('preserves direct player id matches even when roster name metadata is unavailable', () => {
    const statsByRound = mapSeasonStatsByRound(
      [
        {
          season: 2026,
          round_number: 3,
          player_id: 'ply_ed_richards',
          player_name: 'Ed Richards',
          team: 'WBD',
          position: 'MID',
          stats: { goals: 1, tackles: 5 },
        },
      ],
      ['ply_ed_richards'],
      new Map()
    );

    expect(statsByRound.get(3)?.get('ply_ed_richards')).toMatchObject({
      playerId: 'ply_ed_richards',
      playerName: 'Ed Richards',
      team: 'WBD',
      position: 'MID',
    });
    expect(statsByRound.get(3)?.get('ply_ed_richards')?.stats.goals).toBe(1);
    expect(statsByRound.get(3)?.get('ply_ed_richards')?.stats.tackles).toBe(5);
  });
});
