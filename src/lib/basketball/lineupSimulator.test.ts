import { describe, expect, it } from 'vitest';
import {
  YAHOO_DEFAULT_ROSTER_SLOTS,
  type BasketballRosterSlotCounts,
  type NbaStatLine,
} from '@/types/basketball';
import {
  countedActuals,
  countedGames,
  eligibleSlots,
  simulateLineups,
  type LineupRosterEntry,
} from './lineupSimulator';
import { emptyStatLine } from './statLine';

const MONDAY = '2026-11-02';
const TUESDAY = '2026-11-03';
const WEDNESDAY = '2026-11-04';

function slots(counts: Partial<BasketballRosterSlotCounts>): BasketballRosterSlotCounts {
  return { PG: 0, SG: 0, G: 0, SF: 0, PF: 0, F: 0, C: 0, UTIL: 0, BN: 0, IL: 0, ...counts };
}

function entry(
  playerId: string,
  positions: string[],
  value: number,
  overrides: Partial<LineupRosterEntry> = {}
): LineupRosterEntry {
  return {
    playerId,
    positions,
    value,
    onInjuredList: false,
    out: false,
    acquiredOn: '2026-10-19',
    ...overrides,
  };
}

function startersOn(
  roster: LineupRosterEntry[],
  slotCounts: BasketballRosterSlotCounts,
  playing: string[]
): string[] {
  return simulateLineups({ roster, slots: slotCounts, days: [{ date: MONDAY, playing }] })[0]
    .starters;
}

describe('eligibleSlots', () => {
  it('maps NBA positions to the slots they can fill', () => {
    expect(eligibleSlots(['PG'])).toEqual(['PG', 'G', 'UTIL']);
    expect(eligibleSlots(['C'])).toEqual(['C', 'UTIL']);
    expect(eligibleSlots(['G'])).toEqual(['PG', 'SG', 'G', 'UTIL']);
    expect(eligibleSlots(['F'])).toEqual(['SF', 'PF', 'F', 'UTIL']);
  });

  it('takes the union of several positions, in any common spelling', () => {
    expect(eligibleSlots(['SG', 'SF'])).toEqual(['SG', 'G', 'SF', 'F', 'UTIL']);
    expect(eligibleSlots(['f-c'])).toEqual(['SF', 'PF', 'F', 'C', 'UTIL']);
  });

  it('allows only UTIL for an unknown position', () => {
    expect(eligibleSlots([])).toEqual(['UTIL']);
    expect(eligibleSlots(['XX'])).toEqual(['UTIL']);
  });
});

describe('simulateLineups', () => {
  it('starts the most valuable players with a game, then fills from the bench', () => {
    const roster = [entry('star', ['PG'], 9), entry('bench', ['SG'], 1), entry('idle', ['SG'], 8)];
    // One PG and one G slot: "idle" has no game, so "bench" fills the G slot.
    expect(startersOn(roster, slots({ PG: 1, G: 1, BN: 1 }), ['star', 'bench'])).toEqual([
      'star',
      'bench',
    ]);
  });

  it('blocks a player whose positions have no open slot', () => {
    // Two C slots and one UTIL: the fourth centre sits even though he outranks the point guard.
    const roster = [
      entry('c1', ['C'], 10),
      entry('c2', ['C'], 9),
      entry('c3', ['C'], 8),
      entry('c4', ['C'], 7),
      entry('pg', ['PG'], 1),
    ];
    expect(
      startersOn(roster, slots({ PG: 1, C: 2, UTIL: 1 }), ['c1', 'c2', 'c3', 'c4', 'pg'])
    ).toEqual(['c1', 'c2', 'c3', 'pg']);
  });

  it('moves an earlier starter to another slot when that lets one more player start', () => {
    // "big" can play F or C. "wing" can only play F, so "big" must move to C.
    const roster = [entry('big', ['PF', 'C'], 10), entry('wing', ['SF'], 5)];
    expect(startersOn(roster, slots({ F: 1, C: 1 }), ['big', 'wing'])).toEqual(['big', 'wing']);
  });

  it('puts an unknown position in UTIL only', () => {
    const roster = [entry('mystery', [], 10), entry('pg1', ['PG'], 5), entry('pg2', ['PG'], 4)];
    expect(startersOn(roster, slots({ PG: 1, UTIL: 1 }), ['mystery', 'pg1', 'pg2'])).toEqual([
      'mystery',
      'pg1',
    ]);
  });

  it('never starts injured-list or OUT players, or anyone before he was acquired', () => {
    const roster = [
      entry('il', ['PG'], 10, { onInjuredList: true }),
      entry('out', ['PG'], 9, { out: true }),
      entry('pickup', ['PG'], 8, { acquiredOn: TUESDAY }),
      entry('backup', ['PG'], 1),
    ];
    const lineups = simulateLineups({
      roster,
      slots: slots({ PG: 1, BN: 3, IL: 1 }),
      days: [
        { date: MONDAY, playing: ['il', 'out', 'pickup', 'backup'] },
        { date: TUESDAY, playing: new Set(['il', 'out', 'pickup', 'backup']) },
      ],
    });
    expect(lineups).toEqual([
      { date: MONDAY, starters: ['backup'] },
      { date: TUESDAY, starters: ['pickup'] },
    ]);
  });

  it('fills the Yahoo default roster from a full slate', () => {
    const roster = [
      entry('pg', ['PG'], 13),
      entry('sg', ['SG'], 12),
      entry('sf', ['SF'], 11),
      entry('pf', ['PF'], 10),
      entry('c1', ['C'], 9),
      entry('c2', ['C'], 8),
      entry('g', ['G'], 7),
      entry('f', ['F'], 6),
      entry('u1', ['G', 'F'], 5),
      entry('u2', ['C'], 4),
      entry('b1', ['PG'], 3),
      entry('b2', ['SF'], 2),
      entry('b3', ['C'], 1),
    ];
    const starters = startersOn(
      roster,
      YAHOO_DEFAULT_ROSTER_SLOTS,
      roster.map((player) => player.playerId)
    );
    expect(starters).toHaveLength(10);
    expect(starters).not.toContain('b1');
  });
});

describe('countedGames', () => {
  it('counts each player’s starts in a date range', () => {
    const lineups = [
      { date: MONDAY, starters: ['a', 'b'] },
      { date: TUESDAY, starters: ['a'] },
      { date: WEDNESDAY, starters: ['a', 'b'] },
    ];
    expect(countedGames(lineups)).toEqual({ a: 3, b: 2 });
    expect(countedGames(lineups, { from: TUESDAY })).toEqual({ a: 2, b: 1 });
    expect(countedGames(lineups, { from: TUESDAY, to: TUESDAY })).toEqual({ a: 1 });
  });
});

describe('countedActuals', () => {
  function statLine(values: Partial<NbaStatLine>): NbaStatLine {
    return { ...emptyStatLine(), ...values };
  }

  it('sums the box-score lines of the players who would have started', () => {
    const roster = [
      entry('a', ['PG'], 10),
      entry('b', ['PG'], 5),
      entry('hurt-now', ['C'], 8, { out: true }),
      entry('stashed', ['C'], 9, { onInjuredList: true }),
    ];
    const result = countedActuals({
      roster,
      slots: slots({ PG: 1, C: 1, BN: 2, IL: 1 }),
      days: [
        {
          date: MONDAY,
          lines: {
            a: statLine({ points: 20, fieldGoalsMade: 8, fieldGoalsAttempted: 15 }),
            b: statLine({ points: 30 }),
            'hurt-now': statLine({ points: 12, rebounds: 10 }),
            stashed: statLine({ points: 40 }),
          },
        },
        { date: TUESDAY, lines: { b: statLine({ points: 7 }) } },
      ],
    });

    // Monday: a beats b to the PG slot; "hurt-now" played then, so he counts; IL never counts.
    // Tuesday: only b played.
    expect(result.lineups).toEqual([
      { date: MONDAY, starters: ['a', 'hurt-now'] },
      { date: TUESDAY, starters: ['b'] },
    ]);
    expect(result.total).toEqual(
      statLine({ points: 39, rebounds: 10, fieldGoalsMade: 8, fieldGoalsAttempted: 15 })
    );
    expect(result.byPlayer.b).toEqual(statLine({ points: 7 }));
    expect(result.byPlayer.stashed).toBeUndefined();
  });
});
