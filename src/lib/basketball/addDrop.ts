/**
 * Add/drop planner: for one drop candidate, how each free agent changes this week's categories
 * against the opponent. Ported from the sheet's Add/Drop Planner, with the lineup re-simulated.
 * Pure and isomorphic. See docs/domain/basketball.md, "Valuation and matchup maths".
 */

import {
  getBasketballCategory,
  type BasketballCategoryId,
  type BasketballRosterSlotCounts,
  type NbaStatLine,
} from '@/types/basketball';
import type { EasternDate } from './fantasyWeeks';
import type { LineupDay, LineupRosterEntry } from './lineupSimulator';
import {
  compareCategory,
  projectRestOfWeek,
  type CategoryCall,
  type CategoryComparison,
  type MatchupSide,
} from './matchup';
import { addStatLines, categoryValue, emptyStatLine, scaleStatLine } from './statLine';

export interface FreeAgent {
  playerId: string;
  positions: readonly string[];
  value: number;
  perGame: NbaStatLine;
}

export interface NeedComparison extends CategoryComparison {
  /** 1.0 within 10 %, 0.4 when behind by more, 0.1 when ahead by more. */
  needWeight: number;
}

export interface AddDropOption {
  playerId: string;
  /** Games the free agent is simulated to start from `addFrom`. */
  gamesAdded: number;
  addRestOfWeek: NbaStatLine;
  /** My projected week after the swap. */
  total: NbaStatLine;
  categories: CategoryComparison[];
  /** Win 1, toss-up ½, loss 0. */
  categoriesWon: number;
  categoryChange: number;
  /** 100 × Σ need weight × relative change in the category. */
  fit: number;
}

export interface AddDropPlan {
  now: { total: NbaStatLine; categories: NeedComparison[]; categoriesWon: number };
  dropRestOfWeek: NbaStatLine;
  /** Sorted by category change, then fit, highest first. */
  options: AddDropOption[];
}

const CALL_POINTS: Record<CategoryCall, number> = { WIN: 1, TOSS_UP: 0.5, LOSS: 0 };

function needWeight(comparison: CategoryComparison): number {
  const scale = Math.max(Math.abs(comparison.me), Math.abs(comparison.opponent));
  const relative = scale > 0 ? comparison.margin / scale : 0;
  if (Math.abs(relative) <= 0.1) return 1;
  return relative < 0 ? 0.4 : 0.1;
}

function categoriesWon(categories: readonly CategoryComparison[]): number {
  return categories.reduce((sum, category) => sum + CALL_POINTS[category.call], 0);
}

/**
 * Drops `dropPlayerId` and adds each free agent from `addFrom`, re-running the lineup
 * simulator over the remaining days: the add starts only where he fits by value and position, and
 * may push a lower-valued teammate out. The drop loses every remaining day. `remainingDays` must
 * list the free agents among the players whose teams play. Filtering free agents (minutes,
 * injuries, ownership) is the caller's job.
 *
 * `dropPlayerId: null` drops nobody: on a full roster that models an extra roster spot. A caller
 * ranking pickups for a full roster must pass a real drop, such as the lowest-valued droppable
 * player.
 */
export function planAddDrop(input: {
  categories: readonly BasketballCategoryId[];
  slots: BasketballRosterSlotCounts;
  remainingDays: readonly LineupDay[];
  me: MatchupSide;
  /** The opponent's projected week (actuals plus rest of week). */
  opponentTotal: NbaStatLine;
  dropPlayerId: string | null;
  addFrom: EasternDate;
  freeAgents: readonly FreeAgent[];
}): AddDropPlan {
  const days = input.remainingDays.map((day) => ({
    date: day.date,
    playing: day.playing instanceof Set ? day.playing : new Set(day.playing),
  }));
  const compare = (total: NbaStatLine) =>
    input.categories.map((category) => compareCategory(total, input.opponentTotal, category));

  const current = projectRestOfWeek({ ...input.me, slots: input.slots, days });
  const nowTotal = addStatLines(input.me.actual, current.restOfWeek);
  const now = compare(nowTotal).map((c) => ({ ...c, needWeight: needWeight(c) }));
  const nowWon = categoriesWon(now);
  const dropPerGame = input.dropPlayerId ? input.me.perGame[input.dropPlayerId] : undefined;
  const dropGames = input.dropPlayerId ? (current.gamesLeft[input.dropPlayerId] ?? 0) : 0;

  const kept = input.me.roster.filter((player) => player.playerId !== input.dropPlayerId);
  const options = input.freeAgents.map((agent): AddDropOption => {
    const added: LineupRosterEntry = {
      playerId: agent.playerId,
      positions: agent.positions,
      value: agent.value,
      onInjuredList: false,
      out: false,
      acquiredOn: input.addFrom,
    };
    const after = projectRestOfWeek({
      roster: [...kept, added],
      perGame: { ...input.me.perGame, [agent.playerId]: agent.perGame },
      slots: input.slots,
      days,
    });
    const total = addStatLines(input.me.actual, after.restOfWeek);
    const categories = compare(total);
    const won = categoriesWon(categories);
    const gamesAdded = after.gamesLeft[agent.playerId] ?? 0;

    const fit =
      100 *
      now.reduce((sum, before) => {
        const category = getBasketballCategory(before.category);
        const change = categoryValue(total, category) - before.me;
        const scale =
          category.kind === 'PERCENT'
            ? before.me > 0
              ? before.me
              : 1
            : Math.max(before.opponent, 1);
        const sign = category.direction === 'LOW_WINS' ? -1 : 1;
        return sum + (before.needWeight * sign * change) / scale;
      }, 0);

    return {
      playerId: agent.playerId,
      gamesAdded,
      addRestOfWeek: scaleStatLine(agent.perGame, gamesAdded),
      total,
      categories,
      categoriesWon: won,
      categoryChange: won - nowWon,
      fit,
    };
  });

  return {
    now: { total: nowTotal, categories: now, categoriesWon: nowWon },
    dropRestOfWeek: dropPerGame ? scaleStatLine(dropPerGame, dropGames) : emptyStatLine(),
    options: options.sort((a, b) => b.categoryChange - a.categoryChange || b.fit - a.fit),
  };
}
