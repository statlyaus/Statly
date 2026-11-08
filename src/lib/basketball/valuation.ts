/**
 * Player value: Statly's own volume-weighted z-scores per category, totalled over the league's
 * categories that are not punted, and auction dollars over replacement.
 * Pure and isomorphic. See docs/domain/basketball.md, "Valuation and matchup maths".
 */

import {
  BASKETBALL_CATEGORIES,
  type BasketballCategoryDefinition,
  type BasketballCategoryId,
} from '@/types/basketball';
import type { PlayerProjection } from './projection';

export interface PlayerValue {
  playerId: string;
  /** z for every catalog category, oriented so higher is better (turnovers negated). */
  categoryZ: Record<BasketballCategoryId, number>;
  /** Sum of z over the league's categories that are not punted. */
  total: number;
  /** 1 = most valuable. */
  rank: number;
  /** Whether the player is in the pool the means and spreads come from. */
  inPool: boolean;
}

export interface ValuationOptions {
  categories: readonly BasketballCategoryId[];
  punts?: readonly BasketballCategoryId[];
  /** Blended minutes per game a player needs to join the pool. */
  minPoolMinutes?: number;
}

/** Players' raw score in a category before standardising: the count, or makes above pool rate. */
function rawScores(
  players: readonly PlayerProjection[],
  pool: readonly PlayerProjection[],
  category: BasketballCategoryDefinition
): number[] {
  if (category.kind === 'COUNT') return players.map((player) => player.perGame[category.stat]);
  const poolMade = pool.reduce((sum, player) => sum + player.perGame[category.made], 0);
  const poolAttempted = pool.reduce((sum, player) => sum + player.perGame[category.attempted], 0);
  const poolPct = poolAttempted > 0 ? poolMade / poolAttempted : 0;
  // (pct − poolPct) × attempts, written so zero attempts needs no division.
  return players.map(
    (player) => player.perGame[category.made] - poolPct * player.perGame[category.attempted]
  );
}

function meanAndPopulationSd(values: readonly number[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * Values every player with at least one game in either season. The pool is the players with
 * blended minutes per game of at least `minPoolMinutes` (default 20). Counting categories:
 * `z = (x − poolMean) / poolSd`. Percentages: impact `(pct − poolPct) × attempts`, with
 * `poolPct = Σmakes / Σattempts` over the pool, then z of impact. Low-wins categories are negated.
 * A category with no spread in the pool scores 0. Returned sorted by rank.
 */
export function valuePlayers(
  projections: readonly PlayerProjection[],
  options: ValuationOptions
): PlayerValue[] {
  const minPoolMinutes = options.minPoolMinutes ?? 20;
  const players = projections.filter(
    (player) => player.gamesThisSeason + player.gamesLastSeason >= 1
  );
  const inPool = players.map((player) => player.minutesPerGame >= minPoolMinutes);
  const pool = players.filter((_, index) => inPool[index]);
  const counted = new Set(
    options.categories.filter((category) => !(options.punts ?? []).includes(category))
  );

  const zByCategory = BASKETBALL_CATEGORIES.map((category) => {
    const scores = rawScores(players, pool, category);
    const { mean, sd } = meanAndPopulationSd(scores.filter((_, index) => inPool[index]));
    const sign = category.direction === 'LOW_WINS' ? -1 : 1;
    // `|| 0` turns a negated zero into 0 so it never displays as "-0".
    return scores.map((score) => (sd > 0 ? (sign * (score - mean)) / sd || 0 : 0));
  });

  const values = players.map((player, index) => {
    const categoryZ = Object.fromEntries(
      BASKETBALL_CATEGORIES.map((category, c) => [category.id, zByCategory[c][index]])
    ) as Record<BasketballCategoryId, number>;
    const total = BASKETBALL_CATEGORIES.reduce(
      (sum, category) => sum + (counted.has(category.id) ? categoryZ[category.id] : 0),
      0
    );
    return { playerId: player.playerId, categoryZ, total, rank: 0, inPool: inPool[index] };
  });

  return values
    .sort((a, b) => b.total - a.total)
    .map((value, index) => ({ ...value, rank: index + 1 }));
}

export interface AuctionSettings {
  teamCount: number;
  /** Roster spots per team that are drafted (every slot except IL). */
  rosterSpots: number;
  budget: number;
}

/**
 * Auction dollars by player id. Replacement is the value of the (teams × spots + 1)th best player,
 * or the worst if there are fewer. A player above replacement is worth
 * `ROUND(1 + (v − repl) / Σ(v − repl)⁺ × (teams × budget − teams × spots))`; everyone else $1.
 */
export function auctionValues(
  values: readonly Pick<PlayerValue, 'playerId' | 'total'>[],
  settings: AuctionSettings
): Record<string, number> {
  if (values.length === 0) return {};
  const totals = values.map((value) => value.total).sort((a, b) => b - a);
  const drafted = settings.teamCount * settings.rosterSpots;
  const replacement = totals[Math.min(drafted, totals.length - 1)];
  const aboveReplacement = totals.reduce((sum, total) => sum + Math.max(0, total - replacement), 0);
  const dollarsAboveMinimum = settings.teamCount * settings.budget - drafted;

  return Object.fromEntries(
    values.map((value) => [
      value.playerId,
      value.total > replacement && aboveReplacement > 0
        ? Math.round(1 + ((value.total - replacement) / aboveReplacement) * dollarsAboveMinimum)
        : 1,
    ])
  );
}
