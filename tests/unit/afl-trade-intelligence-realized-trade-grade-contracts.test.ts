import { describe, expect, it } from 'vitest';

import { hpnDpv3ValueForPick } from '@/server/aflTradeIntelligence/modeling/hpnPickValueBenchmark';
import {
  createAflTradeRealizedTradeGradeBatch,
  expectedAflTradeRealizedTradeGradeClubs,
  parseAflTradeRealizedTradeGradeBatch,
  type AflTradeRealizedGradeRuleVersion,
  type AflTradeRealizedTradeGradeBatchContent,
  type AflTradeRealizedTradeGradeLeg,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeGradeContracts';

const hex = (digit: string) => digit.repeat(64);
const benchmarkId = `hpn-pick-benchmark:${hex('b')}`;
const projection = (selectionNumber: number) => ({
  kind: 'pick_projection' as const,
  benchmarkId,
  selectionNumber,
  value: hpnDpv3ValueForPick(selectionNumber),
});
const closed = (seasons: number[]) => ({
  status: 'closed' as const,
  seasonsValued: seasons,
  seasonsMissingPav: [],
});
const SINGLE = 'single_source_pick_outcome' as const;
const V1 = 'afl-trade-realized-grade-rule/v1' as const;
const V3 = 'afl-trade-realized-grade-rule/v3' as const;
const V4 = 'afl-trade-realized-grade-rule/v4' as const;
const V5 = 'afl-trade-realized-grade-rule/v5' as const;
const V6 = 'afl-trade-realized-grade-rule/v6' as const;
const V7 = 'afl-trade-realized-grade-rule/v7' as const;
const V8 = 'afl-trade-realized-grade-rule/v8' as const;
const V9 = 'afl-trade-realized-grade-rule/v9' as const;
const V10 = 'afl-trade-realized-grade-rule/v10' as const;
const V11 = 'afl-trade-realized-grade-rule/v11' as const;
const V12 = 'afl-trade-realized-grade-rule/v12' as const;
const V13 = 'afl-trade-realized-grade-rule/v13' as const;
const LIMITATIONS = {
  [V1]: 'Private local non-production realized trade grade in career_pav; single-source pick outcomes; not public factual, publication, production or activation authority.',
  'afl-trade-realized-grade-rule/v2':
    'Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; not public factual, publication, production or activation authority.',
  [V3]: 'Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; not public factual, publication, production or activation authority.',
  [V4]: 'Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; not public factual, publication, production or activation authority.',
  [V5]: 'Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; not public factual, publication, production or activation authority.',
  [V6]: "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; not public factual, publication, production or activation authority.",
  [V7]: "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; not public factual, publication, production or activation authority.",
  [V8]: "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; not public factual, publication, production or activation authority.",
  [V9]: "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; not public factual, publication, production or activation authority.",
  [V10]:
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; a receiving club's selection a reviewed Footyinfo board records as that club's matched bid counts as a nominee even when Draftguru marks it open; not public factual, publication, production or activation authority.",
  [V11]:
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; a receiving club's selection a reviewed Footyinfo board records as that club's matched bid counts as a nominee even when Draftguru marks it open; a sole asset traded on is valued at its club's whole return in the onward trade, whatever became of the pick there; a traded-on pick whose club's every return leg in the onward trade is excluded is unallocated, not worth 0; not public factual, publication, production or activation authority.",
  [V12]:
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; a receiving club's selection a reviewed Footyinfo board records as that club's matched bid counts as a nominee even when Draftguru marks it open; a sole asset traded on is valued at its club's whole return in the onward trade, whatever became of the pick there; a traded-on pick whose club's every return leg in the onward trade is excluded is unallocated, not worth 0; undated pick trades of one season are ordered by the Draftguru pick-trade sequence, an ordering inferred from its agreement with every chain checked, not a stated date, and a pick with more than one possible trail follows the one ending at its latest Official AFL custody holder; not public factual, publication, production or activation authority.",
  [V13]:
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; a receiving club's selection a reviewed Footyinfo board records as that club's matched bid counts as a nominee even when Draftguru marks it open; a sole asset traded on is valued at its club's whole return in the onward trade, whatever became of the pick there; a traded-on pick whose club's every return leg in the onward trade is excluded is unallocated, not worth 0; undated pick trades of one season are ordered by the Draftguru pick-trade sequence, an ordering inferred from its agreement with every chain checked, not a stated date, and a pick with more than one possible trail follows the one ending at its latest Official AFL custody holder; a traded-on pick given in a bundle with an excluded asset is unallocated, the excluded asset's share of the return being unknown, and a sole asset still takes the whole return; not public factual, publication, production or activation authority.",
} as const;

type Leg = AflTradeRealizedTradeGradeLeg;
const player = (
  transferId: string,
  sendingClubId: string,
  receivingClubId: string,
  realizedValue: number,
  season: number,
  stintSeasons: number[]
): Leg => ({
  transferId,
  assetKind: 'player',
  sendingClubId,
  receivingClubId,
  state: 'valued',
  basis: 'player_first_stint',
  realizedValue,
  stint: closed(stintSeasons),
  reasons: [],
  atTrade: { kind: 'player_trade_season_pav', season, value: 9 },
});

function trade(
  transactionId: string,
  tradeYear: number,
  legs: Leg[],
  ruleVersion: AflTradeRealizedGradeRuleVersion = V1
) {
  const reasons = [...new Set(legs.flatMap((leg) => leg.reasons))].sort();
  const state = legs.some((leg) => leg.state === 'blocked')
    ? ('blocked' as const)
    : reasons.length
      ? ('provisional' as const)
      : ('complete' as const);
  return {
    transactionId,
    tradeYear,
    state,
    reasons,
    clubs: expectedAflTradeRealizedTradeGradeClubs(legs, ruleVersion),
    legs,
  };
}

// tx-1 provisional: Collingwood gives a player (30 at Carlton); Carlton gives pick 12 (draftee 20) and a
//   not-used pick (Collingwood took no nominee: 0). Pick legs are single-source.
// tx-2 provisional: an open stint. tx-3 blocked: a pending future pick. tx-4 complete: players only.
// tx-5 / tx-6: Hawthorn receives pick 20 from Melbourne (tx-5), then trades it with a player to St Kilda
//   for a player worth 40 (tx-6). The pick became a draftee worth 12 there, the player 28: the pick's
//   share of Hawthorn's return is 12/40 of 40.
function content(
  ruleVersion: AflTradeRealizedGradeRuleVersion = V1
): AflTradeRealizedTradeGradeBatchContent {
  const weight = 12;
  const weightTotal = 40;
  const share = weight / weightTotal;
  const trades = [
    trade('tx-1', 2020, [
      player('tr-1a', 'collingwood', 'carlton', 30, 2020, [2021, 2022]),
      {
        transferId: 'tr-1b',
        assetKind: 'pick',
        sendingClubId: 'carlton',
        receivingClubId: 'collingwood',
        state: 'valued',
        basis: 'pick_selected_first_stint',
        realizedValue: 20,
        stint: closed([2021, 2022]),
        reasons: [SINGLE],
        atTrade: projection(12),
      },
      {
        transferId: 'tr-1c',
        assetKind: 'pick',
        sendingClubId: 'carlton',
        receivingClubId: 'collingwood',
        state: 'valued',
        basis: 'pick_not_used_no_nominee',
        realizedValue: 0,
        reasons: [SINGLE],
        atTrade: projection(40),
      },
    ]),
    trade('tx-2', 2021, [
      {
        ...player('tr-2a', 'essendon', 'geelong', 15, 2021, [2022]),
        stint: { status: 'open', seasonsValued: [2022], seasonsMissingPav: [] },
        reasons: ['stint_open'],
      } as Leg,
    ]),
    trade('tx-3', 2025, [
      {
        transferId: 'tr-3a',
        assetKind: 'pick',
        sendingClubId: 'hawthorn',
        receivingClubId: 'richmond',
        state: 'blocked',
        basis: 'unavailable',
        reasons: ['pick_outcome_pending'],
        atTrade: { kind: 'unavailable', reason: 'future_pick_slot_unknown' },
      },
    ]),
    trade('tx-4', 2020, [
      player('tr-4a', 'fremantle', 'gws', 8, 2020, [2021]),
      player('tr-4b', 'gws', 'fremantle', 10, 2020, [2021, 2022]),
    ]),
    trade('tx-5', 2020, [
      {
        transferId: 'tr-5a',
        assetKind: 'pick',
        sendingClubId: 'melbourne',
        receivingClubId: 'hawthorn',
        state: 'valued',
        basis: 'pick_traded_on_return',
        realizedValue: share * 40,
        onward: {
          transactionId: 'tx-6',
          allocation: 'relative_value',
          returnValue: 40,
          givenAssetCount: 2,
          weight,
          weightTotal,
          share,
        },
        reasons: [SINGLE, 'traded_on_return_provisional'],
        atTrade: projection(20),
      },
    ]),
    trade('tx-6', 2020, [
      {
        transferId: 'tr-6a',
        assetKind: 'pick',
        sendingClubId: 'hawthorn',
        receivingClubId: 'st-kilda',
        state: 'valued',
        basis: 'pick_selected_first_stint',
        realizedValue: 12,
        stint: closed([2021]),
        reasons: [SINGLE],
        atTrade: projection(20),
      },
      player('tr-6b', 'hawthorn', 'st-kilda', 28, 2020, [2021, 2022]),
      player('tr-6c', 'st-kilda', 'hawthorn', 40, 2020, [2021, 2022]),
    ]),
  ].map((row) => ({
    ...row,
    clubs: expectedAflTradeRealizedTradeGradeClubs(row.legs, ruleVersion),
  }));
  return {
    schemaVersion: 'afl-trade-realized-trade-grade-batch/v1',
    ruleVersion,
    environment: 'non_production',
    valueUnit: 'career_pav',
    inputs: {
      candidateId: `external-reconciliation:${hex('a')}`,
      pavCalculations: [
        { season: 2021, calculationId: 'hpn-pav-season:2021', official: true },
        { season: 2022, calculationId: 'hpn-pav-season:2022', official: true },
      ],
      pickProjectionBenchmarkId: benchmarkId,
      spellCutoffAt: '2026-10-08T00:00:00.000Z',
    },
    gradedAt: '2026-10-08T13:00:00.000Z',
    trades,
    ungraded: [],
    summary: { complete: 1, provisional: 4, blocked: 1, ungraded: 0 },
    publicationEligible: false,
    publicationProhibited: true,
    limitation: LIMITATIONS[ruleVersion],
  };
}

type Content = ReturnType<typeof content>;
const tradeOf = (value: Content, id: string) =>
  value.trades.find((row) => row.transactionId === id)!;
/** Replaces one leg and re-derives the trade's reasons, state, clubs and the summary. */
function withLeg(value: Content, id: string, index: number, change: (leg: Leg) => Leg) {
  const target = tradeOf(value, id);
  target.legs[index] = change(structuredClone(target.legs[index]!));
  Object.assign(
    target,
    trade(target.transactionId, target.tradeYear, target.legs, value.ruleVersion)
  );
  value.summary = {
    complete: value.trades.filter((row) => row.state === 'complete').length,
    provisional: value.trades.filter((row) => row.state === 'provisional').length,
    blocked: value.trades.filter((row) => row.state === 'blocked').length,
    ungraded: value.ungraded.length,
  };
  return value;
}
const refuses = (value: Content, message: RegExp) =>
  expect(() => createAflTradeRealizedTradeGradeBatch(value)).toThrow(message);

describe('realized trade grade batch contract', () => {
  it('seals a batch under its content address and parses it back', () => {
    const batch = createAflTradeRealizedTradeGradeBatch(content());
    expect(batch.batchId).toMatch(/^realized-trade-grade-batch:[a-f0-9]{64}$/);
    expect(parseAflTradeRealizedTradeGradeBatch(batch)).toEqual(batch);
    expect(batch.content.trades.map(({ transactionId, state }) => [transactionId, state])).toEqual([
      ['tx-1', 'provisional'],
      ['tx-2', 'provisional'],
      ['tx-3', 'blocked'],
      ['tx-4', 'complete'],
      ['tx-5', 'provisional'],
      ['tx-6', 'provisional'],
    ]);
    expect(() =>
      parseAflTradeRealizedTradeGradeBatch({
        ...batch,
        content: { ...batch.content, gradedAt: '2026-10-09T00:00:00.000Z' },
      })
    ).toThrow(/content address/);
    expect(() =>
      parseAflTradeRealizedTradeGradeBatch({
        ...batch,
        batchId: batch.batchId.replace('realized', 'other'),
      })
    ).toThrow();
  });

  it('values a traded-on pick at its relative share of the onward return', () => {
    const tx5 = tradeOf(
      createAflTradeRealizedTradeGradeBatch(content()).content as Content,
      'tx-5'
    );
    expect(tx5.clubs).toEqual([
      { clubId: 'hawthorn', received: 12, givenUp: 0, net: 12 },
      { clubId: 'melbourne', received: 0, givenUp: 12, net: -12 },
    ]);
  });

  it('accepts an excluded nominee pick, which adds nothing to either club', () => {
    const value = withLeg(content(), 'tx-1', 2, (leg) => ({
      transferId: leg.transferId,
      assetKind: 'pick',
      sendingClubId: 'carlton',
      receivingClubId: 'collingwood',
      state: 'excluded',
      basis: 'pick_not_used_nominee_excluded',
      reasons: ['not_used_nominee_excluded', SINGLE],
      atTrade: projection(40),
    }));
    expect(
      tradeOf(createAflTradeRealizedTradeGradeBatch(value).content as Content, 'tx-1').clubs
    ).toEqual([
      { clubId: 'carlton', received: 30, givenUp: 20, net: 10 },
      { clubId: 'collingwood', received: 20, givenUp: 30, net: -10 },
    ]);
  });

  // St Kilda spends pick 20 on a nominee (tx-6), so Hawthorn's traded-on pick in tx-5 has no weight.
  const unallocated = (base = content()) => {
    const value = withLeg(base, 'tx-6', 0, (leg) => ({
      transferId: leg.transferId,
      assetKind: 'pick',
      sendingClubId: leg.sendingClubId,
      receivingClubId: leg.receivingClubId,
      state: 'excluded',
      basis: 'pick_not_used_nominee_excluded',
      reasons: ['not_used_nominee_excluded', SINGLE],
      atTrade: leg.atTrade,
    }));
    return withLeg(value, 'tx-5', 0, (leg) => ({
      transferId: leg.transferId,
      assetKind: 'pick',
      sendingClubId: leg.sendingClubId,
      receivingClubId: leg.receivingClubId,
      state: 'excluded',
      basis: 'pick_traded_on_return_unallocated',
      onwardTransactionId: 'tx-6',
      reasons: [SINGLE, 'traded_on_return_unallocated'],
      atTrade: leg.atTrade,
    }));
  };

  it('excludes a traded-on pick its onward club spent on a nominee', () => {
    const tx5 = tradeOf(
      createAflTradeRealizedTradeGradeBatch(unallocated()).content as Content,
      'tx-5'
    );
    expect(tx5).toMatchObject({
      state: 'provisional',
      clubs: [
        { clubId: 'hawthorn', received: 0, givenUp: 0, net: 0 },
        { clubId: 'melbourne', received: 0, givenUp: 0, net: 0 },
      ],
    });
  });

  it('names untradeable rows instead of dropping them', () => {
    const value = content();
    value.ungraded = [{ transactionId: 'tx-0', reason: 'no_transfers' }];
    value.summary = { ...value.summary, ungraded: 1 };
    expect(createAflTradeRealizedTradeGradeBatch(value).content.ungraded).toEqual([
      { transactionId: 'tx-0', reason: 'no_transfers' },
    ]);
  });

  it.each<[string, () => Content, RegExp]>([
    [
      'club totals that differ from the legs',
      () => {
        const value = content();
        tradeOf(value, 'tx-1').clubs[0]!.net = 11;
        return value;
      },
      /Club totals must be exactly/,
    ],
    [
      'an at-trade projection added into a total',
      () => {
        const value = content();
        tradeOf(value, 'tx-1').clubs[1]!.received = 20 + hpnDpv3ValueForPick(12);
        return value;
      },
      /Club totals must be exactly/,
    ],
    [
      'a pick leg without the single-source reason',
      () => withLeg(content(), 'tx-1', 1, (leg) => ({ ...leg, reasons: [] })),
      /single-source/,
    ],
    [
      'a player leg with the single-source reason',
      () => withLeg(content(), 'tx-4', 0, (leg) => ({ ...leg, reasons: [SINGLE] })),
      /Only a pick leg rests/,
    ],
    [
      'a trade state that ignores a provisional reason',
      () => {
        const value = content();
        tradeOf(value, 'tx-2').state = 'complete';
        value.summary = { complete: 2, provisional: 3, blocked: 1, ungraded: 0 };
        return value;
      },
      /state must be provisional/,
    ],
    [
      'a blocked leg with only provisional reasons',
      () => withLeg(content(), 'tx-3', 0, (leg) => ({ ...leg, reasons: ['stint_open'] })),
      /blocked exactly when/,
    ],
    [
      'a blocking reason on a valued leg',
      () => withLeg(content(), 'tx-4', 0, (leg) => ({ ...leg, reasons: ['pick_outcome_pending'] })),
      /blocked exactly when/,
    ],
    [
      'a not-used no-nominee pick worth more than 0',
      () => withLeg(content(), 'tx-1', 2, (leg) => ({ ...leg, realizedValue: 5 }) as Leg),
      /./,
    ],
    [
      'a stint on a not-used pick',
      () => withLeg(content(), 'tx-1', 2, (leg) => ({ ...leg, stint: closed([2021]) }) as Leg),
      /./,
    ],
    [
      'a first-stint leg without a stint',
      () =>
        withLeg(content(), 'tx-4', 0, (leg) => {
          const { stint: _stint, ...rest } = leg as Leg & { stint: unknown };
          return rest as Leg;
        }),
      /./,
    ],
    [
      'an open stint without the stint_open reason',
      () => withLeg(content(), 'tx-2', 0, (leg) => ({ ...leg, reasons: [] })),
      /open stint/,
    ],
    [
      'stint_open on a closed stint',
      () => withLeg(content(), 'tx-4', 0, (leg) => ({ ...leg, reasons: ['stint_open'] })),
      /open stint/,
    ],
    [
      'missing PAV seasons without the reason',
      () =>
        withLeg(
          content(),
          'tx-4',
          0,
          (leg) =>
            ({
              ...leg,
              stint: { status: 'closed', seasonsValued: [2021], seasonsMissingPav: [2023] },
            }) as Leg
        ),
      /Missing PAV seasons/,
    ],
    [
      'a missing season that has a pinned calculation',
      () =>
        withLeg(
          content(),
          'tx-4',
          0,
          (leg) =>
            ({
              ...leg,
              stint: { status: 'closed', seasonsValued: [2021], seasonsMissingPav: [2022] },
              reasons: ['pav_seasons_missing'],
            }) as Leg
        ),
      /not missing/,
    ],
    [
      'a valued season with no pinned calculation',
      () =>
        withLeg(content(), 'tx-4', 0, (leg) => ({ ...leg, stint: closed([2021, 2023]) }) as Leg),
      /pinned PAV calculation/,
    ],
    [
      'an unofficial season without the reason',
      () => {
        const value = content();
        value.inputs.pavCalculations[1]!.official = false;
        return value;
      },
      /unofficial season/,
    ],
    [
      'a stint season inside the trade season',
      () =>
        withLeg(content(), 'tx-4', 0, (leg) => ({ ...leg, stint: closed([2020, 2021]) }) as Leg),
      /after the trade season/,
    ],
    [
      'a player at-trade season other than the trade year',
      () =>
        withLeg(content(), 'tx-4', 0, (leg) => ({
          ...leg,
          atTrade: { kind: 'player_trade_season_pav', season: 2019, value: 9 },
        })),
      /PAV in the trade season/,
    ],
    [
      'a player leg valued on a pick basis',
      () =>
        withLeg(
          content(),
          'tx-4',
          0,
          (leg) => ({ ...leg, basis: 'pick_selected_first_stint' }) as Leg
        ),
      /player first-stint basis/,
    ],
    [
      'an excluded player',
      () =>
        withLeg(content(), 'tx-4', 0, (leg) => ({
          transferId: leg.transferId,
          assetKind: 'player',
          sendingClubId: leg.sendingClubId,
          receivingClubId: leg.receivingClubId,
          state: 'excluded',
          basis: 'pick_not_used_nominee_excluded',
          reasons: ['not_used_nominee_excluded'],
          atTrade: leg.atTrade,
        })),
      /player first-stint basis/,
    ],
    [
      'a projection on a player leg',
      () => withLeg(content(), 'tx-4', 0, (leg) => ({ ...leg, atTrade: projection(5) })),
      /on a pick leg/,
    ],
    [
      'a hand-written projection value',
      () =>
        withLeg(content(), 'tx-1', 1, (leg) => ({
          ...leg,
          atTrade: { ...projection(12), value: 71.51 },
        })),
      /HPN DPVC v3 value/,
    ],
    [
      'a projection that cites another benchmark',
      () =>
        withLeg(content(), 'tx-1', 1, (leg) => ({
          ...leg,
          atTrade: { ...projection(12), benchmarkId: `hpn-pick-benchmark:${hex('c')}` },
        })),
      /pinned benchmark/,
    ],
    [
      'a leg between the same club',
      () => withLeg(content(), 'tx-4', 0, (leg) => ({ ...leg, receivingClubId: 'fremantle' })),
      /distinct clubs/,
    ],
    [
      'a traded-on value that is not its share of the return',
      () => withLeg(content(), 'tx-5', 0, (leg) => ({ ...leg, realizedValue: 13 }) as Leg),
      /share of the onward return/,
    ],
    [
      'a traded-on return that differs from the onward trade',
      () =>
        withLeg(content(), 'tx-5', 0, (leg) => {
          const traded = leg as Extract<Leg, { basis: 'pick_traded_on_return' }>;
          return {
            ...traded,
            realizedValue: 0.3 * 50,
            onward: { ...traded.onward, returnValue: 50 },
          };
        }),
      /what its club received in the onward trade/,
    ],
    [
      'weights that do not total what the club gave up',
      () =>
        withLeg(content(), 'tx-5', 0, (leg) => {
          const traded = leg as Extract<Leg, { basis: 'pick_traded_on_return' }>;
          return {
            ...traded,
            realizedValue: (12 / 50) * 40,
            onward: { ...traded.onward, weightTotal: 50, share: 12 / 50 },
          };
        }),
      /weights total what its club gave up/,
    ],
    [
      'an equal split when the club gave value',
      () =>
        withLeg(content(), 'tx-5', 0, (leg) => {
          const traded = leg as Extract<Leg, { basis: 'pick_traded_on_return' }>;
          return {
            ...traded,
            realizedValue: 0.5 * 40,
            onward: {
              ...traded.onward,
              allocation: 'equal_split',
              weight: null,
              weightTotal: null,
              share: 0.5,
            },
            reasons: ['equal_split_tiebreak', SINGLE, 'traded_on_return_provisional'],
          };
        }),
      /only when everything its club gave was worth 0/,
    ],
    [
      'a traded-on pick whose onward trade is not in the batch',
      () =>
        withLeg(content(), 'tx-5', 0, (leg) => {
          const traded = leg as Extract<Leg, { basis: 'pick_traded_on_return' }>;
          return { ...traded, onward: { ...traded.onward, transactionId: 'tx-99' } };
        }),
      /names another graded trade/,
    ],
    [
      'a traded-on pick that hides its provisional onward trade',
      () => withLeg(content(), 'tx-5', 0, (leg) => ({ ...leg, reasons: [SINGLE] })),
      /provisional exactly when its onward trade is/,
    ],
    [
      'an onward-trade reason on another leg',
      () =>
        withLeg(content(), 'tx-1', 1, (leg) => ({
          ...leg,
          reasons: [SINGLE, 'traded_on_return_provisional'],
        })),
      /Only a traded-on pick/,
    ],
    [
      'an unallocated traded-on pick whose onward trade excludes nothing',
      () => {
        const value = unallocated();
        const tx5 = tradeOf(value, 'tx-5');
        (tx5.legs[0] as { onwardTransactionId: string }).onwardTransactionId = 'tx-4';
        return value;
      },
      /where it is excluded/,
    ],
    [
      'an unallocated traded-on pick without its reason',
      () => withLeg(unallocated(), 'tx-5', 0, (leg) => ({ ...leg, reasons: [SINGLE] })),
      /unallocated traded-on pick/,
    ],
    [
      'a trade both graded and ungraded',
      () => {
        const value = content();
        value.ungraded = [{ transactionId: 'tx-1', reason: 'no_transfers' }];
        value.summary = { ...value.summary, ungraded: 1 };
        return value;
      },
      /either graded or ungraded/,
    ],
    [
      'a summary that miscounts ungraded trades',
      () => {
        const value = content();
        value.ungraded = [{ transactionId: 'tx-0', reason: 'club_unresolved' }];
        return value;
      },
      /count the trades by state/,
    ],
    [
      'a summary that miscounts',
      () => {
        const value = content();
        value.summary = { complete: 2, provisional: 3, blocked: 1, ungraded: 0 };
        return value;
      },
      /count the trades by state/,
    ],
    [
      'unsorted reasons',
      () => {
        const value = content();
        tradeOf(value, 'tx-5').legs[0]!.reasons = ['traded_on_return_provisional', SINGLE];
        return value;
      },
      /sorted/,
    ],
    [
      'unsorted PAV calculations',
      () => {
        const value = content();
        value.inputs.pavCalculations.reverse();
        return value;
      },
      /unique and sorted/,
    ],
    [
      'a duplicate transaction',
      () => {
        const value = content();
        value.trades[1] = structuredClone(value.trades[0]!);
        return value;
      },
      /ordered by transaction/,
    ],
    [
      'unsorted legs',
      () => {
        const value = content();
        tradeOf(value, 'tx-4').legs.reverse();
        return value;
      },
      /ordered by transfer/,
    ],
    [
      'a publishable batch',
      () => {
        const value = content();
        (value as { publicationEligible: boolean }).publicationEligible = true;
        return value;
      },
      /expected false/,
    ],
  ])('refuses %s', (_label, build, message) => refuses(build(), message));

  describe('rule v2 corroboration', () => {
    const V2 = {
      ruleVersion: 'afl-trade-realized-grade-rule/v2' as const,
      limitation:
        'Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; not public factual, publication, production or activation authority.' as const,
    };
    const pickTradeId = () =>
      content().trades.find((row) =>
        row.legs.some(
          (leg) => leg.basis === 'pick_selected_first_stint' && leg.reasons.length === 1
        )
      )!;
    const corroborate = (value: Content) => {
      const target = value.trades.find(
        ({ transactionId }) => transactionId === pickTradeId().transactionId
      )!;
      const index = target.legs.findIndex((leg) => leg.basis === 'pick_selected_first_stint');
      return withLeg(value, target.transactionId, index, (leg) => ({
        ...leg,
        corroboratedBy: 'footyinfo',
        reasons: leg.reasons.filter((reason) => reason !== SINGLE),
      }));
    };

    it('still parses a stored v1 batch', () => {
      expect(() => createAflTradeRealizedTradeGradeBatch(content())).not.toThrow();
    });

    it('accepts a corroborated pick leg without single_source_pick_outcome under v2', () => {
      const value = corroborate({ ...content(), ...V2 });
      expect(() => createAflTradeRealizedTradeGradeBatch(value)).not.toThrow();
    });

    it('refuses a corroborated leg under v1', () => {
      expect(() => createAflTradeRealizedTradeGradeBatch(corroborate(content()))).toThrow(
        /Rule v1 treats every pick outcome as single-source/
      );
    });

    it('refuses a v2 pick leg that drops the reason without naming a provider', () => {
      const value = corroborate({ ...content(), ...V2 });
      for (const row of value.trades)
        for (const leg of row.legs) delete (leg as { corroboratedBy?: string }).corroboratedBy;
      expect(() => createAflTradeRealizedTradeGradeBatch(value)).toThrow(
        /single-source exactly when no second provider corroborates/
      );
    });

    it('refuses a limitation that is not its rule version’s', () => {
      expect(() =>
        createAflTradeRealizedTradeGradeBatch({ ...content(), ruleVersion: V2.ruleVersion })
      ).toThrow(/limitation must be the one its rule version states/);
    });
  });

  describe('rule v3 club-scoped totals', () => {
    const V2 = {
      ruleVersion: 'afl-trade-realized-grade-rule/v2' as const,
      limitation: LIMITATIONS['afl-trade-realized-grade-rule/v2'],
    };
    const blockedPlayer = (transferId: string, from: string, to: string): Leg => ({
      transferId,
      assetKind: 'player',
      sendingClubId: from,
      receivingClubId: to,
      state: 'blocked',
      basis: 'unavailable',
      reasons: ['player_identity_unresolved'],
      atTrade: { kind: 'unavailable', reason: 'trade_season_pav_missing' },
    });
    // Essendon sends St Kilda an unidentified player in tx-6: the trade is blocked, Hawthorn's side is not.
    const blockedElsewhere = (value: Content) =>
      withLeg(value, 'tx-6', 3, () => blockedPlayer('tr-6d', 'essendon', 'st-kilda'));
    const partial = (value: Content) =>
      withLeg(blockedElsewhere(value), 'tx-5', 0, (leg) => ({
        ...leg,
        reasons: [SINGLE, 'traded_on_return_partial'],
      }));

    it('still parses a sealed v2 batch whose blocked trade nulls every club total', () => {
      const batch = createAflTradeRealizedTradeGradeBatch({ ...content(), ...V2 });
      expect(tradeOf(batch.content as Content, 'tx-3').clubs).toEqual([
        { clubId: 'hawthorn', received: null, givenUp: null, net: null },
        { clubId: 'richmond', received: null, givenUp: null, net: null },
      ]);
      expect(() =>
        createAflTradeRealizedTradeGradeBatch({
          ...content(),
          ruleVersion: V3,
          limitation: LIMITATIONS[V3],
        })
      ).toThrow(/Club totals must be exactly/);
    });

    it('nulls only the sides a blocked leg enters under v3, and refuses them under v2', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(content(V3));
      expect(tradeOf(batch.content as Content, 'tx-3').clubs).toEqual([
        { clubId: 'hawthorn', received: 0, givenUp: null, net: null },
        { clubId: 'richmond', received: null, givenUp: 0, net: null },
      ]);
      expect(() => createAflTradeRealizedTradeGradeBatch({ ...content(V3), ...V2 })).toThrow(
        /Club totals must be exactly/
      );
    });

    it('accepts a traded-on pick valued on its club’s known side of a blocked onward trade', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(partial(content(V3)));
      expect(tradeOf(batch.content as Content, 'tx-6')).toMatchObject({
        state: 'blocked',
        clubs: [
          { clubId: 'essendon', received: 0, givenUp: null, net: null },
          { clubId: 'hawthorn', received: 40, givenUp: 40, net: 0 },
          { clubId: 'st-kilda', received: null, givenUp: 40, net: null },
        ],
      });
      expect(tradeOf(batch.content as Content, 'tx-5').state).toBe('provisional');
    });

    it.each<[string, () => Content, RegExp]>([
      [
        'a traded-on pick that hides its blocked onward trade',
        () =>
          withLeg(blockedElsewhere(content(V3)), 'tx-5', 0, (leg) => ({
            ...leg,
            reasons: [SINGLE],
          })),
        /partial exactly when its onward trade is blocked/,
      ],
      [
        'a partial traded-on pick whose onward trade is not blocked',
        () =>
          withLeg(content(V3), 'tx-5', 0, (leg) => ({
            ...leg,
            reasons: [SINGLE, 'traded_on_return_partial', 'traded_on_return_provisional'],
          })),
        /partial exactly when its onward trade is blocked/,
      ],
      [
        'a partial traded-on pick under v2',
        () => partial({ ...content(), ...V2 }),
        /names another graded trade/,
      ],
      [
        'a bundle share whose club’s given-up side is blocked',
        () =>
          withLeg(partial(content(V3)), 'tx-6', 1, (leg) =>
            blockedPlayer(leg.transferId, leg.sendingClubId, leg.receivingClubId)
          ),
        /weights total what its club gave up/,
      ],
      [
        'an onward-trade reason on another leg',
        () =>
          withLeg(content(V3), 'tx-1', 1, (leg) => ({
            ...leg,
            reasons: [SINGLE, 'traded_on_return_partial'],
          })),
        /Only a traded-on pick/,
      ],
      [
        'an unallocated traded-on pick whose club’s onward side is blocked',
        () =>
          withLeg(unallocated(content(V3)), 'tx-6', 1, (leg) =>
            blockedPlayer(leg.transferId, leg.sendingClubId, leg.receivingClubId)
          ),
        /needs its club’s side of the onward trade/,
      ],
    ])('refuses %s', (_label, build, message) => refuses(build(), message));
  });

  describe('rule v4 signed PAV sums', () => {
    /** A v4 batch: every stint records its signed PAV sum, here equal to its (non-negative) value. */
    const v4 = () => {
      const value = content(V4);
      for (const row of value.trades)
        for (const leg of row.legs)
          if ('stint' in leg) leg.stint = { ...leg.stint, pavSum: leg.realizedValue };
      return value;
    };
    const withStint = (value: Content, realizedValue: number, pavSum: number) =>
      withLeg(value, 'tx-4', 0, (leg) => {
        const valued = leg as Extract<Leg, { stint: unknown }>;
        return { ...valued, realizedValue, stint: { ...valued.stint, pavSum } };
      });

    it('accepts a stint whose signed sum is below 0 at a value of 0, and a signed at-trade view', () => {
      const value = withLeg(withStint(v4(), 0, -0.25), 'tx-4', 1, (leg) => ({
        ...leg,
        atTrade: { kind: 'player_trade_season_pav', season: 2020, value: -0.045 },
      }));
      const batch = createAflTradeRealizedTradeGradeBatch(value);
      expect(parseAflTradeRealizedTradeGradeBatch(batch)).toEqual(batch);
      expect(tradeOf(batch.content as Content, 'tx-4')).toMatchObject({
        state: 'complete',
        clubs: [
          { clubId: 'fremantle', received: 10, givenUp: 0, net: 10 },
          { clubId: 'gws', received: 0, givenUp: 10, net: -10 },
        ],
      });
    });

    it('still parses sealed v1 to v3 batches, whose stints record no sum', () => {
      for (const ruleVersion of [V1, 'afl-trade-realized-grade-rule/v2', V3] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(content(ruleVersion))).not.toThrow();
    });

    it.each<[string, () => Content, RegExp]>([
      ['a v4 stint without its signed sum', () => content(V4), /records its signed PAV sum/],
      [
        'a signed sum under v3',
        () => withStint(content(V3), 8, 8),
        /records its signed PAV sum exactly under rule v4/,
      ],
      ['a value that is not the floored sum', () => withStint(v4(), 1, -0.25), /floored at 0/],
      ['a value below a positive sum', () => withStint(v4(), 8, 9), /floored at 0/],
      ['a negative value', () => withStint(v4(), -0.25, -0.25), /expected number to be >=0/],
    ])('refuses %s', (_label, build, message) => refuses(build(), message));
  });

  describe('rule v5 board-proven drafts', () => {
    /** A batch under a rule that records signed PAV sums, each equal to its (non-negative) value. */
    const signed = (ruleVersion: typeof V4 | typeof V5) => {
      const value = content(ruleVersion);
      for (const row of value.trades)
        for (const leg of row.legs)
          if ('stint' in leg) leg.stint = { ...leg.stint, pavSum: leg.realizedValue };
      return value;
    };
    // tx-1's tr-1c is a not-used pick whose club took no nominee; tr-1b a selected pick.
    const proven = (value: Content, index = 2, extra: Partial<Leg> = {}) =>
      withLeg(
        value,
        'tx-1',
        index,
        (leg) => ({ ...leg, draftProvenBy: 'footyinfo', ...extra }) as Leg
      );

    it('accepts a single-source not-used leg whose draft a Footyinfo board proved', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(proven(signed(V5)));
      expect(parseAflTradeRealizedTradeGradeBatch(batch)).toEqual(batch);
      expect(tradeOf(batch.content as Content, 'tx-1').legs[2]).toMatchObject({
        basis: 'pick_not_used_no_nominee',
        draftProvenBy: 'footyinfo',
        reasons: [SINGLE],
      });
    });

    it('still parses sealed v1 to v4 batches, which name no board-proven draft', () => {
      for (const ruleVersion of [V1, 'afl-trade-realized-grade-rule/v2', V3] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(content(ruleVersion))).not.toThrow();
      expect(() => createAflTradeRealizedTradeGradeBatch(signed(V4))).not.toThrow();
    });

    it.each<[string, () => Content, RegExp]>([
      ['a board-proven draft under v4', () => proven(signed(V4)), /Only rule v5 and later/],
      ['a board-proven selected pick', () => proven(signed(V5), 1), /board-proven draft/],
      [
        'a board-proven leg a board also corroborates',
        () => proven(signed(V5), 2, { corroboratedBy: 'footyinfo', reasons: [] }),
        /board-proven draft/,
      ],
      [
        'a board-proven player leg',
        () => withLeg(signed(V5), 'tx-4', 0, (leg) => ({ ...leg, draftProvenBy: 'footyinfo' })),
        /board-proven draft/,
      ],
    ])('refuses %s', (_label, build, message) => refuses(build(), message));
  });

  describe('rule v6 picks projected from the live draft order', () => {
    const signed = (ruleVersion: AflTradeRealizedGradeRuleVersion) => {
      const value = content(ruleVersion);
      for (const row of value.trades)
        for (const leg of row.legs)
          if ('stint' in leg) leg.stint = { ...leg.stint, pavSum: leg.realizedValue };
      return value;
    };
    const LIVE = 'pick_projected_from_live_order' as const;
    const PROXY = 'pick_projected_from_prior_order_proxy' as const;
    /** A pending 2026 pick valued at the HPN DPVC v3 value of its slot in the 2026 order. */
    const projectedLeg = (leg: Leg, selectionNumber = 7, proxy = false): Leg => ({
      transferId: leg.transferId,
      assetKind: 'pick',
      sendingClubId: leg.sendingClubId,
      receivingClubId: leg.receivingClubId,
      state: 'valued',
      basis: 'pick_projected_from_order',
      realizedValue: hpnDpv3ValueForPick(selectionNumber),
      projection: {
        benchmarkId,
        selectionNumber,
        orderDraftYear: proxy ? 2026 : 2027,
        pickDraftYear: 2027,
        custodyId: `external-pick-custody:${hex('c')}`,
        observedAt: { precision: 'day', date: '2026-10-10' },
        proxy,
      },
      reasons: [proxy ? PROXY : LIVE],
      atTrade: { kind: 'unavailable', reason: 'future_pick_slot_unknown' },
    });
    // tx-3's pending future pick, now valued from the order.
    const projected = (value: Content, change: (leg: Leg) => Leg = (leg) => leg, proxy = false) =>
      withLeg(value, 'tx-3', 0, (leg) => change(projectedLeg(leg, 7, proxy)));
    /** Typed access to a projected leg's projection while mutating it. */
    const reprojected = (fields: Record<string, unknown>) => (leg: Leg) =>
      ({ ...leg, projection: { ...(leg as { projection: object }).projection, ...fields } }) as Leg;

    it('accepts a provisional pick valued at its order slot, live or as a proxy', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(projected(signed(V6)));
      expect(parseAflTradeRealizedTradeGradeBatch(batch)).toEqual(batch);
      expect(tradeOf(batch.content as Content, 'tx-3')).toMatchObject({
        state: 'provisional',
        reasons: [LIVE],
        clubs: [
          { clubId: 'hawthorn', received: 0, givenUp: hpnDpv3ValueForPick(7) },
          { clubId: 'richmond', received: hpnDpv3ValueForPick(7), givenUp: 0 },
        ],
      });
      const proxy = createAflTradeRealizedTradeGradeBatch(
        projected(signed(V6), (leg) => leg, true)
      );
      expect(tradeOf(proxy.content as Content, 'tx-3').legs[0]).toMatchObject({
        projection: { orderDraftYear: 2026, pickDraftYear: 2027, proxy: true },
        reasons: [PROXY],
      });
    });

    it('seals v6 with its limitation, which says DPVC is whole-career, not first-stint', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(signed(V6));
      expect(batch.content.limitation).toBe(LIMITATIONS[V6]);
      expect(batch.content.limitation).toContain(
        'HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order'
      );
    });

    it('still parses sealed v1 to v5 batches, which project no pick', () => {
      for (const ruleVersion of [V1, 'afl-trade-realized-grade-rule/v2', V3] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(content(ruleVersion))).not.toThrow();
      for (const ruleVersion of [V4, V5] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(signed(ruleVersion))).not.toThrow();
    });

    // Hawthorn's return in tx-6 (St Kilda's tr-6c) becomes a pending pick projected to slot 3, so
    // Hawthorn's traded-on pick in tx-5 rests on that projection.
    const projectedReturn = (withReason: boolean) => {
      const value = withLeg(signed(V6), 'tx-6', 2, (leg) => projectedLeg(leg, 3));
      const returnValue = hpnDpv3ValueForPick(3);
      return withLeg(value, 'tx-5', 0, (leg) => {
        const onward = (leg as Extract<Leg, { basis: 'pick_traded_on_return' }>).onward;
        return {
          ...leg,
          realizedValue: onward.share * returnValue,
          onward: { ...onward, returnValue },
          reasons: [
            SINGLE,
            ...(withReason ? (['traded_on_return_projected'] as const) : []),
            'traded_on_return_provisional',
          ],
        } as Leg;
      });
    };

    it('accepts a traded-on return that rests on a projection, and says so', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(projectedReturn(true));
      expect(tradeOf(batch.content as Content, 'tx-5').legs[0]!.reasons).toContain(
        'traded_on_return_projected'
      );
    });

    it.each<[string, () => Content, RegExp]>([
      ['a projected pick under v5', () => projected(signed(V5)), /Only rule v6 and later/],
      [
        'a projection reason under v5',
        () => withLeg(signed(V5), 'tx-4', 0, (leg) => ({ ...leg, reasons: [LIVE] }) as Leg),
        /Only rule v6 and later/,
      ],
      [
        'a value that is not the HPN DPVC v3 value of its slot',
        () => projected(signed(V6), (leg) => ({ ...leg, realizedValue: 50 }) as Leg),
        /HPN DPVC v3 value of its order slot/,
      ],
      [
        'a proxy flag without the proxy reason',
        () => projected(signed(V6), reprojected({ proxy: true, orderDraftYear: 2026 })),
        /proxy the order of the draft before it/,
      ],
      [
        'a live reason on an earlier draft’s order',
        () => projected(signed(V6), reprojected({ orderDraftYear: 2026 })),
        /proxy the order of the draft before it/,
      ],
      [
        'a proxy reading its own draft’s order',
        () => projected(signed(V6), reprojected({ orderDraftYear: 2027 }), true),
        /proxy the order of the draft before it/,
      ],
      [
        'both projection reasons',
        () => projected(signed(V6), (leg) => ({ ...leg, reasons: [LIVE, PROXY] })),
        /exactly one projection reason/,
      ],
      [
        'a projected pick without a projection reason',
        () => projected(signed(V6), (leg) => ({ ...leg, reasons: [] })),
        /exactly one projection reason/,
      ],
      [
        'a projection reason on another leg',
        () => withLeg(signed(V6), 'tx-4', 0, (leg) => ({ ...leg, reasons: [LIVE] })),
        /exactly one projection reason/,
      ],
      [
        'a single-source reason on a projected pick',
        () => projected(signed(V6), (leg) => ({ ...leg, reasons: [LIVE, SINGLE] })),
        /rests on a draft order/,
      ],
      [
        'a corroborated projected pick',
        () => projected(signed(V6), (leg) => ({ ...leg, corroboratedBy: 'footyinfo' })),
        /rests on a draft order/,
      ],
      [
        'a projected player leg',
        () =>
          withLeg(signed(V6), 'tx-4', 0, (leg) => ({
            ...projectedLeg(leg),
            assetKind: 'player',
          })),
        /player first-stint basis/,
      ],
      [
        'another benchmark',
        () => projected(signed(V6), reprojected({ benchmarkId: `hpn-pick-benchmark:${hex('d')}` })),
        /A projected pick must cite the batch’s pinned benchmark/,
      ],
      [
        'a slot beyond 90',
        () =>
          projected(signed(V6), (leg) =>
            reprojected({ selectionNumber: 91 })({
              ...leg,
              realizedValue: 0,
            } as Leg)
          ),
        /expected number to be <=90/,
      ],
      [
        'a traded-on return resting on a projection without saying so',
        () => projectedReturn(false),
        /rests on a projection exactly when/,
      ],
      [
        'the projected reason on a leg that is not traded on',
        () =>
          withLeg(signed(V6), 'tx-4', 0, (leg) => ({
            ...leg,
            reasons: ['traded_on_return_projected'],
          })),
        /onward-trade reasons/,
      ],
    ])('refuses %s', (_label, build, message) => refuses(build(), message));
  });

  describe('rule v7 special entitlements followed through their custody chain', () => {
    const signed = (ruleVersion: AflTradeRealizedGradeRuleVersion) => {
      const value = content(ruleVersion);
      for (const row of value.trades)
        for (const leg of row.legs)
          if ('stint' in leg) leg.stint = { ...leg.stint, pavSum: leg.realizedValue };
      return value;
    };
    const LINKED = 'special_entitlement_custody_linked' as const;
    const entitlementId = `special-draft-entitlement:${hex('e')}`;
    // tx-5's tr-5a becomes a special entitlement Hawthorn traded on in tx-6 as pick tr-6a.
    const special = (
      value: Content,
      fields: Partial<Leg> & Record<string, unknown> = {},
      { reason = true, successorTransferId = 'tr-6a' } = {}
    ) =>
      withLeg(
        value,
        'tx-5',
        0,
        (leg) =>
          ({
            ...leg,
            atTrade: { kind: 'unavailable', reason: 'pick_outside_projection_domain' },
            specialEntitlement: { entitlementId, successorTransferId },
            reasons: [SINGLE, ...(reason ? [LINKED] : []), 'traded_on_return_provisional'],
            ...fields,
          }) as Leg
      );

    it('accepts a traded-on special entitlement that names its entitlement and successor', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(special(signed(V7)));
      expect(parseAflTradeRealizedTradeGradeBatch(batch)).toEqual(batch);
      expect(tradeOf(batch.content as Content, 'tx-5')).toMatchObject({
        state: 'provisional',
        reasons: [SINGLE, LINKED, 'traded_on_return_provisional'],
        legs: [
          {
            basis: 'pick_traded_on_return',
            specialEntitlement: { entitlementId, successorTransferId: 'tr-6a' },
          },
        ],
      });
    });

    it('seals v7 with its limitation and still parses sealed v1 to v6 batches', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(signed(V7));
      expect(batch.content.limitation).toBe(LIMITATIONS[V7]);
      for (const ruleVersion of [V1, 'afl-trade-realized-grade-rule/v2', V3] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(content(ruleVersion))).not.toThrow();
      for (const ruleVersion of [V4, V5, V6] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(signed(ruleVersion))).not.toThrow();
    });

    it.each<[string, () => Content, RegExp]>([
      ['a special entitlement under v6', () => special(signed(V6)), /Only rule v7 and later/],
      [
        'the custody reason under v6',
        () =>
          withLeg(signed(V6), 'tx-5', 0, (leg) => ({
            ...leg,
            reasons: [SINGLE, LINKED, 'traded_on_return_provisional'],
          })),
        /Only rule v7 and later/,
      ],
      [
        'a special entitlement without its reason',
        () => special(signed(V7), {}, { reason: false }),
        /followed through its custody chain, and only that/,
      ],
      [
        'the custody reason without a special entitlement',
        () =>
          withLeg(signed(V7), 'tx-5', 0, (leg) => ({
            ...leg,
            reasons: [SINGLE, LINKED, 'traded_on_return_provisional'],
          })),
        /followed through its custody chain, and only that/,
      ],
      [
        'a special entitlement on a selected pick',
        () =>
          withLeg(
            signed(V7),
            'tx-6',
            0,
            (leg) =>
              ({
                ...leg,
                specialEntitlement: { entitlementId, successorTransferId: 'tr-6b' },
                reasons: [SINGLE, LINKED],
              }) as Leg
          ),
        /Only a single-source traded-on pick leg follows/,
      ],
      [
        'a corroborated special entitlement',
        () =>
          special(signed(V7), {
            corroboratedBy: 'footyinfo',
            reasons: [LINKED, 'traded_on_return_provisional'],
          }),
        /Only a single-source traded-on pick leg follows/,
      ],
      [
        'a successor its club did not give',
        () => special(signed(V7), {}, { successorTransferId: 'tr-6c' }),
        /successor is the leg its club gave in the onward trade/,
      ],
      [
        'a successor outside the onward trade',
        () => special(signed(V7), {}, { successorTransferId: 'tr-4a' }),
        /successor is the leg its club gave in the onward trade/,
      ],
      [
        'an entitlement id that is not a special entitlement address',
        () =>
          special(signed(V7), {
            specialEntitlement: { entitlementId: 'draft-pick:x', successorTransferId: 'tr-6a' },
          }),
        /special-draft-entitlement/,
      ],
    ])('refuses %s', (_label, build, message) => refuses(build(), message));
  });

  describe('rule v8 a future pick at the slot it eventually took', () => {
    const signed = (ruleVersion: AflTradeRealizedGradeRuleVersion) => {
      const value = content(ruleVersion);
      for (const row of value.trades)
        for (const leg of row.legs)
          if ('stint' in leg) leg.stint = { ...leg.stint, pavSum: leg.realizedValue };
      return value;
    };
    const eventual = (
      selectionNumber: number,
      slotSource: 'selection' | 'order' | 'projected_order'
    ) => ({
      kind: 'pick_projection_eventual_slot' as const,
      benchmarkId,
      selectionNumber,
      slotSource,
      value: hpnDpv3ValueForPick(selectionNumber),
    });
    const atTrade =
      (view: Record<string, unknown>) =>
      (leg: Leg): Leg =>
        ({ ...leg, atTrade: view }) as Leg;
    /** tx-3's pending future pick, valued from slot 7 of its own draft's order. */
    const projectedLeg = (leg: Leg, selectionNumber = 7, slot = selectionNumber): Leg => ({
      transferId: leg.transferId,
      assetKind: 'pick',
      sendingClubId: leg.sendingClubId,
      receivingClubId: leg.receivingClubId,
      state: 'valued',
      basis: 'pick_projected_from_order',
      realizedValue: hpnDpv3ValueForPick(selectionNumber),
      projection: {
        benchmarkId,
        selectionNumber,
        orderDraftYear: 2026,
        pickDraftYear: 2026,
        custodyId: `external-pick-custody:${hex('c')}`,
        observedAt: { precision: 'day', date: '2026-10-10' },
        proxy: false,
      },
      reasons: ['pick_projected_from_live_order'],
      atTrade: eventual(slot, 'projected_order'),
    });
    // tx-1: the selected pick tr-1b went at 3 and the not-used tr-1c held 40; tx-3 is projected at 7.
    const eventualBatch = (ruleVersion: AflTradeRealizedGradeRuleVersion = V8) => {
      const value = withLeg(signed(ruleVersion), 'tx-1', 1, atTrade(eventual(3, 'selection')));
      withLeg(value, 'tx-1', 2, atTrade(eventual(40, 'order')));
      return withLeg(value, 'tx-3', 0, (leg) => projectedLeg(leg));
    };

    it('reports each eventual slot beside its leg and changes no total', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(eventualBatch());
      expect(parseAflTradeRealizedTradeGradeBatch(batch)).toEqual(batch);
      const before = signed(V8);
      expect(tradeOf(batch.content as Content, 'tx-1')).toMatchObject({
        clubs: tradeOf(before, 'tx-1').clubs,
        legs: [{}, { atTrade: eventual(3, 'selection') }, { atTrade: eventual(40, 'order') }],
      });
      expect(tradeOf(batch.content as Content, 'tx-3').legs[0]).toMatchObject({
        atTrade: eventual(7, 'projected_order'),
      });
    });

    it('seals v8 with its limitation and still parses sealed v1 to v7 batches', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(signed(V8));
      expect(batch.content.limitation).toBe(LIMITATIONS[V8]);
      expect(batch.content.limitation).toContain(
        "a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total"
      );
      for (const ruleVersion of [V1, 'afl-trade-realized-grade-rule/v2', V3] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(content(ruleVersion))).not.toThrow();
      for (const ruleVersion of [V4, V5, V6, V7] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(signed(ruleVersion))).not.toThrow();
    });

    it.each<[string, () => Content, RegExp]>([
      ['an eventual slot under v7', () => eventualBatch(V7), /Only rule v8 and later/],
      [
        'a value that is not the slot’s',
        () => withLeg(signed(V8), 'tx-1', 1, atTrade({ ...eventual(3, 'selection'), value: 100 })),
        /valued at the HPN DPVC v3 value of that slot/,
      ],
      [
        'a slot beyond HPN’s 1 to 90',
        () =>
          withLeg(
            signed(V8),
            'tx-1',
            1,
            atTrade({ ...eventual(90, 'selection'), selectionNumber: 91 })
          ),
        /expected number to be <=90/,
      ],
      [
        'an eventual slot on a player leg',
        () => withLeg(signed(V8), 'tx-4', 0, atTrade(eventual(3, 'order'))),
        /on a pick leg/,
      ],
      [
        'another benchmark',
        () =>
          withLeg(
            signed(V8),
            'tx-1',
            1,
            atTrade({ ...eventual(3, 'selection'), benchmarkId: `hpn-pick-benchmark:${hex('d')}` })
          ),
        /pinned benchmark/,
      ],
      [
        'a projected order slot on a leg that is not projected',
        () => withLeg(signed(V8), 'tx-1', 2, atTrade(eventual(40, 'projected_order'))),
        /projected order slot exactly when its leg is projected/,
      ],
      [
        'a projected leg whose eventual slot is read from the order',
        () =>
          withLeg(signed(V8), 'tx-3', 0, (leg) => atTrade(eventual(7, 'order'))(projectedLeg(leg))),
        /projected order slot exactly when its leg is projected/,
      ],
      [
        'a projected leg whose eventual slot is not its projection’s',
        () => withLeg(signed(V8), 'tx-3', 0, (leg) => projectedLeg(leg, 7, 8)),
        /the slot it is projected from/,
      ],
      [
        'a selection slot on a traded-on pick',
        () => withLeg(signed(V8), 'tx-5', 0, atTrade(eventual(20, 'selection'))),
        /Only a selected pick takes its eventual slot from its selection/,
      ],
    ])('refuses %s', (_label, build, message) => refuses(build(), message));
  });

  describe('rule v9 a stated not-used pick its club traded on (issue 789)', () => {
    const OVERRIDE = 'stated_not_used_traded_on' as const;
    const signed = (ruleVersion: AflTradeRealizedGradeRuleVersion) => {
      const value = content(ruleVersion);
      for (const row of value.trades)
        for (const leg of row.legs)
          if ('stint' in leg) leg.stint = { ...leg.stint, pavSum: leg.realizedValue };
      return value;
    };
    /** tx-5's traded-on pick, which Draftguru stated not used. */
    const overridden = (ruleVersion: AflTradeRealizedGradeRuleVersion = V9) =>
      withLeg(signed(ruleVersion), 'tx-5', 0, (leg) => ({
        ...leg,
        reasons: [SINGLE, OVERRIDE, 'traded_on_return_provisional'],
      }));

    it('accepts the reason on a traded-on leg and changes no total', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(overridden());
      expect(parseAflTradeRealizedTradeGradeBatch(batch)).toEqual(batch);
      expect(tradeOf(batch.content as Content, 'tx-5')).toMatchObject({
        state: 'provisional',
        reasons: [SINGLE, OVERRIDE, 'traded_on_return_provisional'],
        clubs: tradeOf(signed(V9), 'tx-5').clubs,
      });
    });

    it('accepts the reason on a blocked leg', () => {
      const value = withLeg(signed(V9), 'tx-5', 0, (leg) => ({
        transferId: leg.transferId,
        assetKind: 'pick',
        sendingClubId: leg.sendingClubId,
        receivingClubId: leg.receivingClubId,
        state: 'blocked',
        basis: 'unavailable',
        reasons: [OVERRIDE, 'traded_on_return_unlinked'],
        atTrade: leg.atTrade,
      }));
      expect(() => createAflTradeRealizedTradeGradeBatch(value)).not.toThrow();
    });

    it('seals v9 with its limitation and still parses sealed v1 to v8 batches', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(signed(V9));
      expect(batch.content.limitation).toBe(LIMITATIONS[V9]);
      expect(batch.content.limitation).toContain(
        "a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used"
      );
      for (const ruleVersion of [V1, 'afl-trade-realized-grade-rule/v2', V3] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(content(ruleVersion))).not.toThrow();
      for (const ruleVersion of [V4, V5, V6, V7, V8] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(signed(ruleVersion))).not.toThrow();
    });

    it.each<[string, () => Content, RegExp]>([
      ['the reason under v8', () => overridden(V8), /Only rule v9 and later/],
      [
        'the reason on a not-used leg',
        () => withLeg(signed(V9), 'tx-1', 2, (leg) => ({ ...leg, reasons: [SINGLE, OVERRIDE] })),
        /Only a traded-on pick leg, or a blocked one, overrides/,
      ],
      [
        'the reason on a player leg',
        () => withLeg(signed(V9), 'tx-4', 0, (leg) => ({ ...leg, reasons: [OVERRIDE] })),
        /Only a traded-on pick leg, or a blocked one, overrides/,
      ],
    ])('refuses %s', (_label, build, message) => refuses(build(), message));
  });

  describe('rule v10 a nominee only a Footyinfo board matched bid records (issue 789)', () => {
    const signed = (ruleVersion: AflTradeRealizedGradeRuleVersion) => {
      const value = content(ruleVersion);
      for (const row of value.trades)
        for (const leg of row.legs)
          if ('stint' in leg) leg.stint = { ...leg.stint, pavSum: leg.realizedValue };
      return value;
    };
    // tx-1's tr-1c, excluded because its club took a nominee the board records as a matched bid.
    const excluded = (
      ruleVersion: AflTradeRealizedGradeRuleVersion = V10,
      extra: Partial<Leg> = {}
    ) =>
      withLeg(
        signed(ruleVersion),
        'tx-1',
        2,
        (leg) =>
          ({
            transferId: leg.transferId,
            assetKind: 'pick',
            sendingClubId: leg.sendingClubId,
            receivingClubId: leg.receivingClubId,
            state: 'excluded',
            basis: 'pick_not_used_nominee_excluded',
            reasons: ['not_used_nominee_excluded', SINGLE],
            atTrade: leg.atTrade,
            nomineeMatchedBidBy: 'footyinfo',
            ...extra,
          }) as Leg
      );

    it('accepts a single-source excluded nominee leg that names the board', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(excluded());
      expect(parseAflTradeRealizedTradeGradeBatch(batch)).toEqual(batch);
      expect(tradeOf(batch.content as Content, 'tx-1').legs[2]).toMatchObject({
        state: 'excluded',
        nomineeMatchedBidBy: 'footyinfo',
        reasons: ['not_used_nominee_excluded', SINGLE],
      });
    });

    it('seals v10 with its limitation and still parses sealed v1 to v9 batches', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(signed(V10));
      expect(batch.content.limitation).toBe(LIMITATIONS[V10]);
      expect(batch.content.limitation).toContain(
        "a receiving club's selection a reviewed Footyinfo board records as that club's matched bid counts as a nominee even when Draftguru marks it open"
      );
      for (const ruleVersion of [V1, 'afl-trade-realized-grade-rule/v2', V3] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(content(ruleVersion))).not.toThrow();
      for (const ruleVersion of [V4, V5, V6, V7, V8, V9] as const)
        expect(() => createAflTradeRealizedTradeGradeBatch(signed(ruleVersion))).not.toThrow();
    });

    it.each<[string, () => Content, RegExp]>([
      ['the board nominee under v9', () => excluded(V9), /Only rule v10 and later/],
      [
        'the board nominee on a not-used leg worth 0',
        () =>
          withLeg(
            signed(V10),
            'tx-1',
            2,
            (leg) => ({ ...leg, nomineeMatchedBidBy: 'footyinfo' }) as Leg
          ),
        /board-recorded matched bid/,
      ],
      [
        'the board nominee on a player leg',
        () =>
          withLeg(
            signed(V10),
            'tx-4',
            0,
            (leg) => ({ ...leg, nomineeMatchedBidBy: 'footyinfo' }) as Leg
          ),
        /board-recorded matched bid/,
      ],
    ])('refuses %s', (_label, build, message) => refuses(build(), message));
  });

  describe('rule v11 a sole asset takes its return; an all-excluded return is unallocated (issue 789)', () => {
    const signed = (ruleVersion: AflTradeRealizedGradeRuleVersion) => {
      const value = content(ruleVersion);
      for (const row of value.trades)
        for (const leg of row.legs)
          if ('stint' in leg) leg.stint = { ...leg.stint, pavSum: leg.realizedValue };
      return value;
    };
    /** Replaces a trade's legs and re-derives the trade and the summary, like `withLeg`. */
    const withLegs = (value: Content, id: string, change: (legs: Leg[]) => Leg[]) => {
      const target = tradeOf(value, id);
      target.legs = change(structuredClone(target.legs));
      return withLeg(value, id, 0, (leg) => leg);
    };
    const nominee = (leg: Leg): Leg => ({
      transferId: leg.transferId,
      assetKind: 'pick',
      sendingClubId: leg.sendingClubId,
      receivingClubId: leg.receivingClubId,
      state: 'excluded',
      basis: 'pick_not_used_nominee_excluded',
      reasons: ['not_used_nominee_excluded', SINGLE],
      atTrade: projection(20),
    });
    const soleAsset = (leg: Leg, returnValue: number): Leg => ({
      transferId: leg.transferId,
      assetKind: 'pick',
      sendingClubId: leg.sendingClubId,
      receivingClubId: leg.receivingClubId,
      state: 'valued',
      basis: 'pick_traded_on_return',
      realizedValue: returnValue,
      onward: {
        transactionId: 'tx-6',
        allocation: 'sole_asset',
        returnValue,
        givenAssetCount: 1,
        weight: null,
        weightTotal: null,
        share: 1,
      },
      reasons: [SINGLE, 'traded_on_return_provisional'],
      atTrade: leg.atTrade,
    });
    const unallocatedLeg = (leg: Leg): Leg => ({
      transferId: leg.transferId,
      assetKind: 'pick',
      sendingClubId: leg.sendingClubId,
      receivingClubId: leg.receivingClubId,
      state: 'excluded',
      basis: 'pick_traded_on_return_unallocated',
      onwardTransactionId: 'tx-6',
      reasons: [SINGLE, 'traded_on_return_unallocated'],
      atTrade: leg.atTrade,
    });
    // tx-6 with Hawthorn giving only pick 20 (no player), so the tx-5 pick is a sole asset there.
    const sole = (ruleVersion: AflTradeRealizedGradeRuleVersion) =>
      withLegs(signed(ruleVersion), 'tx-6', (legs) =>
        legs.filter(({ transferId }) => transferId !== 'tr-6b')
      );
    // St Kilda spent pick 20 on a nominee; Hawthorn still got the player worth 40 for it.
    const spentOnward = (
      ruleVersion: AflTradeRealizedGradeRuleVersion,
      hop: 'valued' | 'unallocated'
    ) =>
      withLeg(withLeg(sole(ruleVersion), 'tx-6', 0, nominee), 'tx-5', 0, (leg) =>
        hop === 'valued' ? soleAsset(leg, 40) : unallocatedLeg(leg)
      );
    // Hawthorn's only return in tx-6 is a pick it spent on a nominee: excluded, not a known 0.
    const excludedReturn = (
      ruleVersion: AflTradeRealizedGradeRuleVersion,
      hop: 'zero' | 'unallocated',
      keepPlayer = false
    ) =>
      withLeg(
        withLegs(sole(ruleVersion), 'tx-6', (legs) => [
          ...legs.filter(({ transferId }) => keepPlayer || transferId !== 'tr-6c'),
          nominee({
            ...legs[0]!,
            transferId: 'tr-6d',
            sendingClubId: 'st-kilda',
            receivingClubId: 'hawthorn',
          }),
        ]),
        'tx-5',
        0,
        (leg) => (hop === 'zero' ? soleAsset(leg, keepPlayer ? 40 : 0) : unallocatedLeg(leg))
      );

    it('values a sole asset at its whole return when the next holder spent it on a nominee', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(spentOnward(V11, 'valued'));
      expect(parseAflTradeRealizedTradeGradeBatch(batch)).toEqual(batch);
      expect(tradeOf(batch.content as Content, 'tx-5').clubs).toEqual([
        { clubId: 'hawthorn', received: 40, givenUp: 0, net: 40 },
        { clubId: 'melbourne', received: 0, givenUp: 40, net: -40 },
      ]);
    });

    it('leaves an all-excluded return unallocated', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(excludedReturn(V11, 'unallocated'));
      expect(tradeOf(batch.content as Content, 'tx-6').clubs).toContainEqual({
        clubId: 'hawthorn',
        received: 0,
        givenUp: 12,
        net: -12,
      });
      expect(tradeOf(batch.content as Content, 'tx-5').legs[0]).toMatchObject({
        state: 'excluded',
        basis: 'pick_traded_on_return_unallocated',
      });
    });

    it('still leaves a bundle’s excluded pick unallocated and values a partly excluded return', () => {
      expect(() => createAflTradeRealizedTradeGradeBatch(unallocated(signed(V11)))).not.toThrow();
      expect(() =>
        createAflTradeRealizedTradeGradeBatch(excludedReturn(V11, 'zero', true))
      ).not.toThrow();
    });

    it('seals v11 with its limitation and still parses v10 batches graded the old way', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(signed(V11));
      expect(batch.content.limitation).toBe(LIMITATIONS[V11]);
      expect(() => createAflTradeRealizedTradeGradeBatch(signed(V10))).not.toThrow();
      expect(() =>
        createAflTradeRealizedTradeGradeBatch(spentOnward(V10, 'unallocated'))
      ).not.toThrow();
      expect(() =>
        createAflTradeRealizedTradeGradeBatch(excludedReturn(V10, 'zero'))
      ).not.toThrow();
    });

    it.each<[string, () => Content, RegExp]>([
      [
        'a sole asset valued past its excluded onward leg under v10',
        () => spentOnward(V10, 'valued'),
        /Only rule v11 and later/,
      ],
      [
        'a sole asset left unallocated under v11',
        () => spentOnward(V11, 'unallocated'),
        /names the onward trade where it is excluded/,
      ],
      [
        'an all-excluded return valued at 0 under v11',
        () => excludedReturn(V11, 'zero'),
        /every onward return leg is excluded/,
      ],
      [
        'an all-excluded return left unallocated under v10',
        () => excludedReturn(V10, 'unallocated'),
        /names the onward trade where it is excluded/,
      ],
    ])('refuses %s', (_label, build, message) => refuses(build(), message));

    // Rule v12 (issue 789) orders undated pick hops; the batch records nothing new for it.
    it('seals v12 with its limitation, keeps the v11 allocation, and still parses v11 batches', () => {
      const batch = createAflTradeRealizedTradeGradeBatch(signed(V12));
      expect(batch.content.ruleVersion).toBe(V12);
      expect(batch.content.limitation).toBe(LIMITATIONS[V12]);
      expect(batch.content.limitation).toContain(
        'undated pick trades of one season are ordered by the Draftguru pick-trade sequence'
      );
      expect(() => createAflTradeRealizedTradeGradeBatch(spentOnward(V12, 'valued'))).not.toThrow();
      expect(() =>
        createAflTradeRealizedTradeGradeBatch(excludedReturn(V12, 'unallocated'))
      ).not.toThrow();
      expect(() => createAflTradeRealizedTradeGradeBatch(signed(V11))).not.toThrow();
      refuses({ ...signed(V12), limitation: LIMITATIONS[V11] }, /limitation/i);
    });

    describe('rule v13 a bundle with an excluded asset leaves its traded-on shares unknown', () => {
      // Hawthorn's bundle sibling in tx-6 (tr-6b) becomes a pick St Kilda spent on a nominee. Through
      // v12 it dropped out of the weight total, and pick 20 took share 1 (12 of 12) of the 40.
      const excludedSibling = (
        ruleVersion: AflTradeRealizedGradeRuleVersion,
        hop: 'shared' | 'split' | 'unallocated'
      ) => {
        const value = withLeg(signed(ruleVersion), 'tx-6', 1, nominee);
        if (hop === 'split')
          withLeg(value, 'tx-6', 0, (leg) =>
            'stint' in leg ? { ...leg, realizedValue: 0, stint: { ...leg.stint, pavSum: 0 } } : leg
          );
        return withLeg(value, 'tx-5', 0, (leg) => {
          if (hop === 'unallocated') return unallocatedLeg(leg);
          const split = hop === 'split';
          return {
            ...soleAsset(leg, 40),
            realizedValue: split ? 20 : 40,
            onward: {
              transactionId: 'tx-6',
              allocation: split ? 'equal_split' : 'relative_value',
              returnValue: 40,
              givenAssetCount: 2,
              weight: split ? null : 12,
              weightTotal: split ? null : 12,
              share: split ? 0.5 : 1,
            },
            reasons: split
              ? ['equal_split_tiebreak', SINGLE, 'traded_on_return_provisional']
              : [SINGLE, 'traded_on_return_provisional'],
          } as Leg;
        });
      };

      it('seals v13 with its limitation and leaves the bundle’s traded-on pick unallocated', () => {
        const batch = createAflTradeRealizedTradeGradeBatch(excludedSibling(V13, 'unallocated'));
        expect(batch.content.ruleVersion).toBe(V13);
        expect(batch.content.limitation).toBe(LIMITATIONS[V13]);
        expect(tradeOf(batch.content as Content, 'tx-5').clubs).toEqual([
          { clubId: 'hawthorn', received: 0, givenUp: 0, net: 0 },
          { clubId: 'melbourne', received: 0, givenUp: 0, net: 0 },
        ]);
        refuses({ ...signed(V13), limitation: LIMITATIONS[V12] }, /limitation/i);
      });

      it('still shares an all-valued bundle and values a sole asset past its excluded leg', () => {
        expect(() => createAflTradeRealizedTradeGradeBatch(signed(V13))).not.toThrow();
        expect(() =>
          createAflTradeRealizedTradeGradeBatch(spentOnward(V13, 'valued'))
        ).not.toThrow();
      });

      it('still parses v12 batches that shared the return past an excluded sibling', () => {
        for (const hop of ['shared', 'split', 'unallocated'] as const)
          expect(() =>
            createAflTradeRealizedTradeGradeBatch(excludedSibling(V12, hop))
          ).not.toThrow();
        expect(() =>
          createAflTradeRealizedTradeGradeBatch(excludedSibling(V11, 'shared'))
        ).not.toThrow();
      });

      it.each<[string, () => Content]>([
        ['a share by weight past an excluded sibling', () => excludedSibling(V13, 'shared')],
        ['an even split past an excluded sibling', () => excludedSibling(V13, 'split')],
      ])('refuses %s under v13', (_label, build) =>
        refuses(build(), /From rule v13 a bundle with an excluded asset/)
      );
    });
  });
});
