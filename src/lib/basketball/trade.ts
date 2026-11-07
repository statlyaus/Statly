/**
 * Manual trade check by category z, as the sheet's Trades tab: season value only, no schedule.
 * Pure and isomorphic. See docs/domain/basketball.md, "Valuation and matchup maths".
 */

import type { BasketballCategoryId } from '@/types/basketball';
import type { PlayerValue } from './valuation';

/** A category net under this (in z) is even. */
export const TRADE_EVEN_BAND = 0.25;

export type TradeVerdict = 'GAIN' | 'LOSS' | 'EVEN';

export interface TradeCategory {
  category: BasketballCategoryId;
  /** Σ z of the players I give. */
  give: number;
  /** Σ z of the players I get. */
  get: number;
  /** `get − give`; positive favours me. */
  net: number;
  verdict: TradeVerdict;
  punted: boolean;
}

export interface TradeEvaluation {
  categories: TradeCategory[];
  /** Σ net over the league's categories that are not punted. */
  totalNet: number;
  /** Verdict counts over categories that are not punted. */
  summary: { gains: number; losses: number; evens: number };
}

export function evaluateTrade(input: {
  give: readonly Pick<PlayerValue, 'categoryZ'>[];
  get: readonly Pick<PlayerValue, 'categoryZ'>[];
  categories: readonly BasketballCategoryId[];
  punts?: readonly BasketballCategoryId[];
}): TradeEvaluation {
  const sum = (players: readonly Pick<PlayerValue, 'categoryZ'>[], id: BasketballCategoryId) =>
    players.reduce((total, player) => total + player.categoryZ[id], 0);

  const categories = input.categories.map((category): TradeCategory => {
    const give = sum(input.give, category);
    const get = sum(input.get, category);
    const net = get - give;
    const verdict = Math.abs(net) < TRADE_EVEN_BAND ? 'EVEN' : net > 0 ? 'GAIN' : 'LOSS';
    return { category, give, get, net, verdict, punted: (input.punts ?? []).includes(category) };
  });
  const counted = categories.filter((category) => !category.punted);
  const count = (verdict: TradeVerdict) => counted.filter((c) => c.verdict === verdict).length;

  return {
    categories,
    totalNet: counted.reduce((total, category) => total + category.net, 0),
    summary: { gains: count('GAIN'), losses: count('LOSS'), evens: count('EVEN') },
  };
}
