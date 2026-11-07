import { describe, expect, it } from 'vitest';
import type { BasketballRosterSlotCounts, NbaStatLine } from '@/types/basketball';
import { planAddDrop, type FreeAgent } from './addDrop';
import type { LineupRosterEntry } from './lineupSimulator';
import { emptyStatLine } from './statLine';

function statLine(values: Partial<NbaStatLine>): NbaStatLine {
  return { ...emptyStatLine(), ...values };
}

const SLOTS: BasketballRosterSlotCounts = {
  PG: 0,
  SG: 0,
  G: 0,
  SF: 0,
  PF: 0,
  F: 0,
  C: 0,
  UTIL: 2,
  BN: 1,
  IL: 0,
};

function entry(playerId: string, value: number): LineupRosterEntry {
  return {
    playerId,
    positions: ['SF'],
    value,
    onInjuredList: false,
    out: false,
    acquiredOn: '2026-10-19',
  };
}

const D1 = '2026-11-06';
const D2 = '2026-11-07';
const D3 = '2026-11-08';

// Two UTIL slots. Now: D1 star + drop, D2 star + bench, D3 star + drop.
// Week now: PTS 186, REB 65, FG 75/160 (46.9 %), TO 20 v opponent PTS 190, REB 80, FG 45 %, TO 25.
const INPUT = {
  categories: ['PTS', 'REB', 'FG_PCT', 'TO'] as const,
  slots: SLOTS,
  remainingDays: [
    { date: D1, playing: ['star', 'drop', 'big'] },
    { date: D2, playing: ['star', 'bench', 'big', 'scorer'] },
    { date: D3, playing: ['star', 'drop', 'big', 'scorer', 'role'] },
  ],
  me: {
    roster: [entry('star', 10), entry('drop', 5), entry('bench', 1)],
    perGame: {
      star: statLine({
        points: 20,
        rebounds: 5,
        fieldGoalsMade: 8,
        fieldGoalsAttempted: 16,
        turnovers: 2,
      }),
      drop: statLine({
        points: 10,
        rebounds: 2,
        fieldGoalsMade: 4,
        fieldGoalsAttempted: 10,
        turnovers: 1,
      }),
      bench: statLine({ points: 6, rebounds: 6, fieldGoalsMade: 3, fieldGoalsAttempted: 5 }),
    },
    actual: statLine({
      points: 100,
      rebounds: 40,
      fieldGoalsMade: 40,
      fieldGoalsAttempted: 87,
      turnovers: 12,
    }),
  },
  opponentTotal: statLine({
    points: 190,
    rebounds: 80,
    fieldGoalsMade: 45,
    fieldGoalsAttempted: 100,
    turnovers: 25,
  }),
  dropPlayerId: 'drop',
  addFrom: D2,
};

function freeAgent(playerId: string, value: number, perGame: Partial<NbaStatLine>): FreeAgent {
  return { playerId, positions: ['C'], value, perGame: statLine(perGame) };
}

const FREE_AGENTS = [
  freeAgent('idle', 2, {}),
  freeAgent('big', 3, {
    points: 8,
    rebounds: 12,
    fieldGoalsMade: 4,
    fieldGoalsAttempted: 6,
    turnovers: 1,
  }),
  freeAgent('role', 2, {
    points: 12,
    rebounds: 4,
    fieldGoalsMade: 5,
    fieldGoalsAttempted: 10,
    turnovers: 1,
  }),
  freeAgent('scorer', 4, {
    points: 25,
    rebounds: 3,
    fieldGoalsMade: 11,
    fieldGoalsAttempted: 22,
    turnovers: 3,
  }),
];

describe('planAddDrop', () => {
  it('describes the week now, with need weights and the drop’s remaining contribution', () => {
    const plan = planAddDrop({ ...INPUT, freeAgents: [] });

    expect(plan.now.total).toEqual(
      statLine({
        points: 186,
        rebounds: 65,
        fieldGoalsMade: 75,
        fieldGoalsAttempted: 160,
        turnovers: 20,
      })
    );
    expect(plan.now.categories.map((c) => [c.category, c.call, c.needWeight])).toEqual([
      ['PTS', 'TOSS_UP', 1], // 2 % behind
      ['REB', 'LOSS', 0.4], // 19 % behind
      ['FG_PCT', 'WIN', 1], // 4 % ahead
      ['TO', 'WIN', 0.1], // 20 % ahead
    ]);
    expect(plan.now.categoriesWon).toBe(2.5);
    expect(plan.dropRestOfWeek).toEqual(
      statLine({
        points: 20,
        rebounds: 4,
        fieldGoalsMade: 8,
        fieldGoalsAttempted: 20,
        turnovers: 2,
      })
    );
  });

  it('ranks free agents by categories gained this week, then by fit to needs', () => {
    const plan = planAddDrop({ ...INPUT, freeAgents: FREE_AGENTS });

    expect(
      plan.options.map((option) => [option.playerId, option.categoryChange, option.fit])
    ).toEqual([
      ['scorer', 0.5, expect.closeTo(11.52692, 4)],
      ['big', 0, expect.closeTo(6.22664, 4)],
      ['role', -0.5, expect.closeTo(-1.41053, 4)],
      ['idle', -0.5, expect.closeTo(-9.63108, 4)],
    ]);
  });

  it('re-simulates the lineup: the add counts from his add date and can push a bench player out', () => {
    const plan = planAddDrop({ ...INPUT, freeAgents: FREE_AGENTS });
    const big = plan.options.find((option) => option.playerId === 'big');

    // "big" plays all three days but only counts from D2; on D2 he takes the bench player's slot.
    expect(big?.gamesAdded).toBe(2);
    expect(big?.addRestOfWeek.rebounds).toBe(24);
    expect(big?.total).toEqual(
      statLine({
        points: 176,
        rebounds: 79,
        fieldGoalsMade: 72,
        fieldGoalsAttempted: 147,
        turnovers: 20,
      })
    );
    expect(big?.categoriesWon).toBe(2.5);
    expect(big?.categories.map((c) => c.call)).toEqual(['LOSS', 'TOSS_UP', 'WIN', 'WIN']);
  });

  it('weights a category 1.0 when the gap is exactly 10 %, 0.4 when behind by more', () => {
    const atTen = planAddDrop({
      ...INPUT,
      opponentTotal: { ...INPUT.opponentTotal, turnovers: 18 },
      freeAgents: [],
    });
    const beyond = planAddDrop({
      ...INPUT,
      opponentTotal: { ...INPUT.opponentTotal, turnovers: 17 },
      freeAgents: [],
    });

    expect(atTen.now.categories.find((c) => c.category === 'TO')?.needWeight).toBe(1);
    expect(beyond.now.categories.find((c) => c.category === 'TO')?.needWeight).toBe(0.4);
  });

  it('ignores a rostered player with no projection, now and after the swap', () => {
    const withUnprojected = planAddDrop({
      ...INPUT,
      me: { ...INPUT.me, roster: [...INPUT.me.roster, entry('unprojected', 20)] },
      remainingDays: INPUT.remainingDays.map((day) => ({
        ...day,
        playing: [...day.playing, 'unprojected'],
      })),
      freeAgents: FREE_AGENTS,
    });
    const without = planAddDrop({ ...INPUT, freeAgents: FREE_AGENTS });

    expect(withUnprojected.now.total).toEqual(without.now.total);
    expect(withUnprojected.options).toEqual(without.options);
  });
});
