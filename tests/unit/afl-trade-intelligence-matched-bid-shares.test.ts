import { describe, expect, it } from 'vitest';

import { parseFootyinfoDraftBoard } from '@/server/aflTradeIntelligence/source/footyinfoDraftBoardAdapter';
import {
  aflTradeMatchedBidPrice,
  aflTradeMatchedBidSlotPoints,
  AFL_TRADE_MATCHED_BID_PRICE_RULES,
} from '@/server/aflTradeIntelligence/valuation/matchedBidPriceRules';
import {
  aflTradeMatchedBidShares,
  type AflTradeMatchedBidShareInput,
} from '@/server/aflTradeIntelligence/valuation/matchedBidShares';

import { FOOTYINFO_2021_MATCHED_BIDS } from '../testUtils/footyinfo2021MatchedBids';
import { footyinfoBoardPage } from '../testUtils/footyinfoDraftBoardPage';

const digest = (character: string) => character.repeat(64);

/** Sam Darcy's 2021 bid as parser v2 states it from the synthetic board. */
function darcyBid(): AflTradeMatchedBidShareInput {
  const result = parseFootyinfoDraftBoard(
    footyinfoBoardPage(FOOTYINFO_2021_MATCHED_BIDS, { year: 2021 }),
    {
      draftYear: 2021,
      capture: {
        captureId: `source-capture:${digest('1')}`,
        artifactId: `artifact:${digest('2')}`,
        contentSha256: digest('2'),
        mediaType: 'text/html; charset=utf-8',
        sourceUrl: 'https://www.footyinfo.com/draft/2021',
        capturedAt: '2026-10-17T01:00:00.000Z',
        effectiveAt: '2026-10-17T01:00:00.000Z',
        parserVersion: 'footyinfo-draft-board-parser/v2',
        fieldManifestSha256: digest('3'),
      },
    }
  );
  const claim = result.evidence
    .map(({ content }) => content.claim)
    .find(
      (claim) => claim.kind === 'draft_board_bid_match' && claim.player.recordedName === 'Sam Darcy'
    );
  if (claim?.kind !== 'draft_board_bid_match') throw new Error('Darcy bid missing');
  return claim;
}

const spent = (nativePickId: string, pointsUsed: number) => ({ nativePickId, pointsUsed });

/** 2020 Jamarra Ugle-Hagan, pick 1, next-generation academy (the board's ids and points). */
const UGLE_HAGAN = {
  draftYear: 2020,
  selectionNumber: 1,
  roundNumber: 1,
  points: 3000,
  consumedPicks: [
    spent('6036', 653),
    spent('5580', 563),
    spent('5589', 412),
    spent('6031', 395),
    spent('7366', 246),
    spent('5569', 220),
  ],
  leftoverPicks: [{ nativePickId: '5645', points: 207 }],
};

/** 2019 Liam Henry, pick 9, next-generation academy: Fremantle's picks fell short. */
const HENRY = {
  draftYear: 2019,
  selectionNumber: 9,
  roundNumber: 1,
  points: 1469,
  consumedPicks: [spent('7308', 287), spent('5439', 246), spent('5446', 207), spent('6007', 170)],
};

const sumShares = (result: ReturnType<typeof aflTradeMatchedBidShares>) =>
  result.status === 'shared' ? result.picks.reduce((total, { share }) => total + share, 0) : NaN;

describe('matched-bid prices by draft year (issue 789)', () => {
  it('prices a first-round bid at 20% off and a later one at 197 off, 2019 to 2024', () => {
    expect(
      aflTradeMatchedBidPrice({ draftYear: 2021, selectionNumber: 2, roundNumber: 1, points: 2517 })
    ).toMatchObject({
      status: 'priced',
      ruleId: 'afl-bid-price-2015-dvi',
      priceTenths: 20136,
    });
    // The first round is the round, not slots 1 to 18: 2024 pick 25 is still 20% off (605 by the AFL).
    expect(
      aflTradeMatchedBidPrice({ draftYear: 2024, selectionNumber: 25, roundNumber: 1, points: 756 })
    ).toMatchObject({
      priceTenths: 6048,
    });
    expect(
      aflTradeMatchedBidPrice({ draftYear: 2019, selectionNumber: 25, roundNumber: 2, points: 756 })
    ).toMatchObject({
      priceTenths: 5590,
    });
  });

  it('prices 2025 bids at 10% off to 18, 84 off to 36, and the next selection from 37', () => {
    const price = (selectionNumber: number, points: number) =>
      aflTradeMatchedBidPrice({ draftYear: 2025, selectionNumber, roundNumber: null, points });
    expect(price(2, 2481)).toMatchObject({ ruleId: 'afl-bid-price-2025-dvi', priceTenths: 22329 });
    expect(price(19, 948)).toMatchObject({ priceTenths: 8640 });
    expect(price(39, 257)).toMatchObject({ status: 'priced', priceTenths: null });
  });

  it('refuses rather than guesses', () => {
    // No rule is recorded before the boards' first year.
    expect(
      aflTradeMatchedBidPrice({ draftYear: 2018, selectionNumber: 3, roundNumber: 1, points: 2234 })
    ).toMatchObject({
      status: 'refused',
      reason: 'rule_missing',
    });
    // A rule whose values are not published refuses every bid.
    const unpublished = AFL_TRADE_MATCHED_BID_PRICE_RULES.map((rule) =>
      rule.ruleId === 'afl-bid-price-2026-ladder' ? { ...rule, valuesPublished: false } : rule
    );
    expect(
      aflTradeMatchedBidPrice(
        { draftYear: 2026, selectionNumber: 3, roundNumber: 1, points: 2178, ladderPosition: 1 },
        unpublished
      )
    ).toMatchObject({ status: 'refused', reason: 'rule_values_missing' });
    expect(aflTradeMatchedBidSlotPoints(2026, 6, unpublished)).toBeNull();
    // 2019 to 2024 need the round, and a bid after pick 56 follows a rule no board needs.
    expect(
      aflTradeMatchedBidPrice({
        draftYear: 2022,
        selectionNumber: 3,
        roundNumber: null,
        points: 2234,
      })
    ).toMatchObject({
      reason: 'round_missing',
    });
    expect(
      aflTradeMatchedBidPrice({ draftYear: 2022, selectionNumber: 60, roundNumber: 4, points: 140 })
    ).toMatchObject({
      reason: 'rule_not_modelled',
    });
    expect(
      aflTradeMatchedBidPrice({ draftYear: 2022, selectionNumber: 56, roundNumber: 3, points: 150 })
    ).toMatchObject({
      reason: 'price_not_positive',
    });
  });

  it('prices 2026 bids by the ladder bands the AFL states, and nothing it does not', () => {
    const bid = { draftYear: 2026, selectionNumber: 10, roundNumber: 1, points: 1276 };
    const at = (ladderPosition: number | null, selectionNumber = 10) =>
      aflTradeMatchedBidPrice({ ...bid, selectionNumber, ladderPosition });
    // 1st-2nd: 20% loading to 18; 3rd-4th: 10%; 5th-10th: none; 11th-18th: 10% off to 36.
    expect(at(1)).toMatchObject({ ruleId: 'afl-bid-price-2026-ladder', priceTenths: 15312 });
    expect(at(4)).toMatchObject({ priceTenths: 14036 });
    expect(at(7)).toMatchObject({ priceTenths: 12760 });
    expect(at(12)).toMatchObject({ priceTenths: 11484 });
    // From 19 a top-four club pays the DVI, as a 5th-10th club does to 36; 11th-18th stays 10% off.
    expect(at(2, 20)).toMatchObject({ priceTenths: 12760 });
    expect(at(9, 36)).toMatchObject({ priceTenths: 12760 });
    expect(at(18, 36)).toMatchObject({ priceTenths: 11484 });
    // From 37 the club's next pick pays, whatever its ladder position, even an unknown one.
    expect(at(null, 37)).toMatchObject({ status: 'priced', priceTenths: null });
    expect(at(null)).toMatchObject({ reason: 'ladder_position_missing' });
    // A 19th club (from 2027) has no band yet.
    expect(at(19)).toMatchObject({ reason: 'band_missing' });
    expect(AFL_TRADE_MATCHED_BID_PRICE_RULES.at(-1)).toMatchObject({
      maximumSpentPicks: 2,
      maximumDeficitPoints: 412,
    });
  });

  it('reads 2026 slot points from the AFL DVI, and none outside it or before 2026', () => {
    expect(
      [1, 6, 8, 13, 22, 33, 43, 53, 54].map((slot) => aflTradeMatchedBidSlotPoints(2026, slot))
    ).toEqual([3000, 1659, 1443, 1080, 686, 382, 184, 28, 14]);
    expect(aflTradeMatchedBidSlotPoints(2026, 55)).toBeNull();
    expect(aflTradeMatchedBidSlotPoints(2026, 0)).toBeNull();
    // Earlier years' bids state their own points (the boards); no DVI is stored for them.
    expect(aflTradeMatchedBidSlotPoints(2025, 6)).toBeNull();
    const dvi = AFL_TRADE_MATCHED_BID_PRICE_RULES.at(-1)!.dvi!;
    expect(dvi).toHaveLength(54);
    expect(dvi.every((points, index) => index === 0 || points < dvi[index - 1]!)).toBe(true);
  });
});

/**
 * The four 2026 bids as Draftguru's post-draft order states them (synthetic: slots only, points from
 * the AFL 2026 DVI), at the owner's 2026 ladder (final ranking including finals): Western Bulldogs
 * 7th, Carlton 8th, GWS 12th, Port Adelaide 15th.
 */
describe('2026 matched-bid shares (owner, 2026-11-24)', () => {
  const LADDER_2026 = { bulldogs: 7, carlton: 8, gws: 12, port: 15 };
  const dvi = (slot: number) => aflTradeMatchedBidSlotPoints(2026, slot)!;
  const bid2026 = (
    selectionNumber: number,
    usingPicks: readonly number[],
    ladderPosition: number | null,
    leftoverPicks: AflTradeMatchedBidShareInput['leftoverPicks'] = []
  ): AflTradeMatchedBidShareInput => ({
    draftYear: 2026,
    selectionNumber,
    roundNumber: 1,
    points: dvi(selectionNumber),
    ladderPosition,
    consumedPicks: usingPicks.map((slot) => spent(`as-${slot}`, dvi(slot))),
    leftoverPicks,
  });

  it('prices Port Adelaide’s match for Dougie Cochrane at 1 with picks 6 and 22', () => {
    // 1,659 + 686 = 2,345. At no adjustment the deficit would be 655, over the 412 the AFL allows.
    expect(aflTradeMatchedBidShares(bid2026(1, [6, 22], 7))).toMatchObject({
      status: 'refused',
      reason: 'deficit_over_limit',
    });
    expect(aflTradeMatchedBidShares(bid2026(1, [6, 22], LADDER_2026.port))).toEqual({
      status: 'shared',
      ruleId: 'afl-bid-price-2026-ladder',
      pricePoints: 2700,
      picks: [
        {
          nativePickId: 'as-6',
          pointsUsed: 1659,
          countedPoints: 1659,
          share: 1659 / 2700,
          use: 'full',
        },
        {
          nativePickId: 'as-22',
          pointsUsed: 686,
          countedPoints: 686,
          share: 686 / 2700,
          use: 'full',
        },
      ],
      leftover: null,
      deficit: { points: 355, against: 'next_draft_first_pick' },
    });
  });

  it('prices Carlton’s match for Cody Walker at 3 with picks 15 and 18', () => {
    // 973 + 836 = 1,809 against 2,178 (8th: no adjustment), 369 short.
    expect(aflTradeMatchedBidShares(bid2026(3, [15, 18], LADDER_2026.carlton))).toMatchObject({
      status: 'shared',
      pricePoints: 2178,
      picks: [
        { countedPoints: 973, share: 973 / 2178, use: 'full' },
        { countedPoints: 836, share: 836 / 2178, use: 'full' },
      ],
      leftover: null,
      deficit: { points: 369, against: 'next_draft_first_pick' },
    });
    // At 11th-18th it would be 10% off, 1,960.2.
    const shares = aflTradeMatchedBidShares(bid2026(3, [15, 18], 12));
    expect(shares).toMatchObject({
      pricePoints: 1960.2,
      picks: [
        { countedPoints: 973, share: 973 / 1960.2, use: 'full' },
        { countedPoints: 836, share: 836 / 1960.2, use: 'full' },
      ],
      leftover: null,
    });
    if (shares.status !== 'shared') throw new Error('unreachable');
    expect(shares.deficit!.points).toBeCloseTo(151.2, 10);
  });

  it('prices GWS’s match for Ethan Matthews at 6: pick 13 partly used, its rest Jake Eime’s pick 13', () => {
    const shares = aflTradeMatchedBidShares(
      bid2026(6, [8, 13], LADDER_2026.gws, [{ nativePickId: 'eime-13', points: null }])
    );
    // 10% off 1,659 is 1,493.1: pick 8 counts its 1,443, pick 13 the 50.1 still owed of its 1,080.
    expect(shares).toMatchObject({
      status: 'shared',
      pricePoints: 1493.1,
      picks: [
        { nativePickId: 'as-8', countedPoints: 1443, use: 'full' },
        { nativePickId: 'as-13', countedPoints: 50.1, use: 'partial' },
      ],
      leftover: {
        spentNativePickId: 'as-13',
        remainderPoints: 1029.9,
        boardLeftoverPickIds: ['eime-13'],
      },
      deficit: null,
    });
    expect(sumShares(shares)).toBeCloseTo(1, 12);
  });

  it('prices the Bulldogs’ match for Khaled El Souki at 33 with picks 43 and 53', () => {
    // 184 + 28 = 212 against 382 (7th: no adjustment): a deficit of 170, within the 412 allowed.
    expect(aflTradeMatchedBidShares(bid2026(33, [43, 53], LADDER_2026.bulldogs))).toEqual({
      status: 'shared',
      ruleId: 'afl-bid-price-2026-ladder',
      pricePoints: 382,
      picks: [
        {
          nativePickId: 'as-43',
          pointsUsed: 184,
          countedPoints: 184,
          share: 184 / 382,
          use: 'full',
        },
        { nativePickId: 'as-53', pointsUsed: 28, countedPoints: 28, share: 28 / 382, use: 'full' },
      ],
      leftover: null,
      deficit: { points: 170, against: 'next_draft_first_pick' },
    });
    // At 11th-18th it would be 343.8, 131.8 short.
    const shares = aflTradeMatchedBidShares(bid2026(33, [43, 53], 16));
    expect(shares).toMatchObject({
      pricePoints: 343.8,
      picks: [
        { countedPoints: 184, share: 184 / 343.8 },
        { countedPoints: 28, share: 28 / 343.8 },
      ],
    });
    if (shares.status !== 'shared') throw new Error('unreachable');
    expect(shares.deficit!.points).toBeCloseTo(131.8, 10);
  });

  it('refuses a 2026 bid with no ladder position, more than two picks, or a deficit over the cap', () => {
    expect(aflTradeMatchedBidShares(bid2026(6, [8, 13], null))).toMatchObject({
      reason: 'ladder_position_missing',
    });
    expect(aflTradeMatchedBidShares(bid2026(1, [6, 22, 30], 14))).toMatchObject({
      reason: 'spent_picks_over_limit',
    });
    // The cap is a rule field: a corrected cap changes what is refused, nothing else.
    const capped = AFL_TRADE_MATCHED_BID_PRICE_RULES.map((rule) =>
      rule.ruleId === 'afl-bid-price-2026-ladder' ? { ...rule, maximumDeficitPoints: 300 } : rule
    );
    expect(aflTradeMatchedBidShares(bid2026(1, [6, 22], 14), capped)).toMatchObject({
      reason: 'deficit_over_limit',
    });
  });
});

describe('matched-bid shares (issue 789)', () => {
  it('shares Sam Darcy’s 2021 match by points covered, pick 45 partly used', () => {
    const result = aflTradeMatchedBidShares(darcyBid());
    expect(result).toMatchObject({
      status: 'shared',
      ruleId: 'afl-bid-price-2015-dvi',
      pricePoints: 2013.6,
    });
    if (result.status !== 'shared') throw new Error('unreachable');
    expect(
      result.picks.map(({ nativePickId, countedPoints, use }) => [nativePickId, countedPoints, use])
    ).toEqual([
      ['7449', 542, 'full'],
      ['6042', 395, 'full'],
      ['6057', 378, 'full'],
      ['7451', 362, 'full'],
      ['5727', 336.6, 'partial'],
    ]);
    // Geelong's pick 34 covered 542 of 2,013.6: about 26.9% of Darcy.
    expect(result.picks[0]!.share).toBeCloseTo(542 / 2013.6, 12);
    expect(sumShares(result)).toBeCloseTo(1, 12);
    // Pick 45's 10.4 unused points became the Bulldogs' leftover pick 61 (Luke Cleary, board id
    // 5792): an asset of its own, never part of Darcy. The board's 1,889 is not the price.
    expect(result.leftover).toEqual({
      spentNativePickId: '5727',
      remainderPoints: 10.4,
      boardLeftoverPickIds: ['5792'],
    });
    expect(result.deficit).toBeNull();
  });

  it('shares Jamarra Ugle-Hagan’s 2020 match: 2,489 spent on a 2,400 price, 89 left over', () => {
    const result = aflTradeMatchedBidShares(UGLE_HAGAN);
    expect(result).toMatchObject({ status: 'shared', pricePoints: 2400, deficit: null });
    if (result.status !== 'shared') throw new Error('unreachable');
    expect(result.picks.reduce((total, { pointsUsed }) => total + pointsUsed, 0)).toBe(2489);
    expect(result.picks.at(-1)).toMatchObject({
      nativePickId: '5569',
      countedPoints: 131,
      use: 'partial',
    });
    // The AFL reported the 89 points back as pick 61.
    expect(result.leftover).toEqual({
      spentNativePickId: '5569',
      remainderPoints: 89,
      boardLeftoverPickIds: ['5645'],
    });
    expect(sumShares(result)).toBeCloseTo(1, 12);
  });

  it('records a deficit against the next draft’s first pick and values none of it', () => {
    const result = aflTradeMatchedBidShares(HENRY);
    // 1,469 × 0.8 = 1,175.2 against 910 spent: the AFL took 265 points off Fremantle's 2020 pick 7.
    expect(result).toMatchObject({
      status: 'shared',
      pricePoints: 1175.2,
      leftover: null,
      deficit: { points: 265.2, against: 'next_draft_first_pick' },
    });
    if (result.status !== 'shared') throw new Error('unreachable');
    expect(result.picks.every(({ use }) => use === 'full')).toBe(true);
    expect(sumShares(result)).toBeCloseTo(910 / 1175.2, 12);
  });

  it('shares nothing when the club spent no pick, and says what is owed', () => {
    // 2025 Tylah Williams, pick 39: the next selection was owed and West Coast spent none.
    expect(
      aflTradeMatchedBidShares({
        draftYear: 2025,
        selectionNumber: 39,
        roundNumber: 3,
        points: 257,
        consumedPicks: [],
      })
    ).toEqual({
      status: 'shared',
      ruleId: 'afl-bid-price-2025-dvi',
      pricePoints: null,
      picks: [],
      leftover: null,
      deficit: { points: null, against: 'next_selection' },
    });
    // A points-priced bid with no pick spent owes the whole price.
    expect(aflTradeMatchedBidShares({ ...HENRY, consumedPicks: [] })).toMatchObject({
      picks: [],
      deficit: { points: 1175.2, against: 'next_draft_first_pick' },
    });
  });

  it('gives the next selection the whole nominee from 2025 pick 37', () => {
    // 2025 Koby Coulson, pick 46: Gold Coast's next selection, an unnumbered leftover pick.
    expect(
      aflTradeMatchedBidShares({
        draftYear: 2025,
        selectionNumber: 46,
        roundNumber: 3,
        points: 134,
        consumedPicks: [spent('6608', 86)],
      })
    ).toMatchObject({
      picks: [{ nativePickId: '6608', countedPoints: 86, share: 1, use: 'full' }],
      deficit: null,
    });
  });

  it('refuses a missing rule, an order the rule forbids and a pick spent past the price', () => {
    expect(aflTradeMatchedBidShares({ ...HENRY, draftYear: 2018 })).toMatchObject({
      status: 'refused',
      reason: 'rule_missing',
    });
    expect(
      aflTradeMatchedBidShares({ ...HENRY, consumedPicks: [...HENRY.consumedPicks].reverse() })
    ).toMatchObject({
      reason: 'spend_order_not_descending',
    });
    expect(
      aflTradeMatchedBidShares({
        ...UGLE_HAGAN,
        consumedPicks: [...UGLE_HAGAN.consumedPicks, spent('9999', 100)],
      })
    ).toMatchObject({ reason: 'spent_beyond_price' });
    // A board leftover pick with points when the rule leaves none over would count twice.
    expect(
      aflTradeMatchedBidShares({ ...HENRY, leftoverPicks: [{ nativePickId: '9998', points: 40 }] })
    ).toMatchObject({ reason: 'leftover_mismatch' });
    // A leftover pick with no points (created to fill list spots) carries none of the match.
    expect(
      aflTradeMatchedBidShares({
        ...HENRY,
        leftoverPicks: [{ nativePickId: '9998', points: null }],
      })
    ).toMatchObject({ status: 'shared' });
  });
});
