/**
 * Daily lineup simulator: who would start each day, given positions and slot counts.
 * Pure and isomorphic. See docs/domain/basketball.md, "Valuation and matchup maths".
 */

import {
  BASKETBALL_ROSTER_SLOTS,
  type BasketballRosterSlot,
  type BasketballRosterSlotCounts,
  type NbaStatLine,
} from '@/types/basketball';
import type { EasternDate } from './fantasyWeeks';
import { addStatLines, emptyStatLine } from './statLine';

export interface LineupRosterEntry {
  playerId: string;
  /** Positions as the provider lists them (`NbaPlayer.positions`), e.g. `['G']` or `['SF', 'PF']`. */
  positions: readonly string[];
  /** Ranking value: the higher, the earlier he is put in the lineup. */
  value: number;
  onInjuredList: boolean;
  /** Ruled out (injury status OUT). Day-to-day players count as playing. */
  out: boolean;
  /** First Eastern date he counts for this team. */
  acquiredOn: EasternDate;
}

export interface LineupDay {
  date: EasternDate;
  /** Player ids whose NBA team plays that day. May include players not on the roster. */
  playing: ReadonlySet<string> | readonly string[];
}

export interface DailyLineup {
  date: EasternDate;
  /** Starters in the order they were placed (value, highest first). */
  starters: string[];
}

const POSITION_SLOTS: Readonly<Record<string, readonly BasketballRosterSlot[]>> = {
  PG: ['PG', 'G'],
  SG: ['SG', 'G'],
  SF: ['SF', 'F'],
  PF: ['PF', 'F'],
  C: ['C'],
  // ESPN's generic guard and forward.
  G: ['PG', 'SG', 'G'],
  F: ['SF', 'PF', 'F'],
};

/**
 * The starter slots a player can fill, in catalog order. Several positions (or `"F-C"`) give the
 * union; every player can fill UTIL, and an unknown position fills UTIL only.
 */
export function eligibleSlots(positions: readonly string[]): BasketballRosterSlot[] {
  const allowed = new Set<BasketballRosterSlot>(['UTIL']);
  for (const token of positions.flatMap((position) => position.toUpperCase().split(/[^A-Z]+/))) {
    for (const slot of POSITION_SLOTS[token] ?? []) allowed.add(slot);
  }
  return BASKETBALL_ROSTER_SLOTS.filter((slot) => allowed.has(slot));
}

function starterSlotList(slots: BasketballRosterSlotCounts): BasketballRosterSlot[] {
  return BASKETBALL_ROSTER_SLOTS.filter((slot) => slot !== 'BN' && slot !== 'IL').flatMap((slot) =>
    Array.from({ length: Math.max(0, slots[slot]) }, () => slot)
  );
}

/**
 * Adds candidates in order, keeping a player only if he raises the maximum matching between
 * players and starter slots (Kuhn's augmenting paths). Greedy is optimal here: the sets of players
 * that can all start form a matroid. `slotIndices` are the starter slots each candidate can fill.
 */
function chooseStarters(
  candidates: readonly { playerId: string; slotIndices: readonly number[] }[],
  slotCount: number
): string[] {
  const slotHolder: number[] = Array.from({ length: slotCount }, () => -1);

  const assign = (player: number, seen: boolean[]): boolean => {
    for (const slot of candidates[player].slotIndices) {
      if (seen[slot]) continue;
      seen[slot] = true;
      if (slotHolder[slot] === -1 || assign(slotHolder[slot], seen)) {
        slotHolder[slot] = player;
        return true;
      }
    }
    return false;
  };

  return candidates.flatMap((candidate, index) => {
    const seen = Array.from({ length: slotCount }, () => false);
    return assign(index, seen) ? [candidate.playerId] : [];
  });
}

/**
 * Per day, the players who start: those with a game, not on the injured list, not OUT and already
 * acquired, taken by value (highest first) while each one still fits a starter slot.
 */
export function simulateLineups(input: {
  roster: readonly LineupRosterEntry[];
  slots: BasketballRosterSlotCounts;
  days: readonly LineupDay[];
}): DailyLineup[] {
  const slotList = starterSlotList(input.slots);
  const byValue = [...input.roster]
    .sort((a, b) => b.value - a.value)
    .map((player) => {
      const allowed = new Set(eligibleSlots(player.positions));
      const slotIndices = slotList.flatMap((slot, index) => (allowed.has(slot) ? [index] : []));
      return { ...player, slotIndices };
    });
  return input.days.map((day) => {
    const playing = day.playing instanceof Set ? day.playing : new Set(day.playing);
    const candidates = byValue.filter(
      (player) =>
        playing.has(player.playerId) &&
        !player.onInjuredList &&
        !player.out &&
        player.acquiredOn <= day.date
    );
    return { date: day.date, starters: chooseStarters(candidates, slotList.length) };
  });
}

/** Starts per player id over the lineups, optionally limited to `from`–`to` inclusive. */
export function countedGames(
  lineups: readonly DailyLineup[],
  range: { from?: EasternDate; to?: EasternDate } = {}
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lineup of lineups) {
    if ((range.from && lineup.date < range.from) || (range.to && lineup.date > range.to)) continue;
    for (const playerId of lineup.starters) counts[playerId] = (counts[playerId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Stats already counted this week. There is no lineup log, so past days are simulated too: the
 * players who played that day (they have a box-score line) compete for slots, the injured list
 * still applies, today's OUT status does not. Lines of players who are no longer on the roster
 * are lost.
 */
export function countedActuals(input: {
  roster: readonly LineupRosterEntry[];
  slots: BasketballRosterSlotCounts;
  days: readonly { date: EasternDate; lines: Readonly<Record<string, NbaStatLine>> }[];
}): { total: NbaStatLine; byPlayer: Record<string, NbaStatLine>; lineups: DailyLineup[] } {
  const lineups = simulateLineups({
    roster: input.roster.map((player) => ({ ...player, out: false })),
    slots: input.slots,
    days: input.days.map((day) => ({ date: day.date, playing: Object.keys(day.lines) })),
  });
  const byPlayer: Record<string, NbaStatLine> = {};
  let total = emptyStatLine();
  lineups.forEach((lineup, index) => {
    for (const playerId of lineup.starters) {
      const line = input.days[index].lines[playerId];
      byPlayer[playerId] = addStatLines(byPlayer[playerId] ?? emptyStatLine(), line);
      total = addStatLines(total, line);
    }
  });
  return { total, byPlayer, lineups };
}
