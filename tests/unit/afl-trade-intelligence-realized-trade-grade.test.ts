import { describe, expect, it } from 'vitest';

import { hpnDpv3ValueForPick } from '@/server/aflTradeIntelligence/modeling/hpnPickValueBenchmark';
import {
  gradeAflTradesOnRealizedValue,
  type AflTradeRealizedTradeGradeInputs,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeGrade';

const hex = (digit: string) => digit.repeat(64);
type Candidate = AflTradeRealizedTradeGradeInputs['candidate'];
type Transfer = Candidate['transfers'][number];
type Outcome = NonNullable<Candidate['pickOutcomes']>[number];

const player = (
  transferId: string,
  transactionId: string,
  from: string,
  to: string,
  playerId: string | null
): Transfer =>
  ({
    transferId,
    transactionId,
    fromClubId: from,
    toClubId: to,
    asset: { kind: 'player', playerId, recordedName: playerId ?? 'Unknown' },
    status: 'single_source',
    evidenceIds: [],
  }) as unknown as Transfer;
const pick = (
  transferId: string,
  transactionId: string,
  from: string,
  to: string,
  pickId: string,
  draftYear: number,
  nominalPick: number | null
): Transfer =>
  ({
    transferId,
    transactionId,
    fromClubId: from,
    toClubId: to,
    asset: {
      kind: 'pick_entitlement',
      pickId,
      draftYear,
      draftType: 'national',
      nominalRound: 1,
      nominalPick,
      originalClubId: from,
      recordedLabel: null,
    },
    status: 'single_source',
    evidenceIds: [],
  }) as unknown as Transfer;
/** A pick of a draft HPN's national-draft benchmark does not cover, so it has no projection. */
const rookie = (transfer: Transfer): Transfer =>
  ({ ...transfer, asset: { ...transfer.asset, draftType: 'rookie' } }) as Transfer;
/** Moves one transfer of a candidate to the rookie draft. */
const unprojected = (candidate: Candidate, transferId: string): Candidate => ({
  ...candidate,
  transfers: candidate.transfers.map((transfer) =>
    transfer.transferId === transferId ? rookie(transfer) : transfer
  ),
});
const outcome = (transferId: string, fields: Partial<Outcome>): Outcome =>
  ({
    outcomeId: `outcome-${transferId}`,
    transferId,
    disposition: 'selected',
    outcomeStatus: 'stated',
    selectionId: null,
    playerId: null,
    evidenceIds: [],
    ...fields,
  }) as unknown as Outcome;
const trade = (transactionId: string, seasonYear: number) =>
  ({
    transactionId,
    seasonYear,
    transactionType: 'trade',
  }) as unknown as Candidate['transactions'][number];

const spells = (playerId: string, rows: Array<[number, string]>) =>
  rows.map(([season, clubId]) => ({ playerId, season, clubId }));
const pavRows = (playerId: string, rows: Array<[number, string, number]>) =>
  rows.map(([season, clubId, value]) => ({ playerId, season, clubId, value }));

function inputs(
  candidate: Candidate,
  extra: Partial<AflTradeRealizedTradeGradeInputs> = {}
): AflTradeRealizedTradeGradeInputs {
  return {
    candidateId: `external-reconciliation:${hex('a')}`,
    candidate,
    pavCalculations: [2021, 2022, 2023, 2024, 2025].map((season) => ({
      season,
      calculationId: `hpn-pav-season:${season}`,
      official: true,
    })),
    pav: [],
    seasonSpells: [],
    spellSeasons: [2021, 2022, 2023, 2024, 2025],
    reviewedArrivals: [],
    pickProjectionBenchmarkId: `hpn-pick-benchmark:${hex('b')}`,
    spellCutoffAt: '2026-10-08T00:00:00.000Z',
    gradedAt: '2026-10-08T13:00:00.000Z',
    ...extra,
  };
}
const gradeOf = (batch: ReturnType<typeof gradeAflTradesOnRealizedValue>, transactionId: string) =>
  batch.content.trades.find((row) => row.transactionId === transactionId)!;
const legOf = (batch: ReturnType<typeof gradeAflTradesOnRealizedValue>, transferId: string) =>
  batch.content.trades.flatMap((row) => row.legs).find((leg) => leg.transferId === transferId)!;

describe('MVP realized trade grader', () => {
  // A 2021 player-for-player trade: P1 Collingwood → Carlton, P2 Carlton → Collingwood.
  const swap = (): Candidate => ({
    transactions: [trade('tx-1', 2021)],
    transfers: [
      player('tr-1a', 'tx-1', 'collingwood', 'carlton', 'p1'),
      player('tr-1b', 'tx-1', 'carlton', 'collingwood', 'p2'),
    ],
  });
  const swapData = {
    seasonSpells: [
      ...spells('p1', [
        [2021, 'collingwood'],
        [2022, 'carlton'],
        [2023, 'carlton'],
        [2024, 'essendon'],
        [2025, 'carlton'],
      ]),
      ...spells('p2', [
        [2021, 'carlton'],
        [2022, 'collingwood'],
        [2023, 'geelong'],
      ]),
    ],
    pav: [
      ...pavRows('p1', [
        [2021, 'collingwood', 9],
        [2022, 'carlton', 12],
        [2023, 'carlton', 10],
        [2025, 'carlton', 50],
      ]),
      ...pavRows('p2', [[2022, 'collingwood', 7]]),
    ],
    reviewedArrivals: [
      { playerId: 'p1', clubId: 'carlton', season: 2022 },
      { playerId: 'p2', clubId: 'collingwood', season: 2022 },
    ],
  };

  it('values each player on his whole first stint, excludes a return stint, and nets received minus given', () => {
    const batch = gradeAflTradesOnRealizedValue(inputs(swap(), swapData));
    const p1 = legOf(batch, 'tr-1a');
    expect(p1).toMatchObject({
      state: 'valued',
      basis: 'player_first_stint',
      realizedValue: 22,
      stint: { status: 'closed', seasonsValued: [2022, 2023], seasonsMissingPav: [] },
      reasons: [],
      atTrade: { kind: 'player_trade_season_pav', season: 2021, value: 9 },
    });
    // The 2025 return to Carlton (50) is not this trade's.
    expect(gradeOf(batch, 'tx-1')).toMatchObject({
      state: 'complete',
      clubs: [
        { clubId: 'carlton', received: 22, givenUp: 7, net: 15 },
        { clubId: 'collingwood', received: 7, givenUp: 22, net: -15 },
      ],
    });
  });

  it('counts a season with no games as 0 and states open stints, unreviewed arrivals and no appearances', () => {
    const batch = gradeAflTradesOnRealizedValue(
      inputs(swap(), {
        seasonSpells: spells('p1', [
          [2022, 'carlton'],
          [2023, 'carlton'],
          [2024, 'carlton'],
          [2025, 'carlton'],
        ]),
        pav: pavRows('p1', [
          [2022, 'carlton', 5],
          [2024, 'carlton', 6],
        ]),
        reviewedArrivals: [],
      })
    );
    expect(legOf(batch, 'tr-1a')).toMatchObject({
      realizedValue: 11,
      stint: { status: 'open', seasonsValued: [2022, 2023, 2024, 2025] },
      reasons: ['arrival_unreviewed', 'stint_open'],
    });
    expect(legOf(batch, 'tr-1b')).toMatchObject({
      realizedValue: 0,
      reasons: ['arrival_unreviewed', 'no_appearances_after_trade', 'stint_open'],
    });
    expect(gradeOf(batch, 'tx-1').state).toBe('provisional');
  });

  it('lists seasons without PAV and flags unofficial seasons', () => {
    const candidate: Candidate = {
      transactions: [trade('tx-9', 2019)],
      transfers: [
        player('tr-9a', 'tx-9', 'gws', 'fremantle', 'p9'),
        player('tr-9b', 'tx-9', 'fremantle', 'gws', 'p8'),
      ],
    };
    const batch = gradeAflTradesOnRealizedValue(
      inputs(candidate, {
        pavCalculations: [
          { season: 2021, calculationId: 'hpn-pav-season:2021', official: true },
          { season: 2026, calculationId: 'hpn-pav-season:2026', official: false },
        ],
        spellSeasons: [2021, 2026],
        seasonSpells: [
          ...spells('p9', [
            [2021, 'fremantle'],
            [2026, 'fremantle'],
          ]),
          ...spells('p8', [
            [2021, 'gws'],
            [2026, 'adelaide'],
          ]),
        ],
        pav: pavRows('p9', [
          [2021, 'fremantle', 4],
          [2026, 'fremantle', 3],
        ]),
        reviewedArrivals: [
          { playerId: 'p9', clubId: 'fremantle', season: 2020 },
          { playerId: 'p8', clubId: 'gws', season: 2020 },
        ],
      })
    );
    expect(legOf(batch, 'tr-9a')).toMatchObject({
      realizedValue: 7,
      stint: {
        status: 'open',
        seasonsValued: [2021, 2026],
        seasonsMissingPav: [2020, 2022, 2023, 2024, 2025],
      },
      reasons: ['pav_season_not_official', 'pav_seasons_missing', 'stint_open'],
      atTrade: { kind: 'unavailable', reason: 'trade_season_pav_missing' },
    });
    expect(legOf(batch, 'tr-9b')).toMatchObject({
      stint: {
        status: 'closed',
        seasonsValued: [2021],
        seasonsMissingPav: [2020, 2022, 2023, 2024, 2025],
      },
    });
  });

  describe('picks', () => {
    const pickTrade = (
      outcomeFields: Partial<Outcome> | null,
      nominalPick: number | null = 12
    ): Candidate => ({
      transactions: [trade('tx-2', 2021)],
      transfers: [pick('tr-2a', 'tx-2', 'richmond', 'hawthorn', 'pick-A', 2021, nominalPick)],
      pickOutcomes: outcomeFields ? [outcome('tr-2a', outcomeFields)] : [],
    });

    it('values a selected pick on its draftee’s first stint at the drafting club', () => {
      const batch = gradeAflTradesOnRealizedValue(
        inputs(pickTrade({ disposition: 'selected', playerId: 'd1' }), {
          seasonSpells: spells('d1', [
            [2022, 'hawthorn'],
            [2023, 'hawthorn'],
            [2024, 'sydney'],
          ]),
          pav: pavRows('d1', [
            [2022, 'hawthorn', 2],
            [2023, 'hawthorn', 6],
          ]),
        })
      );
      expect(legOf(batch, 'tr-2a')).toMatchObject({
        state: 'valued',
        basis: 'pick_selected_first_stint',
        realizedValue: 8,
        stint: { status: 'closed', seasonsValued: [2022, 2023] },
        reasons: ['arrival_unreviewed', 'single_source_pick_outcome'],
        atTrade: { kind: 'pick_projection', selectionNumber: 12, value: hpnDpv3ValueForPick(12) },
      });
      expect(gradeOf(batch, 'tx-2').state).toBe('provisional');
    });

    it.each<[string, Partial<Outcome> | null, Record<string, unknown>]>([
      [
        'a not-used pick whose club took no nominee is worth 0',
        {
          disposition: 'not_used',
          nominationBasis: 'club_took_no_nominated_player',
          receivingClubNominatedSelections: 0,
        },
        {
          state: 'valued',
          basis: 'pick_not_used_no_nominee',
          realizedValue: 0,
          reasons: ['single_source_pick_outcome'],
        },
      ],
      [
        'a not-used pick whose club took a nominee is excluded',
        {
          disposition: 'not_used',
          nominationBasis: 'club_took_nominated_player',
          receivingClubNominatedSelections: 2,
        },
        { state: 'excluded', reasons: ['not_used_nominee_excluded', 'single_source_pick_outcome'] },
      ],
      [
        'a not-used pick without access evidence blocks',
        { disposition: 'not_used', nominationBasis: 'no_access_evidence' },
        { state: 'blocked', reasons: ['not_used_no_access_evidence'] },
      ],
      [
        'a pending pick blocks',
        { disposition: 'not_used', outcomeStatus: 'pending' },
        { state: 'blocked', reasons: ['pick_outcome_pending'] },
      ],
      [
        'an unresolved outcome blocks',
        { disposition: 'selected', outcomeStatus: 'unresolved' },
        { state: 'blocked', reasons: ['pick_outcome_unresolved'] },
      ],
      [
        'a missing outcome blocks',
        null,
        { state: 'blocked', reasons: ['pick_outcome_unresolved'] },
      ],
    ])('%s', (_label, fields, expected) => {
      expect(
        legOf(gradeAflTradesOnRealizedValue(inputs(pickTrade(fields))), 'tr-2a')
      ).toMatchObject(expected);
    });

    it('gives a future pick no slot projection', () => {
      const leg = legOf(
        gradeAflTradesOnRealizedValue(
          inputs(pickTrade({ disposition: 'not_used', outcomeStatus: 'pending' }, null))
        ),
        'tr-2a'
      );
      expect(leg.atTrade).toEqual({ kind: 'unavailable', reason: 'future_pick_slot_unknown' });
    });

    it('blocks a special pick and an unidentified player', () => {
      const candidate: Candidate = {
        transactions: [trade('tx-3', 2021)],
        transfers: [
          {
            ...pick('tr-3a', 'tx-3', 'gold-coast', 'gws', 'x', 2021, 1),
            asset: {
              kind: 'special_pick',
              entitlementType: 'mini_draft',
              draftYear: 2021,
              selectionOrdinal: 1,
              sourceLabel: 'Mini draft',
            },
          } as unknown as Transfer,
          player('tr-3b', 'tx-3', 'gws', 'gold-coast', null),
        ],
      };
      const batch = gradeAflTradesOnRealizedValue(inputs(candidate));
      expect(legOf(batch, 'tr-3a').reasons).toEqual(['special_entitlement_unsupported']);
      expect(legOf(batch, 'tr-3b').reasons).toEqual(['player_identity_unresolved']);
      expect(gradeOf(batch, 'tx-3')).toMatchObject({
        state: 'blocked',
        clubs: [{ net: null }, { net: null }],
      });
    });
  });

  describe('traded-on picks', () => {
    // tx-A: Melbourne sends pick P to Hawthorn, which trades it on in tx-B to St Kilda (draftee d5)
    // for player q (40 at Hawthorn); optionally with player r (28 at St Kilda) in the bundle.
    function chain(
      withBundle: boolean,
      onwardOutcome: Partial<Outcome> = { disposition: 'selected', playerId: 'd5' }
    ): Candidate {
      return {
        transactions: [trade('tx-A', 2021), trade('tx-B', 2021)],
        transfers: [
          pick('tr-A1', 'tx-A', 'melbourne', 'hawthorn', 'pick-P', 2021, 20),
          pick('tr-B1', 'tx-B', 'hawthorn', 'st-kilda', 'pick-P', 2021, 20),
          ...(withBundle ? [player('tr-B2', 'tx-B', 'hawthorn', 'st-kilda', 'r')] : []),
          player('tr-B3', 'tx-B', 'st-kilda', 'hawthorn', 'q'),
        ],
        pickOutcomes: [
          outcome('tr-A1', { disposition: 'traded_on' }),
          outcome('tr-B1', onwardOutcome),
        ],
      };
    }
    const chainData = {
      seasonSpells: [
        ...spells('d5', [
          [2022, 'st-kilda'],
          [2023, 'adelaide'],
        ]),
        ...spells('r', [
          [2022, 'st-kilda'],
          [2023, 'st-kilda'],
          [2024, 'carlton'],
        ]),
        ...spells('q', [
          [2022, 'hawthorn'],
          [2023, 'essendon'],
        ]),
      ],
      pav: [
        ...pavRows('d5', [[2022, 'st-kilda', 12]]),
        ...pavRows('r', [
          [2022, 'st-kilda', 14],
          [2023, 'st-kilda', 14],
        ]),
        ...pavRows('q', [[2022, 'hawthorn', 40]]),
      ],
      reviewedArrivals: [
        { playerId: 'q', clubId: 'hawthorn', season: 2022 },
        { playerId: 'r', clubId: 'st-kilda', season: 2022 },
      ],
    };

    it('takes the whole onward return when the pick was the only asset given', () => {
      const leg = legOf(gradeAflTradesOnRealizedValue(inputs(chain(false), chainData)), 'tr-A1');
      expect(leg).toMatchObject({
        state: 'valued',
        basis: 'pick_traded_on_return',
        realizedValue: 40,
        onward: {
          transactionId: 'tx-B',
          allocation: 'sole_asset',
          returnValue: 40,
          givenAssetCount: 1,
          share: 1,
        },
        reasons: ['single_source_pick_outcome', 'traded_on_return_provisional'],
      });
    });

    it('shares a bundle’s return by what each given asset became', () => {
      const batch = gradeAflTradesOnRealizedValue(inputs(chain(true), chainData));
      expect(legOf(batch, 'tr-A1')).toMatchObject({
        realizedValue: (12 / 40) * 40,
        onward: {
          allocation: 'relative_value',
          weight: 12,
          weightTotal: 40,
          share: 12 / 40,
          givenAssetCount: 2,
        },
      });
      expect(gradeOf(batch, 'tx-A').clubs).toEqual([
        { clubId: 'hawthorn', received: 12, givenUp: 0, net: 12 },
        { clubId: 'melbourne', received: 0, givenUp: 12, net: -12 },
      ]);
    });

    it('splits evenly, and says so, when everything given became nothing', () => {
      const leg = legOf(
        gradeAflTradesOnRealizedValue(
          inputs(chain(true), { ...chainData, pav: pavRows('q', [[2022, 'hawthorn', 40]]) })
        ),
        'tr-A1'
      );
      expect(leg).toMatchObject({
        realizedValue: 20,
        onward: { allocation: 'equal_split', share: 0.5, weight: null, weightTotal: null },
        reasons: [
          'equal_split_tiebreak',
          'single_source_pick_outcome',
          'traded_on_return_provisional',
        ],
      });
    });

    it('blocks when the onward trade is missing or blocked', () => {
      const unlinked = chain(false);
      unlinked.transfers = unlinked.transfers.filter(({ transferId }) => transferId === 'tr-A1');
      unlinked.transactions = unlinked.transactions.filter(
        ({ transactionId }) => transactionId === 'tx-A'
      );
      expect(
        legOf(gradeAflTradesOnRealizedValue(inputs(unlinked, chainData)), 'tr-A1').reasons
      ).toEqual(['traded_on_return_unlinked']);
      // Rule v3: blocked when Hawthorn's own side is, here the player it received.
      const unidentified = chain(false);
      unidentified.transfers = unidentified.transfers.map((transfer) =>
        transfer.transferId === 'tr-B3'
          ? player('tr-B3', 'tx-B', 'st-kilda', 'hawthorn', null)
          : transfer
      );
      const blockedOnward = gradeAflTradesOnRealizedValue(inputs(unidentified, chainData));
      expect(legOf(blockedOnward, 'tr-A1').reasons).toEqual(['traded_on_return_blocked']);
    });

    it('rule v15: weights a pick the onward club spent on a nominee by its projection, the player by his value', () => {
      const batch = gradeAflTradesOnRealizedValue(
        inputs(
          chain(true, {
            disposition: 'not_used',
            nominationBasis: 'club_took_nominated_player',
            receivingClubNominatedSelections: 1,
          }),
          chainData
        )
      );
      expect(legOf(batch, 'tr-B1')).toMatchObject({
        state: 'excluded',
        basis: 'pick_not_used_nominee_excluded',
      });
      expect(legOf(batch, 'tr-B2')).toMatchObject({ state: 'valued', realizedValue: 28 });
      // Through v14 pick P was unallocated: player r has no projection. Under v15 r weighs the 28 he
      // realized at St Kilda and pick P, whose realized weight is unknown, its slot-20 DPVC value.
      const p20 = hpnDpv3ValueForPick(20);
      const total = p20 + 28;
      expect(legOf(batch, 'tr-A1')).toMatchObject({
        state: 'valued',
        basis: 'pick_traded_on_return',
        realizedValue: (p20 / total) * 40,
        onward: {
          transactionId: 'tx-B',
          allocation: 'hybrid_weighted',
          returnValue: 40,
          givenAssetCount: 2,
          weight: p20,
          weightTotal: total,
          share: p20 / total,
          hybridWeights: {
            benchmarkId: batch.content.inputs.pickProjectionBenchmarkId,
            onwardTransferId: 'tr-B1',
            assets: [
              { transferId: 'tr-B1', source: 'projection', value: p20 },
              { transferId: 'tr-B2', source: 'realized', value: 28 },
            ],
          },
        },
        reasons: [
          'bundle_split_estimated_weights',
          'single_source_pick_outcome',
          'traded_on_return_provisional',
        ],
      });
      expect(gradeOf(batch, 'tx-A').clubs).toEqual([
        { clubId: 'hawthorn', received: (p20 / total) * 40, givenUp: 0, net: (p20 / total) * 40 },
        {
          clubId: 'melbourne',
          received: 0,
          givenUp: (p20 / total) * 40,
          net: -(p20 / total) * 40,
        },
      ]);
    });

    describe('rules v11 and v16: a sole asset takes its return; an all-excluded return is unallocated unless projected', () => {
      const nominee: Partial<Outcome> = {
        disposition: 'not_used',
        nominationBasis: 'club_took_nominated_player',
        receivingClubNominatedSelections: 1,
      };
      // St Kilda also sends Hawthorn pick Q in tx-B, which Hawthorn spent matching a nominee bid.
      const withExcludedReturn = (
        candidate: Candidate,
        keepQ: boolean,
        slot: number = 30
      ): Candidate => ({
        ...candidate,
        transfers: [
          ...candidate.transfers.filter(({ transferId }) => keepQ || transferId !== 'tr-B3'),
          pick('tr-B4', 'tx-B', 'st-kilda', 'hawthorn', 'pick-Q', 2021, slot),
        ],
        pickOutcomes: [...(candidate.pickOutcomes ?? []), outcome('tr-B4', nominee)],
      });

      it('values a sole asset at its whole return when the next holder spent it on a nominee', () => {
        const batch = gradeAflTradesOnRealizedValue(inputs(chain(false, nominee), chainData));
        expect(legOf(batch, 'tr-B1')).toMatchObject({
          state: 'excluded',
          basis: 'pick_not_used_nominee_excluded',
        });
        expect(legOf(batch, 'tr-A1')).toMatchObject({
          state: 'valued',
          basis: 'pick_traded_on_return',
          realizedValue: 40,
          onward: { allocation: 'sole_asset', returnValue: 40, givenAssetCount: 1, share: 1 },
          reasons: ['single_source_pick_outcome', 'traded_on_return_provisional'],
        });
        expect(gradeOf(batch, 'tx-A').clubs).toEqual([
          { clubId: 'hawthorn', received: 40, givenUp: 0, net: 40 },
          { clubId: 'melbourne', received: 0, givenUp: 40, net: -40 },
        ]);
      });

      it('splits a bundle’s excluded pick by hybrid weights from rule v15, not as a sole asset', () => {
        expect(
          legOf(gradeAflTradesOnRealizedValue(inputs(chain(true, nominee), chainData)), 'tr-A1')
        ).toMatchObject({
          state: 'valued',
          onward: { allocation: 'hybrid_weighted', givenAssetCount: 2 },
        });
      });

      it('leaves a hop unallocated, not 0, when an excluded return leg has no projection', () => {
        // Pick Q is a rookie-draft pick, outside HPN's national draft, so rule v16 has no projection.
        const batch = gradeAflTradesOnRealizedValue(
          inputs(unprojected(withExcludedReturn(chain(false), false), 'tr-B4'), chainData)
        );
        expect(gradeOf(batch, 'tx-B').clubs).toContainEqual({
          clubId: 'hawthorn',
          received: 0,
          givenUp: 12,
          net: -12,
        });
        expect(legOf(batch, 'tr-B4').atTrade).toEqual({
          kind: 'unavailable',
          reason: 'pick_outside_projection_domain',
        });
        expect(legOf(batch, 'tr-A1')).toMatchObject({
          state: 'excluded',
          basis: 'pick_traded_on_return_unallocated',
          onwardTransactionId: 'tx-B',
          reasons: ['single_source_pick_outcome', 'traded_on_return_unallocated'],
        });
        expect(gradeOf(batch, 'tx-A').clubs).toEqual([
          { clubId: 'hawthorn', received: 0, givenUp: 0, net: 0 },
          { clubId: 'melbourne', received: 0, givenUp: 0, net: 0 },
        ]);
      });

      it('keeps the hop unallocated when one of several excluded return legs has no projection', () => {
        // Hawthorn gets back pick Q at 30 (projected) and rookie pick W (none): the sum is unknown.
        const candidate = withExcludedReturn(chain(false), false);
        candidate.transfers.push(
          rookie(pick('tr-B6', 'tx-B', 'st-kilda', 'hawthorn', 'pick-W', 2021, 30))
        );
        candidate.pickOutcomes!.push(outcome('tr-B6', nominee));
        expect(
          legOf(gradeAflTradesOnRealizedValue(inputs(candidate, chainData)), 'tr-A1')
        ).toMatchObject({
          state: 'excluded',
          basis: 'pick_traded_on_return_unallocated',
          reasons: ['single_source_pick_outcome', 'traded_on_return_unallocated'],
        });
      });

      it('rule v16: values a sole asset at the projection of the pick its club spent on a bid', () => {
        const batch = gradeAflTradesOnRealizedValue(
          inputs(withExcludedReturn(chain(false), false), chainData)
        );
        // Hawthorn's only return, pick Q at 30, matched a bid: its slot-30 DPVC value stands in.
        const p30 = hpnDpv3ValueForPick(30);
        expect(legOf(batch, 'tr-B4')).toMatchObject({
          state: 'excluded',
          basis: 'pick_not_used_nominee_excluded',
        });
        expect(legOf(batch, 'tr-A1')).toMatchObject({
          state: 'valued',
          basis: 'pick_traded_on_return',
          realizedValue: p30,
          onward: {
            transactionId: 'tx-B',
            allocation: 'sole_asset',
            returnValue: p30,
            givenAssetCount: 1,
            weight: null,
            weightTotal: null,
            share: 1,
            returnProjection: {
              benchmarkId: batch.content.inputs.pickProjectionBenchmarkId,
              legs: [{ transferId: 'tr-B4', source: 'pick_projection', value: p30 }],
            },
          },
          reasons: [
            'single_source_pick_outcome',
            'traded_on_return_estimated_from_projection',
            'traded_on_return_provisional',
          ],
        });
        expect(gradeOf(batch, 'tx-A').clubs).toEqual([
          { clubId: 'hawthorn', received: p30, givenUp: 0, net: p30 },
          { clubId: 'melbourne', received: 0, givenUp: p30, net: -p30 },
        ]);
      });

      it('rule v16: splits a projected return across a bundle as v15 would', () => {
        const p20 = hpnDpv3ValueForPick(20);
        const p30 = hpnDpv3ValueForPick(30);
        // All valued: pick P's draftee realized 12 and player r 28, so P takes 12 / 40 of p30.
        const valued = gradeAflTradesOnRealizedValue(
          inputs(withExcludedReturn(chain(true), false), chainData)
        );
        expect(legOf(valued, 'tr-A1')).toMatchObject({
          state: 'valued',
          realizedValue: (12 / 40) * p30,
          onward: {
            allocation: 'relative_value',
            returnValue: p30,
            givenAssetCount: 2,
            weight: 12,
            weightTotal: 40,
            share: 12 / 40,
            returnProjection: { legs: [{ transferId: 'tr-B4', value: p30 }] },
          },
          reasons: [
            'single_source_pick_outcome',
            'traded_on_return_estimated_from_projection',
            'traded_on_return_provisional',
          ],
        });
        // St Kilda spent pick P on a nominee too: P weighs its slot-20 projection, r his 28.
        const hybrid = gradeAflTradesOnRealizedValue(
          inputs(withExcludedReturn(chain(true, nominee), false), chainData)
        );
        const total = p20 + 28;
        expect(legOf(hybrid, 'tr-A1')).toMatchObject({
          state: 'valued',
          realizedValue: (p20 / total) * p30,
          onward: {
            allocation: 'hybrid_weighted',
            returnValue: p30,
            weight: p20,
            weightTotal: total,
            share: p20 / total,
            hybridWeights: {
              assets: [
                { transferId: 'tr-B1', source: 'projection', value: p20 },
                { transferId: 'tr-B2', source: 'realized', value: 28 },
              ],
            },
            returnProjection: { legs: [{ transferId: 'tr-B4', value: p30 }] },
          },
          reasons: [
            'bundle_split_estimated_weights',
            'single_source_pick_outcome',
            'traded_on_return_estimated_from_projection',
            'traded_on_return_provisional',
          ],
        });
      });

      it('rule v16: splits a projected return evenly when everything given became nothing', () => {
        // Draftee d5 and player r realized 0 at St Kilda, so Hawthorn's bundle splits p30 evenly.
        const leg = legOf(
          gradeAflTradesOnRealizedValue(
            inputs(withExcludedReturn(chain(true), false), { ...chainData, pav: [] })
          ),
          'tr-A1'
        );
        const p30 = hpnDpv3ValueForPick(30);
        expect(leg).toMatchObject({
          state: 'valued',
          realizedValue: p30 / 2,
          onward: {
            allocation: 'equal_split',
            returnValue: p30,
            givenAssetCount: 2,
            weight: null,
            weightTotal: null,
            share: 0.5,
            returnProjection: { legs: [{ transferId: 'tr-B4', value: p30 }] },
          },
          reasons: [
            'equal_split_tiebreak',
            'single_source_pick_outcome',
            'traded_on_return_estimated_from_projection',
            'traded_on_return_provisional',
          ],
        });
      });

      it('rule v16: values an upstream hop by the pick its club got back for a projected return', () => {
        // Gold Coast sends pick X to Hawthorn in tx-0; Hawthorn gives X to Melbourne in tx-A for
        // pick P, which is worth p30 (the projected return of tx-B). X is worth what P was.
        const candidate = withExcludedReturn(chain(false), false);
        candidate.transactions.push(trade('tx-0', 2020));
        candidate.transfers.push(
          pick('tr-01', 'tx-0', 'gold-coast', 'hawthorn', 'pick-X', 2021, 10),
          pick('tr-A2', 'tx-A', 'hawthorn', 'melbourne', 'pick-X', 2021, 10)
        );
        candidate.pickOutcomes!.push(
          outcome('tr-01', { disposition: 'traded_on' }),
          outcome('tr-A2', {
            disposition: 'not_used',
            nominationBasis: 'club_took_no_nominated_player',
            receivingClubNominatedSelections: 0,
          })
        );
        const batch = gradeAflTradesOnRealizedValue(inputs(candidate, chainData));
        const p30 = hpnDpv3ValueForPick(30);
        expect(legOf(batch, 'tr-A1')).toMatchObject({
          state: 'valued',
          realizedValue: p30,
          onward: { transactionId: 'tx-B', returnValue: p30 },
        });
        const upstream = legOf(batch, 'tr-01');
        expect(upstream).toMatchObject({
          state: 'valued',
          basis: 'pick_traded_on_return',
          realizedValue: p30,
          onward: { transactionId: 'tx-A', allocation: 'sole_asset', returnValue: p30, share: 1 },
          reasons: ['single_source_pick_outcome', 'traded_on_return_provisional'],
        });
        // Its own return, pick P, is valued, so it records no projected return of its own.
        expect('onward' in upstream && upstream.onward.returnProjection).toBeUndefined();
      });

      it('rule v16: counts an unallocated traded-on return leg at its own projection', () => {
        // Hawthorn trades pick Q on in tx-C for rookie pick Z, which it spends on a nominee: Q's own
        // return is unallocated (Z has no projection). In tx-B, Hawthorn's return is Q (slot 30) and
        // pick W (slot 40, a nominee): P is worth both projections, Q's onward chain unread.
        const candidate = withExcludedReturn(chain(false), false);
        candidate.transactions.push(trade('tx-C', 2021));
        candidate.transfers.push(
          pick('tr-B6', 'tx-B', 'st-kilda', 'hawthorn', 'pick-W', 2021, 40),
          pick('tr-C1', 'tx-C', 'hawthorn', 'geelong', 'pick-Q', 2021, 30),
          rookie(pick('tr-C2', 'tx-C', 'geelong', 'hawthorn', 'pick-Z', 2021, 30))
        );
        candidate.pickOutcomes = [
          ...candidate.pickOutcomes!.filter(({ transferId }) => transferId !== 'tr-B4'),
          outcome('tr-B4', { disposition: 'traded_on' }),
          outcome('tr-B6', nominee),
          outcome('tr-C1', nominee),
          outcome('tr-C2', nominee),
        ];
        const batch = gradeAflTradesOnRealizedValue(inputs(candidate, chainData));
        expect(legOf(batch, 'tr-B4')).toMatchObject({
          state: 'excluded',
          basis: 'pick_traded_on_return_unallocated',
          onwardTransactionId: 'tx-C',
        });
        const p30 = hpnDpv3ValueForPick(30);
        const p40 = hpnDpv3ValueForPick(40);
        expect(legOf(batch, 'tr-A1')).toMatchObject({
          state: 'valued',
          realizedValue: p30 + p40,
          onward: {
            allocation: 'sole_asset',
            returnValue: p30 + p40,
            returnProjection: {
              legs: [
                { transferId: 'tr-B4', source: 'pick_projection', value: p30 },
                { transferId: 'tr-B6', source: 'pick_projection', value: p40 },
              ],
            },
          },
        });
      });

      it('rule v18: adds a partly excluded return’s projected leg to its valued legs', () => {
        // Through v17 Hawthorn's return was player q's 40 alone, pick Q counting 0.
        const batch = gradeAflTradesOnRealizedValue(
          inputs(withExcludedReturn(chain(false), true), chainData)
        );
        const p30 = hpnDpv3ValueForPick(30);
        expect(legOf(batch, 'tr-A1')).toMatchObject({
          state: 'valued',
          realizedValue: 40 + p30,
          onward: {
            allocation: 'sole_asset',
            returnValue: 40 + p30,
            share: 1,
            returnProjection: {
              benchmarkId: batch.content.inputs.pickProjectionBenchmarkId,
              realizedValue: 40,
              legs: [{ transferId: 'tr-B4', source: 'pick_projection', value: p30 }],
            },
          },
          reasons: [
            'single_source_pick_outcome',
            'traded_on_return_estimated_from_projection',
            'traded_on_return_provisional',
          ],
        });
        // Hawthorn's tx-B total is unchanged: only the traded-on pick reads the projection.
        expect(gradeOf(batch, 'tx-B').clubs).toContainEqual({
          clubId: 'hawthorn',
          received: 40,
          givenUp: 12,
          net: 28,
        });
      });
    });

    describe('rules v13 to v15: a bundle with an excluded asset', () => {
      // Hawthorn also gives St Kilda pick S in tx-B, which St Kilda spent matching a nominee bid: its
      // realized weight is unknown, so pick P's realized share of the 40 Hawthorn got back is too.
      const withExcludedSibling = (candidate: Candidate, slot: number = 25): Candidate => ({
        ...candidate,
        transfers: [
          ...candidate.transfers,
          pick('tr-B5', 'tx-B', 'hawthorn', 'st-kilda', 'pick-S', 2021, slot),
        ],
        pickOutcomes: [
          ...(candidate.pickOutcomes ?? []),
          outcome('tr-B5', {
            disposition: 'not_used',
            nominationBasis: 'club_took_nominated_player',
            receivingClubNominatedSelections: 1,
          }),
        ],
      });
      const unallocatedP = {
        state: 'excluded',
        basis: 'pick_traded_on_return_unallocated',
        onwardTransactionId: 'tx-B',
        reasons: ['single_source_pick_outcome', 'traded_on_return_unallocated'],
      };

      it('rule v15: weights each valued pick by its realized value and the excluded one by projection', () => {
        const batch = gradeAflTradesOnRealizedValue(
          inputs(withExcludedSibling(chain(false)), chainData)
        );
        expect(legOf(batch, 'tr-B1')).toMatchObject({ state: 'valued', realizedValue: 12 });
        expect(legOf(batch, 'tr-B5')).toMatchObject({
          state: 'excluded',
          basis: 'pick_not_used_nominee_excluded',
          atTrade: { kind: 'pick_projection', selectionNumber: 25 },
        });
        // Through v12 pick P took share 1 (12 of a 12 total), absorbing pick S's unknown share;
        // under v13 it was unallocated, and v14 weighted both picks by their DPVC values. Under v15
        // pick P weighs the 12 its draftee realized and pick S its slot-25 DPVC value.
        const p25 = hpnDpv3ValueForPick(25);
        const total = 12 + p25;
        expect(legOf(batch, 'tr-A1')).toEqual({
          transferId: 'tr-A1',
          assetKind: 'pick',
          sendingClubId: 'melbourne',
          receivingClubId: 'hawthorn',
          atTrade: expect.objectContaining({ kind: 'pick_projection', selectionNumber: 20 }),
          state: 'valued',
          basis: 'pick_traded_on_return',
          realizedValue: (12 / total) * 40,
          onward: {
            transactionId: 'tx-B',
            allocation: 'hybrid_weighted',
            returnValue: 40,
            givenAssetCount: 2,
            weight: 12,
            weightTotal: total,
            share: 12 / total,
            hybridWeights: {
              benchmarkId: batch.content.inputs.pickProjectionBenchmarkId,
              onwardTransferId: 'tr-B1',
              assets: [
                { transferId: 'tr-B1', source: 'realized', value: 12 },
                { transferId: 'tr-B5', source: 'projection', value: p25 },
              ],
            },
          },
          reasons: [
            'bundle_split_estimated_weights',
            'single_source_pick_outcome',
            'traded_on_return_provisional',
          ],
        });
        expect(gradeOf(batch, 'tx-A').clubs).toEqual([
          { clubId: 'hawthorn', received: (12 / total) * 40, givenUp: 0, net: (12 / total) * 40 },
          {
            clubId: 'melbourne',
            received: 0,
            givenUp: (12 / total) * 40,
            net: -(12 / total) * 40,
          },
        ]);
      });

      it('keeps v13’s unallocated when an excluded asset given has no projection', () => {
        // Pick S is a rookie-draft pick, outside HPN's national draft, so it has no weight.
        const batch = gradeAflTradesOnRealizedValue(
          inputs(unprojected(withExcludedSibling(chain(false)), 'tr-B5'), chainData)
        );
        expect(legOf(batch, 'tr-B5').atTrade).toEqual({
          kind: 'unavailable',
          reason: 'pick_outside_projection_domain',
        });
        expect(legOf(batch, 'tr-A1')).toMatchObject(unallocatedP);
        expect(gradeOf(batch, 'tx-A').clubs).toEqual([
          { clubId: 'hawthorn', received: 0, givenUp: 0, net: 0 },
          { clubId: 'melbourne', received: 0, givenUp: 0, net: 0 },
        ]);
      });

      it('weights a bundle holding a player by its realized value, even when that is 0', () => {
        // Draftee d5 and player r are worth 0 to St Kilda, so only pick S's projection weighs.
        const batch = gradeAflTradesOnRealizedValue(
          inputs(withExcludedSibling(chain(true)), {
            ...chainData,
            pav: pavRows('q', [[2022, 'hawthorn', 40]]),
          })
        );
        expect(gradeOf(batch, 'tx-B').clubs).toContainEqual({
          clubId: 'hawthorn',
          received: 40,
          givenUp: 0,
          net: 40,
        });
        const p25 = hpnDpv3ValueForPick(25);
        expect(legOf(batch, 'tr-A1')).toMatchObject({
          state: 'valued',
          realizedValue: 0,
          onward: {
            allocation: 'hybrid_weighted',
            givenAssetCount: 3,
            weight: 0,
            weightTotal: p25,
            share: 0,
            hybridWeights: {
              assets: [
                { transferId: 'tr-B1', source: 'realized', value: 0 },
                { transferId: 'tr-B2', source: 'realized', value: 0 },
                { transferId: 'tr-B5', source: 'projection', value: p25 },
              ],
            },
          },
        });
      });

      it('still shares a bundle with every asset valued, and values a sole asset', () => {
        expect(
          legOf(gradeAflTradesOnRealizedValue(inputs(chain(true), chainData)), 'tr-A1')
        ).toMatchObject({
          state: 'valued',
          realizedValue: (12 / 40) * 40,
          onward: { allocation: 'relative_value', weight: 12, weightTotal: 40 },
        });
        expect(
          legOf(gradeAflTradesOnRealizedValue(inputs(chain(false), chainData)), 'tr-A1')
        ).toMatchObject({
          state: 'valued',
          realizedValue: 40,
          onward: { allocation: 'sole_asset', share: 1 },
        });
      });
    });

    describe('rule v3: only the holding club’s side of the onward trade counts', () => {
      // Carlton sends St Kilda an unidentified player in tx-B: blocked, but not Hawthorn's.
      const elsewhere = (candidate: Candidate): Candidate => ({
        ...candidate,
        transfers: [...candidate.transfers, player('tr-B9', 'tx-B', 'carlton', 'st-kilda', null)],
      });
      const withoutR = (candidate: Candidate): Candidate => ({
        ...candidate,
        transfers: candidate.transfers.map((transfer) =>
          transfer.transferId === 'tr-B2'
            ? player('tr-B2', 'tx-B', 'hawthorn', 'st-kilda', null)
            : transfer
        ),
      });

      it('values a sole asset whose own onward leg is blocked, and says the return is partial', () => {
        const batch = gradeAflTradesOnRealizedValue(
          inputs(chain(false, { disposition: 'not_used', outcomeStatus: 'pending' }), chainData)
        );
        expect(legOf(batch, 'tr-A1')).toMatchObject({
          state: 'valued',
          realizedValue: 40,
          onward: { allocation: 'sole_asset', returnValue: 40, share: 1 },
          reasons: ['single_source_pick_outcome', 'traded_on_return_partial'],
        });
        expect(gradeOf(batch, 'tx-A').state).toBe('provisional');
        expect(gradeOf(batch, 'tx-B')).toMatchObject({
          state: 'blocked',
          clubs: [
            { clubId: 'hawthorn', received: 40, givenUp: null, net: null },
            { clubId: 'st-kilda', received: null, givenUp: 40, net: null },
          ],
        });
      });

      it('values a bundle share when the blocked leg is between other clubs', () => {
        const batch = gradeAflTradesOnRealizedValue(inputs(elsewhere(chain(true)), chainData));
        expect(legOf(batch, 'tr-A1')).toMatchObject({
          state: 'valued',
          realizedValue: (12 / 40) * 40,
          onward: { allocation: 'relative_value', weight: 12, weightTotal: 40 },
          reasons: ['single_source_pick_outcome', 'traded_on_return_partial'],
        });
        expect(gradeOf(batch, 'tx-B').clubs).toEqual([
          { clubId: 'carlton', received: 0, givenUp: null, net: null },
          { clubId: 'hawthorn', received: 40, givenUp: 40, net: 0 },
          { clubId: 'st-kilda', received: null, givenUp: 40, net: null },
        ]);
      });

      it('splits evenly when what the club gave is known to be 0', () => {
        const leg = legOf(
          gradeAflTradesOnRealizedValue(
            inputs(elsewhere(chain(true)), {
              ...chainData,
              pav: pavRows('q', [[2022, 'hawthorn', 40]]),
            })
          ),
          'tr-A1'
        );
        expect(leg).toMatchObject({
          state: 'valued',
          realizedValue: 20,
          onward: { allocation: 'equal_split', share: 0.5 },
          reasons: [
            'equal_split_tiebreak',
            'single_source_pick_outcome',
            'traded_on_return_partial',
          ],
        });
      });

      it('blocks a bundle share when another asset the club gave is blocked', () => {
        expect(
          legOf(gradeAflTradesOnRealizedValue(inputs(withoutR(chain(true)), chainData)), 'tr-A1')
            .reasons
        ).toEqual(['traded_on_return_blocked']);
      });

      it('splits a nominee-spent pick’s bundle only when the side it would be valued on is known', () => {
        const nominee = chain(true, {
          disposition: 'not_used',
          nominationBasis: 'club_took_nominated_player',
          receivingClubNominatedSelections: 1,
        });
        expect(
          legOf(gradeAflTradesOnRealizedValue(inputs(elsewhere(nominee), chainData)), 'tr-A1')
        ).toMatchObject({
          state: 'valued',
          onward: { allocation: 'hybrid_weighted' },
          reasons: [
            'bundle_split_estimated_weights',
            'single_source_pick_outcome',
            'traded_on_return_partial',
          ],
        });
        expect(
          legOf(gradeAflTradesOnRealizedValue(inputs(withoutR(nominee), chainData)), 'tr-A1')
            .reasons
        ).toEqual(['traded_on_return_blocked']);
      });

      it('blocks a three-club cycle whatever order its trades are graded in', () => {
        // Pick K goes Adelaide → Brisbane → Carlton → Adelaide in three undated 2021 trades. Every
        // rotation chains, so each hop links by club to the next, and the onward trades form a ring.
        const ring = (ids: [string, string, string]): Candidate => ({
          transactions: ids.map((id) => trade(id, 2021)),
          transfers: [
            pick('tr-ab', ids[0], 'adelaide', 'brisbane', 'pick-K', 2021, 30),
            pick('tr-bc', ids[1], 'brisbane', 'carlton', 'pick-K', 2021, 30),
            pick('tr-ca', ids[2], 'carlton', 'adelaide', 'pick-K', 2021, 30),
          ],
          pickOutcomes: ['tr-ab', 'tr-bc', 'tr-ca'].map((id) =>
            outcome(id, { disposition: 'traded_on' })
          ),
        });
        // Trades are graded in id order, so each rotation enters the ring at a different trade.
        const [first, ...others] = (
          [
            ['tx-1', 'tx-2', 'tx-3'],
            ['tx-2', 'tx-3', 'tx-1'],
            ['tx-3', 'tx-1', 'tx-2'],
          ] as [string, string, string][]
        ).map((ids) => {
          const batch = gradeAflTradesOnRealizedValue(inputs(ring(ids)));
          return ['tr-ab', 'tr-bc', 'tr-ca'].map((id) => legOf(batch, id));
        });
        for (const legs of others) expect(legs).toEqual(first);
        expect(first!.map(({ reasons }) => reasons)).toEqual([
          ['traded_on_return_blocked'],
          ['traded_on_return_blocked'],
          ['traded_on_return_blocked'],
        ]);
      });
    });

    it('follows a three-link chain and blocks a cycle', () => {
      const three: Candidate = {
        transactions: [trade('tx-A', 2021), trade('tx-B', 2021), trade('tx-C', 2021)],
        transfers: [
          pick('tr-A1', 'tx-A', 'melbourne', 'hawthorn', 'pick-P', 2021, 20),
          pick('tr-B1', 'tx-B', 'hawthorn', 'st-kilda', 'pick-P', 2021, 20),
          player('tr-B3', 'tx-B', 'st-kilda', 'hawthorn', 'q'),
          pick('tr-C1', 'tx-C', 'st-kilda', 'carlton', 'pick-P', 2021, 20),
          player('tr-C2', 'tx-C', 'carlton', 'st-kilda', 'r'),
        ],
        pickOutcomes: [
          outcome('tr-A1', { disposition: 'traded_on' }),
          outcome('tr-B1', { disposition: 'traded_on' }),
          outcome('tr-C1', {
            disposition: 'not_used',
            nominationBasis: 'club_took_no_nominated_player',
            receivingClubNominatedSelections: 0,
          }),
        ],
      };
      const batch = gradeAflTradesOnRealizedValue(inputs(three, chainData));
      // St Kilda's pick bought r (28); Hawthorn's bought q (40).
      expect(legOf(batch, 'tr-B1')).toMatchObject({
        realizedValue: 28,
        onward: { transactionId: 'tx-C' },
      });
      expect(legOf(batch, 'tr-A1')).toMatchObject({
        realizedValue: 40,
        onward: { transactionId: 'tx-B' },
      });

      const cycle: Candidate = {
        transactions: [trade('tx-X', 2021), trade('tx-Y', 2021)],
        transfers: [
          pick('tr-X1', 'tx-X', 'adelaide', 'brisbane', 'pick-C', 2021, 30),
          pick('tr-Y1', 'tx-Y', 'brisbane', 'adelaide', 'pick-C', 2021, 30),
        ],
        pickOutcomes: [
          outcome('tr-X1', { disposition: 'traded_on' }),
          outcome('tr-Y1', { disposition: 'traded_on' }),
        ],
      };
      const cycled = gradeAflTradesOnRealizedValue(inputs(cycle));
      expect(cycled.content.summary).toMatchObject({ blocked: 2 });
    });

    it('never follows a pick back into an earlier trade', () => {
      const pingPong: Candidate = {
        transactions: [trade('tx-1', 2020), trade('tx-2', 2021), trade('tx-3', 2021)],
        transfers: [
          pick('tr-1', 'tx-1', 'brisbane', 'adelaide', 'pick-Z', 2021, 10),
          pick('tr-2', 'tx-2', 'adelaide', 'brisbane', 'pick-Z', 2021, 10),
          pick('tr-3', 'tx-3', 'brisbane', 'carlton', 'pick-Z', 2021, 10),
          player('tr-3b', 'tx-3', 'carlton', 'brisbane', 'q'),
        ],
        pickOutcomes: [
          outcome('tr-1', { disposition: 'traded_on' }),
          outcome('tr-2', { disposition: 'traded_on' }),
          outcome('tr-3', {
            disposition: 'not_used',
            nominationBasis: 'club_took_no_nominated_player',
            receivingClubNominatedSelections: 0,
          }),
        ],
      };
      const batch = gradeAflTradesOnRealizedValue(
        inputs(pingPong, {
          ...chainData,
          seasonSpells: spells('q', [
            [2022, 'brisbane'],
            [2023, 'essendon'],
          ]),
          pav: pavRows('q', [[2022, 'brisbane', 40]]),
        })
      );
      expect(legOf(batch, 'tr-2')).toMatchObject({
        realizedValue: 40,
        onward: { transactionId: 'tx-3' },
      });
    });
    // Issue 867: Brisbane's 2022 third-round pick went Brisbane → Geelong → Hawthorn → Collingwood →
    // Geelong in 2021 and back to Brisbane in 2022. Two transfers leave Geelong, and undated same-season
    // trades cannot be ordered, but only one ordering chains all five transfers.
    const loop = (): Candidate => ({
      transactions: [
        trade('tx-1', 2021),
        trade('tx-2', 2021),
        trade('tx-3', 2021),
        trade('tx-4', 2021),
        trade('tx-5', 2022),
      ],
      transfers: [
        pick('tr-1', 'tx-1', 'brisbane', 'geelong', 'pick-L', 2022, 50),
        pick('tr-2', 'tx-2', 'geelong', 'hawthorn', 'pick-L', 2022, 50),
        pick('tr-3', 'tx-3', 'hawthorn', 'collingwood', 'pick-L', 2022, 50),
        pick('tr-4', 'tx-4', 'collingwood', 'geelong', 'pick-L', 2022, 50),
        pick('tr-5', 'tx-5', 'geelong', 'brisbane', 'pick-L', 2022, 50),
      ],
      pickOutcomes: [
        outcome('tr-1', { disposition: 'traded_on' }),
        outcome('tr-2', { disposition: 'traded_on' }),
        outcome('tr-3', { disposition: 'traded_on' }),
        outcome('tr-4', { disposition: 'traded_on' }),
        outcome('tr-5', {
          disposition: 'not_used',
          nominationBasis: 'club_took_no_nominated_player',
          receivingClubNominatedSelections: 0,
        }),
      ],
    });

    it('follows a pick that leaves one club twice along its only complete trail', () => {
      const batch = gradeAflTradesOnRealizedValue(inputs(loop()));
      for (const transferId of ['tr-1', 'tr-2', 'tr-3', 'tr-4'])
        expect(legOf(batch, transferId).reasons).not.toContain('traded_on_return_unlinked');
      expect(legOf(batch, 'tr-1')).toMatchObject({ onward: { transactionId: 'tx-2' } });
      expect(legOf(batch, 'tr-4')).toMatchObject({ onward: { transactionId: 'tx-5' } });
    });

    it('keeps a pick unlinked when more than one trail covers its transfers', () => {
      // Out of Geelong to Hawthorn and to Carlton, each handing it straight back: either order works.
      const ambiguous: Candidate = {
        transactions: ['tx-1', 'tx-2', 'tx-3', 'tx-4', 'tx-5'].map((id) => trade(id, 2021)),
        transfers: [
          pick('tr-1', 'tx-1', 'brisbane', 'geelong', 'pick-M', 2022, 50),
          pick('tr-2', 'tx-2', 'geelong', 'hawthorn', 'pick-M', 2022, 50),
          pick('tr-3', 'tx-3', 'hawthorn', 'geelong', 'pick-M', 2022, 50),
          pick('tr-4', 'tx-4', 'geelong', 'carlton', 'pick-M', 2022, 50),
          pick('tr-5', 'tx-5', 'carlton', 'geelong', 'pick-M', 2022, 50),
        ],
        pickOutcomes: ['tr-1', 'tr-2', 'tr-3', 'tr-4', 'tr-5'].map((id) =>
          outcome(id, { disposition: 'traded_on' })
        ),
      };
      const batch = gradeAflTradesOnRealizedValue(inputs(ambiguous));
      expect(legOf(batch, 'tr-1').reasons).toEqual(['traded_on_return_unlinked']);
    });
  });

  describe('edge cases', () => {
    it('names a trade with no transfers or an unknown club instead of failing the batch', () => {
      const candidate: Candidate = {
        ...swap(),
        transactions: [...swap().transactions, trade('tx-0', 2021), trade('tx-z', 2021)],
        transfers: [
          ...swap().transfers,
          { ...player('tr-z', 'tx-z', 'adelaide', 'x', 'p7'), toClubId: null } as Transfer,
        ],
      };
      const batch = gradeAflTradesOnRealizedValue(inputs(candidate, swapData));
      expect(batch.content.ungraded).toEqual([
        { transactionId: 'tx-0', reason: 'no_transfers' },
        { transactionId: 'tx-z', reason: 'club_unresolved' },
      ]);
      expect(batch.content.summary).toEqual({
        complete: 1,
        provisional: 0,
        blocked: 0,
        ungraded: 2,
      });
    });

    it('ends a stint at a later reviewed arrival at the same club', () => {
      const batch = gradeAflTradesOnRealizedValue(
        inputs(swap(), {
          ...swapData,
          seasonSpells: spells('p1', [
            [2022, 'carlton'],
            [2023, 'carlton'],
            [2024, 'carlton'],
          ]),
          pav: pavRows('p1', [
            [2022, 'carlton', 5],
            [2023, 'carlton', 6],
            [2024, 'carlton', 30],
          ]),
          reviewedArrivals: [
            ...swapData.reviewedArrivals,
            { playerId: 'p1', clubId: 'carlton', season: 2024 },
          ],
        })
      );
      expect(legOf(batch, 'tr-1a')).toMatchObject({
        realizedValue: 11,
        stint: { status: 'closed', seasonsValued: [2022, 2023] },
      });
    });

    it('counts the departure season at the club he left during it', () => {
      const batch = gradeAflTradesOnRealizedValue(
        inputs(swap(), {
          ...swapData,
          seasonSpells: spells('p1', [
            [2022, 'carlton'],
            [2023, 'carlton'],
            [2023, 'essendon'],
          ]),
          pav: pavRows('p1', [
            [2022, 'carlton', 4],
            [2023, 'carlton', 6],
            [2023, 'essendon', 9],
          ]),
        })
      );
      expect(legOf(batch, 'tr-1a')).toMatchObject({
        realizedValue: 10,
        stint: { status: 'closed', seasonsValued: [2022, 2023] },
      });
    });

    it('values a 2019 trade from 2021, listing 2020 as missing', () => {
      const candidate: Candidate = {
        transactions: [trade('tx-19', 2019)],
        transfers: [
          player('tr-19a', 'tx-19', 'sydney', 'brisbane', 'p6'),
          player('tr-19b', 'tx-19', 'brisbane', 'sydney', 'p5'),
        ],
      };
      const batch = gradeAflTradesOnRealizedValue(
        inputs(candidate, {
          seasonSpells: [
            ...spells('p6', [
              [2021, 'brisbane'],
              [2022, 'gws'],
            ]),
            ...spells('p5', [[2021, 'adelaide']]),
          ],
          pav: pavRows('p6', [[2021, 'brisbane', 8]]),
          reviewedArrivals: [
            { playerId: 'p6', clubId: 'brisbane', season: 2020 },
            { playerId: 'p5', clubId: 'sydney', season: 2020 },
          ],
        })
      );
      expect(legOf(batch, 'tr-19a')).toMatchObject({
        realizedValue: 8,
        stint: { status: 'closed', seasonsValued: [2021], seasonsMissingPav: [2020] },
        reasons: ['pav_seasons_missing'],
      });
      // He left after 2020, the one season with no PAV: his value is unknown, not 0, so the leg blocks.
      expect(legOf(batch, 'tr-19b')).toMatchObject({
        state: 'blocked',
        reasons: ['hpn_pav_head_missing'],
      });
    });

    it('values a pick for next year’s draft from the season after that draft', () => {
      const candidate: Candidate = {
        transactions: [trade('tx-4', 2021)],
        transfers: [pick('tr-4a', 'tx-4', 'adelaide', 'geelong', 'pick-F', 2022, null)],
        pickOutcomes: [outcome('tr-4a', { disposition: 'selected', playerId: 'd4' })],
      };
      const batch = gradeAflTradesOnRealizedValue(
        inputs(candidate, {
          seasonSpells: spells('d4', [
            [2022, 'geelong'],
            [2023, 'geelong'],
          ]),
          pav: pavRows('d4', [
            [2022, 'geelong', 99],
            [2023, 'geelong', 3],
          ]),
          reviewedArrivals: [{ playerId: 'd4', clubId: 'geelong', season: 2023 }],
        })
      );
      expect(legOf(batch, 'tr-4a')).toMatchObject({
        realizedValue: 3,
        stint: { seasonsValued: [2023, 2024, 2025] },
        reasons: ['single_source_pick_outcome', 'stint_open'],
        atTrade: { kind: 'unavailable', reason: 'future_pick_slot_unknown' },
      });
    });
  });

  describe('inputs the candidate allows that must not stop the batch', () => {
    it('names a same-club transfer and an unrepresentable club id as unresolved', () => {
      const candidate: Candidate = {
        ...swap(),
        transactions: [...swap().transactions, trade('tx-s', 2021), trade('tx-g', 2021)],
        transfers: [
          ...swap().transfers,
          player('tr-s', 'tx-s', 'adelaide', 'adelaide', 'p7'),
          player('tr-g', 'tx-g', 'Gold Coast', 'brisbane', 'p6'),
        ],
      };
      expect(gradeAflTradesOnRealizedValue(inputs(candidate, swapData)).content.ungraded).toEqual([
        { transactionId: 'tx-g', reason: 'club_unresolved' },
        { transactionId: 'tx-s', reason: 'club_unresolved' },
      ]);
    });

    it('blocks a selected pick whose draft came before the trade', () => {
      const candidate: Candidate = {
        transactions: [trade('tx-e', 2022)],
        transfers: [pick('tr-e', 'tx-e', 'adelaide', 'geelong', 'pick-E', 2021, 5)],
        pickOutcomes: [outcome('tr-e', { disposition: 'selected', playerId: 'd9' })],
      };
      expect(legOf(gradeAflTradesOnRealizedValue(inputs(candidate)), 'tr-e').reasons).toEqual([
        'pick_outcome_unresolved',
      ]);
    });

    it('seals a trade from long before PAV coverage', () => {
      const candidate: Candidate = {
        transactions: [trade('tx-old', 1979)],
        transfers: [
          player('tr-old', 'tx-old', 'carlton', 'collingwood', 'p-old'),
          player('tr-old2', 'tx-old', 'collingwood', 'carlton', 'p-old2'),
        ],
      };
      const batch = gradeAflTradesOnRealizedValue(inputs(candidate));
      expect(legOf(batch, 'tr-old')).toMatchObject({
        stint: { seasonsMissingPav: Array.from({ length: 41 }, (_, i) => 1980 + i) },
      });
    });

    it('ignores a later arrival record when the move itself has no reviewed arrival', () => {
      const batch = gradeAflTradesOnRealizedValue(
        inputs(swap(), {
          ...swapData,
          seasonSpells: spells('p1', [
            [2022, 'carlton'],
            [2023, 'carlton'],
            [2024, 'carlton'],
          ]),
          pav: pavRows('p1', [
            [2022, 'carlton', 5],
            [2023, 'carlton', 6],
            [2024, 'carlton', 7],
          ]),
          reviewedArrivals: [{ playerId: 'p1', clubId: 'carlton', season: 2024 }],
        })
      );
      expect(legOf(batch, 'tr-1a')).toMatchObject({
        realizedValue: 18,
        stint: { status: 'open' },
        reasons: ['arrival_unreviewed', 'stint_open'],
      });
    });

    it('refuses a candidate with no trades, plainly', () => {
      expect(() =>
        gradeAflTradesOnRealizedValue(inputs({ transactions: [], transfers: [] }))
      ).toThrow('The candidate holds no trades to grade.');
    });
  });

  it('seals the same inputs to the same batch', () => {
    const first = gradeAflTradesOnRealizedValue(inputs(swap(), swapData));
    const second = gradeAflTradesOnRealizedValue(
      inputs(swap(), { ...swapData, pav: [...swapData.pav].reverse() })
    );
    expect(second.batchId).toBe(first.batchId);
    expect(first.content.summary).toEqual({ complete: 1, provisional: 0, blocked: 0, ungraded: 0 });
  });
});

describe('rule v2: pick outcomes a Footyinfo board corroborates (owner decision 2026-10-12)', () => {
  type Selection = NonNullable<Candidate['draftSelections']>[number];
  type Board = NonNullable<Candidate['draftBoardPicks']>[number];
  const selection = (fields: Partial<Selection>): Selection =>
    ({
      selectionId: 'selection-12',
      draftYear: 2021,
      draftType: 'national',
      selectionNumber: 12,
      roundNumber: 1,
      pickId: 'pick-A',
      playerId: 'd1',
      clubId: 'hawthorn',
      status: 'corroborated',
      supportingProviders: ['draftguru', 'footyinfo'],
      evidenceIds: [],
      ...fields,
    }) as Selection;
  const board = (route: string[], fields: Partial<Board> = {}): Board =>
    ({
      boardPickId: `external-draft-board-pick:${hex(String(route.length))}`,
      draftYear: 2021,
      draftType: 'national',
      roundNumber: 1,
      recordedPickNumber: 20,
      status: 'selected',
      clubId: route.at(-1)!,
      routeClubIds: route,
      evidenceIds: [],
      ...fields,
    }) as Board;
  const selected = (draftSelections: Selection[]) =>
    legOf(
      gradeAflTradesOnRealizedValue(
        inputs(
          {
            transactions: [trade('tx-2', 2021)],
            transfers: [pick('tr-2a', 'tx-2', 'richmond', 'hawthorn', 'pick-A', 2021, 12)],
            pickOutcomes: [
              outcome('tr-2a', {
                disposition: 'selected',
                playerId: 'd1',
                selectionId: 'selection-12',
              }),
            ],
            draftSelections,
          },
          {
            seasonSpells: spells('d1', [
              [2022, 'hawthorn'],
              [2023, 'sydney'],
            ]),
            pav: pavRows('d1', [[2022, 'hawthorn', 5]]),
            reviewedArrivals: [{ playerId: 'd1', clubId: 'hawthorn', season: 2022 }],
          }
        )
      ),
      'tr-2a'
    );

  it('drops single_source_pick_outcome from a selection Draftguru and Footyinfo both state', () => {
    expect(selected([selection({})])).toMatchObject({
      state: 'valued',
      corroboratedBy: 'footyinfo',
      reasons: [],
    });
  });

  it('keeps it when the second provider is not Footyinfo or the selection is not corroborated', () => {
    for (const fields of [
      { supportingProviders: ['draftguru', 'footywire'] },
      { status: 'single_source' },
    ] as Partial<Selection>[]) {
      const leg = selected([selection(fields)]);
      expect(leg.reasons).toEqual(['single_source_pick_outcome']);
      expect(leg).not.toHaveProperty('corroboratedBy');
    }
  });

  // Melbourne → Hawthorn → St Kilda, with a sole-asset onward trade for player q.
  const tradedOn = (draftBoardPicks: Board[]) =>
    legOf(
      gradeAflTradesOnRealizedValue(
        inputs(
          {
            transactions: [trade('tx-A', 2021), trade('tx-B', 2021)],
            transfers: [
              pick('tr-A1', 'tx-A', 'melbourne', 'hawthorn', 'pick-P', 2021, 20),
              pick('tr-B1', 'tx-B', 'hawthorn', 'st-kilda', 'pick-P', 2021, 20),
              player('tr-B3', 'tx-B', 'st-kilda', 'hawthorn', 'q'),
            ],
            pickOutcomes: [
              outcome('tr-A1', { disposition: 'traded_on' }),
              outcome('tr-B1', {
                disposition: 'not_used',
                nominationBasis: 'club_took_no_nominated_player',
                receivingClubNominatedSelections: 0,
              }),
            ],
            draftBoardPicks,
          },
          {
            seasonSpells: spells('q', [
              [2022, 'hawthorn'],
              [2023, 'essendon'],
            ]),
            pav: pavRows('q', [[2022, 'hawthorn', 40]]),
            reviewedArrivals: [{ playerId: 'q', clubId: 'hawthorn', season: 2022 }],
          }
        )
      ),
      'tr-A1'
    );

  it('drops it from a traded-on pick when one board route names the leg and its onward hop', () => {
    expect(tradedOn([board(['melbourne', 'hawthorn', 'st-kilda'])])).toMatchObject({
      basis: 'pick_traded_on_return',
      corroboratedBy: 'footyinfo',
      // The onward trade is still provisional on its own single-source not-used pick.
      reasons: ['traded_on_return_provisional'],
    });
  });

  it('keeps it when no route, or more than one, names the hops in order', () => {
    for (const boards of [
      [],
      [board(['hawthorn', 'st-kilda'])],
      [board(['melbourne', 'hawthorn', 'carlton'])],
      [board(['melbourne', 'hawthorn', 'st-kilda'], { draftYear: 2022 })],
      [
        board(['melbourne', 'hawthorn', 'st-kilda']),
        board(['geelong', 'melbourne', 'hawthorn', 'st-kilda']),
      ],
    ]) {
      expect(tradedOn(boards).reasons).toEqual([
        'single_source_pick_outcome',
        'traded_on_return_provisional',
      ]);
    }
  });

  it('seals rule v19 and keeps rule v16’s limitation', () => {
    const batch = gradeAflTradesOnRealizedValue(
      inputs({
        transactions: [trade('tx-1', 2021)],
        transfers: [player('tr-1a', 'tx-1', 'collingwood', 'carlton', 'p1')],
      })
    );
    expect(batch.content.ruleVersion).toBe('afl-trade-realized-grade-rule/v19');
    expect(batch.content.limitation).toContain(
      "from rule v16 a traded-on pick whose club's every return leg in the onward trade is excluded is valued, provisionally, at the sum of those legs' HPN DPVC v3 at-trade projections (the draft value its club spent matching a bid), and stays unallocated when one has none"
    );
    expect(batch.content.limitation).toContain(
      "from rule v15 a bundle with an excluded asset is split by each asset's realized value where known and its HPN DPVC v3 projection otherwise, provisionally, and stays unallocated when an excluded asset has no projection"
    );
    expect(batch.content.limitation).not.toContain('from rule v14');
    expect(batch.content.limitation).toContain(
      "a traded-on pick given in a bundle with an excluded asset is unallocated, the excluded asset's share of the return being unknown, and a sole asset still takes the whole return"
    );
    expect(batch.content.limitation).toContain(
      'undated pick trades of one season are ordered by the Draftguru pick-trade sequence, an ordering inferred from its agreement with every chain checked, not a stated date, and a pick with more than one possible trail follows the one ending at its latest Official AFL custody holder'
    );
    expect(batch.content.limitation).toContain(
      "a sole asset traded on is valued at its club's whole return in the onward trade, whatever became of the pick there; a traded-on pick whose club's every return leg in the onward trade is excluded is unallocated, not worth 0"
    );
    expect(batch.content.limitation).toContain(
      "a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used"
    );
    expect(batch.content.limitation).toContain(
      "a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total"
    );
    expect(batch.content.limitation).toContain(
      "a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return"
    );
    expect(batch.content.limitation).toContain(
      'a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order'
    );
    expect(batch.content.limitation).toContain(
      "a pick of a draft with no order yet uses its original club's slot in the latest order"
    );
    expect(batch.content.limitation).toContain('unless a Footyinfo draft board corroborates');
    expect(batch.content.limitation).toContain('only the club totals it enters');
    expect(batch.content.limitation).toContain('signed HPN PAV sum floored at 0');
    expect(batch.content.limitation).toContain(
      'the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed'
    );
  });
});

describe('rule v4: a first stint is worth its signed PAV sum floored at 0 (issue 789)', () => {
  // P1 Collingwood → Carlton in 2021 for P2. HPN PAV is signed: a few player-seasons are below 0.
  const swap = (): Candidate => ({
    transactions: [trade('tx-1', 2021)],
    transfers: [
      player('tr-1a', 'tx-1', 'collingwood', 'carlton', 'p1'),
      player('tr-1b', 'tx-1', 'carlton', 'collingwood', 'p2'),
    ],
  });
  const swapData = (p1: Array<[number, string, number]>) => ({
    seasonSpells: [
      ...spells('p1', [
        [2021, 'collingwood'],
        [2022, 'carlton'],
        [2023, 'carlton'],
        [2024, 'essendon'],
      ]),
      ...spells('p2', [
        [2022, 'collingwood'],
        [2023, 'geelong'],
      ]),
    ],
    pav: [...pavRows('p1', p1), ...pavRows('p2', [[2022, 'collingwood', 7]])],
    reviewedArrivals: [
      { playerId: 'p1', clubId: 'carlton', season: 2022 },
      { playerId: 'p2', clubId: 'collingwood', season: 2022 },
    ],
  });

  it('values a stint whose seasons sum below 0 at 0, keeps the signed sum and reports a signed at-trade view', () => {
    const batch = gradeAflTradesOnRealizedValue(
      inputs(
        swap(),
        swapData([
          [2021, 'collingwood', -0.045],
          [2022, 'carlton', -0.5],
          [2023, 'carlton', -0.25],
        ])
      )
    );
    expect(legOf(batch, 'tr-1a')).toMatchObject({
      state: 'valued',
      realizedValue: 0,
      stint: { status: 'closed', seasonsValued: [2022, 2023], pavSum: -0.75 },
      reasons: [],
      atTrade: { kind: 'player_trade_season_pav', season: 2021, value: -0.045 },
    });
    expect(gradeOf(batch, 'tx-1')).toMatchObject({
      state: 'complete',
      clubs: [
        { clubId: 'carlton', received: 0, givenUp: 7, net: -7 },
        { clubId: 'collingwood', received: 7, givenUp: 0, net: 7 },
      ],
    });
  });

  it.each<[string, Array<[number, string, number]>, number, number]>([
    [
      'nets above 0',
      [2022, 2023].map((season, at) => [season, 'carlton', [-0.5, 2][at]!]),
      1.5,
      1.5,
    ],
    [
      'nets below 0',
      [2022, 2023].map((season, at) => [season, 'carlton', [0.25, -0.5][at]!]),
      -0.25,
      0,
    ],
  ])(
    'sums mixed signed seasons first, then floors, when the stint %s',
    (_label, rows, sum, value) => {
      const leg = legOf(gradeAflTradesOnRealizedValue(inputs(swap(), swapData(rows))), 'tr-1a');
      expect(leg).toMatchObject({ realizedValue: value, stint: { pavSum: sum } });
    }
  );

  it('records the sum unchanged as the value when it is not below 0', () => {
    const leg = legOf(
      gradeAflTradesOnRealizedValue(inputs(swap(), swapData([[2022, 'carlton', 12]]))),
      'tr-1a'
    );
    expect(leg).toMatchObject({ realizedValue: 12, stint: { pavSum: 12 } });
  });

  describe('a traded-on pick in a bundle with a floored asset', () => {
    // tx-A: Melbourne sends pick P to Hawthorn, which trades it with player r to St Kilda in tx-B for
    // player q (40 at Hawthorn). P became draftee d5, whose first stint at St Kilda sums below 0.
    const chain = (): Candidate => ({
      transactions: [trade('tx-A', 2021), trade('tx-B', 2021)],
      transfers: [
        pick('tr-A1', 'tx-A', 'melbourne', 'hawthorn', 'pick-P', 2021, 20),
        pick('tr-B1', 'tx-B', 'hawthorn', 'st-kilda', 'pick-P', 2021, 20),
        player('tr-B2', 'tx-B', 'hawthorn', 'st-kilda', 'r'),
        player('tr-B3', 'tx-B', 'st-kilda', 'hawthorn', 'q'),
      ],
      pickOutcomes: [
        outcome('tr-A1', { disposition: 'traded_on' }),
        outcome('tr-B1', { disposition: 'selected', playerId: 'd5' }),
      ],
    });
    const chainData = (rPav: number) => ({
      seasonSpells: [
        ...spells('d5', [
          [2022, 'st-kilda'],
          [2023, 'adelaide'],
        ]),
        ...spells('r', [
          [2022, 'st-kilda'],
          [2023, 'carlton'],
        ]),
        ...spells('q', [
          [2022, 'hawthorn'],
          [2023, 'essendon'],
        ]),
      ],
      pav: [
        ...pavRows('d5', [[2022, 'st-kilda', -0.5]]),
        ...pavRows('r', [[2022, 'st-kilda', rPav]]),
        ...pavRows('q', [[2022, 'hawthorn', 40]]),
      ],
    });

    it('weights the floored pick at 0 so its relative-value share is 0', () => {
      const batch = gradeAflTradesOnRealizedValue(inputs(chain(), chainData(14)));
      expect(legOf(batch, 'tr-B1')).toMatchObject({ realizedValue: 0, stint: { pavSum: -0.5 } });
      const leg = legOf(batch, 'tr-A1');
      expect(leg).toMatchObject({
        state: 'valued',
        realizedValue: 0,
        onward: {
          allocation: 'relative_value',
          returnValue: 40,
          weight: 0,
          weightTotal: 14,
          share: 0,
        },
      });
      expect(gradeOf(batch, 'tx-B').clubs).toEqual([
        { clubId: 'hawthorn', received: 40, givenUp: 14, net: 26 },
        { clubId: 'st-kilda', received: 14, givenUp: 40, net: -26 },
      ]);
    });

    it('splits evenly when every asset given floors to 0', () => {
      const batch = gradeAflTradesOnRealizedValue(inputs(chain(), chainData(-0.045)));
      expect(legOf(batch, 'tr-B2')).toMatchObject({ realizedValue: 0, stint: { pavSum: -0.045 } });
      expect(legOf(batch, 'tr-A1')).toMatchObject({
        realizedValue: 20,
        onward: { allocation: 'equal_split', share: 0.5, weight: null, weightTotal: null },
      });
      expect(gradeOf(batch, 'tx-B').clubs[0]).toEqual({
        clubId: 'hawthorn',
        received: 40,
        givenUp: 0,
        net: 40,
      });
    });
  });
});

describe('rule v5: a Footyinfo board proves the 2025 national draft (owner decision 2026-10-14)', () => {
  // Richmond's 2025 pick to Hawthorn, not used; the nominee count rests on a board-proven draft.
  const notUsed = (fields: Partial<Outcome>): Candidate => ({
    transactions: [trade('tx-5', 2025)],
    transfers: [pick('tr-5a', 'tx-5', 'richmond', 'hawthorn', 'pick-Z', 2025, 30)],
    pickOutcomes: [outcome('tr-5a', { disposition: 'not_used', ...fields })],
  });
  const legFor = (fields: Partial<Outcome>) =>
    legOf(gradeAflTradesOnRealizedValue(inputs(notUsed(fields))), 'tr-5a');

  it('names the board on a no-nominee or excluded leg and keeps it single-source', () => {
    expect(
      legFor({
        nominationBasis: 'club_took_no_nominated_player',
        receivingClubNominatedSelections: 0,
        draftProvenBy: 'footyinfo',
      })
    ).toMatchObject({
      state: 'valued',
      basis: 'pick_not_used_no_nominee',
      realizedValue: 0,
      draftProvenBy: 'footyinfo',
      reasons: ['single_source_pick_outcome'],
    });
    const excluded = legFor({
      nominationBasis: 'club_took_nominated_player',
      receivingClubNominatedSelections: 1,
      draftProvenBy: 'footyinfo',
    });
    expect(excluded).toMatchObject({
      state: 'excluded',
      basis: 'pick_not_used_nominee_excluded',
      draftProvenBy: 'footyinfo',
      reasons: ['not_used_nominee_excluded', 'single_source_pick_outcome'],
    });
    expect(excluded).not.toHaveProperty('corroboratedBy');
  });

  it('names nothing when an official session proved the draft', () => {
    expect(
      legFor({
        nominationBasis: 'club_took_no_nominated_player',
        receivingClubNominatedSelections: 0,
      })
    ).not.toHaveProperty('draftProvenBy');
  });
});

describe('rule v10: a nominee only a Footyinfo board matched bid records (issue 789)', () => {
  // 2020 pick 41, Hawthorn to Collingwood: not used, and Collingwood matched GWS's academy bid for
  // Reef McInnes, whom Draftguru marks open.
  const legFor = (fields: Partial<Outcome>) =>
    legOf(
      gradeAflTradesOnRealizedValue(
        inputs({
          transactions: [trade('tx-5', 2020)],
          transfers: [pick('tr-5a', 'tx-5', 'hawthorn', 'collingwood', 'pick-Z', 2020, 41)],
          pickOutcomes: [outcome('tr-5a', { disposition: 'not_used', ...fields })],
        })
      ),
      'tr-5a'
    );
  const boardPickId = `external-draft-board-pick:${hex('b')}`;

  it('excludes the pick, single-source, and names the board', () => {
    const excluded = legFor({
      nominationBasis: 'club_took_nominated_player',
      receivingClubNominatedSelections: 1,
      matchedBidBoardPickIds: [boardPickId],
    });
    expect(excluded).toMatchObject({
      state: 'excluded',
      basis: 'pick_not_used_nominee_excluded',
      nomineeMatchedBidBy: 'footyinfo',
      reasons: ['not_used_nominee_excluded', 'single_source_pick_outcome'],
    });
    expect(excluded).not.toHaveProperty('corroboratedBy');
  });

  it('names nothing when Draftguru’s categories alone give the count', () => {
    expect(
      legFor({ nominationBasis: 'club_took_nominated_player', receivingClubNominatedSelections: 1 })
    ).not.toHaveProperty('nomineeMatchedBidBy');
  });
});

describe('rule v6: a pick not yet drafted is valued from the live draft order (owner direction 2026-10-14)', () => {
  type Custody = NonNullable<Candidate['pickCustody']>[number];
  const custodyId = (digit: string) => `external-pick-custody:${hex(digit)}`;
  /** Richmond's original first-round pick in the 2026 order, held by Hawthorn: slot 7. */
  const order = (digit: string, fields: Partial<Custody> = {}): Custody =>
    ({
      custodyId: custodyId(digit),
      pickId: 'pick-F',
      observedAt: { precision: 'day', date: '2026-10-10' },
      draftYear: 2026,
      draftType: 'national',
      roundNumber: 1,
      recordedPickNumber: 7,
      originalClubId: 'richmond',
      currentClubId: 'hawthorn',
      status: 'single_source',
      evidenceIds: [],
      ...fields,
    }) as unknown as Custody;
  const pending = { disposition: 'not_used', outcomeStatus: 'pending' } as const;
  // 2025: Richmond sends its future first-round pick to Hawthorn for player p1.
  const future = (pickCustody: Custody[], draftYear = 2026): Candidate => ({
    transactions: [trade('tx-F', 2025)],
    transfers: [
      pick('tr-Fa', 'tx-F', 'richmond', 'hawthorn', 'pick-F', draftYear, null),
      player('tr-Fb', 'tx-F', 'hawthorn', 'richmond', 'p1'),
    ],
    pickOutcomes: [outcome('tr-Fa', pending)],
    pickCustody,
  });
  const legFor = (pickCustody: Custody[], draftYear?: number) =>
    legOf(gradeAflTradesOnRealizedValue(inputs(future(pickCustody, draftYear))), 'tr-Fa');
  const later = { precision: 'day', date: '2026-10-12' } as const;

  it('values a pending pick at the HPN DPVC v3 value of the slot its pickId holds', () => {
    // Another original club on the row: the pickId alone makes it this pick's capture.
    const batch = gradeAflTradesOnRealizedValue(
      inputs(future([order('1', { originalClubId: 'carlton' })]))
    );
    expect(legOf(batch, 'tr-Fa')).toEqual({
      transferId: 'tr-Fa',
      assetKind: 'pick',
      sendingClubId: 'richmond',
      receivingClubId: 'hawthorn',
      // Rule v8: the future pick's at-trade view is the slot it is projected from.
      atTrade: {
        kind: 'pick_projection_eventual_slot',
        benchmarkId: `hpn-pick-benchmark:${hex('b')}`,
        selectionNumber: 7,
        slotSource: 'projected_order',
        value: hpnDpv3ValueForPick(7),
      },
      state: 'valued',
      basis: 'pick_projected_from_order',
      realizedValue: hpnDpv3ValueForPick(7),
      projection: {
        benchmarkId: `hpn-pick-benchmark:${hex('b')}`,
        selectionNumber: 7,
        orderDraftYear: 2026,
        pickDraftYear: 2026,
        custodyId: custodyId('1'),
        observedAt: { precision: 'day', date: '2026-10-10' },
        proxy: false,
      },
      reasons: ['pick_projected_from_live_order'],
    });
    expect(gradeOf(batch, 'tx-F')).toMatchObject({
      state: 'provisional',
      clubs: [
        { clubId: 'hawthorn', received: hpnDpv3ValueForPick(7), givenUp: 0 },
        { clubId: 'richmond', received: 0, givenUp: hpnDpv3ValueForPick(7) },
      ],
    });
  });

  it('finds the slot by draft, round and original club, from the latest observation', () => {
    const leg = legFor([
      order('1', { pickId: 'pick-other', recordedPickNumber: 9 }),
      order('2', {
        pickId: 'pick-other',
        recordedPickNumber: 5,
        observedAt: { precision: 'day', date: '2026-10-12' },
      }),
      // A second-round row and another club's row are not this pick.
      order('3', { pickId: 'pick-other', roundNumber: 2, recordedPickNumber: 25 }),
      order('4', { pickId: 'pick-other', originalClubId: 'carlton', recordedPickNumber: 2 }),
    ]);
    expect(leg).toMatchObject({
      basis: 'pick_projected_from_order',
      realizedValue: hpnDpv3ValueForPick(5),
      projection: { selectionNumber: 5, custodyId: custodyId('2'), proxy: false },
    });
  });

  it('takes a 2027 pick from its original club’s slot in the 2026 order, flagged as a proxy', () => {
    expect(legFor([order('1', { pickId: 'pick-2026' })], 2027)).toMatchObject({
      state: 'valued',
      basis: 'pick_projected_from_order',
      realizedValue: hpnDpv3ValueForPick(7),
      projection: { orderDraftYear: 2026, pickDraftYear: 2027, proxy: true },
      reasons: ['pick_projected_from_prior_order_proxy'],
    });
    // Once a 2027 order exists, a pick missing from it is never projected from 2026.
    expect(
      legFor(
        [
          order('1', { pickId: 'pick-2026' }),
          order('2', { pickId: 'pick-other', draftYear: 2027, originalClubId: 'carlton' }),
        ],
        2027
      )
    ).toMatchObject({ state: 'blocked', reasons: ['pick_outcome_pending'] });
  });

  it.each<[string, Custody[]]>([
    ['no order at all', []],
    ['no slot of its own in the order', [order('1', { pickId: 'x', originalClubId: 'carlton' })]],
    [
      'two slots in the same observation',
      [order('1', { pickId: 'x' }), order('2', { pickId: 'x', recordedPickNumber: 8 })],
    ],
    [
      'an observation overlapping the latest',
      [order('1'), order('2', { recordedPickNumber: 8, observedAt: '2026-10-10T03:00:00.000Z' })],
    ],
    ['a slot beyond 90', [order('1', { recordedPickNumber: 91 })]],
    ['a slot with no number', [order('1', { recordedPickNumber: null })]],
    ['a disputed slot', [order('1', { status: 'disputed' })]],
    ['only a rookie-draft order', [order('1', { draftType: 'rookie' })]],
    // The latest capture decides, whatever its status: an older usable slot never overrides it.
    [
      'a newer disputed capture over an older usable one',
      [order('1'), order('2', { recordedPickNumber: 9, status: 'disputed', observedAt: later })],
    ],
    [
      'a newer disputed capture re-keyed under another pickId',
      [order('1'), order('2', { pickId: 'pick-rekeyed', status: 'disputed', observedAt: later })],
    ],
    [
      'a newer unnumbered capture over an older numbered one',
      [order('1'), order('2', { recordedPickNumber: null, observedAt: later })],
    ],
  ])('stays pending, and blocking, with %s', (_label, pickCustody) => {
    expect(legFor(pickCustody)).toMatchObject({
      state: 'blocked',
      basis: 'unavailable',
      reasons: ['pick_outcome_pending'],
    });
  });

  it('reads a newer capture of the pick re-keyed under another pickId', () => {
    expect(
      legFor([
        order('1'),
        order('2', { pickId: 'pick-rekeyed', recordedPickNumber: 9, observedAt: later }),
      ])
    ).toMatchObject({
      basis: 'pick_projected_from_order',
      projection: { selectionNumber: 9, custodyId: custodyId('2') },
    });
  });

  it('keeps a 2027 proxy pending when the latest prior-order capture is disputed', () => {
    expect(
      legFor(
        [
          order('1', { pickId: 'pick-2026' }),
          order('2', { pickId: 'pick-2026', status: 'disputed', observedAt: later }),
        ],
        2027
      )
    ).toMatchObject({ state: 'blocked', reasons: ['pick_outcome_pending'] });
  });

  it('keeps a pick with no original club (a compensation pick) pending unless its pickId is captured', () => {
    const compensation = future([order('1', { pickId: 'pick-other', originalClubId: null })]);
    compensation.transfers[0] = {
      ...compensation.transfers[0]!,
      asset: { ...compensation.transfers[0]!.asset, originalClubId: null },
    } as Transfer;
    expect(legOf(gradeAflTradesOnRealizedValue(inputs(compensation)), 'tr-Fa')).toMatchObject({
      state: 'blocked',
      reasons: ['pick_outcome_pending'],
    });
    // Nor does it proxy: with no 2027 order, a 2027 compensation pick has no entitlement to match.
    const proxied = future([order('1', { originalClubId: null })], 2027);
    proxied.transfers[0] = {
      ...proxied.transfers[0]!,
      asset: { ...proxied.transfers[0]!.asset, originalClubId: null },
    } as Transfer;
    expect(legOf(gradeAflTradesOnRealizedValue(inputs(proxied)), 'tr-Fa')).toMatchObject({
      state: 'blocked',
      reasons: ['pick_outcome_pending'],
    });
  });

  it('values each hop of a pick traded twice before its draft at the same slot', () => {
    // 2025: Richmond → Hawthorn (tx-F), then Hawthorn → St Kilda (tx-G); both outcomes pending.
    const candidate = future([order('1')]);
    candidate.transactions.push(trade('tx-G', 2025));
    candidate.transfers.push(pick('tr-Ga', 'tx-G', 'hawthorn', 'st-kilda', 'pick-F', 2026, null));
    candidate.pickOutcomes!.push(outcome('tr-Ga', pending));
    const batch = gradeAflTradesOnRealizedValue(inputs(candidate));
    const value = hpnDpv3ValueForPick(7);
    expect(legOf(batch, 'tr-Fa')).toMatchObject({ realizedValue: value });
    expect(legOf(batch, 'tr-Ga')).toMatchObject({ realizedValue: value });
    const hawthorn = (id: string) =>
      gradeOf(batch, id).clubs.find(({ clubId }) => clubId === 'hawthorn')!;
    expect(hawthorn('tx-G')).toEqual({
      clubId: 'hawthorn',
      received: 0,
      givenUp: value,
      net: -value,
    });
    // Hawthorn, the middle club, nets 0 on the pick: received in tx-F, given up in tx-G.
    expect(hawthorn('tx-F').received! - hawthorn('tx-G').givenUp!).toBe(0);
  });

  describe('a traded-on pick whose onward trade holds a projected pick', () => {
    // 2025: Melbourne sends its pending 2026 pick P (slot 20) to Hawthorn (tx-A); Hawthorn trades it
    // on to St Kilda (tx-B) for St Kilda's pending 2026 pick S (slot 15), or for player q.
    const chain = (hawthornReceives: 'pick' | 'player'): Candidate => ({
      transactions: [trade('tx-A', 2025), trade('tx-B', 2025)],
      transfers: [
        pick('tr-A1', 'tx-A', 'melbourne', 'hawthorn', 'pick-P', 2026, null),
        pick('tr-B1', 'tx-B', 'hawthorn', 'st-kilda', 'pick-P', 2026, null),
        hawthornReceives === 'pick'
          ? pick('tr-B2', 'tx-B', 'st-kilda', 'hawthorn', 'pick-S', 2026, null)
          : player('tr-B2', 'tx-B', 'st-kilda', 'hawthorn', 'q'),
      ],
      pickOutcomes: [
        outcome('tr-A1', { disposition: 'traded_on' }),
        outcome('tr-B1', pending),
        ...(hawthornReceives === 'pick' ? [outcome('tr-B2', pending)] : []),
      ],
      pickCustody: [
        order('1', { pickId: 'pick-P', originalClubId: 'melbourne', recordedPickNumber: 20 }),
        order('2', { pickId: 'pick-S', originalClubId: 'st-kilda', recordedPickNumber: 15 }),
      ],
    });

    it('unblocks: the return is the projected pick, provisional and stated as projected', () => {
      const batch = gradeAflTradesOnRealizedValue(inputs(chain('pick')));
      expect(legOf(batch, 'tr-B2')).toMatchObject({
        basis: 'pick_projected_from_order',
        realizedValue: hpnDpv3ValueForPick(15),
      });
      expect(legOf(batch, 'tr-A1')).toMatchObject({
        state: 'valued',
        basis: 'pick_traded_on_return',
        realizedValue: hpnDpv3ValueForPick(15),
        onward: { transactionId: 'tx-B', allocation: 'sole_asset', share: 1 },
        reasons: [
          'single_source_pick_outcome',
          'traded_on_return_projected',
          'traded_on_return_provisional',
        ],
      });
      expect(gradeOf(batch, 'tx-A').state).toBe('provisional');
    });

    it('does not say projected when only the sole asset the club gave is projected', () => {
      const batch = gradeAflTradesOnRealizedValue(inputs(chain('player')));
      expect(legOf(batch, 'tr-B1')).toMatchObject({ basis: 'pick_projected_from_order' });
      expect(legOf(batch, 'tr-A1')).toMatchObject({
        state: 'valued',
        realizedValue: 0,
        reasons: ['single_source_pick_outcome', 'traded_on_return_provisional'],
      });
    });
  });
});

describe('rule v7: a special entitlement follows its reviewed custody chain (issue 789)', () => {
  const entitlementId = `special-draft-entitlement:${hex('e')}`;
  const concession = (transferId: string, transactionId: string, from: string, to: string) =>
    ({
      ...pick(transferId, transactionId, from, to, 'unused', 2020, null),
      asset: {
        kind: 'special_pick',
        entitlementType: 'assistance_concession',
        draftYear: 2020,
        selectionOrdinal: null,
        sourceLabel: '2020MIDR1 (Gold Coast concession)',
      },
    }) as unknown as Transfer;
  // tx-S (2019): Gold Coast sends Geelong its 2020 concession for player g. tx-C (2020): Geelong
  // trades it on, as ordinary pick 15 (draftee d15, GWS), to GWS for player cam.
  const geelong = (): Candidate => ({
    transactions: [trade('tx-S', 2019), trade('tx-C', 2020)],
    transfers: [
      concession('tr-S1', 'tx-S', 'gold-coast', 'geelong'),
      player('tr-S2', 'tx-S', 'geelong', 'gold-coast', 'g'),
      pick('tr-C1', 'tx-C', 'geelong', 'gws', 'pick-15', 2020, 15),
      player('tr-C2', 'tx-C', 'gws', 'geelong', 'cam'),
    ],
    pickOutcomes: [outcome('tr-C1', { disposition: 'selected', playerId: 'd15' })],
  });
  const chain = [
    { transferId: 'tr-S1', entitlementId, predecessorTransferId: null },
    { transferId: 'tr-C1', entitlementId, predecessorTransferId: 'tr-S1' },
  ];
  const data = {
    seasonSpells: [
      ...spells('g', [
        [2021, 'gold-coast'],
        [2022, 'gold-coast'],
      ]),
      ...spells('d15', [
        [2021, 'gws'],
        [2022, 'gws'],
      ]),
      ...spells('cam', [
        [2021, 'geelong'],
        [2022, 'geelong'],
        [2023, 'carlton'],
      ]),
    ],
    pav: [
      ...pavRows('g', [[2021, 'gold-coast', 6]]),
      ...pavRows('d15', [[2022, 'gws', 8.597]]),
      ...pavRows('cam', [
        [2021, 'geelong', 30],
        [2022, 'geelong', 25],
      ]),
    ],
    reviewedArrivals: [{ playerId: 'cam', clubId: 'geelong', season: 2021 }],
    specialEntitlementCustody: chain,
  };

  it('rule v17: reports the selection its custody successor was used at, else stays outside', () => {
    const candidate = geelong();
    candidate.pickOutcomes = [
      outcome('tr-C1', { disposition: 'selected', playerId: 'd15', selectionId: 'selection-15' }),
    ];
    candidate.draftSelections = [
      {
        selectionId: 'selection-15',
        draftYear: 2020,
        draftType: 'national',
        selectionNumber: 15,
        roundNumber: 1,
        pickId: 'pick-15',
        playerId: 'd15',
        clubId: 'gws',
        status: 'single_source',
        supportingProviders: ['draftguru'],
        evidenceIds: [],
      } as unknown as NonNullable<Candidate['draftSelections']>[number],
    ];
    expect(legOf(gradeAflTradesOnRealizedValue(inputs(candidate, data)), 'tr-S1').atTrade).toEqual({
      kind: 'pick_projection_eventual_slot',
      benchmarkId: `hpn-pick-benchmark:${hex('b')}`,
      selectionNumber: 15,
      slotSource: 'onward_selection',
      value: hpnDpv3ValueForPick(15),
    });
    // No selection on the successor's trail, or no custody chain: no real slot.
    for (const extra of [{}, { specialEntitlementCustody: [] }])
      expect(
        legOf(gradeAflTradesOnRealizedValue(inputs(geelong(), { ...data, ...extra })), 'tr-S1')
          .atTrade
      ).toEqual({ kind: 'unavailable', reason: 'pick_outside_projection_domain' });
  });

  it('values a special entitlement at its share of the return its successor brought back', () => {
    const batch = gradeAflTradesOnRealizedValue(inputs(geelong(), data));
    expect(legOf(batch, 'tr-S1')).toMatchObject({
      state: 'valued',
      basis: 'pick_traded_on_return',
      realizedValue: 55,
      onward: { transactionId: 'tx-C', allocation: 'sole_asset', returnValue: 55, share: 1 },
      specialEntitlement: { entitlementId, successorTransferId: 'tr-C1' },
      reasons: [
        'single_source_pick_outcome',
        'special_entitlement_custody_linked',
        'traded_on_return_provisional',
      ],
    });
    expect(legOf(batch, 'tr-S1')).not.toHaveProperty('corroboratedBy');
    expect(gradeOf(batch, 'tx-S')).toMatchObject({
      state: 'provisional',
      clubs: [
        { clubId: 'geelong', received: 55 },
        { clubId: 'gold-coast', givenUp: 55 },
      ],
    });
    expect(legOf(batch, 'tr-C1')).toMatchObject({
      basis: 'pick_selected_first_stint',
      realizedValue: 8.597,
    });
    expect(legOf(batch, 'tr-C1')).not.toHaveProperty('specialEntitlement');
  });

  it.each<[string, Partial<AflTradeRealizedTradeGradeInputs>, (candidate: Candidate) => void]>([
    ['no custody chain is loaded', { specialEntitlementCustody: undefined }, () => {}],
    ['the chain has no successor', { specialEntitlementCustody: chain.slice(0, 1) }, () => {}],
    [
      'the successor is another entitlement’s',
      {
        specialEntitlementCustody: [
          chain[0]!,
          { ...chain[1]!, entitlementId: `special-draft-entitlement:${hex('f')}` },
        ],
      },
      () => {},
    ],
    [
      'the successor is given by another club',
      {},
      (candidate) => {
        candidate.transfers[2] = pick('tr-C1', 'tx-C', 'carlton', 'gws', 'pick-15', 2020, 15);
      },
    ],
    [
      'the successor’s trade comes first',
      {},
      (candidate) => {
        candidate.transactions[1] = trade('tx-C', 2018);
      },
    ],
    [
      'a resolved special entitlement names another entitlement',
      {},
      (candidate) => {
        candidate.transfers[0] = {
          ...candidate.transfers[0]!,
          asset: {
            kind: 'special_entitlement',
            entitlementId: `special-draft-entitlement:${hex('f')}`,
          },
        } as unknown as Transfer;
      },
    ],
  ])('stays unsupported when %s', (_label, extra, change) => {
    const candidate = geelong();
    change(candidate);
    const batch = gradeAflTradesOnRealizedValue(inputs(candidate, { ...data, ...extra }));
    expect(legOf(batch, 'tr-S1')).toMatchObject({
      state: 'blocked',
      reasons: ['special_entitlement_unsupported'],
    });
    expect(legOf(batch, 'tr-S1')).not.toHaveProperty('specialEntitlement');
  });

  it('follows a resolved special entitlement whose id is its chain’s', () => {
    const candidate = geelong();
    candidate.transfers[0] = {
      ...candidate.transfers[0]!,
      asset: { kind: 'special_entitlement', entitlementId },
    } as unknown as Transfer;
    const batch = gradeAflTradesOnRealizedValue(inputs(candidate, data));
    expect(legOf(batch, 'tr-S1')).toMatchObject({ state: 'valued', realizedValue: 55 });
  });

  it('blocks a custody link whose onward trade leads back to its own trade', () => {
    // Same season, undated: Geelong receives pick Z from GWS in tx-C and gives it on in tx-S.
    const candidate = geelong();
    candidate.transactions = [trade('tx-S', 2020), trade('tx-C', 2020)];
    candidate.transfers.push(
      pick('tr-C3', 'tx-C', 'gws', 'geelong', 'pick-Z', 2021, 30),
      pick('tr-S4', 'tx-S', 'geelong', 'gold-coast', 'pick-Z', 2021, 30)
    );
    candidate.pickOutcomes = [
      ...candidate.pickOutcomes!,
      outcome('tr-C3', { disposition: 'traded_on' }),
      outcome('tr-S4', { disposition: 'selected', playerId: 'dz' }),
    ];
    const batch = gradeAflTradesOnRealizedValue(inputs(candidate, data));
    expect(legOf(batch, 'tr-S1')).toMatchObject({
      state: 'blocked',
      reasons: ['traded_on_return_blocked'],
    });
    expect(legOf(batch, 'tr-C3').reasons).toEqual(['traded_on_return_blocked']);
  });

  it('unblocks a traded-on pick bundled with the special entitlement in its onward trade', () => {
    // tx-K (2019): West Coast sends Gold Coast pick K for player k; Gold Coast gives Geelong pick K
    // (draftee dk) with the concession in tx-S.
    const candidate = geelong();
    candidate.transactions.push(trade('tx-K', 2019));
    candidate.transfers.push(
      pick('tr-K1', 'tx-K', 'west-coast', 'gold-coast', 'pick-K', 2019, 10),
      player('tr-K2', 'tx-K', 'gold-coast', 'west-coast', 'k'),
      pick('tr-S3', 'tx-S', 'gold-coast', 'geelong', 'pick-K', 2019, 10)
    );
    candidate.pickOutcomes = [
      ...candidate.pickOutcomes!,
      outcome('tr-K1', { disposition: 'traded_on' }),
      outcome('tr-S3', { disposition: 'selected', playerId: 'dk' }),
    ];
    const kData = {
      ...data,
      seasonSpells: [...data.seasonSpells, ...spells('dk', [[2021, 'geelong']])],
      pav: [...data.pav, ...pavRows('dk', [[2021, 'geelong', 5]])],
    };
    const before = gradeAflTradesOnRealizedValue(
      inputs(candidate, { ...kData, specialEntitlementCustody: undefined })
    );
    expect(legOf(before, 'tr-K1').reasons).toEqual(['traded_on_return_blocked']);
    const after = gradeAflTradesOnRealizedValue(inputs(candidate, kData));
    expect(legOf(after, 'tr-S1')).toMatchObject({ state: 'valued', realizedValue: 55 });
    // Gold Coast gave the concession (55) and pick K (dk's 5) for g (6): pick K takes 5 / 60.
    expect(legOf(after, 'tr-K1')).toMatchObject({
      state: 'valued',
      basis: 'pick_traded_on_return',
      onward: { transactionId: 'tx-S', allocation: 'relative_value', weight: 5, weightTotal: 60 },
      realizedValue: (5 / 60) * 6,
    });
    expect(gradeOf(after, 'tx-K').state).toBe('provisional');
  });
});

describe('rule v8: a future pick’s at-trade view is the slot it eventually took (owner direction 2026-10-16)', () => {
  type Selection = NonNullable<Candidate['draftSelections']>[number];
  type Custody = NonNullable<Candidate['pickCustody']>[number];
  const eventual = (
    selectionNumber: number,
    slotSource: 'selection' | 'order' | 'projected_order'
  ) => ({
    kind: 'pick_projection_eventual_slot',
    benchmarkId: `hpn-pick-benchmark:${hex('b')}`,
    selectionNumber,
    slotSource,
    value: hpnDpv3ValueForPick(selectionNumber),
  });
  const UNKNOWN = { kind: 'unavailable', reason: 'future_pick_slot_unknown' };
  /** GWS takes Finn Callaghan with Collingwood's original 2021 first-round pick, at 3. */
  const selection = (fields: Partial<Selection> = {}): Selection =>
    ({
      selectionId: 'selection-3',
      draftYear: 2021,
      draftType: 'national',
      selectionNumber: 3,
      roundNumber: 1,
      pickId: 'pick-C',
      playerId: 'callaghan',
      clubId: 'gws',
      status: 'corroborated',
      supportingProviders: ['draftguru', 'footyinfo'],
      evidenceIds: [],
      ...fields,
    }) as Selection;
  /** The same pick's slot in an Official AFL order. */
  const order = (recordedPickNumber: number, fields: Partial<Custody> = {}): Custody =>
    ({
      custodyId: `external-pick-custody:${hex('1')}`,
      pickId: 'pick-C',
      observedAt: { precision: 'day', date: '2021-11-20' },
      draftYear: 2021,
      draftType: 'national',
      roundNumber: 1,
      recordedPickNumber,
      originalClubId: 'collingwood',
      currentClubId: 'gws',
      status: 'single_source',
      evidenceIds: [],
      ...fields,
    }) as unknown as Custody;
  // 2020: Collingwood sends its 2021 first-round pick (no slot yet) to GWS for player p1.
  const future = (
    outcomeFields: Partial<Outcome>,
    extra: Partial<Candidate> = {},
    nominalPick: number | null = null,
    draftYear = 2021
  ): Candidate => ({
    transactions: [trade('tx-C', 2020)],
    transfers: [
      pick('tr-Ca', 'tx-C', 'collingwood', 'gws', 'pick-C', draftYear, nominalPick),
      player('tr-Cb', 'tx-C', 'gws', 'collingwood', 'p1'),
    ],
    pickOutcomes: [outcome('tr-Ca', outcomeFields)],
    ...extra,
  });
  const callaghan = {
    disposition: 'selected',
    playerId: 'callaghan',
    selectionId: 'selection-3',
  } as const;
  const callaghanCareer = {
    seasonSpells: spells('callaghan', [
      [2022, 'gws'],
      [2023, 'gws'],
      [2024, 'gws'],
      [2025, 'gws'],
    ]),
    pav: pavRows('callaghan', [
      [2022, 'gws', 5],
      [2023, 'gws', 15],
      [2024, 'gws', 20],
      [2025, 'gws', 20],
    ]),
    reviewedArrivals: [{ playerId: 'callaghan', clubId: 'gws', season: 2022 }],
  };
  const atTradeOf = (candidate: Candidate) =>
    legOf(gradeAflTradesOnRealizedValue(inputs(candidate)), 'tr-Ca').atTrade;
  const noNominee = {
    disposition: 'not_used',
    nominationBasis: 'club_took_no_nominated_player',
    receivingClubNominatedSelections: 0,
  } as const;

  it('values a future pick used at 3 (Finn Callaghan) at slot 3 at trade, and changes no total', () => {
    const batch = gradeAflTradesOnRealizedValue(
      inputs(future(callaghan, { draftSelections: [selection()] }), callaghanCareer)
    );
    expect(legOf(batch, 'tr-Ca')).toMatchObject({
      state: 'valued',
      basis: 'pick_selected_first_stint',
      realizedValue: 60,
      corroboratedBy: 'footyinfo',
      atTrade: eventual(3, 'selection'),
    });
    expect(gradeOf(batch, 'tx-C').clubs).toEqual([
      { clubId: 'collingwood', received: 0, givenUp: 60, net: -60 },
      { clubId: 'gws', received: 60, givenUp: 0, net: 60 },
    ]);
  });

  it('takes the selection over a different order slot, and the order when the selection is not usable', () => {
    const withOrder = (status: Selection['status']) =>
      future(callaghan, { draftSelections: [selection({ status })], pickCustody: [order(5)] });
    expect(atTradeOf(withOrder('single_source'))).toEqual(eventual(3, 'selection'));
    expect(atTradeOf(withOrder('disputed'))).toEqual(eventual(5, 'order'));
  });

  it.each<[string, Partial<Outcome>]>([
    ['a traded-on future pick', { disposition: 'traded_on' }],
    ['a not-used future pick', noNominee],
  ])('values %s at its slot in its own draft’s order', (_label, fields) => {
    expect(atTradeOf(future(fields, { pickCustody: [order(9)] }))).toEqual(eventual(9, 'order'));
  });

  it('never reads a drafted pick from the previous draft’s order', () => {
    const prior = order(9, { draftYear: 2020, pickId: 'pick-2020' });
    expect(atTradeOf(future(noNominee, { pickCustody: [prior] }))).toEqual(UNKNOWN);
  });

  it.each<[string, Custody[]]>([
    ['its own draft’s order', [order(7)]],
    [
      'the previous draft’s order, as a proxy',
      [order(7, { draftYear: 2020, pickId: 'pick-2020' })],
    ],
  ])('values a pending future pick at the slot it is projected from in %s', (_label, rows) => {
    const leg = legOf(
      gradeAflTradesOnRealizedValue(
        inputs(future({ disposition: 'not_used', outcomeStatus: 'pending' }, { pickCustody: rows }))
      ),
      'tr-Ca'
    );
    expect(leg).toMatchObject({
      basis: 'pick_projected_from_order',
      projection: { selectionNumber: 7 },
      atTrade: eventual(7, 'projected_order'),
    });
  });

  it.each<[string, Candidate]>([
    [
      'a selection beyond 90, whatever the order said',
      future(callaghan, {
        draftSelections: [selection({ selectionNumber: 91, roundNumber: 5 })],
        pickCustody: [order(9)],
      }),
    ],
    ['an order slot beyond 90', future(noNominee, { pickCustody: [order(91)] })],
    [
      'a disputed order slot',
      future(noNominee, { pickCustody: [order(9, { status: 'disputed' })] }),
    ],
    ['no selection and no order', future(callaghan)],
    [
      'a draft before the trade',
      future(noNominee, { pickCustody: [order(9, { draftYear: 2019 })] }, null, 2019),
    ],
  ])('keeps the slot unknown with %s', (_label, candidate) => {
    expect(atTradeOf(candidate)).toEqual(UNKNOWN);
  });

  it('keeps a current pick’s view at its slot at the trade', () => {
    const candidate = future(callaghan, { draftSelections: [selection()] }, 12);
    expect(atTradeOf(candidate)).toEqual({
      kind: 'pick_projection',
      benchmarkId: `hpn-pick-benchmark:${hex('b')}`,
      selectionNumber: 12,
      value: hpnDpv3ValueForPick(12),
    });
  });
});

describe('rule v17: at-trade projections for selected, consumed and out-of-domain picks (issue 789)', () => {
  type Selection = NonNullable<Candidate['draftSelections']>[number];
  type Custody = NonNullable<Candidate['pickCustody']>[number];
  const benchmarkId = `hpn-pick-benchmark:${hex('b')}`;
  const UNKNOWN = { kind: 'unavailable', reason: 'future_pick_slot_unknown' };
  const eventual = (selectionNumber: number, slotSource: string) => ({
    kind: 'pick_projection_eventual_slot',
    benchmarkId,
    selectionNumber,
    slotSource,
    value: hpnDpv3ValueForPick(selectionNumber),
  });
  /** A future pick (no slot at the trade) with its draft, round and original club. */
  const future = (
    ids: [transferId: string, transactionId: string, from: string, to: string],
    round: number,
    originalClubId: string | null,
    draftYear = 2024
  ): Transfer => {
    const [transferId, transactionId, from, to] = ids;
    const transfer = pick(transferId, transactionId, from, to, 'pick-F', draftYear, null);
    const asset = { ...transfer.asset, nominalRound: round, originalClubId };
    return { ...transfer, asset } as Transfer;
  };
  const selection = (selectionNumber: number, fields: Partial<Selection> = {}): Selection =>
    ({
      selectionId: `selection-${selectionNumber}`,
      draftYear: 2024,
      draftType: 'national',
      selectionNumber,
      roundNumber: 1,
      pickId: `pick-${selectionNumber}`,
      playerId: 'draftee',
      clubId: 'sydney',
      // Its custody is unresolved: no capture names the pick's original club (rule v8 skipped it).
      status: 'unresolved',
      supportingProviders: ['draftguru'],
      evidenceIds: [],
      ...fields,
    }) as Selection;
  /** One row of a final order: a club's own pick in a round. */
  const order = (
    digit: string,
    originalClubId: string,
    roundNumber: number,
    recordedPickNumber: number | null,
    fields: Partial<Custody> = {}
  ): Custody =>
    ({
      custodyId: `external-pick-custody:${hex(digit)}`,
      pickId: `pick-${originalClubId}-${roundNumber}`,
      observedAt: { precision: 'day', date: '2024-11-20' },
      draftYear: 2024,
      draftType: 'national',
      roundNumber,
      recordedPickNumber,
      originalClubId,
      currentClubId: originalClubId,
      status: 'single_source',
      evidenceIds: [],
      ...fields,
    }) as unknown as Custody;
  // The 2024 first round names all 18 clubs: Geelong 3, Collingwood 9, then 16 more from 10 on
  // (Hawthorn's own first-round pick is not among them), so Collingwood ranks second.
  const others = [
    'adelaide',
    'brisbane',
    'carlton',
    'essendon',
    'fremantle',
    'gold-coast',
    'gws',
    'melbourne',
    'north-melbourne',
    'port-adelaide',
    'richmond',
    'st-kilda',
    'sydney',
    'tasmania',
    'west-coast',
    'western-bulldogs',
  ];
  const firstRound = [
    order('1', 'geelong', 1, 3),
    order('2', 'collingwood', 1, 9),
    ...others.map((club, at) =>
      order('0', club, 1, 10 + at, {
        custodyId: `external-pick-custody:${(at + 16).toString(16).padStart(64, '0')}`,
      })
    ),
  ];
  const proxy = (clubPosition: number, roundNumber: number, selectionNumber: number) => ({
    kind: 'pick_projection_round_position_proxy',
    benchmarkId,
    roundNumber,
    clubPosition,
    selectionNumber,
    orderCustodyId: `external-pick-custody:${hex('2')}`,
    value: hpnDpv3ValueForPick(selectionNumber),
  });
  const noNominee = {
    disposition: 'not_used',
    nominationBasis: 'club_took_no_nominated_player',
    receivingClubNominatedSelections: 0,
  } as const;
  const nominee = {
    disposition: 'not_used',
    nominationBasis: 'club_took_nominated_player',
    receivingClubNominatedSelections: 1,
  } as const;
  const drafted = (selectionNumber: number) =>
    ({
      disposition: 'selected',
      playerId: 'draftee',
      selectionId: `selection-${selectionNumber}`,
    }) as const;
  // 2023: Collingwood sends its 2024 pick to Richmond for player p1.
  const single = (
    round: number,
    originalClubId: string | null,
    outcomeFields: Partial<Outcome>,
    extra: Partial<Candidate> = {}
  ): Candidate => ({
    transactions: [trade('tx-1', 2023)],
    transfers: [
      future(['tr-1a', 'tx-1', 'collingwood', 'richmond'], round, originalClubId),
      player('tr-1b', 'tx-1', 'richmond', 'collingwood', 'p1'),
    ],
    pickOutcomes: [outcome('tr-1a', outcomeFields)],
    ...extra,
  });
  // 2023: a 2024 pick goes from `first` to Richmond, which trades it on to `last` for player p2.
  const trail = (
    [first, last]: [string, string],
    round: number,
    originalClubId: string | null,
    end: Partial<Outcome>,
    extra: Partial<Candidate> = {}
  ): Candidate => ({
    transactions: [trade('tx-A', 2023), trade('tx-B', 2023)],
    transfers: [
      future(['tr-A1', 'tx-A', first, 'richmond'], round, originalClubId),
      player('tr-A2', 'tx-A', 'richmond', first, 'p1'),
      future(['tr-B1', 'tx-B', 'richmond', last], round, originalClubId),
      player('tr-B2', 'tx-B', last, 'richmond', 'p2'),
    ],
    pickOutcomes: [outcome('tr-A1', { disposition: 'traded_on' }), outcome('tr-B1', end)],
    ...extra,
  });
  const atTradeOf = (candidate: Candidate, transferId = 'tr-1a') =>
    legOf(gradeAflTradesOnRealizedValue(inputs(candidate)), transferId).atTrade;

  describe('case 1: a used pick takes its selection’s slot', () => {
    it('values a selected pick with no original club (Ned Bowman, 26) at its unresolved selection', () => {
      const candidate = single(1, null, drafted(26), { draftSelections: [selection(26)] });
      expect(atTradeOf(candidate)).toEqual(eventual(26, 'selection'));
      // A disputed selection, or one naming no player, still settles nothing.
      candidate.draftSelections = [selection(26, { status: 'disputed' })];
      expect(atTradeOf(candidate)).toEqual(UNKNOWN);
      candidate.draftSelections = [selection(26, { playerId: null })];
      expect(atTradeOf(candidate)).toEqual(UNKNOWN);
    });

    // Port Adelaide's 2024 R1 (no original club) goes to Richmond, then to North Melbourne, who use
    // it at 27 (Matt Whitlock).
    const whitlock = (extra: Partial<Candidate> = {}) =>
      trail(['port-adelaide', 'north-melbourne'], 1, null, drafted(27), {
        draftSelections: [selection(27, { clubId: 'north-melbourne' })],
        ...extra,
      });

    it('values a traded-on pick at the selection its trail ends in, on a later hop', () => {
      expect(atTradeOf(whitlock(), 'tr-A1')).toEqual(eventual(27, 'onward_selection'));
      expect(atTradeOf(whitlock(), 'tr-B1')).toEqual(eventual(27, 'selection'));
    });

    it('takes the trail’s selection over the pick’s own order slot', () => {
      const own = order('4', 'port-adelaide', 1, 25, { pickId: 'pick-F' });
      expect(atTradeOf(whitlock({ pickCustody: [own] }), 'tr-A1')).toEqual(
        eventual(27, 'onward_selection')
      );
    });

    it('falls back to the pick’s own order slot when a later hop is unresolved', () => {
      const own = order('4', 'port-adelaide', 1, 25, { pickId: 'pick-F' });
      const candidate = whitlock({ pickCustody: [own] });
      candidate.pickOutcomes![1] = outcome('tr-B1', {
        disposition: 'selected',
        outcomeStatus: 'unresolved',
      });
      expect(atTradeOf(candidate, 'tr-A1')).toEqual(eventual(25, 'order'));
    });

    it('keeps the slot unknown when the trail’s selection is beyond 90', () => {
      const late = whitlock({
        draftSelections: [selection(27, { clubId: 'north-melbourne', selectionNumber: 91 })],
      });
      expect(atTradeOf(late, 'tr-A1')).toEqual(UNKNOWN);
    });
  });

  describe('case 2: a pick with no slot in its draft’s final order takes a round-position proxy', () => {
    it.each<[string, Partial<Outcome>]>([
      ['spent matching a bid', nominee],
      ['never used', noNominee],
    ])('projects a round-4 pick %s at its club’s rank plus 54', (_label, fields) => {
      // Collingwood ranks second by its own first-round slot: 2 + 18 × 3 = 56.
      const candidate = single(4, 'collingwood', fields, { pickCustody: firstRound });
      expect(atTradeOf(candidate)).toEqual(proxy(2, 4, 56));
      // An unnumbered capture of the pick itself (spent before the final order) changes nothing.
      const spent = order('5', 'collingwood', 4, null, { pickId: 'pick-F' });
      candidate.pickCustody = [...firstRound, spent];
      expect(atTradeOf(candidate)).toEqual(proxy(2, 4, 56));
    });

    it('caps a late round at 90 and changes no total', () => {
      const batch = gradeAflTradesOnRealizedValue(
        inputs(single(6, 'collingwood', noNominee, { pickCustody: firstRound }))
      );
      expect(legOf(batch, 'tr-1a')).toMatchObject({
        state: 'valued',
        basis: 'pick_not_used_no_nominee',
        realizedValue: 0,
        reasons: ['single_source_pick_outcome'],
        atTrade: proxy(2, 6, 90),
      });
      expect(gradeOf(batch, 'tx-1').clubs).toEqual([
        { clubId: 'collingwood', received: 0, givenUp: 0, net: 0 },
        { clubId: 'richmond', received: 0, givenUp: 0, net: 0 },
      ]);
    });

    it('projects a traded-on pick whose trail ended unused', () => {
      const candidate = trail(['collingwood', 'essendon'], 4, 'collingwood', noNominee, {
        pickCustody: firstRound,
      });
      expect(atTradeOf(candidate, 'tr-A1')).toEqual(proxy(2, 4, 56));
    });

    const withoutCollingwood = firstRound.filter((row) => row.originalClubId !== 'collingwood');
    it.each<[string, Candidate]>([
      ['no original club (a 2023 R3)', single(3, null, noNominee, { pickCustody: firstRound })],
      [
        'an original club with no first-round slot',
        single(4, 'hawthorn', noNominee, { pickCustody: firstRound }),
      ],
      [
        'an original club whose first-round slot is disputed',
        single(4, 'collingwood', noNominee, {
          pickCustody: [
            ...withoutCollingwood,
            order('2', 'collingwood', 1, 9, { status: 'disputed' }),
          ],
        }),
      ],
      [
        'another club’s first-round slot disputed, which would move Collingwood up a place',
        single(4, 'collingwood', noNominee, {
          pickCustody: [
            order('1', 'geelong', 1, 3, { status: 'disputed' }),
            ...firstRound.slice(1),
          ],
        }),
      ],
      ['no order for its draft', single(4, 'collingwood', noNominee)],
      [
        'captures of the pick too close in time to tell which is latest',
        single(4, 'collingwood', noNominee, {
          pickCustody: [
            ...firstRound,
            order('5', 'collingwood', 4, null, { pickId: 'pick-F' }),
            order('6', 'collingwood', 4, null, { pickId: 'pick-F' }),
          ],
        }),
      ],
      [
        'a slot it held beyond 90',
        single(4, 'collingwood', noNominee, {
          pickCustody: [...firstRound, order('5', 'collingwood', 6, 95, { pickId: 'pick-F' })],
        }),
      ],
      [
        'a pending outcome',
        single(
          4,
          'collingwood',
          { disposition: 'not_used', outcomeStatus: 'pending' },
          { pickCustody: firstRound }
        ),
      ],
      [
        'a selection missing from the candidate',
        single(4, 'collingwood', drafted(60), { pickCustody: firstRound }),
      ],
    ])('keeps the slot unknown with %s', (_label, candidate) => {
      expect(atTradeOf(candidate)).toEqual(UNKNOWN);
    });
  });

  describe('rule v19: a board’s stated pre-draft slot comes before the proxy (owner decision 2026-10-18)', () => {
    type Board = NonNullable<Candidate['draftBoardPicks']>[number];
    const boardPickId = `external-draft-board-pick:${hex('9')}`;
    // The 2024 board's Collingwood round-4 pick, held at the draft by Gold Coast: the board names a
    // later holder than the graded trail reaches, which does not stop the entitlement joining.
    const board = (fields: Partial<Board> = {}): Board =>
      ({
        boardPickId,
        draftYear: 2024,
        draftType: 'national',
        roundNumber: 4,
        recordedPickNumber: null,
        status: 'removed',
        clubId: 'gold-coast',
        routeClubIds: ['collingwood', 'richmond', 'gold-coast'],
        originalClubId: 'collingwood',
        originalNumber: 70,
        evidenceIds: [],
        ...fields,
      }) as Board;
    const stated = (selectionNumber: number) => ({
      kind: 'pick_projection_eventual_slot',
      benchmarkId,
      selectionNumber,
      slotSource: 'board_pre_draft_slot',
      boardPickId,
      value: hpnDpv3ValueForPick(selectionNumber),
    });

    it('values an unused pick at the number the board states it held, not its proxy', () => {
      const candidate = single(4, 'collingwood', noNominee, {
        pickCustody: firstRound,
        draftBoardPicks: [board()],
      });
      expect(atTradeOf(candidate)).toEqual(stated(70));
      // A passed pick states its slot the same way.
      candidate.draftBoardPicks = [board({ status: 'passed', clubId: 'richmond' })];
      expect(atTradeOf(candidate)).toEqual(stated(70));
    });

    it('takes the board slot for a traded-on pick whose trail ended unused, with no order at all', () => {
      const candidate = trail(['collingwood', 'essendon'], 4, 'collingwood', noNominee, {
        draftBoardPicks: [board()],
      });
      expect(atTradeOf(candidate, 'tr-A1')).toEqual(stated(70));
    });

    it.each<[string, Partial<Board>[]]>([
      ['no pre-draft number', [{ originalNumber: null }]],
      ['a pre-draft number beyond 90', [{ originalNumber: 96 }]],
      ['another original club', [{ originalClubId: 'essendon' }]],
      ['another round', [{ roundNumber: 5 }]],
      ['a board read before parser v3', [{ originalClubId: undefined, originalNumber: undefined }]],
      [
        'two board picks of the entitlement',
        [{}, { boardPickId: `external-draft-board-pick:${hex('a')}` }],
      ],
      ['a selected board pick', [{ status: 'selected', recordedPickNumber: 70 }]],
    ])('falls back to the proxy with %s', (_label, boards) => {
      const candidate = single(4, 'collingwood', noNominee, {
        pickCustody: firstRound,
        draftBoardPicks: boards.map((fields) => board(fields)),
      });
      expect(atTradeOf(candidate)).toEqual(proxy(2, 4, 56));
    });

    it('never applies to a pick with no original club, a pending pick or a used one', () => {
      const boards = { draftBoardPicks: [board()] };
      expect(atTradeOf(single(4, null, noNominee, { pickCustody: firstRound, ...boards }))).toEqual(
        UNKNOWN
      );
      expect(
        atTradeOf(
          single(4, 'collingwood', { disposition: 'not_used', outcomeStatus: 'pending' }, boards)
        )
      ).toEqual(UNKNOWN);
      expect(
        atTradeOf(single(4, 'collingwood', drafted(60), { pickCustody: firstRound, ...boards }))
      ).toEqual(UNKNOWN);
    });

    it('changes no total', () => {
      const batch = gradeAflTradesOnRealizedValue(
        inputs(
          single(4, 'collingwood', noNominee, {
            pickCustody: firstRound,
            draftBoardPicks: [board()],
          })
        )
      );
      expect(legOf(batch, 'tr-1a')).toMatchObject({
        basis: 'pick_not_used_no_nominee',
        realizedValue: 0,
        atTrade: stated(70),
      });
      expect(gradeOf(batch, 'tx-1').clubs).toEqual([
        { clubId: 'collingwood', received: 0, givenUp: 0, net: 0 },
        { clubId: 'richmond', received: 0, givenUp: 0, net: 0 },
      ]);
    });
  });

  describe('case 3: a pick beyond HPN’s 1 to 90', () => {
    const numbered = (transform: (transfer: Transfer) => Transfer = (transfer) => transfer) => ({
      transactions: [trade('tx-1', 2023)],
      transfers: [
        transform(pick('tr-1a', 'tx-1', 'collingwood', 'geelong', 'pick-94', 2023, 94)),
        player('tr-1b', 'tx-1', 'geelong', 'collingwood', 'p1'),
      ],
      pickOutcomes: [outcome('tr-1a', noNominee)],
    });

    it('values pick 94 at DPVC(90), an upper bound, flagged as capped', () => {
      expect(atTradeOf(numbered())).toEqual({
        kind: 'pick_projection_domain_capped',
        benchmarkId,
        selectionNumber: 94,
        cappedAt: 90,
        value: hpnDpv3ValueForPick(90),
      });
      // HPN's curve falls with the slot, so its formula at 94 would be lower still.
      expect(hpnDpv3ValueForPick(90)).toBeGreaterThan(-30.36 * Math.log(94) + 146.95);
    });

    it('keeps a pick beyond the contract’s bound of 500 outside the domain', () => {
      const late = (transfer: Transfer) =>
        ({ ...transfer, asset: { ...transfer.asset, nominalPick: 501 } }) as Transfer;
      expect(atTradeOf(numbered(late))).toEqual({
        kind: 'unavailable',
        reason: 'pick_outside_projection_domain',
      });
    });

    it('keeps a pick of another draft outside the domain', () => {
      expect(atTradeOf(numbered(rookie))).toEqual({
        kind: 'unavailable',
        reason: 'pick_outside_projection_domain',
      });
    });
  });

  describe('an unallocated rule v16 leg is valued once its excluded asset has a v17 projection', () => {
    // tx-A: Melbourne sends pick P (20) to Hawthorn, which trades it on alone in tx-B to St Kilda for
    // St Kilda's pick 95; Hawthorn spends that pick matching a bid.
    const cappedReturn = (): Candidate => ({
      transactions: [trade('tx-A', 2021), trade('tx-B', 2021)],
      transfers: [
        pick('tr-A1', 'tx-A', 'melbourne', 'hawthorn', 'pick-P', 2021, 20),
        player('tr-A2', 'tx-A', 'hawthorn', 'melbourne', 'm'),
        pick('tr-B1', 'tx-B', 'hawthorn', 'st-kilda', 'pick-P', 2021, 20),
        pick('tr-B2', 'tx-B', 'st-kilda', 'hawthorn', 'pick-Q', 2021, 95),
      ],
      pickOutcomes: [
        outcome('tr-A1', { disposition: 'traded_on' }),
        outcome('tr-B1', noNominee),
        outcome('tr-B2', nominee),
      ],
    });

    it('values a sole asset at the capped projection of its matched-bid return', () => {
      const p90 = hpnDpv3ValueForPick(90);
      const batch = gradeAflTradesOnRealizedValue(inputs(cappedReturn()));
      expect(legOf(batch, 'tr-A1')).toMatchObject({
        state: 'valued',
        basis: 'pick_traded_on_return',
        realizedValue: p90,
        onward: {
          allocation: 'sole_asset',
          returnValue: p90,
          returnProjection: {
            benchmarkId,
            legs: [{ transferId: 'tr-B2', source: 'pick_projection_domain_capped', value: p90 }],
          },
        },
        reasons: [
          'projection_domain_capped',
          'single_source_pick_outcome',
          'traded_on_return_estimated_from_projection',
          'traded_on_return_provisional',
        ],
      });
      // With no projection for the return pick (rule v16's view of it), the hop stays unallocated.
      const v16 = unprojected(cappedReturn(), 'tr-B2');
      expect(legOf(gradeAflTradesOnRealizedValue(inputs(v16)), 'tr-A1')).toMatchObject({
        state: 'excluded',
        basis: 'pick_traded_on_return_unallocated',
      });
    });

    it('splits a bundle by its excluded sibling’s round-position proxy', () => {
      // Hawthorn also gives St Kilda Collingwood's 2021 R4 (no slot in the final order), which St
      // Kilda spends matching a bid; pick P's draftee realized 12 and Hawthorn got player q (40).
      const candidate: Candidate = {
        transactions: [trade('tx-A', 2020), trade('tx-B', 2020)],
        transfers: [
          pick('tr-A1', 'tx-A', 'melbourne', 'hawthorn', 'pick-P', 2021, 20),
          pick('tr-B1', 'tx-B', 'hawthorn', 'st-kilda', 'pick-P', 2021, 20),
          future(['tr-B5', 'tx-B', 'hawthorn', 'st-kilda'], 4, 'collingwood', 2021),
          player('tr-B3', 'tx-B', 'st-kilda', 'hawthorn', 'q'),
        ],
        pickOutcomes: [
          outcome('tr-A1', { disposition: 'traded_on' }),
          outcome('tr-B1', { disposition: 'selected', playerId: 'd5' }),
          outcome('tr-B5', nominee),
        ],
        pickCustody: firstRound.map((row) => ({ ...row, draftYear: 2021 })),
      };
      const data = {
        seasonSpells: [...spells('d5', [[2022, 'st-kilda']]), ...spells('q', [[2021, 'hawthorn']])],
        pav: [
          ...pavRows('d5', [[2022, 'st-kilda', 12]]),
          ...pavRows('q', [[2021, 'hawthorn', 40]]),
        ],
        reviewedArrivals: [{ playerId: 'q', clubId: 'hawthorn', season: 2021 }],
      };
      const p56 = hpnDpv3ValueForPick(56);
      const batch = gradeAflTradesOnRealizedValue(inputs(candidate, data));
      expect(legOf(batch, 'tr-B5').atTrade).toEqual(proxy(2, 4, 56));
      expect(legOf(batch, 'tr-A1')).toMatchObject({
        state: 'valued',
        realizedValue: (12 / (12 + p56)) * 40,
        onward: {
          allocation: 'hybrid_weighted',
          hybridWeights: {
            assets: [
              { transferId: 'tr-B1', source: 'realized', value: 12 },
              { transferId: 'tr-B5', source: 'projection', value: p56 },
            ],
          },
        },
        reasons: [
          'bundle_split_estimated_weights',
          'projection_round_position_proxy',
          'single_source_pick_outcome',
          'traded_on_return_provisional',
        ],
      });
      // Without the first-round order the sibling has no projection, so the pick stays unallocated.
      candidate.pickCustody = [];
      expect(legOf(gradeAflTradesOnRealizedValue(inputs(candidate, data)), 'tr-A1')).toMatchObject({
        state: 'excluded',
        basis: 'pick_traded_on_return_unallocated',
      });
    });
  });

  it('keeps rule v17’s limitation under rule v19', () => {
    const batch = gradeAflTradesOnRealizedValue(
      inputs({
        transactions: [trade('tx-1', 2021)],
        transfers: [player('tr-1a', 'tx-1', 'collingwood', 'carlton', 'p1')],
      })
    );
    expect(batch.content.ruleVersion).toBe('afl-trade-realized-grade-rule/v19');
    expect(batch.content.limitation).toContain(
      "from rule v17 a future pick's at-trade view also takes the selection its traded-on trail, or a special entitlement's custody successor, ends in, and its own selection when that selection is unresolved but not disputed and names its player and club"
    );
    expect(batch.content.limitation).toContain(
      "a future pick that held no slot in its draft's final order is projected at an estimated round-position proxy, its original club's first-round rank among all 18 clubs in that order plus 18 per later round, capped at 90, not a slot it held"
    );
    expect(batch.content.limitation).toContain(
      "a pick numbered beyond HPN's 1 to 90 is projected at DPVC(90), an upper bound"
    );
  });
});

describe('rule v18: every excluded leg of an onward return counts at its projection (issue 789)', () => {
  const benchmarkId = `hpn-pick-benchmark:${hex('b')}`;
  const nominee: Partial<Outcome> = {
    disposition: 'not_used',
    nominationBasis: 'club_took_nominated_player',
    receivingClubNominatedSelections: 1,
  };
  const p30 = hpnDpv3ValueForPick(30);
  const p40 = hpnDpv3ValueForPick(40);
  const p50 = hpnDpv3ValueForPick(50);
  // The genuine 2023 R2 (GWS) shape. tx-A: Melbourne sends pick P to Hawthorn, which trades it on
  // alone in tx-B to St Kilda for picks 30, 40 and 50, each spent matching a bid. With `withR`,
  // St Kilda also sends pick R, which Hawthorn trades on in tx-C to Geelong for player g (17).
  const gwsShaped = (withR: boolean): Candidate => ({
    transactions: [
      trade('tx-A', 2021),
      trade('tx-B', 2021),
      ...(withR ? [trade('tx-C', 2021)] : []),
    ],
    transfers: [
      pick('tr-A1', 'tx-A', 'melbourne', 'hawthorn', 'pick-P', 2021, 20),
      pick('tr-B1', 'tx-B', 'hawthorn', 'st-kilda', 'pick-P', 2021, 20),
      pick('tr-B2', 'tx-B', 'st-kilda', 'hawthorn', 'pick-Q30', 2021, 30),
      pick('tr-B3', 'tx-B', 'st-kilda', 'hawthorn', 'pick-Q40', 2021, 40),
      pick('tr-B4', 'tx-B', 'st-kilda', 'hawthorn', 'pick-Q50', 2021, 50),
      ...(withR
        ? [
            pick('tr-B5', 'tx-B', 'st-kilda', 'hawthorn', 'pick-R', 2021, 60),
            pick('tr-C1', 'tx-C', 'hawthorn', 'geelong', 'pick-R', 2021, 60),
            player('tr-C2', 'tx-C', 'geelong', 'hawthorn', 'g'),
          ]
        : []),
    ],
    pickOutcomes: [
      outcome('tr-A1', { disposition: 'traded_on' }),
      outcome('tr-B1', { disposition: 'selected', playerId: 'd5' }),
      outcome('tr-B2', nominee),
      outcome('tr-B3', nominee),
      outcome('tr-B4', nominee),
      ...(withR ? [outcome('tr-B5', { disposition: 'traded_on' }), outcome('tr-C1', nominee)] : []),
    ],
  });
  const data = {
    seasonSpells: [...spells('d5', [[2022, 'st-kilda']]), ...spells('g', [[2022, 'hawthorn']])],
    pav: [...pavRows('d5', [[2022, 'st-kilda', 12]]), ...pavRows('g', [[2022, 'hawthorn', 17]])],
    reviewedArrivals: [{ playerId: 'g', clubId: 'hawthorn', season: 2022 }],
  };
  const PROJECTED = [
    'single_source_pick_outcome',
    'traded_on_return_estimated_from_projection',
    'traded_on_return_provisional',
  ];
  const projectedLegs = [
    { transferId: 'tr-B2', source: 'pick_projection', value: p30 },
    { transferId: 'tr-B3', source: 'pick_projection', value: p40 },
    { transferId: 'tr-B4', source: 'pick_projection', value: p50 },
  ];

  it('keeps the projected legs when a valued leg joins the return', () => {
    const allExcluded = legOf(
      gradeAflTradesOnRealizedValue(inputs(gwsShaped(false), data)),
      'tr-A1'
    );
    expect(allExcluded).toMatchObject({
      state: 'valued',
      realizedValue: p30 + p40 + p50,
      onward: {
        returnValue: p30 + p40 + p50,
        returnProjection: { benchmarkId, realizedValue: 0, legs: projectedLegs },
      },
      reasons: PROJECTED,
    });
    const batch = gradeAflTradesOnRealizedValue(inputs(gwsShaped(true), data));
    expect(legOf(batch, 'tr-B5')).toMatchObject({ state: 'valued', realizedValue: 17 });
    // Through v17 pick P fell to 17, pick R's value alone: the three projections counted 0.
    const partial = legOf(batch, 'tr-A1');
    expect(partial).toMatchObject({
      state: 'valued',
      basis: 'pick_traded_on_return',
      realizedValue: 17 + (p30 + p40 + p50),
      onward: {
        transactionId: 'tx-B',
        allocation: 'sole_asset',
        returnValue: 17 + (p30 + p40 + p50),
        share: 1,
        returnProjection: { benchmarkId, realizedValue: 17, legs: projectedLegs },
      },
      reasons: PROJECTED,
    });
    expect(partial.state === 'valued' && partial.realizedValue).toBeGreaterThan(
      allExcluded.state === 'valued' ? allExcluded.realizedValue : Infinity
    );
    // Hawthorn's own tx-B total still counts only the valued leg; only pick P reads projections.
    expect(gradeOf(batch, 'tx-B').clubs).toContainEqual({
      clubId: 'hawthorn',
      received: 17,
      givenUp: 12,
      net: 5,
    });
  });

  it('leaves a partly valued return unallocated when an excluded leg has no projection', () => {
    // Pick 50 is a rookie-draft pick, so its value is unknown even beside R's 17 and two projections.
    const batch = gradeAflTradesOnRealizedValue(
      inputs(unprojected(gwsShaped(true), 'tr-B4'), data)
    );
    expect(legOf(batch, 'tr-B4')).toMatchObject({
      state: 'excluded',
      atTrade: { kind: 'unavailable', reason: 'pick_outside_projection_domain' },
    });
    expect(legOf(batch, 'tr-A1')).toMatchObject({
      state: 'excluded',
      basis: 'pick_traded_on_return_unallocated',
      onwardTransactionId: 'tx-B',
      reasons: ['single_source_pick_outcome', 'traded_on_return_unallocated'],
    });
  });

  it('states rule v17’s capped estimate when it sits beside a valued leg', () => {
    const candidate = gwsShaped(true);
    candidate.transfers = candidate.transfers.map((transfer) =>
      transfer.transferId === 'tr-B4'
        ? pick('tr-B4', 'tx-B', 'st-kilda', 'hawthorn', 'pick-Q50', 2021, 95)
        : transfer
    );
    const p90 = hpnDpv3ValueForPick(90);
    expect(legOf(gradeAflTradesOnRealizedValue(inputs(candidate, data)), 'tr-A1')).toMatchObject({
      state: 'valued',
      realizedValue: 17 + (p30 + p40 + p90),
      onward: {
        returnProjection: {
          realizedValue: 17,
          legs: [
            projectedLegs[0],
            projectedLegs[1],
            { transferId: 'tr-B4', source: 'pick_projection_domain_capped', value: p90 },
          ],
        },
      },
      reasons: ['projection_domain_capped', ...PROJECTED],
    });
  });

  it('values an upstream hop by the pick its club got back for a partly projected return', () => {
    // Gold Coast sends pick X to Hawthorn in tx-0; Hawthorn gives X to Melbourne in tx-A for pick
    // P, worth tx-B's v18 return. X is worth what P was, at realized value: P is a valued leg.
    const candidate = gwsShaped(true);
    candidate.transactions.push(trade('tx-0', 2020));
    candidate.transfers.push(
      pick('tr-01', 'tx-0', 'gold-coast', 'hawthorn', 'pick-X', 2021, 10),
      pick('tr-A2', 'tx-A', 'hawthorn', 'melbourne', 'pick-X', 2021, 10)
    );
    candidate.pickOutcomes!.push(
      outcome('tr-01', { disposition: 'traded_on' }),
      outcome('tr-A2', {
        disposition: 'not_used',
        nominationBasis: 'club_took_no_nominated_player',
        receivingClubNominatedSelections: 0,
      })
    );
    const batch = gradeAflTradesOnRealizedValue(inputs(candidate, data));
    const value = 17 + (p30 + p40 + p50);
    expect(legOf(batch, 'tr-A1')).toMatchObject({ state: 'valued', realizedValue: value });
    const upstream = legOf(batch, 'tr-01');
    expect(upstream).toMatchObject({
      state: 'valued',
      basis: 'pick_traded_on_return',
      realizedValue: value,
      onward: { transactionId: 'tx-A', allocation: 'sole_asset', returnValue: value, share: 1 },
      reasons: ['single_source_pick_outcome', 'traded_on_return_provisional'],
    });
    expect('onward' in upstream && upstream.onward.returnProjection).toBeUndefined();
  });
});
