import { describe, expect, it } from 'vitest';

import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  aggregateFinalizedCategoryTotals,
  resolveCurrentCompetitionRound,
  resolveRoundPlayerAvailability,
  toMatchupStatusFromRoundStatus,
} from '@/server/leagues/matchupReadModel';
import { normalizeLiveStatRows } from '@/server/leagues/liveStatsAdapter';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('matchupReadModel helpers', () => {
  it('derives matchup status from live/final round status', () => {
    expect(toMatchupStatusFromRoundStatus({ anyLive: true, allFinal: false })).toBe('LIVE');
    expect(toMatchupStatusFromRoundStatus({ anyLive: false, allFinal: true })).toBe('FINAL');
    expect(toMatchupStatusFromRoundStatus({ anyLive: false, allFinal: false })).toBe('SCHEDULED');
  });

  it('chooses the latest eligible started round when prior rounds have no end time', () => {
    const now = new Date('2026-07-16T12:00:00.000Z');
    const rounds = [
      {
        round: 1,
        status: 'SCHEDULED',
        startsAt: new Date('2026-07-01T12:00:00.000Z'),
        endsAt: null,
      },
      {
        round: 2,
        status: 'SCHEDULED',
        startsAt: new Date('2026-07-10T12:00:00.000Z'),
        endsAt: null,
      },
      {
        round: 3,
        status: 'SCHEDULED',
        startsAt: new Date('2026-07-20T12:00:00.000Z'),
        endsAt: null,
      },
    ];

    expect(resolveCurrentCompetitionRound(rounds, now)?.round).toBe(2);
  });

  it('aggregates the selected category stat total for home and away member score rows', () => {
    const totals = aggregateFinalizedCategoryTotals(
      [
        {
          memberId: 'home-member',
          categoriesJson: JSON.stringify([
            {
              category: 'goals',
              homeValue: 12,
              awayValue: 8,
              direction: 'HIGH_WINS',
              winner: 'home',
            },
            {
              category: 'tackles',
              homeValue: 99,
              awayValue: 1,
              direction: 'HIGH_WINS',
              winner: 'home',
            },
          ]),
        },
        {
          memberId: 'away-member',
          categoriesJson: JSON.stringify([
            {
              category: 'goals',
              homeValue: 8,
              awayValue: 12,
              direction: 'HIGH_WINS',
              winner: 'away',
            },
            {
              category: 'tackles',
              homeValue: 1,
              awayValue: 99,
              direction: 'HIGH_WINS',
              winner: 'away',
            },
          ]),
        },
        {
          memberId: 'home-member',
          categoriesJson: JSON.stringify([
            {
              category: 'goals',
              homeValue: 5,
              awayValue: 7,
              direction: 'HIGH_WINS',
              winner: 'away',
            },
          ]),
        },
      ],
      'goals'
    );

    expect([...totals.entries()]).toEqual([
      ['home-member', 17],
      ['away-member', 8],
    ]);
  });

  it('distinguishes confirmed zero-minute players from players on a club bye', () => {
    const matches = [
      {
        match_uid: 'match-1',
        home_team: 'GWS Giants',
        away_team: 'Collingwood',
        status: 'final',
        confirmed_bye_teams: ['Richmond Tigers'],
      },
    ];
    const stats = normalizeLiveStatRows(
      [
        {
          match_uid: 'match-1',
          player_uid: 'did-not-play',
          round_number: 8,
          stats: { minutes: 0, goals: 0 },
        },
        {
          match_uid: 'match-1',
          player_uid: 'played',
          round_number: 8,
          stats: { minutes: 80, goals: 1 },
        },
      ],
      matches
    );
    const availability = resolveRoundPlayerAvailability({
      stats,
      matches,
      expectedPlayers: [
        { playerId: 'did-not-play', club: 'GWS' },
        { playerId: 'played', club: 'Collingwood' },
        { playerId: 'club-bye', club: 'Richmond' },
      ],
    });

    expect([...availability.nonPlayingReasonByPlayerId.entries()]).toEqual([
      ['did-not-play', 'DID_NOT_PLAY'],
      ['club-bye', 'CLUB_BYE'],
    ]);
    expect(availability.totalsByPlayerId.get('club-bye')).toEqual({});
  });

  it('does not infer a club bye from absence in a partial fixture feed', () => {
    const availability = resolveRoundPlayerAvailability({
      stats: [],
      matches: [{ home_team: 'GWS', away_team: 'Collingwood', status: 'final' }],
      expectedPlayers: [{ playerId: 'richmond-player', club: 'Richmond' }],
    });

    expect(availability.nonPlayingReasonByPlayerId.size).toBe(0);
    expect(availability.totalsByPlayerId.has('richmond-player')).toBe(false);
  });

  it('keeps Match Centre reads fixture-backed and category-score normalized', () => {
    const readModel = readRepoFile('src/server/leagues/matchupReadModel.ts');

    expect(REAL_DATA_NINE_CATEGORY_PRESET).toHaveLength(9);
    expect(readModel).toContain('LeagueMatchupCategoryRow');
    expect(readModel).toContain('LeagueMatchupPlayerContribution');
    expect(readModel).toContain('availableRounds');
    expect(readModel).toContain('buildCategoryRows');
    expect(readModel).toContain('buildPlayerContributions');
    expect(readModel).toContain('FANTASY_CATEGORIES');
    expect(readModel).toContain('userId: string');
    expect(readModel).toContain('viewerMember');
    expect(readModel).toContain('viewerMatchupWhere');
    expect(readModel).toContain("lineupPlayer.slot !== 'BENCH'");
    expect(readModel).not.toContain('generateLeagueFixtures');
    expect(readModel).toContain('resolveAflRoundForScoring');
    expect(readModel).toContain('categoryRows: buildCategoryRows');
  });
});
