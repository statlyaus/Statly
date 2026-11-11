import { describe, expect, it } from 'vitest';

import {
  normalizeLiveStatRows,
  normalizeRoundMatchStatus,
  type RawLiveStatRow,
  type RawRoundMatch,
} from '@/server/leagues/liveStatsAdapter';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';

import { normalizePlayerRow, toProcessedStats } from '../../etl/normalizePlayerRow';

// Every fantasy category and the stats field the ETL stores it under (etl/normalizePlayerRow.ts).
// null: the ETL exports no source for that category.
const ETL_FIELD_BY_CATEGORY: Record<FantasyCategoryKey, string | null> = {
  goals: 'goals',
  kicks: 'kicks',
  handballs: 'handballs',
  marks: 'marks',
  tackles: 'tackles',
  hitouts: 'hit_outs',
  clearances: 'clearances',
  inside50s: 'inside_50s',
  rebound50s: 'rebound_50s',
  clangers: 'clangers',
  contestedPossessions: 'contested_possessions',
  uncontestedPossessions: 'uncontested_possessions',
  freesFor: 'frees_for',
  freesAgainst: 'frees_against',
  onePercenters: 'one_percenters',
  goalAssists: 'goal_assists',
  timeOnGroundPct: 'tog_pct',
  disposalEffPct: 'disposal_efficiency',
  turnovers: 'turnovers',
  intercepts: 'intercepts',
  metresGained: 'metres_gained',
  contestedMarks: 'contested_marks',
  effectiveDisposals: 'effective_disposals',
  scoreInvolvements: 'score_involvements',
};

describe('liveStatsAdapter', () => {
  it('normalizes ETL nested stats into fantasy category totals', () => {
    const rows = normalizeLiveStatRows([
      {
        match_uid: 'match-1',
        player_uid: 'player-1',
        stats: {
          goals: 2,
          tackles: 7,
          inside50s: 4,
          rebound50s: 3,
          contested_possessions: 11,
          effective_disposals: 18,
          score_involvements: 6,
        },
      } satisfies RawLiveStatRow,
    ]);

    expect(rows[0]).toMatchObject({
      playerId: 'player-1',
      matchId: 'match-1',
      totals: {
        goals: 2,
        tackles: 7,
        inside50s: 4,
        rebound50s: 3,
        contestedPossessions: 11,
        effectiveDisposals: 18,
        scoreInvolvements: 6,
      },
    });
  });

  it('reads every category the ETL stores from an ETL-shaped stats row', () => {
    const etlFields = Object.values(ETL_FIELD_BY_CATEGORY).filter(
      (field): field is string => field !== null
    );
    // A distinct value per field, so a category reading the wrong field cannot pass.
    const raw = Object.fromEntries(etlFields.map((field, index) => [field, index + 1]));
    const stats = toProcessedStats(
      normalizePlayerRow({
        season: 2026,
        round: 5,
        team: 'Carlton',
        opposition: 'Collingwood',
        player_name: 'Test Player',
        ...raw,
      })
    );

    const [row] = normalizeLiveStatRows([
      { match_uid: 'CARL-COLL', player_uid: 'player-etl', stats } satisfies RawLiveStatRow,
    ]);

    expect(Object.keys(ETL_FIELD_BY_CATEGORY).sort()).toEqual(
      Object.keys(FANTASY_CATEGORIES).sort()
    );
    for (const [category, field] of Object.entries(ETL_FIELD_BY_CATEGORY)) {
      if (field === null) continue;
      expect({ category, value: row.totals[category as FantasyCategoryKey] }).toEqual({
        category,
        value: raw[field],
      });
    }
  });

  it('normalizes top-level snake-case projections into fantasy category totals', () => {
    const rows = normalizeLiveStatRows([
      {
        match_id: 'match-2',
        player_id: 'player-2',
        goals: 1,
        inside_50s: 5,
        contested_marks: 2,
      } satisfies RawLiveStatRow,
    ]);

    expect(rows[0]).toMatchObject({
      playerId: 'player-2',
      matchId: 'match-2',
      totals: {
        goals: 1,
        inside50s: 5,
        contestedMarks: 2,
      },
    });
  });

  it('marks match status unavailable when start and status are missing', () => {
    const rows = normalizeLiveStatRows([{ player_uid: 'player-3', stats: { goals: 1 } }]);

    expect(rows[0].statusUnavailable).toBe(true);
    expect(rows[0].gameStartsAt).toBeNull();
    expect(rows[0].gameStatus).toBe('unknown');
  });

  it('confirms zero minutes as did not play only after the authoritative match is final', () => {
    const rows = normalizeLiveStatRows(
      [
        { player_uid: 'scheduled', match_uid: 'scheduled-match', stats: { minutes: 0 } },
        { player_uid: 'live', match_uid: 'live-match', stats: { minutes: 0 } },
        { player_uid: 'final-dnp', match_uid: 'final-match', stats: { minutes: 0 } },
        { player_uid: 'final-played', match_uid: 'final-match', stats: { minutes: 1 } },
        { player_uid: 'unknown', match_uid: 'unknown-match', stats: { minutes: 0 } },
      ],
      [
        { match_uid: 'scheduled-match', status: 'scheduled' },
        { match_uid: 'live-match', status: 'in_progress' },
        { match_uid: 'final-match', status: 'final' },
      ]
    );

    expect(rows.map((row) => [row.playerId, row.confirmedDidNotPlay])).toEqual([
      ['scheduled', false],
      ['live', false],
      ['final-dnp', true],
      ['final-played', false],
      ['unknown', false],
    ]);
  });

  it('leaves an unreported stat unavailable instead of reading it as 0', () => {
    const [row] = normalizeLiveStatRows([
      {
        player_uid: 'player-missing',
        tackles: 9,
        stats: { goals: null, tackles: 0, inside_50s: 'n/a', intercepts: '' },
      } satisfies RawLiveStatRow,
    ]);

    expect(row.totals.goals).toBeUndefined();
    expect(row.totals.inside50s).toBeUndefined();
    expect(row.totals.intercepts).toBeUndefined();
    expect(row.totals.contestedMarks).toBeUndefined();
    expect(row.unreportedCategories).toEqual(
      expect.arrayContaining(['goals', 'inside50s', 'intercepts', 'contestedMarks'])
    );
    // A reported 0 is a real result, and a nested 0 is not overridden by a top-level field.
    expect(row.totals.tackles).toBe(0);
    expect(row.unreportedCategories).not.toContain('tackles');
  });

  it('treats disposal efficiency as reported-empty, not missing, for a player with no disposals', () => {
    const rows = normalizeLiveStatRows([
      { player_uid: 'no-disposals', stats: { disposals: 0, disposal_efficiency: null } },
      { player_uid: 'no-kicks-or-handballs', stats: { kicks: 0, handballs: 0 } },
      { player_uid: 'unreported-de', stats: { disposals: 12 } },
      { player_uid: 'nothing-reported', stats: {} },
    ]);

    expect(rows.map((row) => [row.playerId, row.totals.disposalEffPct])).toEqual([
      ['no-disposals', undefined],
      ['no-kicks-or-handballs', undefined],
      ['unreported-de', undefined],
      ['nothing-reported', undefined],
    ]);
    expect(rows.map((row) => row.unreportedCategories.includes('disposalEffPct'))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('normalizes round match final and live status variants', () => {
    const status = normalizeRoundMatchStatus([
      { match_uid: 'm1', status: 'completed', start_time_utc: '2026-07-04T08:00:00.000Z' },
      { matchUid: 'm2', status: 'in_progress', start_time_utc: '2026-07-04T10:00:00.000Z' },
    ] satisfies RawRoundMatch[]);

    expect(status).toMatchObject({
      hasUnavailableStatus: false,
      allFinal: false,
      anyLive: true,
      earliestStartAt: new Date('2026-07-04T08:00:00.000Z'),
    });
  });
});
