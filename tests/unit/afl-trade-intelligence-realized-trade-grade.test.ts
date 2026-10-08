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
      const blockedOnward = gradeAflTradesOnRealizedValue(
        inputs(chain(false, { disposition: 'not_used', outcomeStatus: 'pending' }), chainData)
      );
      expect(legOf(blockedOnward, 'tr-A1').reasons).toEqual(['traded_on_return_blocked']);
    });

    it('excludes the pick when the onward club spent it on a nominee', () => {
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
      expect(legOf(batch, 'tr-A1')).toMatchObject({
        state: 'excluded',
        basis: 'pick_traded_on_return_unallocated',
        onwardTransactionId: 'tx-B',
        reasons: ['single_source_pick_outcome', 'traded_on_return_unallocated'],
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
