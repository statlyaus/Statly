import {
  aflTradeMatchedBidPrice,
  AFL_TRADE_MATCHED_BID_PRICE_RULES,
  type AflTradeMatchedBidPriceInput,
  type AflTradeMatchedBidPriceRefusal,
  type AflTradeMatchedBidPriceRule,
} from './matchedBidPriceRules';

/**
 * Matched-bid shares (issue 789, value-line method): each pick a club spent matching a bid owns a
 * share of the nominee, in proportion to the points it covered of the price. Owner-approved rules,
 * 2026-10-17:
 * - The price comes from the draft year's AFL rule (`matchedBidPriceRules.ts`), never from the
 *   board's bid-level `points_used`.
 * - The club spends its next pick first. Each spent pick counts at its points when spent (the board's
 *   per-pick `points_used`, its live slot), in full, until the price is met. The last pick counts only
 *   for what was still owed; its remainder is the leftover pick, an asset of its own valued by its own
 *   outcome, never part of the nominee.
 * - A shortfall is a deficit against the club's first pick of the next draft. It is recorded, never
 *   valued here.
 * - A spent pick's share is its counted points over the price.
 */

export interface AflTradeMatchedBidSpentPick {
  readonly nativePickId: string;
  /** The pick's points when spent, as the board states them. */
  readonly pointsUsed: number;
}

export interface AflTradeMatchedBidShareInput extends AflTradeMatchedBidPriceInput {
  /** The board's spent picks, in the order the board lists them. */
  readonly consumedPicks: readonly AflTradeMatchedBidSpentPick[];
  /** The leftover-points picks the board says the match created. */
  readonly leftoverPicks?: readonly {
    readonly nativePickId: string;
    readonly points: number | null;
  }[];
}

export interface AflTradeMatchedBidPickShare {
  readonly nativePickId: string;
  readonly pointsUsed: number;
  /** The points this pick covered of the price. */
  readonly countedPoints: number;
  /** `countedPoints` over the price: the pick's share of the nominee. */
  readonly share: number;
  readonly use: 'full' | 'partial';
}

export type AflTradeMatchedBidShareRefusal =
  | AflTradeMatchedBidPriceRefusal
  | 'spend_order_not_descending'
  | 'spent_beyond_price'
  | 'spent_picks_over_limit'
  | 'leftover_mismatch';

export type AflTradeMatchedBidShares =
  | {
      readonly status: 'shared';
      readonly ruleId: string;
      /** Null when the club's next selection paid in full (2025, from selection 37). */
      readonly pricePoints: number | null;
      readonly picks: readonly AflTradeMatchedBidPickShare[];
      /**
       * The last spent pick's unused points, which became the leftover pick: an asset of its own,
       * valued by its own outcome. `boardLeftoverPickIds` are the leftover-points picks the board
       * says the match created (empty when the board tracks none).
       */
      readonly leftover: {
        readonly spentNativePickId: string;
        readonly remainderPoints: number;
        readonly boardLeftoverPickIds: readonly string[];
      } | null;
      /**
       * What the spent picks fell short by. `points` is null when the next selection was owed and
       * the club spent none; the owed pick is not valued here.
       */
      readonly deficit: {
        readonly points: number | null;
        readonly against: 'next_draft_first_pick' | 'next_selection';
      } | null;
    }
  | {
      readonly status: 'refused';
      readonly reason: AflTradeMatchedBidShareRefusal;
      readonly detail: string;
    };

const refused = (
  reason: AflTradeMatchedBidShareRefusal,
  detail: string
): AflTradeMatchedBidShares => ({
  status: 'refused',
  reason,
  detail,
});

/** The next selection pays for the bid in full: one pick, a whole share, nothing left over. */
function nextPickShares(
  ruleId: string,
  picks: readonly AflTradeMatchedBidSpentPick[]
): AflTradeMatchedBidShares {
  if (picks.length > 1)
    return refused(
      'spent_beyond_price',
      `${ruleId} spends one selection; the board lists ${picks.length}.`
    );
  const [pick] = picks;
  return {
    status: 'shared',
    ruleId,
    pricePoints: null,
    picks: pick
      ? [
          {
            nativePickId: pick.nativePickId,
            pointsUsed: pick.pointsUsed,
            countedPoints: pick.pointsUsed,
            share: 1,
            use: 'full',
          },
        ]
      : [],
    leftover: null,
    deficit: pick ? null : { points: null, against: 'next_selection' },
  };
}

/**
 * Each spent pick's share of a matched bid's nominee, or why it cannot be given. Arithmetic is in
 * tenths of a point, so the price and every counted share are exact.
 */
export function aflTradeMatchedBidShares(
  bid: AflTradeMatchedBidShareInput,
  rules: readonly AflTradeMatchedBidPriceRule[] = AFL_TRADE_MATCHED_BID_PRICE_RULES
): AflTradeMatchedBidShares {
  const price = aflTradeMatchedBidPrice(bid, rules);
  if (price.status === 'refused') return price;
  const picks = bid.consumedPicks;
  if (price.maximumSpentPicks !== null && picks.length > price.maximumSpentPicks)
    return refused(
      'spent_picks_over_limit',
      `${price.ruleId} allows ${price.maximumSpentPicks} picks; the board lists ${picks.length}.`
    );
  // Draft value never rises down the order, so the next pick first means points never rise.
  if (picks.some((pick, index) => index > 0 && pick.pointsUsed > picks[index - 1]!.pointsUsed))
    return refused('spend_order_not_descending', 'The spent picks are not listed next pick first.');
  const shares =
    price.priceTenths === null
      ? nextPickShares(price.ruleId, picks)
      : pointsShares(bid, price.ruleId, price.priceTenths);
  // A board leftover pick that carries points says the match left points over. When the rule leaves
  // none, its points would count twice: in the last spent pick's share and in the leftover's outcome.
  if (
    shares.status === 'shared' &&
    shares.leftover === null &&
    (bid.leftoverPicks ?? []).some(({ points }) => points !== null)
  )
    return refused(
      'leftover_mismatch',
      `The board lists a leftover pick with points, but ${price.ruleId} leaves none over.`
    );
  return shares;
}

/** Points-priced shares: picks in full until the price is met, the last for what was owed. */
function pointsShares(
  bid: AflTradeMatchedBidShareInput,
  ruleId: string,
  priceTenths: number
): AflTradeMatchedBidShares {
  const picks = bid.consumedPicks;
  let owedTenths = priceTenths;
  const shares: AflTradeMatchedBidPickShare[] = [];
  let leftover: { spentNativePickId: string; remainderPoints: number } | null = null;
  for (const pick of picks) {
    if (owedTenths <= 0)
      return refused(
        'spent_beyond_price',
        `Pick ${pick.nativePickId} is listed after the price of ${priceTenths / 10} was met.`
      );
    const pointsTenths = pick.pointsUsed * 10;
    const countedTenths = Math.min(pointsTenths, owedTenths);
    owedTenths -= countedTenths;
    shares.push({
      nativePickId: pick.nativePickId,
      pointsUsed: pick.pointsUsed,
      countedPoints: countedTenths / 10,
      share: countedTenths / priceTenths,
      use: countedTenths === pointsTenths ? 'full' : 'partial',
    });
    if (countedTenths < pointsTenths)
      leftover = {
        spentNativePickId: pick.nativePickId,
        remainderPoints: (pointsTenths - countedTenths) / 10,
      };
  }
  return {
    status: 'shared',
    ruleId,
    pricePoints: priceTenths / 10,
    picks: shares,
    leftover: leftover && {
      ...leftover,
      boardLeftoverPickIds: (bid.leftoverPicks ?? []).map(({ nativePickId }) => nativePickId),
    },
    deficit: owedTenths > 0 ? { points: owedTenths / 10, against: 'next_draft_first_pick' } : null,
  };
}
