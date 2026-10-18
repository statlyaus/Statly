import { describe, expect, it } from 'vitest';

import { parseFootyinfoDraftBoard } from '@/server/aflTradeIntelligence/source/footyinfoDraftBoardAdapter';
import {
  aflTradeMatchedBidPrice,
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
    // 2026 on: the ladder rule's 19-club values are not published, and no 2026 bid exists yet.
    expect(
      aflTradeMatchedBidPrice({
        draftYear: 2026,
        selectionNumber: 3,
        roundNumber: 1,
        points: 2234,
        ladderPosition: 1,
      })
    ).toMatchObject({ status: 'refused', reason: 'rule_values_missing' });
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

  it('keeps the 2026 ladder bands as data, refused until their values are published', () => {
    const published = AFL_TRADE_MATCHED_BID_PRICE_RULES.map((rule) =>
      rule.ruleId === 'afl-bid-price-2026-ladder' ? { ...rule, valuesPublished: true } : rule
    );
    const bid = { draftYear: 2026, selectionNumber: 10, roundNumber: 1, points: 1000 };
    expect(aflTradeMatchedBidPrice({ ...bid, ladderPosition: 1 }, published)).toMatchObject({
      priceTenths: 12000,
    });
    expect(aflTradeMatchedBidPrice({ ...bid, ladderPosition: 12 }, published)).toMatchObject({
      priceTenths: 9000,
    });
    expect(aflTradeMatchedBidPrice({ ...bid, ladderPosition: null }, published)).toMatchObject({
      reason: 'ladder_position_missing',
    });
    // What a top-two club pays from 19 is not stated: no band, no price.
    expect(
      aflTradeMatchedBidPrice({ ...bid, selectionNumber: 20, ladderPosition: 1 }, published)
    ).toMatchObject({
      reason: 'band_missing',
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
