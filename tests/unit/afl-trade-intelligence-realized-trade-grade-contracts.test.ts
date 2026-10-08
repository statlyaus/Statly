import { describe, expect, it } from 'vitest';

import { hpnDpv3ValueForPick } from '@/server/aflTradeIntelligence/modeling/hpnPickValueBenchmark';
import {
  createAflTradeRealizedTradeGradeBatch,
  expectedAflTradeRealizedTradeGradeClubs,
  parseAflTradeRealizedTradeGradeBatch,
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

function trade(transactionId: string, tradeYear: number, legs: Leg[]) {
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
    clubs: expectedAflTradeRealizedTradeGradeClubs(legs),
    legs,
  };
}

// tx-1 provisional: Collingwood gives a player (30 at Carlton); Carlton gives pick 12 (draftee 20) and a
//   not-used pick (Collingwood took no nominee: 0). Pick legs are single-source.
// tx-2 provisional: an open stint. tx-3 blocked: a pending future pick. tx-4 complete: players only.
// tx-5 / tx-6: Hawthorn receives pick 20 from Melbourne (tx-5), then trades it with a player to St Kilda
//   for a player worth 40 (tx-6). The pick became a draftee worth 12 there, the player 28: the pick's
//   share of Hawthorn's return is 12/40 of 40.
function content(): AflTradeRealizedTradeGradeBatchContent {
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
  ];
  return {
    schemaVersion: 'afl-trade-realized-trade-grade-batch/v1',
    ruleVersion: 'afl-trade-realized-grade-rule/v1',
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
    limitation:
      'Private local non-production realized trade grade in career_pav; single-source pick outcomes; not public factual, publication, production or activation authority.',
  };
}

type Content = ReturnType<typeof content>;
const tradeOf = (value: Content, id: string) =>
  value.trades.find((row) => row.transactionId === id)!;
/** Replaces one leg and re-derives the trade's reasons, state, clubs and the summary. */
function withLeg(value: Content, id: string, index: number, change: (leg: Leg) => Leg) {
  const target = tradeOf(value, id);
  target.legs[index] = change(structuredClone(target.legs[index]!));
  Object.assign(target, trade(target.transactionId, target.tradeYear, target.legs));
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
  const unallocated = () => {
    const value = withLeg(content(), 'tx-6', 0, (leg) => ({
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
});
