import { describe, expect, it, vi } from 'vitest';

import {
  findMissingAflResults,
  findUnjoinedAflResults,
  missingResultWindow,
  readMissingAflResults,
  UNJOINED_RESULT_ROUND_SPAN_MS,
  type FixtureGame,
} from './missingAflResults';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2025-09-28T12:00:00Z');

function game(overrides: Partial<FixtureGame> = {}): FixtureGame {
  return {
    match_uid: '2025-R28-GEE-BRL',
    season: 2025,
    round_number: 28,
    home_team: 'Geelong',
    away_team: 'Brisbane Lions',
    // Scheduled end 3 hours after the start, so the result is due 9 hours after it.
    start_time_utc: new Date(NOW.getTime() - 9 * HOUR).toISOString(),
    ...overrides,
  };
}

const RESULT = { season: 2025, round: 28, matchUid: '2025-R28-GEE-BRL' };

describe('findMissingAflResults', () => {
  it('flags a game with no result 6 hours after its scheduled end', () => {
    expect(findMissingAflResults([game()], [], NOW)).toEqual([game()]);
  });

  it('does not flag a game before its result is due', () => {
    const recent = game({ start_time_utc: new Date(NOW.getTime() - 9 * HOUR + 1).toISOString() });
    expect(findMissingAflResults([recent], [], NOW)).toEqual([]);
  });

  it('does not flag a game with a stored result, whichever club is listed first', () => {
    expect(findMissingAflResults([game()], [RESULT], NOW)).toEqual([]);
    const reversed = { ...RESULT, matchUid: '2025-R28-BRL-GEE' };
    expect(findMissingAflResults([game()], [reversed], NOW)).toEqual([]);
  });

  it('a result from another round or season does not count', () => {
    expect(
      findMissingAflResults([game()], [{ ...RESULT, matchUid: '2025-R27-GEE-BRL' }], NOW)
    ).toHaveLength(1);
    expect(
      findMissingAflResults([game()], [{ ...RESULT, matchUid: '2024-R28-GEE-BRL' }], NOW)
    ).toHaveLength(1);
  });

  it('agrees with scoring: a result scoring cannot join by matchUid still counts as missing (#1315)', () => {
    // The row's own round column says 28, but its matchUid (what scoring joins on) names round 29.
    const relabelled = { ...RESULT, matchUid: '2025-R29-GEE-BRL' };
    expect(findMissingAflResults([game()], [relabelled], NOW)).toEqual([game()]);
  });

  it('ignores games before the look-back and unreadable start times', () => {
    const { from } = missingResultWindow(NOW);
    const old = game({ start_time_utc: new Date(from.getTime() - 1).toISOString() });
    expect(findMissingAflResults([old, game({ start_time_utc: 'TBC' })], [], NOW)).toEqual([]);
  });
});

describe('findUnjoinedAflResults (#1315)', () => {
  it('flags a stored result of a due round that no fixture game joins', () => {
    const stray = { season: 2025, round: 28, matchUid: '2025-R28-GEE-SYD' };
    expect(findUnjoinedAflResults([game()], [RESULT, stray], NOW)).toEqual([stray]);
  });

  it('accepts a result whose home/away order differs from the fixture', () => {
    const reversed = { ...RESULT, matchUid: '2025-R28-BRL-GEE' };
    expect(findUnjoinedAflResults([game()], [reversed], NOW)).toEqual([]);
  });

  it('leaves results of rounds with no due game alone', () => {
    const older = { season: 2025, round: 20, matchUid: '2025-R20-GEE-SYD' };
    expect(findUnjoinedAflResults([game()], [older], NOW)).toEqual([]);
  });
});

describe('readMissingAflResults', () => {
  it('reads the fixture around the window and only current results', async () => {
    const other = game({ match_uid: '2025-R27-SYD-CAR', round_number: 27 });
    const readFixture = vi.fn().mockResolvedValue([game(), other]);
    const findMany = vi.fn().mockResolvedValue([RESULT]);

    const run = await readMissingAflResults({
      now: NOW,
      prisma: { aflMatchResult: { findMany } } as never,
      readFixture,
    });

    const { from } = missingResultWindow(NOW);
    expect(readFixture).toHaveBeenCalledWith(
      new Date(from.getTime() - UNJOINED_RESULT_ROUND_SPAN_MS).toISOString(),
      NOW.toISOString()
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { season: { in: [2025] }, supersededById: null } })
    );
    expect(run).toEqual({ checked: 2, missing: [other], unjoined: [] });
  });

  it('skips the database when no game is due', async () => {
    const findMany = vi.fn();
    const run = await readMissingAflResults({
      now: NOW,
      prisma: { aflMatchResult: { findMany } } as never,
      readFixture: vi.fn().mockResolvedValue([]),
    });
    expect(run).toEqual({ checked: 0, missing: [], unjoined: [] });
    expect(findMany).not.toHaveBeenCalled();
  });
});
