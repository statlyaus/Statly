/**
 * The AFL's price of a matched father-son, academy or next-generation-academy bid, by draft year
 * (issue 789, owner-approved 2026-10-17). The price is the bid slot's draft value index (DVI) points
 * after the year's discount. It is never Footyinfo's bid-level `points_used`: that nets the leftover
 * pick at its final slot (2021 Sam Darcy: 1,889 against a true price of 2,013.6). The bid's own
 * `points` is the DVI of the bid slot (audited against the AFL's figures for every year).
 *
 * Sources, all audited 2026-10-17:
 * - 2019 to 2024 (the boards' first year to the last on these rules): the 2015 DVI. A first-round bid (the whole round, not slots 1 to 18) is 20% off;
 *   a later bid is 197 points off (the 20% discount at pick 18). AFL 42435, 526342, 1428548.
 * - 2025: a new DVI (points to pick 54); 10% off selections 1 to 18, 84 points off 19 to 36, and from
 *   37 the club's next selection. AFL 1185312.
 * - 2026: a loading or discount by the matching club's finishing position that season (final ranking
 *   including finals): 1st-2nd 20% loading and 3rd-4th 10% loading on bids 1 to 18, no adjustment for
 *   them from 19 to 36; 5th-10th no adjustment on 1 to 36; 11th-18th 10% off 1 to 36; at most two
 *   current-draft picks for a bid up to 36; from 37 the club's next pick; a deficit of up to 412 DVI
 *   points off the club's next first-round pick. The 2026 DVI (54 slots) is the AFL's draft order page.
 *   AFL 1508240 (rules), AFL 1508308 (examples), https://www.afl.com.au/draft/draft-order (DVI);
 *   owner-approved 2026-11-24. The rule also needs the club to hold a first-round pick in the next
 *   draft for any deficit; that is not modelled (no 2026 bid is refused or priced by it).
 */

/** How a band turns the bid's DVI points into a price. */
export type AflTradeMatchedBidPriceAdjustment =
  | { readonly kind: 'percent_off'; readonly percent: number }
  | { readonly kind: 'points_off'; readonly points: number }
  /** The club's next selection pays for the bid in full, whatever its points. */
  | { readonly kind: 'next_pick' }
  /** The year's rule says something the boards never need; refused rather than modelled. */
  | { readonly kind: 'not_modelled'; readonly rule: string };

/** Inclusive bounds; `through: null` is open-ended. */
interface Bounds {
  readonly from: number;
  readonly through: number | null;
}

export interface AflTradeMatchedBidPriceBand {
  /** The bid's round on the board. A band with rounds needs the round. */
  readonly rounds?: Bounds;
  /** The bid's selection number. */
  readonly selections?: Bounds;
  /** The matching club's ladder position the season before (2026 on). */
  readonly ladder?: Bounds;
  readonly price: AflTradeMatchedBidPriceAdjustment;
}

export interface AflTradeMatchedBidPriceRule {
  readonly ruleId: string;
  readonly fromDraftYear: number;
  readonly throughDraftYear: number | null;
  /** The source of the rule, for the record. */
  readonly source: string;
  /** False while the AFL has not published a value the rule needs: every bid is refused. */
  readonly valuesPublished: boolean;
  /** The most picks a club may spend; null when the rule sets no limit. */
  readonly maximumSpentPicks: number | null;
  /**
   * The largest deficit the rule allows, in DVI points; a bigger one is refused, never priced. Null
   * when the rule sets no limit. A field so it can be corrected once the AFL text is verified.
   */
  readonly maximumDeficitPoints: number | null;
  /**
   * The year's DVI points by slot (index 0 is pick 1), when the bid's evidence does not state them and
   * the rule's source publishes them. Absent when every bid states its own points (a Footyinfo board).
   */
  readonly dvi?: readonly number[];
  /** Bands in order: the first that matches prices the bid. */
  readonly bands: readonly AflTradeMatchedBidPriceBand[];
}

export const AFL_TRADE_MATCHED_BID_PRICE_RULES: readonly AflTradeMatchedBidPriceRule[] = [
  {
    ruleId: 'afl-bid-price-2015-dvi',
    fromDraftYear: 2019,
    throughDraftYear: 2024,
    source: 'AFL 42435 (2015 rules); 20% confirmed for 2020 (AFL 526342) and 2022 (AFL 1428548)',
    valuesPublished: true,
    maximumSpentPicks: null,
    maximumDeficitPoints: null,
    bands: [
      { rounds: { from: 1, through: 1 }, price: { kind: 'percent_off', percent: 20 } },
      {
        selections: { from: 57, through: null },
        price: {
          kind: 'not_modelled',
          rule: "a bid after pick 56 is matched with the club's last pick",
        },
      },
      { rounds: { from: 2, through: null }, price: { kind: 'points_off', points: 197 } },
    ],
  },
  {
    ruleId: 'afl-bid-price-2025-dvi',
    fromDraftYear: 2025,
    throughDraftYear: 2025,
    source: 'AFL 1185312 (2025 rules)',
    valuesPublished: true,
    maximumSpentPicks: null,
    maximumDeficitPoints: null,
    bands: [
      { selections: { from: 1, through: 18 }, price: { kind: 'percent_off', percent: 10 } },
      { selections: { from: 19, through: 36 }, price: { kind: 'points_off', points: 84 } },
      { selections: { from: 37, through: null }, price: { kind: 'next_pick' } },
    ],
  },
  {
    // The ladder bands as the AFL states them; a club 19th or lower (from 2027) has no band yet.
    ruleId: 'afl-bid-price-2026-ladder',
    fromDraftYear: 2026,
    throughDraftYear: null,
    source:
      'AFL 1508240 (2026 rules); AFL 1508308 examples; afl.com.au/draft/draft-order (2026 DVI)',
    valuesPublished: true,
    maximumSpentPicks: 2,
    maximumDeficitPoints: 412,
    dvi: [
      3000, 2481, 2178, 1962, 1795, 1659, 1543, 1443, 1355, 1276, 1205, 1140, 1080, 1024, 973, 924,
      879, 836, 796, 757, 721, 686, 653, 621, 590, 561, 533, 505, 479, 454, 429, 405, 382, 360, 338,
      317, 297, 277, 257, 238, 220, 202, 184, 167, 150, 134, 118, 102, 86, 71, 57, 42, 28, 14,
    ],
    bands: [
      { selections: { from: 37, through: null }, price: { kind: 'next_pick' } },
      {
        ladder: { from: 1, through: 2 },
        selections: { from: 1, through: 18 },
        price: { kind: 'percent_off', percent: -20 },
      },
      {
        ladder: { from: 3, through: 4 },
        selections: { from: 1, through: 18 },
        price: { kind: 'percent_off', percent: -10 },
      },
      {
        ladder: { from: 1, through: 4 },
        selections: { from: 19, through: 36 },
        price: { kind: 'percent_off', percent: 0 },
      },
      {
        ladder: { from: 5, through: 10 },
        selections: { from: 1, through: 36 },
        price: { kind: 'percent_off', percent: 0 },
      },
      {
        ladder: { from: 11, through: 18 },
        selections: { from: 1, through: 36 },
        price: { kind: 'percent_off', percent: 10 },
      },
    ],
  },
];

export type AflTradeMatchedBidPriceRefusal =
  | 'rule_missing'
  | 'rule_values_missing'
  | 'band_missing'
  | 'round_missing'
  | 'ladder_position_missing'
  | 'rule_not_modelled'
  | 'price_not_positive';

export interface AflTradeMatchedBidPriceInput {
  readonly draftYear: number;
  readonly selectionNumber: number;
  readonly roundNumber: number | null;
  /** The bid slot's DVI points, as the board states them. */
  readonly points: number;
  /** The matching club's finishing position that season, which only the 2026 rule reads. */
  readonly ladderPosition?: number | null;
}

/** A price in tenths of a point, so 20% off 2,517 is exactly 20,136 (2,013.6 points). */
export type AflTradeMatchedBidPrice =
  | {
      readonly status: 'priced';
      readonly ruleId: string;
      readonly band: AflTradeMatchedBidPriceBand;
      readonly maximumSpentPicks: number | null;
      readonly maximumDeficitPoints: number | null;
      /** Null for `next_pick`: the club's next selection pays in full. */
      readonly priceTenths: number | null;
    }
  | {
      readonly status: 'refused';
      readonly reason: AflTradeMatchedBidPriceRefusal;
      readonly detail: string;
    };

const within = (value: number, bounds: Bounds | undefined) =>
  bounds === undefined ||
  (value >= bounds.from && (bounds.through === null || value <= bounds.through));

const refused = (
  reason: AflTradeMatchedBidPriceRefusal,
  detail: string
): AflTradeMatchedBidPrice => ({ status: 'refused', reason, detail });

const NEEDED = {
  round_missing: 'round',
  ladder_position_missing: "matching club's ladder position",
};

function bandMatches(band: AflTradeMatchedBidPriceBand, bid: AflTradeMatchedBidPriceInput) {
  if (band.rounds !== undefined && bid.roundNumber === null) return 'round_missing' as const;
  if (band.ladder !== undefined && (bid.ladderPosition ?? null) === null)
    return 'ladder_position_missing' as const;
  return (
    within(bid.selectionNumber, band.selections) &&
    (band.rounds === undefined || within(bid.roundNumber!, band.rounds)) &&
    (band.ladder === undefined || within(bid.ladderPosition!, band.ladder))
  );
}

function priceTenths(adjustment: AflTradeMatchedBidPriceAdjustment, points: number): number | null {
  if (adjustment.kind === 'percent_off') {
    if (adjustment.percent % 10 !== 0)
      throw new Error('A bid discount must be whole tens of percent.');
    return (points * (100 - adjustment.percent)) / 10;
  }
  if (adjustment.kind === 'points_off') return (points - adjustment.points) * 10;
  return null;
}

/** The year's rule for a draft, if one is recorded. */
function ruleOf(draftYear: number, rules: readonly AflTradeMatchedBidPriceRule[]) {
  return rules.find(
    ({ fromDraftYear, throughDraftYear }) =>
      draftYear >= fromDraftYear && (throughDraftYear === null || draftYear <= throughDraftYear)
  );
}

/**
 * A slot's DVI points from the year's rule, for evidence that states the slot but not its points (a
 * Draftguru post-draft order row). Null when the rule publishes no DVI or none for that slot.
 */
export function aflTradeMatchedBidSlotPoints(
  draftYear: number,
  slot: number,
  rules: readonly AflTradeMatchedBidPriceRule[] = AFL_TRADE_MATCHED_BID_PRICE_RULES
): number | null {
  const rule = ruleOf(draftYear, rules);
  if (!rule?.valuesPublished || !Number.isInteger(slot) || slot < 1) return null;
  return rule.dvi?.[slot - 1] ?? null;
}

/** The year's rule applied to one bid, or the reason it cannot be priced. Never a guess. */
export function aflTradeMatchedBidPrice(
  bid: AflTradeMatchedBidPriceInput,
  rules: readonly AflTradeMatchedBidPriceRule[] = AFL_TRADE_MATCHED_BID_PRICE_RULES
): AflTradeMatchedBidPrice {
  const rule = ruleOf(bid.draftYear, rules);
  if (!rule)
    return refused('rule_missing', `No AFL bid-matching rule is recorded for ${bid.draftYear}.`);
  if (!rule.valuesPublished)
    return refused('rule_values_missing', `${rule.ruleId} needs values the AFL has not published.`);
  for (const band of rule.bands) {
    const match = bandMatches(band, bid);
    if (match === false) continue;
    if (match !== true)
      return refused(
        match,
        `${rule.ruleId} needs the ${NEEDED[match]}, which the bid does not state.`
      );
    if (band.price.kind === 'not_modelled')
      return refused('rule_not_modelled', `${rule.ruleId}: ${band.price.rule}.`);
    const tenths = priceTenths(band.price, bid.points);
    if (tenths !== null && tenths <= 0)
      return refused(
        'price_not_positive',
        `${rule.ruleId} prices pick ${bid.selectionNumber} at ${tenths / 10}.`
      );
    return {
      status: 'priced',
      ruleId: rule.ruleId,
      band,
      maximumSpentPicks: rule.maximumSpentPicks,
      maximumDeficitPoints: rule.maximumDeficitPoints,
      priceTenths: tenths,
    };
  }
  return refused('band_missing', `${rule.ruleId} has no band for pick ${bid.selectionNumber}.`);
}
