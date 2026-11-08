import { describe, expect, it } from 'vitest';

import { addDays } from './fantasyWeeks';
import { buildRotation, type RotationGameRow, type RotationPlayerInfo } from './rotation';

/**
 * One team's box score in shorthand. Each player's entry: `S30` started and played 30 minutes,
 * `B12` came off the bench for 12, `CD` coach's decision, `INJ`, `REST`, `SUSP` other DNPs. A
 * player missing from the object was not dressed (ESPN does not list him).
 */
function game(
  teamCode: string,
  gameDate: string,
  lineup: Record<string, string>,
  box: Partial<Record<string, Partial<RotationGameRow>>> = {}
): RotationGameRow[] {
  const dnp = { CD: 'COACH_DECISION', INJ: 'INJURY', REST: 'REST', SUSP: 'SUSPENDED' } as const;
  return Object.entries(lineup).map(([playerId, entry]) => {
    const played = /^[SB]\d+$/.test(entry);
    return {
      gameId: `${teamCode}-${gameDate}`,
      gameDate,
      teamCode,
      playerId,
      starter: /^S\d+$/.test(entry),
      played,
      dnpReason: played ? null : dnp[entry as keyof typeof dnp],
      secondsPlayed: played ? Number(entry.slice(1)) * 60 : 0,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      freeThrowsAttempted: 0,
      plusMinus: 0,
      ...box[playerId],
    };
  });
}

/** `count` games for a team on consecutive days from 20 Oct 2026, built by `lineupFor(index)`. */
function season(
  teamCode: string,
  count: number,
  lineupFor: (index: number) => Record<string, string>,
  box: (index: number) => Partial<Record<string, Partial<RotationGameRow>>> = () => ({})
): RotationGameRow[] {
  return Array.from({ length: count }, (_, index) =>
    game(teamCode, addDays('2026-10-20', index), lineupFor(index), box(index))
  ).flat();
}

const FIVE = { a: 'S30', b: 'S30', c: 'S30', d: 'S30', e: 'S30' };

describe('buildRotation teams', () => {
  it('counts starting fives and changes, and says why each starter left the five', () => {
    const rows = [
      ...game('BOS', '2026-10-21', { ...FIVE, f: 'B20', g: 'CD' }),
      ...game('BOS', '2026-10-23', { ...FIVE, f: 'B20', g: 'CD' }),
      ...game('BOS', '2026-10-25', { ...FIVE, e: 'B15', f: 'S30', g: 'B5' }),
      // d is not dressed; g joins the five.
      ...game('BOS', '2026-10-27', { a: 'S30', b: 'S30', c: 'S30', e: 'CD', f: 'S30', g: 'S30' }),
    ];

    const [bos] = buildRotation(rows).teams;

    expect(bos).toEqual({
      teamCode: 'BOS',
      gamesPlayed: 4,
      uniqueFives: 3,
      uniqueFivesLast10: 3,
      fiveChanges: 2,
      lastChange: {
        gameDate: '2026-10-27',
        into: ['g'],
        out: [{ playerId: 'd', why: 'not dressed' }],
      },
      // g twice, e once, over 4 games.
      coachDnpsPerGameLast10: 0.75,
      // 6 + 6 + 6 (e's 15 counts, g's 5 does not) + 5.
      tenMinutePlayersPerGameLast10: 5.75,
    });
  });

  it('names each did-not-play reason the way the sheet does', () => {
    const rows = [
      ...game('NYK', '2026-10-21', { p1: 'S30', p2: 'S30', p3: 'S30', p4: 'S30', p5: 'S30' }),
      ...game('NYK', '2026-10-22', {
        p1: 'INJ',
        p2: 'REST',
        p3: 'SUSP',
        p4: 'CD',
        p5: 'S30',
        q1: 'S30',
        q2: 'S30',
        q3: 'S30',
        q4: 'S30',
      }),
    ];

    expect(buildRotation(rows).teams[0].lastChange).toEqual({
      gameDate: '2026-10-22',
      into: ['q1', 'q2', 'q3', 'q4'],
      out: [
        { playerId: 'p1', why: 'injured' },
        { playerId: 'p2', why: 'rested' },
        { playerId: 'p3', why: 'suspended' },
        { playerId: 'p4', why: 'DNP-CD' },
      ],
    });
  });

  it('uses only the last 10 team games for the L10 numbers', () => {
    // Twelve games: a different five in each of the first two, then one five; coach DNPs early only.
    const rows = season('DEN', 12, (index) =>
      index === 0
        ? { ...FIVE, e: 'B10', x: 'S30', y: 'CD' }
        : index === 1
          ? { ...FIVE, e: 'B10', z: 'S30', y: 'CD' }
          : { ...FIVE, y: 'B12' }
    );

    const [den] = buildRotation(rows).teams;

    expect(den.gamesPlayed).toBe(12);
    expect(den.uniqueFives).toBe(3);
    expect(den.uniqueFivesLast10).toBe(1);
    expect(den.fiveChanges).toBe(2);
    expect(den.coachDnpsPerGameLast10).toBe(0);
    expect(den.tenMinutePlayersPerGameLast10).toBe(6);
  });
});

describe('buildRotation players', () => {
  // LAL: w starts five games, then is not dressed; v comes off the bench, then starts for him.
  const lal = season('LAL', 6, (index) => ({
    l1: 'S30',
    l2: 'S30',
    l3: 'S30',
    l4: 'S30',
    ...(index < 5 ? { w: 'S32', v: 'B18' } : { v: 'S30' }),
  }));
  const player = (rows: RotationGameRow[], playerId: string) =>
    buildRotation(rows).players.find((candidate) => candidate.playerId === playerId);

  it('shows a starter who was not dressed for the last game', () => {
    expect(player(lal, 'w')).toEqual({
      playerId: 'w',
      teamCode: 'LAL',
      gamesPlayed: 5,
      gamesStarted: 5,
      startsLast5: 4,
      teamGamesLast5: 5,
      lastGame: 'NOT_DRESSED',
      lastGameDate: '2026-10-25',
      coachDnpsLast10: 0,
      lastCoachDnpOn: null,
      fiveChange: { direction: 'OUT_OF', gameDate: '2026-10-25', why: 'not dressed' },
      minutesPerGame: 32,
      role: 'Starter',
      summary:
        'Last game: Not dressed · Starter (started 4 of 5) · Out of starting five 25 Oct (not dressed) · team used 2 starting fives in last 10',
      alert: null,
    });
  });

  it('shows the player who moved into the five', () => {
    expect(player(lal, 'v')).toMatchObject({
      gamesPlayed: 6,
      gamesStarted: 1,
      startsLast5: 1,
      lastGame: 'STARTED',
      fiveChange: { direction: 'INTO', gameDate: '2026-10-25', why: null },
      minutesPerGame: 20,
      role: 'Spot starter',
      summary:
        'Spot starter (started 1 of 5) · Into starting five 25 Oct · team used 2 starting fives in last 10',
    });
  });

  it('counts coach DNPs in the last 10 team games and dates the latest', () => {
    const rows = season('DEN', 12, (index) => ({
      ...FIVE,
      z: index < 10 ? 'B15' : 'CD',
      k: index === 0 || index === 5 ? 'CD' : 'B4',
    }));

    expect(player(rows, 'z')).toMatchObject({
      gamesPlayed: 10,
      lastGame: 'DNP_CD',
      coachDnpsLast10: 2,
      lastCoachDnpOn: '2026-10-31',
      role: 'Bench',
      summary:
        'Last game: DNP-CD · Bench (started 0 of 5) · DNP-CD 2 in last 10 · team used 1 starting five in last 10',
    });
    // k's first-game DNP is outside the last 10.
    expect(player(rows, 'k')).toMatchObject({ coachDnpsLast10: 1, lastCoachDnpOn: '2026-10-25' });
  });

  it('labels every last-game status', () => {
    const rows = [
      ...game('NYK', '2026-10-21', { p1: 'S30', p2: 'S30', p3: 'S30', p4: 'S30', p5: 'S30' }),
      ...game('NYK', '2026-10-22', {
        p1: 'INJ',
        p2: 'REST',
        p3: 'SUSP',
        p4: 'CD',
        p5: 'S30',
        q1: 'S30',
        q2: 'S30',
        q3: 'S30',
        q4: 'B20',
        q5: 'CD',
      }),
    ];
    const status = (playerId: string) => player(rows, playerId)?.lastGame;

    expect(['p1', 'p2', 'p3', 'p4', 'p5', 'q4'].map(status)).toEqual([
      'OUT',
      'REST',
      'SUSPENDED',
      'DNP_CD',
      'STARTED',
      'BENCH',
    ]);
    expect(player(rows, 'q5')).toMatchObject({ gamesPlayed: 0, role: 'DNP', minutesPerGame: 0 });
  });

  it('shows a traded player once, with his new team and that team’s games only', () => {
    const rows = [
      ...game('BOS', '2026-10-21', { ...FIVE, t: 'B20' }),
      ...game('BOS', '2026-10-23', { ...FIVE, t: 'B20' }),
      ...game('BOS', '2026-10-27', FIVE),
      ...game('NYK', '2026-10-24', { p1: 'S30', p2: 'S30', p3: 'S30', p4: 'S30', p5: 'S30' }),
      ...game('NYK', '2026-10-26', { p1: 'S30', p2: 'S30', p3: 'S30', p4: 'S30', t: 'S36' }),
    ];

    const traded = buildRotation(rows).players.filter((candidate) => candidate.playerId === 't');

    expect(traded).toHaveLength(1);
    expect(traded[0]).toMatchObject({
      teamCode: 'NYK',
      gamesPlayed: 1,
      gamesStarted: 1,
      minutesPerGame: 36,
      lastGame: 'STARTED',
    });
  });
});

describe('buildRotation alerts', () => {
  const alertOf = (
    rows: RotationGameRow[],
    playerId: string,
    info?: ReadonlyMap<string, RotationPlayerInfo>
  ) => buildRotation(rows, info).players.find((p) => p.playerId === playerId)?.alert ?? null;

  it('is red for a rotation player with a coach DNP in the last two team games', () => {
    const rows = season('DEN', 12, (index) => ({
      ...FIVE,
      z: index < 10 ? 'B15' : 'CD',
      // Under 12 minutes a game: a coach DNP is no news.
      k: index < 11 ? 'B6' : 'CD',
    }));

    expect(alertOf(rows, 'z')).toEqual({
      level: 'RED',
      text: 'DNP-CD 31 Oct',
      roleUp: null,
    });
    expect(alertOf(rows, 'k')).toBeNull();
  });

  it('is red for an established starter benched, green for the player who replaced him', () => {
    const rows = season('DEN', 12, (index) => ({
      a: 'S30',
      b: 'S30',
      c: 'S30',
      d: 'S30',
      ...(index < 9 ? { x: 'S30', y: 'B20' } : { x: 'B24', y: 'S30' }),
    }));

    expect(alertOf(rows, 'x')).toEqual({
      level: 'RED',
      text: 'Benched 29 Oct',
      roleUp: null,
    });
    expect(alertOf(rows, 'y')).toEqual({
      level: 'GREEN',
      text: 'New starter 29 Oct',
      roleUp: 'EARNED',
    });
  });

  it('calls a new starter injury cover when he replaced a starter who is out', () => {
    const lal = season('LAL', 6, (index) => ({
      l1: 'S30',
      l2: 'S30',
      l3: 'S30',
      l4: 'S30',
      ...(index < 5 ? { w: 'S32', v: 'B18' } : { v: 'S30' }),
    }));
    const info = new Map<string, RotationPlayerInfo>([
      ['w', { name: 'Will Walker', position: 'C', returnOn: '2026-11-20' }],
      ['v', { name: 'Vic Vale', position: 'C', returnOn: null }],
    ]);

    expect(alertOf(lal, 'v', info)).toEqual({
      level: 'GREEN',
      text: 'Starting for Walker (back 20 Nov)',
      roleUp: 'INJURY_COVER',
    });
    expect(alertOf(lal, 'w', info)).toBeNull();
  });

  it('pairs two new starters with absent starters by position', () => {
    const rows = season('MIA', 4, (index) => ({
      a: 'S30',
      b: 'S30',
      c: 'S30',
      // The two new starters are listed in the other order from the two they replace.
      ...(index < 3 ? { g1: 'S30', c1: 'S30', g2: 'B15', c2: 'B15' } : { c2: 'S30', g2: 'S30' }),
    }));
    const info = new Map<string, RotationPlayerInfo>([
      ['g1', { name: 'Gus Guard', position: 'G', returnOn: null }],
      ['c1', { name: 'Cal Centre', position: 'C', returnOn: null }],
      ['g2', { name: 'Gil Guard', position: 'G', returnOn: null }],
      ['c2', { name: 'Cy Centre', position: 'C', returnOn: null }],
    ]);

    expect(alertOf(rows, 'c2', info)?.text).toBe('Starting for Centre');
    expect(alertOf(rows, 'g2', info)?.text).toBe('Starting for Guard');
  });

  it('does not call a starter back from an absence a new starter, nor flag a one-game spot start', () => {
    const rows = season('PHI', 6, (index) => ({
      a: 'S30',
      b: 'S30',
      c: 'S30',
      d: 'S30',
      ...(index === 4 ? { u: 'S25' } : { r: 'S30', u: 'B15' }),
    }));

    expect(alertOf(rows, 'r')).toBeNull();
    expect(alertOf(rows, 'u')).toBeNull();
  });

  it('is green when the last three games’ median minutes are 5 or more above his average', () => {
    const rows = season('ORL', 12, (index) => ({
      ...FIVE,
      m: index < 9 ? 'B15' : `B${17 + index}`,
    }));

    expect(alertOf(rows, 'm')).toEqual({
      level: 'GREEN',
      text: 'Min 27 last 3 (avg 18)',
      roleUp: 'MINUTES_UP',
    });
  });

  it('flags a bench risk for a starter shooting badly without getting to the line', () => {
    const rows = season(
      'CHA',
      6,
      () => FIVE,
      () => ({ a: { fieldGoalsMade: 3, fieldGoalsAttempted: 10, freeThrowsAttempted: 0 } })
    );

    expect(alertOf(rows, 'a')).toEqual({
      level: 'AMBER',
      text: 'Bench risk ↑',
      roleUp: null,
    });
  });

  it('gives no bench risk to a starter who was out or not dressed for the last game', () => {
    const shooting = { fieldGoalsMade: 3, fieldGoalsAttempted: 10, freeThrowsAttempted: 0 };
    const rows = (lastEntry: string | null) =>
      season(
        'CHA',
        7,
        (index) => {
          if (index < 6) return FIVE;
          const { a: _a, ...others } = FIVE;
          return lastEntry ? { ...others, f: 'S30', a: lastEntry } : { ...others, f: 'S30' };
        },
        () => ({ a: shooting })
      );

    // Deliberately unlike the sheet: an absent starter is not at risk of losing his spot.
    expect(alertOf(rows(null), 'a')).toBeNull();
    expect(alertOf(rows('INJ'), 'a')).toBeNull();
  });

  it('keeps the two most important items: DNP risk, then minutes down', () => {
    // 14 games off the bench: 30 minutes, then 20 in the last three, losing his minutes badly.
    const rows = season(
      'SAC',
      14,
      (index) => ({ ...FIVE, n: index < 11 ? 'B30' : 'B20' }),
      () => ({ n: { fieldGoalsMade: 3, fieldGoalsAttempted: 10, plusMinus: -6 } })
    );

    expect(alertOf(rows, 'n')).toEqual({
      level: 'AMBER',
      text: 'DNP risk ↑ · Min 20 last 3 (avg 28)',
      roleUp: null,
    });
  });
});
