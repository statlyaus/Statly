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

      it('excludes a nominee-spent pick only when the side it would be valued on is known', () => {
        const nominee = chain(true, {
          disposition: 'not_used',
          nominationBasis: 'club_took_nominated_player',
          receivingClubNominatedSelections: 1,
        });
        expect(
          legOf(gradeAflTradesOnRealizedValue(inputs(elsewhere(nominee), chainData)), 'tr-A1')
        ).toMatchObject({
          state: 'excluded',
          reasons: ['single_source_pick_outcome', 'traded_on_return_unallocated'],
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

  it('seals rule v6 and its limitation', () => {
    const batch = gradeAflTradesOnRealizedValue(
      inputs({
        transactions: [trade('tx-1', 2021)],
        transfers: [player('tr-1a', 'tx-1', 'collingwood', 'carlton', 'p1')],
      })
    );
    expect(batch.content.ruleVersion).toBe('afl-trade-realized-grade-rule/v6');
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

  it('values a pending pick at the HPN DPVC v3 value of the slot its pickId holds', () => {
    // Another original club on the row: the pickId match is read first.
    const batch = gradeAflTradesOnRealizedValue(
      inputs(future([order('1', { originalClubId: 'carlton' })]))
    );
    expect(legOf(batch, 'tr-Fa')).toEqual({
      transferId: 'tr-Fa',
      assetKind: 'pick',
      sendingClubId: 'richmond',
      receivingClubId: 'hawthorn',
      atTrade: { kind: 'unavailable', reason: 'future_pick_slot_unknown' },
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
  ])('stays pending, and blocking, with %s', (_label, pickCustody) => {
    expect(legFor(pickCustody)).toMatchObject({
      state: 'blocked',
      basis: 'unavailable',
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
