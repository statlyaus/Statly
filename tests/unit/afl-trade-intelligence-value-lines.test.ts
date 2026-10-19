import { describe, expect, it, vi } from 'vitest';

import { storeLocalAflTradeEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';
import {
  buildAflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGamesRows,
} from '@/server/aflTradeIntelligence/modeling/playerSeasonGames';
import type {
  AflTradeTradedPlayerValueEvaluator,
  AflTradeTradedPlayerValueInput,
} from '@/server/aflTradeIntelligence/modeling/tradedPlayerValueLineContracts';
import {
  aflTradeValueLinePointAt,
  aflTradeValueLineSlotCurve,
  fitAflTradeValueLine,
  type AflTradeValueLineFitSelection,
} from '@/server/aflTradeIntelligence/modeling/valueLineFit';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeAssetLedgerReadModel } from '@/server/aflTradeIntelligence/valuation/assetLedger';
import type { AflTradeAssetLedgerStint } from '@/server/aflTradeIntelligence/valuation/assetLedgerContracts';
import type {
  AflTradeValueLineCheckpoint,
  AflTradeValueLines,
} from '@/server/aflTradeIntelligence/valuation/valueLineContracts';
import {
  computeAflTradeValueLines,
  type AflTradeValueLineInputs,
} from '@/server/aflTradeIntelligence/valuation/valueLines';

import {
  parseComputeValueLinesArguments,
  storeValueLines,
} from '../../Scripts/compute-value-lines';

vi.mock('@/server/aflTradeIntelligence/development/localEvidenceStorage', () => ({
  storeLocalAflTradeEvidence: vi.fn(async () => ({ custody: 'recorded' })),
}));

const METHOD = `hpn-pav-method:${'b'.repeat(64)}`;
const CANDIDATE = `external-reconciliation:${'c'.repeat(64)}`;
const LAST = 2026;
const range = (from: number, through: number) =>
  Array.from({ length: through - from + 1 }, (_, index) => from + index);
type Row = { season: number; playerId: string; clubId: string; games: number; pav: number };

function gamesModel(rows: readonly Row[], seasons: readonly number[]) {
  const raw: AflTradePlayerSeasonGamesRows = {
    heads: seasons.map((season) => ({
      season_year: season,
      calculation_id: `hpn-pav-season:${season}`,
      status: 'finalized',
      finalized_at: '2026-10-01T00:00:00.000Z',
    })),
    players: rows.map((row, index) => ({
      season_year: row.season,
      spell_version_id: `acquisition-spell-version:${index}`,
      player_id: row.playerId,
      team_id: row.clubId,
      games_played: row.games,
      total_pav: row.pav,
    })),
    appearances: rows.map((row) => ({
      season_year: row.season,
      player_id: row.playerId,
      club_id: row.clubId,
      matches: row.games,
    })),
  };
  return buildAflTradePlayerSeasonGames({ methodId: METHOD, seasons }, raw);
}

/** A small synthetic league (classes 2011-2024, 40 picks), fitted once for every test. */
function fittedLeague() {
  let state = 11;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const selections: AflTradeValueLineFitSelection[] = [];
  const rows: Row[] = [];
  for (let year = 2011; year <= 2024; year++)
    for (let slot = 1; slot <= 40; slot++) {
      const playerId = `f-${year}-${slot}`;
      const clubId = ['fa', 'fb', 'fc'][(year + slot) % 3]!;
      selections.push({
        selectionId: `s-${year}-${slot}`,
        draftYear: year,
        slot,
        clubId,
        playerId,
      });
      const quality = 1 / (1 + slot / 12);
      const form = 0.6 + 0.8 * next();
      if (next() < 0.12 + slot / 200) continue;
      for (let season = year + 1; season <= LAST; season++) {
        if (next() < 0.05 + (1 - quality) * 0.12) break;
        const games = Math.round(22 * quality * Math.min(1, (season - year) / 3) * (0.5 + next()));
        if (games > 0)
          rows.push({ season, playerId, clubId, games, pav: games * 0.6 * quality * form });
      }
    }
  return fitAflTradeValueLine({ selections, games: gamesModel(rows, range(2012, LAST)) });
}
const FIT = fittedLeague();
const PARAMETERS = FIT.content.parameters;
const V = (slot: number) =>
  aflTradeValueLinePointAt(aflTradeValueLineSlotCurve(PARAMETERS, slot), PARAMETERS, [], 0).value;

/** Each test player's seasons: [player, club, season, games, pav]. */
const BASE_ROWS: Row[] = [
  // X: drafted 2016, at B, traded to A in 2019.
  ...[2018, 2019].map((season) => ({ season, playerId: 'x', clubId: 'b', games: 18, pav: 8 })),
  ...range(2020, LAST).map((season) => ({
    season,
    playerId: 'x',
    clubId: 'a',
    games: 20,
    pav: 10,
  })),
  // D1: pick 1 (used at 10 by B in 2019) plays 2020, then three empty seasons.
  { season: 2020, playerId: 'd1', clubId: 'b', games: 15, pav: 6 },
  // D2: pick 2 (used at 12 by C in 2020).
  ...range(2021, LAST).map((season) => ({
    season,
    playerId: 'd2',
    clubId: 'c',
    games: 12,
    pav: 5,
  })),
  // Y: at C, traded to B in 2020; negative PAV, moves to A in 2023.
  ...range(2021, 2023).map((season) => ({
    season,
    playerId: 'y',
    clubId: 'b',
    games: 10,
    pav: -2,
  })),
  { season: 2023, playerId: 'y', clubId: 'a', games: 5, pav: 1 },
  // N: the matched-bid nominee C took at 3 in 2021.
  ...range(2022, LAST).map((season) => ({
    season,
    playerId: 'n',
    clubId: 'c',
    games: 22,
    pav: 12,
  })),
];

const transferId = (name: string) => `external-transfer:${name.padEnd(64, '0')}`;
const pickId = (name: string) => `draft-pick:${name.padEnd(64, '0')}`;

function pickTransfer(
  name: string,
  pick: string,
  draftYear: number,
  nominalPick: number | null,
  round = 1,
  originalClubId = 'a'
) {
  return {
    transferId: transferId(name),
    asset: {
      kind: 'pick_entitlement' as const,
      pickId: pickId(pick),
      draftYear,
      draftType: 'national',
      nominalRound: round,
      nominalPick,
      originalClubId,
      recordedLabel: null,
    },
  };
}

interface Options {
  rows?: Row[];
  special?: boolean;
  custody?: { draftYear: number; recordedPickNumber: number }[];
  oldPick?: boolean;
  /** Ledger stint ends by `player|club|fromSeason`, overriding the fixture's. */
  ends?: Record<string, number>;
}

function inputs(options: Options = {}): AflTradeValueLineInputs {
  const rows = options.rows ?? BASE_ROWS;
  const seasons = options.oldPick ? range(2005, LAST) : range(2018, LAST);
  const games = gamesModel(rows, seasons);
  const stint = (
    playerId: string,
    clubId: string,
    fromSeason: number,
    fixtureEnd: number | null = null
  ): AflTradeAssetLedgerStint => {
    const endSeason = options.ends?.[`${playerId}|${clubId}|${fromSeason}`] ?? fixtureEnd;
    const through = endSeason ?? LAST;
    const counted = range(fromSeason, through).map((season) => ({
      season,
      pav: rows
        .filter(
          (row) => row.playerId === playerId && row.clubId === clubId && row.season === season
        )
        .reduce((sum, row) => sum + row.pav, 0),
      official: true,
    }));
    const total = counted.reduce((sum, { pav }) => sum + pav, 0);
    return {
      clubId,
      startSeason: fromSeason,
      endSeason,
      status: endSeason === null ? 'open' : 'closed',
      arrivalReviewed: true,
      beganBeforeCoverage: false,
      seasons: counted,
      seasonsMissingPav: [],
      total,
      value: Math.max(0, total),
    };
  };
  const stints: Record<string, AflTradeAssetLedgerStint> = {
    'x|a|2020': stint('x', 'a', 2020),
    'y|b|2021': stint('y', 'b', 2021, 2023),
  };
  const picks = [
    {
      pickId: pickId('p1'),
      draftYear: 2019,
      outcome: {
        kind: 'selected',
        selectionId: 's1',
        playerId: 'd1',
        clubId: 'b',
        selectionNumber: 10,
        firstStint: stint('d1', 'b', 2020),
      },
    },
    {
      pickId: pickId('p2'),
      draftYear: 2020,
      outcome: {
        kind: 'selected',
        selectionId: 's2',
        playerId: 'd2',
        clubId: 'c',
        selectionNumber: 12,
        firstStint: stint('d2', 'c', 2021),
      },
    },
    {
      pickId: pickId('p3'),
      draftYear: 2021,
      outcome: {
        kind: 'matched_bid',
        basis: 'board_matched_bid',
        matchedBidBoardPickIds: [],
        status: 'shared',
        bidMatchId: 'bid-1',
        nomineePlayerId: 'n',
        countedPoints: 600,
        share: 0.6,
        use: 'partial',
        value: null,
      },
    },
    { pickId: pickId('p4'), draftYear: 2021, outcome: { kind: 'not_used' } },
    ...(options.oldPick
      ? [
          {
            pickId: pickId('p9'),
            draftYear: 2005,
            outcome: {
              kind: 'selected',
              selectionId: 's9',
              playerId: 'old',
              clubId: 'c',
              selectionNumber: 5,
              firstStint: stint('old', 'c', 2006),
            },
          },
        ]
      : []),
  ];
  const ledger = {
    ledger: {
      ledgerId: 'asset-ledger:test',
      content: {
        inputs: {
          candidateId: CANDIDATE,
          pavCalculations: seasons.map((season) => ({
            season,
            calculationId: `hpn-pav-season:${season}`,
            official: true,
          })),
        },
        picks,
        bidMatches: [
          {
            bidMatchId: 'bid-1',
            draftYear: 2021,
            selectionNumber: 3,
            clubId: 'c',
            nominee: { selectionId: 'sn', playerId: 'n', firstStint: stint('n', 'c', 2022) },
          },
        ],
      },
    },
    stintValue: (playerId: string, clubId: string, fromSeason: number) =>
      stints[`${playerId}|${clubId}|${fromSeason}`] ?? stint(playerId, clubId, fromSeason),
  } as unknown as Pick<AflTradeAssetLedgerReadModel, 'ledger' | 'stintValue'>;
  const l3 = options.special
    ? {
        transferId: transferId('l3'),
        asset: { kind: 'special_entitlement', entitlementId: 'special-draft-entitlement:x' },
      }
    : pickTransfer('l3', 'p2', 2020, null);
  const candidate = {
    transfers: [
      pickTransfer('l1', 'p1', 2019, 5),
      { transferId: transferId('l2'), asset: { kind: 'player', playerId: 'x', recordedName: 'X' } },
      l3,
      pickTransfer('l4', 'p2', 2020, 12),
      { transferId: transferId('l5'), asset: { kind: 'player', playerId: 'y', recordedName: 'Y' } },
      pickTransfer('l6', 'p3', 2021, 20),
      pickTransfer('l7', 'p4', 2021, 40, 3, 'c'),
      ...(options.oldPick ? [pickTransfer('l9', 'p9', 2005, 5)] : []),
    ],
    pickCustody: (options.custody ?? [{ draftYear: 2020, recordedPickNumber: 14 }]).map(
      (row, index) => ({
        custodyId: `external-pick-custody:${index}`,
        pickId: pickId('p2'),
        observedAt: '2020-10-01T00:00:00.000Z',
        draftYear: row.draftYear,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: row.recordedPickNumber,
        originalClubId: 'a',
        currentClubId: 'b',
        status: 'single_source',
        evidenceIds: [],
      })
    ),
    draftBoardPicks: [],
    draftSelections: [
      {
        selectionId: 'sx',
        draftYear: 2016,
        draftType: 'national',
        playerId: 'x',
        status: 'corroborated',
      },
    ],
  } as unknown as AflTradeValueLineInputs['candidate'];
  const leg = (
    name: string,
    assetKind: 'player' | 'pick',
    sendingClubId: string,
    receivingClubId: string,
    extra: object = {}
  ) => ({
    transferId: transferId(name),
    assetKind,
    sendingClubId,
    receivingClubId,
    basis:
      assetKind === 'player'
        ? ('player_first_stint' as const)
        : ('pick_selected_first_stint' as const),
    ...extra,
  });
  const trades = [
    {
      transactionId: 't1',
      tradeYear: 2019,
      clubs: [{ clubId: 'a' }, { clubId: 'b' }],
      legs: [
        leg('l1', 'pick', 'a', 'b'),
        leg('l2', 'player', 'b', 'a'),
        leg('l3', 'pick', 'a', 'b', {
          onward: { transactionId: 't2' },
          ...(options.special
            ? { specialEntitlement: { successorTransferId: transferId('l4') } }
            : {}),
        }),
      ],
    },
    {
      transactionId: 't2',
      tradeYear: 2020,
      clubs: [{ clubId: 'b' }, { clubId: 'c' }],
      legs: [leg('l4', 'pick', 'b', 'c'), leg('l5', 'player', 'c', 'b')],
    },
    {
      transactionId: 't3',
      tradeYear: 2021,
      clubs: [{ clubId: 'a' }, { clubId: 'c' }],
      legs: [
        leg('l6', 'pick', 'a', 'c'),
        leg('l7', 'pick', 'c', 'a'),
        ...(options.oldPick ? [leg('l9', 'pick', 'a', 'c')] : []),
      ],
    },
  ];
  return {
    fit: FIT,
    ledger,
    games,
    candidateId: CANDIDATE,
    candidate,
    batch: {
      batchId: 'realized-trade-grade-batch:test',
      content: {
        inputs: {
          candidateId: CANDIDATE,
          pavCalculations: seasons.map((season) => ({
            season,
            calculationId: `hpn-pav-season:${season}`,
          })),
        },
        trades,
      },
    },
    throughSeason: LAST,
  };
}

const at = (kind: AflTradeValueLineCheckpoint['kind'], season: number) => ({ kind, season });
const asset = (lines: AflTradeValueLines, key: string) =>
  lines.content.assets.find(({ assetKey }) => assetKey === key)!;
const pointOf = (lines: AflTradeValueLines, key: string, checkpoint: AflTradeValueLineCheckpoint) =>
  asset(lines, key).points.find(
    (point) =>
      point.checkpoint.kind === checkpoint.kind && point.checkpoint.season === checkpoint.season
  )!;
const trade = (lines: AflTradeValueLines, id: string) =>
  lines.content.trades.find(({ transactionId }) => transactionId === id)!;
const PLAYER_X = 'player|x|a|2020';
const P = (name: string) => `pick|${pickId(name)}`;

/** A stand-in traded-player fit: one PAV per season still to come, reading only the checkpoint. */
function stubEvaluator(
  seen: AflTradeTradedPlayerValueInput[] = []
): AflTradeTradedPlayerValueEvaluator {
  return {
    parameters: {
      fitId: 'traded-player-value-line-fit:stub',
    } as AflTradeTradedPlayerValueEvaluator['parameters'],
    valueAt: (parameters, input, checkpointSeason) => {
      seen.push(input);
      const produced = input.stint.seasons.reduce((sum, { pav }) => sum + pav, 0);
      const expectedRemaining = 2030 - checkpointSeason;
      return {
        fitId: parameters.fitId,
        checkpointSeason,
        tenure: checkpointSeason - input.tradeSeason,
        state: 'open',
        closeReason: null,
        produced,
        expectedRemaining,
        value: produced + expectedRemaining,
        stageAtTrade: input.tradeSeason - input.stage.originSeason,
        stageBasis: input.stage.basis,
        leftCensored: input.stage.leftCensored,
        effect: { games: 0, rate: 0, seasons: 0, gamesPlayed: 0 },
      };
    },
  };
}

describe('computeAflTradeValueLines', () => {
  const lines = computeAflTradeValueLines(inputs());
  const withFit = computeAflTradeValueLines({ ...inputs(), tradedPlayers: stubEvaluator() });

  it('keeps every trade zero-sum at every checkpoint, the at-trade view included', () => {
    for (const result of [lines, withFit])
      for (const { clubs } of result.content.trades) {
        const sum = (pick: (club: (typeof clubs)[number]) => number) =>
          clubs.reduce((total, club) => total + pick(club), 0);
        expect(sum((club) => club.atTrade.net)).toBeCloseTo(0, 6);
        clubs[0]!.points.forEach((_, index) =>
          expect(sum((club) => club.points[index]!.net)).toBeCloseTo(0, 6)
        );
      }
  });

  it('values a pick at its at-trade slot before the draft, never its eventual selection', () => {
    const l1 = trade(lines, 't1').legs.find(({ transferId: id }) => id === transferId('l1'))!;
    expect(l1.atTrade).toMatchObject({
      state: 'pick',
      slot: { selectionNumber: 5, source: 'stated_at_trade' },
    });
    expect(l1.atTrade.value).toBeCloseTo(V(5), 6);
    const draft = pointOf(lines, P('p1'), at('draft', 2019));
    expect(draft).toMatchObject({
      state: 'open',
      tenure: 0,
      slot: { selectionNumber: 10, source: 'used_selection' },
    });
    expect(draft.value).toBeCloseTo(V(10), 6);
    // Rule v6: a future pick with no stated number takes its live-order slot at the trade.
    const l3 = trade(lines, 't1').legs.find(({ transferId: id }) => id === transferId('l3'))!;
    expect(l3.atTrade.slot).toEqual({ selectionNumber: 14, source: 'order' });
    // Its line before the draft follows its latest hop: t2 states 12.
    expect(pointOf(lines, P('p2'), at('season_end', 2020)).slot).toEqual({
      selectionNumber: 14,
      source: 'order',
    });
    expect(pointOf(lines, P('p2'), at('draft', 2020)).slot).toEqual({
      selectionNumber: 12,
      source: 'used_selection',
    });
    const t2 = trade(lines, 't2').legs.find(({ transferId: id }) => id === transferId('l4'))!;
    expect(t2.atTrade.slot).toEqual({ selectionNumber: 12, source: 'stated_at_trade' });
  });

  it('flags the previous draft order as a proxy slot', () => {
    const proxied = computeAflTradeValueLines(
      inputs({ custody: [{ draftYear: 2019, recordedPickNumber: 16 }] })
    );
    const l3 = trade(proxied, 't1').legs.find(({ transferId: id }) => id === transferId('l3'))!;
    expect(l3.atTrade.slot).toEqual({ selectionNumber: 16, source: 'order_proxy' });
    const unknown = computeAflTradeValueLines(inputs({ custody: [] }));
    const blind = trade(unknown, 't1').legs.find(({ transferId: id }) => id === transferId('l3'))!;
    expect(blind.atTrade).toMatchObject({ state: 'pending', value: null, pending: 'slot_unknown' });
  });

  it('follows a traded-on pick to its final hop', () => {
    const special = computeAflTradeValueLines(inputs({ special: true }));
    const l3 = trade(special, 't1').legs.find(({ transferId: id }) => id === transferId('l3'))!;
    expect(l3.assetKey).toBe(P('p2'));
    expect(l3.atTrade.pending).toBe('slot_unknown');
    const line = pointOf(special, P('p2'), at('season_end', 2024));
    expect(line).toMatchObject({ state: 'open', tenure: 4 });
    const b = trade(special, 't1').clubs.find(({ clubId }) => clubId === 'b')!;
    const p1 = pointOf(special, P('p1'), at('season_end', 2024)).value!;
    const bAt2024 = b.points.find(
      ({ checkpoint }) => checkpoint.kind === 'season_end' && checkpoint.season === 2024
    )!;
    expect(bAt2024.pending).toEqual([
      { assetKey: PLAYER_X, direction: 'given', reason: 'traded_player_fit_not_stored' },
    ]);
    expect(bAt2024.net).toBeCloseTo(p1 + line.value!, 6);
  });

  it('closes a drafted stint after three empty seasons at exactly what it produced', () => {
    expect(pointOf(lines, P('p1'), at('season_end', 2022))).toMatchObject({
      state: 'open',
      tenure: 3,
    });
    expect(pointOf(lines, P('p1'), at('season_end', 2023))).toMatchObject({
      state: 'closed',
      value: 6,
      produced: 6,
      expectedRemaining: 0,
      tenure: 4,
    });
    expect(pointOf(lines, P('p1'), at('season_end', LAST)).value).toBe(6);
  });

  it('keeps an inactivity closure: a game after three empty seasons is not first-stint PAV', () => {
    const rows = [...BASE_ROWS, { season: 2024, playerId: 'd1', clubId: 'b', games: 9, pav: 4 }];
    const comeback = computeAflTradeValueLines(inputs({ rows }));
    for (const season of [2023, 2024, LAST])
      expect(pointOf(comeback, P('p1'), at('season_end', season))).toMatchObject({
        state: 'closed',
        value: 6,
        produced: 6,
        expectedRemaining: 0,
      });
  });

  it('closes a ledger-ended stint only once the season that reveals the move is read', () => {
    // Y leaves B for A in 2023 without a game for B that season: the ledger counts B through 2022.
    const rows = BASE_ROWS.filter(
      (row) => !(row.playerId === 'y' && row.clubId === 'b' && row.season === 2023)
    );
    const moved = computeAflTradeValueLines(inputs({ rows, ends: { 'y|b|2021': 2022 } }));
    expect(pointOf(moved, 'player|y|b|2021', at('season_end', 2022))).toMatchObject({
      state: 'pending',
      produced: -4,
    });
    expect(pointOf(moved, 'player|y|b|2021', at('season_end', 2023))).toMatchObject({
      state: 'closed',
      value: -4,
      produced: -4,
    });
    // D2 leaves C for A in 2024: his pick's line stays open through 2023 and closes in 2024.
    const d2Rows = [
      ...BASE_ROWS.filter((row) => !(row.playerId === 'd2' && row.season >= 2024)),
      ...range(2024, LAST).map((season) => ({
        season,
        playerId: 'd2',
        clubId: 'a',
        games: 12,
        pav: 5,
      })),
    ];
    const left = computeAflTradeValueLines(inputs({ rows: d2Rows, ends: { 'd2|c|2021': 2023 } }));
    const open = aflTradeValueLinePointAt(
      aflTradeValueLineSlotCurve(PARAMETERS, 12),
      PARAMETERS,
      range(2021, 2023).map((season) => ({ tenure: season - 2020, games: 12, pav: 5 })),
      3
    );
    const at2023 = pointOf(left, P('p2'), at('season_end', 2023));
    expect(at2023.state).toBe('open');
    expect(at2023.value).toBeCloseTo(open.value, 6);
    expect(pointOf(left, P('p2'), at('season_end', 2024))).toMatchObject({
      state: 'closed',
      value: 15,
      produced: 15,
      expectedRemaining: 0,
    });
  });

  it('values a matched-bid pick at its own slot until the bid, then its share of the nominee', () => {
    const l6 = trade(lines, 't3').legs.find(({ transferId: id }) => id === transferId('l6'))!;
    expect(l6.atTrade.value).toBeCloseTo(V(20), 6);
    expect(pointOf(lines, P('p3'), at('draft', 2021))).toMatchObject({
      slot: { selectionNumber: 3, source: 'bid_selection' },
    });
    expect(pointOf(lines, P('p3'), at('draft', 2021)).value).toBeCloseTo(0.6 * V(3), 6);
    const nominee = aflTradeValueLinePointAt(
      aflTradeValueLineSlotCurve(PARAMETERS, 3),
      PARAMETERS,
      range(2022, 2024).map((season) => ({ tenure: season - 2021, games: 22, pav: 12 })),
      3
    );
    const point = pointOf(lines, P('p3'), at('season_end', 2024));
    expect(point.value).toBeCloseTo(0.6 * nominee.value, 6);
    expect(point.produced).toBeCloseTo(0.6 * 36, 6);
  });

  it('values a pick not used at its slot until the draft, then 0', () => {
    const l7 = trade(lines, 't3').legs.find(({ transferId: id }) => id === transferId('l7'))!;
    expect(l7.atTrade.value).toBeCloseTo(V(40), 6);
    expect(pointOf(lines, P('p4'), at('draft', 2021))).toMatchObject({
      state: 'not_used',
      value: 0,
    });
  });

  it('keeps signed values: a closed traded stint is exactly what it produced', () => {
    expect(pointOf(lines, 'player|y|b|2021', at('season_end', 2023))).toMatchObject({
      state: 'closed',
      value: -6,
      produced: -6,
    });
    expect(pointOf(lines, 'player|y|b|2021', at('season_end', 2022))).toMatchObject({
      state: 'pending',
      produced: -4,
    });
  });

  it('leaves an open traded stint pending without the traded-player fit, and the net provisional', () => {
    expect(lines.content.inputs.tradedPlayerFitId).toBeNull();
    expect(pointOf(lines, PLAYER_X, at('season_end', 2024))).toMatchObject({
      state: 'pending',
      value: null,
      pending: 'traded_player_fit_not_stored',
      produced: 50,
    });
    expect(trade(lines, 't1').clubs.every(({ atTrade }) => atTrade.provisional)).toBe(true);
    expect(lines.content.summary.provisionalTrades).toBe(1);
    const seen: AflTradeTradedPlayerValueInput[] = [];
    const estimated = computeAflTradeValueLines({
      ...inputs(),
      tradedPlayers: stubEvaluator(seen),
    });
    expect(estimated.content.inputs.tradedPlayerFitId).toBe('traded-player-value-line-fit:stub');
    expect(pointOf(estimated, PLAYER_X, at('season_end', 2024))).toMatchObject({
      state: 'open',
      value: 56,
      produced: 50,
      expectedRemaining: 6,
    });
    const atTrade = trade(estimated, 't1').legs.find(
      ({ transferId: id }) => id === transferId('l2')
    )!.atTrade;
    expect(atTrade).toMatchObject({ state: 'open', tenure: 0, value: 11 });
    expect(trade(estimated, 't1').clubs.some(({ atTrade: net }) => net.provisional)).toBe(false);
    const input = seen.find(
      ({ playerId, career }) => playerId === 'x' && career.at(-1)?.season === 2022
    )!;
    expect(input.stage).toEqual({ basis: 'draft', originSeason: 2016, leftCensored: false });
    expect(input.career.map(({ season }) => season)).toEqual(range(2018, 2022));
    expect(input.stint.seasons.map(({ season }) => season)).toEqual(range(2020, 2022));
  });

  it('reads no season after a checkpoint', () => {
    const changed = BASE_ROWS.map((row) =>
      row.playerId === 'd2' && row.season === 2025 ? { ...row, games: 22, pav: 40 } : row
    );
    const after = computeAflTradeValueLines(inputs({ rows: changed }));
    const before = (result: AflTradeValueLines) =>
      result.content.assets.flatMap(({ assetKey, points }) =>
        points
          .filter(({ checkpoint }) => checkpoint.season < 2025)
          .map((point) => [assetKey, point])
      );
    expect(before(after)).toEqual(before(lines));
    expect(pointOf(after, P('p2'), at('season_end', 2025)).value).not.toBe(
      pointOf(lines, P('p2'), at('season_end', 2025)).value
    );
  });

  it('seals a deterministic content address', () => {
    const again = inputs();
    const reversed = {
      ...again,
      batch: {
        ...again.batch,
        content: { ...again.batch.content, trades: [...again.batch.content.trades].reverse() },
      },
    };
    expect(computeAflTradeValueLines(reversed).valueLinesId).toBe(lines.valueLinesId);
    expect(lines.valueLinesId).toMatch(/^value-lines:[0-9a-f]{64}$/);
    expect(lines.content).toMatchObject({
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('matches the fit: one evaluator for the back-test and the lines', () => {
    for (const { slot, expectedFirstStintPav } of FIT.content.pickCurve.slice(0, 30))
      expect(V(slot)).toBeCloseTo(expectedFirstStintPav, 2);
    const direct = aflTradeValueLinePointAt(
      aflTradeValueLineSlotCurve(PARAMETERS, 12),
      PARAMETERS,
      range(2021, 2024).map((season) => ({ tenure: season - 2020, games: 12, pav: 5 })),
      4
    );
    const point = pointOf(lines, P('p2'), at('season_end', 2024));
    expect(point.value).toBeCloseTo(direct.value, 6);
    expect(point.expectedRemaining).toBeCloseTo(direct.expectedRemaining, 6);
  });

  it('refuses inputs that do not agree', () => {
    const base = inputs();
    const refuse = (change: Partial<AflTradeValueLineInputs>, message: RegExp) =>
      expect(() => computeAflTradeValueLines({ ...base, ...change })).toThrow(message);
    const otherCalculation = base.batch.content.inputs.pavCalculations.map((row) =>
      row.season === 2020 ? { ...row, calculationId: 'hpn-pav-season:other' } : row
    );
    refuse(
      {
        batch: {
          ...base.batch,
          content: {
            ...base.batch.content,
            inputs: { ...base.batch.content.inputs, pavCalculations: otherCalculation },
          },
        },
      },
      /Season 2020: .* pin different HPN PAV calculations/
    );
    refuse(
      { games: { ...base.games, methodId: 'hpn-pav-method:other' } },
      /not of the fit’s HPN PAV method/
    );
    refuse({ throughSeason: LAST + 1 }, /after the fit's last season/);
    refuse({ candidateId: 'external-reconciliation:other' }, /not of the same candidate/);
    refuse({ fit: { ...FIT, fitId: 'value-line-fit:tampered' } }, /content address/);
    expect(() => computeAflTradeValueLines(inputs({ oldPick: true }))).toThrow(
      /past the 20-season horizon/
    );
  });
});

describe('compute-value-lines', () => {
  const loopback = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };
  const argv = [
    '--candidate',
    CANDIDATE,
    '--method',
    METHOD,
    '--seasons',
    '2019-2026',
    '--official-seasons',
    '2019-2026',
    '--benchmark',
    'hpn-pick-benchmark:x',
    '--fit',
    '/receipts/fit.json',
    '--through-season',
    '2026',
    '--store-id',
    'statly-grading-1-artifacts',
    '--out',
    '/receipts/value-lines.json',
  ];

  it('parses the grader arguments, the fit and the last season end', () => {
    expect(parseComputeValueLinesArguments(argv, loopback)).toMatchObject({
      candidateId: CANDIDATE,
      fit: '/receipts/fit.json',
      throughSeason: 2026,
      seasons: range(2019, 2026),
      storeId: 'statly-grading-1-artifacts',
      out: '/receipts/value-lines.json',
      dryRun: false,
    });
    const without = (name: string) => {
      const index = argv.indexOf(name);
      return [...argv.slice(0, index), ...argv.slice(index + 2)];
    };
    expect(() => parseComputeValueLinesArguments(without('--fit'), loopback)).toThrow(
      /--fit is required/
    );
    expect(() => parseComputeValueLinesArguments(without('--through-season'), loopback)).toThrow(
      /--through-season is required/
    );
    expect(() =>
      parseComputeValueLinesArguments(
        argv.map((value) => (value === '/receipts/fit.json' ? 'fit.json' : value)),
        loopback
      )
    ).toThrow(/--fit must be an absolute path/);
    expect(() =>
      parseComputeValueLinesArguments(
        argv.map((value, index) =>
          index === argv.indexOf('--through-season') + 1 ? '2025-2026' : value
        ),
        loopback
      )
    ).toThrow(/one season/);
    expect(() => parseComputeValueLinesArguments([...argv, '--fit', '/x.json'], loopback)).toThrow(
      /--fit may be given once/
    );
    expect(() => parseComputeValueLinesArguments(without('--store-id'), loopback)).toThrow(
      /--store-id is required/
    );
    expect(
      parseComputeValueLinesArguments([...without('--store-id'), '--dry-run'], loopback).dryRun
    ).toBe(true);
    expect(() =>
      parseComputeValueLinesArguments(argv, {
        AFL_OUTCOMES_DATABASE_URL: 'postgresql://x:y@db.example.com:5432/outcomes',
      })
    ).toThrow();
  });

  it('stores the value lines as private derived output in their own repository', async () => {
    const client = {} as AflOutcomeSqlClient;
    const bytes = new TextEncoder().encode('{"valueLinesId":"x"}');
    await storeValueLines(client, 'statly-grading-1-artifacts', bytes);
    expect(storeLocalAflTradeEvidence).toHaveBeenCalledWith(client, {
      storeId: 'statly-grading-1-artifacts',
      repositoryId: 'value-lines',
      artifactClass: 'derived_private',
      bytes,
      mediaType: 'application/json',
      maximumObjectBytes: 64 * 1024 * 1024,
    });
  });
});
