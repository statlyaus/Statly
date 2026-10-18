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
 * - 2026 on: a ladder-based loading or discount, at most two picks to match a bid up to 36, on a DVI
 *   adjusted for 19 clubs whose values are not published. AFL 1508308.
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
    bands: [
      { selections: { from: 1, through: 18 }, price: { kind: 'percent_off', percent: 10 } },
      { selections: { from: 19, through: 36 }, price: { kind: 'points_off', points: 84 } },
      { selections: { from: 37, through: null }, price: { kind: 'next_pick' } },
    ],
  },
  {
    // The ladder bands as the AFL states them. The 19-club DVI is not published, nor is what a top
    // club pays from 19 to 36 or any club after 36, so every bid is refused until they are.
    ruleId: 'afl-bid-price-2026-ladder',
    fromDraftYear: 2026,
    throughDraftYear: null,
    source: 'AFL 1508308 (2026 rules)',
    valuesPublished: false,
    maximumSpentPicks: 2,
    bands: [
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
        ladder: { from: 5, through: 10 },
        selections: { from: 1, through: 18 },
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
  /** The matching club's ladder position, which only the 2026 rule reads. */
  readonly ladderPosition?: number | null;
}

/** A price in tenths of a point, so 20% off 2,517 is exactly 20,136 (2,013.6 points). */
export type AflTradeMatchedBidPrice =
  | {
      readonly status: 'priced';
      readonly ruleId: string;
      readonly band: AflTradeMatchedBidPriceBand;
      readonly maximumSpentPicks: number | null;
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

/** The year's rule applied to one bid, or the reason it cannot be priced. Never a guess. */
export function aflTradeMatchedBidPrice(
  bid: AflTradeMatchedBidPriceInput,
  rules: readonly AflTradeMatchedBidPriceRule[] = AFL_TRADE_MATCHED_BID_PRICE_RULES
): AflTradeMatchedBidPrice {
  const rule = rules.find(
    ({ fromDraftYear, throughDraftYear }) =>
      bid.draftYear >= fromDraftYear &&
      (throughDraftYear === null || bid.draftYear <= throughDraftYear)
  );
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
      priceTenths: tenths,
    };
  }
  return refused('band_missing', `${rule.ruleId} has no band for pick ${bid.selectionNumber}.`);
}
