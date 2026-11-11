import { describe, expect, it, vi } from 'vitest';

import {
  findMissingAflResults,
  missingResultWindow,
  readMissingAflResults,
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

const RESULT = { season: 2025, round: 28, homeClub: 'Geelong', awayClub: 'Brisbane Lions' };

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
    const reversed = { ...RESULT, homeClub: RESULT.awayClub, awayClub: RESULT.homeClub };
    expect(findMissingAflResults([game()], [reversed], NOW)).toEqual([]);
  });

  it('a result from another round or season does not count', () => {
    expect(findMissingAflResults([game()], [{ ...RESULT, round: 27 }], NOW)).toHaveLength(1);
    expect(findMissingAflResults([game()], [{ ...RESULT, season: 2024 }], NOW)).toHaveLength(1);
  });

  it('ignores games before the look-back and unreadable start times', () => {
    const { from } = missingResultWindow(NOW);
    const old = game({ start_time_utc: new Date(from.getTime() - 1).toISOString() });
    expect(findMissingAflResults([old, game({ start_time_utc: 'TBC' })], [], NOW)).toEqual([]);
  });
});

describe('readMissingAflResults', () => {
  it('reads the window from the fixture and only current results', async () => {
    const readFixture = vi
      .fn()
      .mockResolvedValue([game(), game({ match_uid: 'other', round_number: 27 })]);
    const findMany = vi.fn().mockResolvedValue([RESULT]);

    const run = await readMissingAflResults({
      now: NOW,
      prisma: { aflMatchResult: { findMany } } as never,
      readFixture,
    });

    const { from, to } = missingResultWindow(NOW);
    expect(readFixture).toHaveBeenCalledWith(from.toISOString(), to.toISOString());
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { season: { in: [2025] }, supersededById: null } })
    );
    expect(run).toEqual({ checked: 2, missing: [game({ match_uid: 'other', round_number: 27 })] });
  });

  it('skips the database when no game is due', async () => {
    const findMany = vi.fn();
    const run = await readMissingAflResults({
      now: NOW,
      prisma: { aflMatchResult: { findMany } } as never,
      readFixture: vi.fn().mockResolvedValue([]),
    });
    expect(run).toEqual({ checked: 0, missing: [] });
    expect(findMany).not.toHaveBeenCalled();
  });
});
