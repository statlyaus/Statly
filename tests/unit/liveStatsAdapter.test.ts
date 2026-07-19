import { describe, expect, it } from 'vitest';

import {
  normalizeLiveStatRows,
  normalizeRoundMatchStatus,
  type RawLiveStatRow,
  type RawRoundMatch,
} from '@/server/leagues/liveStatsAdapter';

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
