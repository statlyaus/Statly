import { describe, expect, it } from 'vitest';

import { normalizeCategoryDirections } from '@/server/leagues/categoryDirections';
import { buildMatchupCard } from '@/server/leagues/matchupReadModel';
import {
  buildNoLosersRoundContext,
  matchUidClubAbbreviations,
  noLosersPlayerScoreRows,
  noLosersWaitingOn,
  resolveResultClub,
  scoreNoLosersLineup,
  type StoredAflMatchResult,
} from '@/server/leagues/noLosersScoring';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

const GEE_HAW: StoredAflMatchResult = {
  id: 'result-gee-haw',
  matchUid: '2025-R18-GEE-HAW',
  homeClub: 'Geelong',
  awayClub: 'Hawthorn',
  homePoints: 90,
  awayPoints: 60,
  status: 'FINAL',
};
const MATCHES = [
  { match_uid: '2025-R18-GEE-HAW', home_team: 'Geelong', away_team: 'Hawthorn', status: 'final' },
  { match_uid: '2025-R18-SYD-CAR', home_team: 'Sydney', away_team: 'Carlton', status: 'final' },
  {
    match_uid: '2025-R18-ESS-RIC',
    home_team: 'Essendon',
    away_team: 'Richmond',
    status: 'scheduled',
  },
];

function context(results: StoredAflMatchResult[] = [GEE_HAW]) {
  return buildNoLosersRoundContext({
    results,
    matches: MATCHES,
    statRows: [
      // Provider spellings that are not the result's club names (BR-07).
      { playerId: 'gee', matchId: '2025-R18-GEE-HAW', teamAbbr: 'gee' },
      { playerId: 'haw', matchId: '2025-R18-GEE-HAW', teamAbbr: 'HAW' },
      { playerId: 'syd', matchId: '2025-R18-SYD-CAR', teamAbbr: 'SYD' },
      { playerId: 'stray', matchId: '2025-R18-GEE-HAW', teamAbbr: 'COL' },
    ],
  });
}

describe('No Losers join (BR-07)', () => {
  it('reads both club abbreviations from the Statly match id', () => {
    expect(matchUidClubAbbreviations('2025-R18-GEE-HAW')).toEqual({ home: 'GEE', away: 'HAW' });
    expect(matchUidClubAbbreviations('bad')).toBeNull();
  });

  it("resolves the side by abbreviation and gives the rule the result's own club name", () => {
    expect(resolveResultClub('gee', GEE_HAW)).toBe('Geelong');
    expect(resolveResultClub('HAW', GEE_HAW)).toBe('Hawthorn');
    expect(resolveResultClub('COL', GEE_HAW)).toBe('');
    expect(resolveResultClub(null, GEE_HAW)).toBe('');
  });

  it('scores a player whose stat-row club is spelled differently from the result row', () => {
    const score = scoreNoLosersLineup(
      [
        { playerId: 'gee', slot: 'MID', totals: { goals: 2 } },
        { playerId: 'haw', slot: 'MID', totals: { goals: 3 } },
      ],
      context()
    );

    expect(score.rule.unavailablePlayerIds).toEqual([]);
    expect(score.players.map((player) => player.totals.goals)).toEqual([2, 0]);
  });

  it('refuses an abbreviation that names neither side', () => {
    const score = scoreNoLosersLineup(
      [{ playerId: 'stray', slot: 'MID', totals: { goals: 2 } }],
      context()
    );

    expect(score.rule.players[0].outcome).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'CLUB_NOT_IN_MATCH',
    });
  });
});

describe('No Losers waiting and provisional totals (BR-08, BR-20)', () => {
  it('counts a pending player raw, provisionally, and names every finished game without a result', () => {
    const ctx = context();
    const score = scoreNoLosersLineup(
      [
        { playerId: 'gee', slot: 'MID', totals: { goals: 2 } },
        { playerId: 'syd', slot: 'MID', totals: { goals: 4 } },
      ],
      ctx
    );

    expect(score.rule.unavailablePlayerIds).toEqual(['syd']);
    expect(score.players.map((player) => player.totals.goals)).toEqual([2, 4]);
    // Essendon v Richmond has not been played, so nothing waits on it.
    expect(noLosersWaitingOn(ctx, score.rule.players)).toEqual([
      'Waiting on the result of Sydney v Carlton',
    ]);
  });

  it('names a game a counted player cannot be joined to', () => {
    const ctx = context([
      GEE_HAW,
      {
        ...GEE_HAW,
        id: 'r2',
        matchUid: '2025-R18-SYD-CAR',
        homeClub: 'Sydney',
        awayClub: 'Carlton',
      },
    ]);
    const score = scoreNoLosersLineup(
      [{ playerId: 'stray', slot: 'MID', totals: { goals: 1 } }],
      ctx
    );

    expect(noLosersWaitingOn(ctx, score.rule.players)).toEqual([
      "A player's club cannot be matched to Geelong v Hawthorn",
    ]);
  });

  it('stores one row per counted player with the result row id; bench is left out', () => {
    const ctx = context();
    const score = scoreNoLosersLineup(
      [
        { playerId: 'haw', slot: 'MID', totals: { goals: 3 } },
        { playerId: 'gee', slot: 'BENCH', totals: { goals: 2 } },
      ],
      ctx
    );

    expect(
      noLosersPlayerScoreRows(score, ctx, {
        leagueId: 'l',
        seasonId: 's',
        matchupId: 'm',
        memberId: 'mem',
        round: 1,
      })
    ).toEqual([
      expect.objectContaining({
        playerId: 'haw',
        outcome: 'RESULT',
        clubResult: 'LOSS',
        margin: -30,
        multiplier: 0,
        aflMatchUid: '2025-R18-GEE-HAW',
        aflMatchResultId: 'result-gee-haw',
        rawTotalsJson: { goals: 3 },
        countedTotalsJson: { goals: 0 },
        ruleVersion: 'no-losers-result-rule/v1',
      }),
    ]);
  });
});

describe('buildMatchupCard in a No Losers league', () => {
  const categories: FantasyCategoryKey[] = ['goals'];
  const member = (id: string) => ({ id, teamName: id, teamLogoUrl: null });
  const lineup = (playerIds: string[]) => ({
    players: playerIds.map((playerId, slotIndex) => ({
      playerId,
      slot: 'MID',
      slotIndex,
      player: { name: playerId, position: 'MID' },
    })),
  });
  const matchup = {
    id: 'matchup-1',
    round: 1,
    status: 'LIVE',
    startsAt: null,
    endsAt: null,
    finalizedAt: null,
    winnerMemberId: null,
    homeMemberId: 'home',
    awayMemberId: 'away',
    byeMemberId: null,
    homeMember: member('home'),
    awayMember: member('away'),
    byeMember: null,
    homeCategoryWins: 0,
    awayCategoryWins: 0,
    drawnCategories: 0,
    scores: [],
  } as unknown as Parameters<typeof buildMatchupCard>[0]['matchup'];
  const input = {
    matchup,
    categories,
    categoryDirections: normalizeCategoryDirections(categories),
    scoringMode: 'H2H_EACH_CATEGORY' as const,
    lineupsByMemberId: new Map([
      ['home', lineup(['haw', 'syd'])],
      ['away', lineup(['gee'])],
    ]),
    totalsByPlayerId: new Map([
      ['haw', { goals: 3 }],
      ['syd', { goals: 1 }],
      ['gee', { goals: 2 }],
    ]),
    liveRound: { available: true, started: true },
  };

  it('shows counted totals, marks a pending result and labels the total provisional', () => {
    const card = buildMatchupCard({ ...input, noLosers: context() });

    expect(card.status).toBe('LIVE');
    expect(card.provisional).toBe(true);
    // Hawthorn lost by 30 (zeroed); Sydney's result is not stored yet, so its raw 1 counts for now.
    expect(card.categoryRows[0]).toMatchObject({ homeValue: 1, awayValue: 2, winner: 'away' });
    expect(
      card.homeMember?.players.map((player) => [player.playerId, player.total, player.noLosers])
    ).toEqual([
      ['haw', 0, { status: 'COUNTED', clubResult: 'LOSS', margin: -30, multiplier: 0 }],
      ['syd', 1, { status: 'RESULT_PENDING' }],
    ]);
    expect(card.waitingOnResults).toEqual(['Waiting on the result of Sydney v Carlton']);
  });

  it('sends the raw value beside a zeroed counted value (BR-40)', () => {
    const card = buildMatchupCard({ ...input, noLosers: context() });

    expect(card.homeMember?.players[0].categories).toEqual([
      { category: 'goals', shortLabel: expect.any(String), value: 0, rawValue: 3 },
    ]);
    // A full-count row carries no raw value.
    expect(card.awayMember?.players[0].categories[0]).not.toHaveProperty('rawValue');
  });

  it('shows a FINAL card from its stored per-player rows, not the live results (#1296)', () => {
    const stored = (playerId: string, memberId: string, raw: number, counted: number) => ({
      memberId,
      playerId,
      outcome: 'RESULT',
      clubResult: counted === raw ? 'WIN' : 'LOSS',
      margin: counted === raw ? 10 : -4,
      multiplier: counted === raw ? 1 : 0.5,
      rawTotalsJson: { goals: raw },
      countedTotalsJson: { goals: counted },
    });
    const card = buildMatchupCard({
      ...input,
      matchup: { ...input.matchup, status: 'FINAL' } as typeof input.matchup,
      // The live results now say Hawthorn lost by 30; the stored score said a 4-point loss.
      noLosers: context(),
      noLosersStored: [stored('haw', 'home', 3, 1.5), stored('syd', 'home', 1, 1)],
    });

    expect(
      card.homeMember?.players.map((player) => [
        player.playerId,
        player.categories[0].value,
        player.categories[0].rawValue,
        player.noLosers,
      ])
    ).toEqual([
      ['haw', 1.5, 3, { status: 'COUNTED', clubResult: 'LOSS', margin: -4, multiplier: 0.5 }],
      ['syd', 1, undefined, { status: 'COUNTED', clubResult: 'WIN', margin: 10, multiplier: 1 }],
    ]);
    expect(card).not.toHaveProperty('waitingOnResults');
  });

  it("carries each side's counted players per club for the strip (BR-41)", () => {
    const withClubs = (playerIds: Array<[string, string]>) => ({
      players: playerIds.map(([playerId, club], slotIndex) => ({
        playerId,
        slot: 'MID',
        slotIndex,
        player: { name: playerId, position: 'MID', club },
      })),
    });
    const card = buildMatchupCard({
      ...input,
      lineupsByMemberId: new Map([
        [
          'home',
          withClubs([
            ['haw', 'Hawthorn'],
            ['syd', 'Sydney'],
          ]),
        ],
        ['away', withClubs([['gee', 'Geelong']])],
      ]),
      noLosers: context(),
      noLosersFormat: true,
    });

    expect(card.noLosersClubCounts).toEqual([
      { club: 'Geelong', home: 0, away: 1 },
      { club: 'Hawthorn', home: 1, away: 0 },
      { club: 'Sydney', home: 1, away: 0 },
    ]);
  });

  it('leaves a standard card exactly as before', () => {
    const card = buildMatchupCard(input);

    expect(card).not.toHaveProperty('waitingOnResults');
    expect(card).not.toHaveProperty('noLosersClubCounts');
    expect(card.categoryRows[0]).toMatchObject({ homeValue: 4, awayValue: 2, winner: 'home' });
    expect(card.homeMember?.players.every((player) => !('noLosers' in player))).toBe(true);
  });
});
