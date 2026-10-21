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
import {
  gradeAflTradesOnRealizedValue,
  type AflTradeRealizedTradeGradeInputs,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeGrade';
import {
  buildAflTradeStructure,
  type AflTradeStructureInputs,
} from '@/server/aflTradeIntelligence/valuation/tradeStructure';
import {
  createAflTradeStructure,
  type AflTradeStructureLeg,
} from '@/server/aflTradeIntelligence/valuation/tradeStructureContracts';
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
const ENTITLEMENT = `special-draft-entitlement:${'e'.repeat(64)}`;

/** A candidate transfer: its trade and clubs, then its asset. */
const moved = (name: string, transactionId: string, from: string, to: string, asset: object) => ({
  transferId: transferId(name),
  transactionId,
  fromClubId: from,
  toClubId: to,
  asset,
  status: 'single_source',
  evidenceIds: [],
});

function pickTransfer(
  name: string,
  transactionId: string,
  from: string,
  to: string,
  pick: string,
  draftYear: number,
  nominalPick: number | null,
  round = 1,
  originalClubId = 'a'
) {
  return moved(name, transactionId, from, to, {
    kind: 'pick_entitlement' as const,
    pickId: pickId(pick),
    draftYear,
    draftType: 'national',
    nominalRound: round,
    nominalPick,
    originalClubId,
    recordedLabel: null,
  });
}

/** Rule v7: l3's reviewed custody chain names l4 as its successor. */
const SPECIAL_CUSTODY = [
  { transferId: transferId('l3'), entitlementId: ENTITLEMENT, predecessorTransferId: null },
  {
    transferId: transferId('l4'),
    entitlementId: ENTITLEMENT,
    predecessorTransferId: transferId('l3'),
  },
];

interface Options {
  rows?: Row[];
  /** l3 is a special entitlement whose reviewed custody successor is l4. */
  special?: boolean;
  /** The player C sends B in t2 is unresolved, so the batch blocked B's side of t2. */
  unresolvedPears?: boolean;
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
  // t1 (2019): A gives B p1 and p2 (l3, traded on in t2) for X. t2 (2020): B gives C p2 for Y.
  // t3 (2021): A gives C the matched-bid pick p3 for the unused p4.
  const l3 = options.special
    ? moved('l3', 't1', 'a', 'b', { kind: 'special_entitlement', entitlementId: ENTITLEMENT })
    : pickTransfer('l3', 't1', 'a', 'b', 'p2', 2020, null);
  const player = (name: string, transactionId: string, from: string, to: string, id: string) =>
    moved(name, transactionId, from, to, { kind: 'player', playerId: id, recordedName: id });
  const transaction = (transactionId: string, seasonYear: number) => ({
    transactionId,
    providerEventId: transactionId,
    seasonYear,
    occurredOn: null,
    transactionType: 'trade',
  });
  const candidate = {
    transactions: [transaction('t1', 2019), transaction('t2', 2020), transaction('t3', 2021)],
    transfers: [
      pickTransfer('l1', 't1', 'a', 'b', 'p1', 2019, 5),
      player('l2', 't1', 'b', 'a', 'x'),
      l3,
      pickTransfer('l4', 't2', 'b', 'c', 'p2', 2020, 12),
      options.unresolvedPears
        ? moved('l5', 't2', 'c', 'b', { kind: 'player', playerId: null, recordedName: 'Y?' })
        : player('l5', 't2', 'c', 'b', 'y'),
      pickTransfer('l6', 't3', 'a', 'c', 'p3', 2021, 20),
      pickTransfer('l7', 't3', 'c', 'a', 'p4', 2021, 40, 3, 'c'),
      ...(options.oldPick ? [pickTransfer('l9', 't3', 'a', 'c', 'p9', 2005, 5)] : []),
    ],
    pickOutcomes: [
      {
        outcomeId: 'outcome-l3',
        transferId: transferId('l3'),
        disposition: 'traded_on',
        outcomeStatus: 'stated',
        selectionId: null,
        playerId: null,
        evidenceIds: [],
      },
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
  } as unknown as AflTradeValueLineInputs['candidate'] & AflTradeStructureInputs['candidate'];
  const structure = buildAflTradeStructure({
    candidateId: CANDIDATE,
    candidate,
    ...(options.special ? { specialEntitlementCustody: SPECIAL_CUSTODY } : {}),
  });
  return {
    fit: FIT,
    ledger,
    games,
    candidateId: CANDIDATE,
    candidate,
    structure,
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

/**
 * A stand-in traded-player fit: one PAV per season still to come, reading only the checkpoint. It read
 * the fixture's games from 2018, x's 2016 national draft, and x's 2019 and y's 2020 trades.
 */
function stubEvaluator(
  seen: AflTradeTradedPlayerValueInput[] = [],
  extra: Partial<AflTradeTradedPlayerValueEvaluator> = {}
): AflTradeTradedPlayerValueEvaluator {
  return {
    tradeSeasons: range(2019, 2025),
    playerTradeSeasons: new Map([
      ['x', [2019]],
      ['y', [2020]],
    ]),
    draftOrigins: [{ playerId: 'x', draftYear: 2016, draftType: 'national', selectionId: 'sx' }],
    games: inputs().games,
    ...extra,
    parameters: {
      fitId: 'traded-player-value-line-fit:stub',
      firstReadSeason: 2018,
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

  it("takes the traded player's stage and phases as the fit does", () => {
    const inputOf = (extra: Partial<AflTradeTradedPlayerValueEvaluator>) => {
      const seen: AflTradeTradedPlayerValueInput[] = [];
      const result = computeAflTradeValueLines({
        ...inputs(),
        tradedPlayers: stubEvaluator(seen, extra),
      });
      return { result, input: seen.find(({ playerId }) => playerId === 'x') };
    };
    // The merged origins, not the candidate's draft selections: an earlier Draftguru listing wins.
    expect(
      inputOf({
        draftOrigins: [
          { playerId: 'x', draftYear: 2016, draftType: 'national', selectionId: 'sx' },
          {
            playerId: 'x',
            draftYear: 2010,
            draftType: 'rookie',
            selectionId: 'external-evidence:x',
          },
        ],
      }).input?.stage
    ).toEqual({ basis: 'draft', originSeason: 2010, leftCensored: false });
    // No draft: his first game, in the first season read, is a left-censored first game.
    expect(inputOf({ draftOrigins: [] }).input?.stage).toEqual({
      basis: 'first_game',
      originSeason: 2017,
      leftCensored: true,
    });
    // An earlier trade in the window sets the stage origin's trade and the phases.
    const twice = inputOf({
      draftOrigins: [],
      playerTradeSeasons: new Map([
        ['x', [2017, 2019]],
        ['y', [2020]],
      ]),
    }).input!;
    expect(twice.stage).toEqual({
      basis: 'assumed_youngest',
      originSeason: 2016,
      leftCensored: false,
    });
    expect(twice.earlierTradeSeasons).toEqual([2017]);
    expect(inputOf({}).input?.earlierTradeSeasons).toEqual([]);
  });

  it('leaves a traded stint unavailable only where the fit refuses it', () => {
    const lines = (extra: Partial<AflTradeTradedPlayerValueEvaluator>) =>
      computeAflTradeValueLines({ ...inputs(), tradedPlayers: stubEvaluator([], extra) });
    // A trade season the fit did not read.
    expect(
      pointOf(lines({ tradeSeasons: [2020] }), PLAYER_X, at('season_end', 2024))
    ).toMatchObject({ state: 'pending', pending: 'unavailable', produced: 50 });
    // A draft origin at or after his first trade.
    expect(
      pointOf(
        lines({
          draftOrigins: [{ playerId: 'x', draftYear: 2019, draftType: 'rookie', selectionId: 's' }],
        }),
        PLAYER_X,
        at('season_end', 2024)
      )
    ).toMatchObject({ state: 'pending', pending: 'unavailable' });
    expect(() => lines({ playerTradeSeasons: new Map([['y', [2020]]]) })).toThrow(
      /has no 2019 trade of x/
    );
  });

  it('refuses a traded-player fit that read other games', () => {
    const base = inputs();
    const refuse = (extra: Partial<AflTradeTradedPlayerValueEvaluator>, message: RegExp) =>
      expect(() =>
        computeAflTradeValueLines({ ...base, tradedPlayers: stubEvaluator([], extra) })
      ).toThrow(message);
    refuse(
      { games: { ...base.games, methodId: 'hpn-pav-method:other' } },
      /traded-player fit's games are not of the value lines' HPN PAV method/
    );
    refuse(
      {
        games: {
          ...base.games,
          seasons: base.games.seasons.map((row) =>
            row.season === 2021 ? { ...row, calculationId: 'hpn-pav-season:other' } : row
          ),
        },
      },
      /Season 2021: the traded-player fit's games pin another HPN PAV calculation/
    );
    refuse(
      {
        games: gamesModel(
          BASE_ROWS.filter(({ season }) => season >= 2019),
          range(2019, LAST)
        ),
      },
      /traded-player fit's games do not start at its first read season 2018/
    );
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

  it('seals a deterministic content address over the trade structure it read', () => {
    const again = inputs();
    // The same candidate in any order gives the same structure, so the same value lines.
    const candidate = {
      ...again.candidate,
      transfers: [...again.candidate.transfers].reverse(),
    } as typeof again.candidate & AflTradeStructureInputs['candidate'];
    const reordered = {
      ...again,
      candidate,
      structure: buildAflTradeStructure({ candidateId: CANDIDATE, candidate }),
    };
    expect(reordered.structure.structureId).toBe(again.structure.structureId);
    expect(computeAflTradeValueLines(reordered).valueLinesId).toBe(lines.valueLinesId);
    expect(lines.valueLinesId).toMatch(/^value-lines:[0-9a-f]{64}$/);
    expect(lines.content).toMatchObject({
      schemaVersion: 'afl-trade-value-lines/v2',
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(lines.content.inputs.structureId).toBe(again.structure.structureId);
    expect(lines.content.inputs).not.toHaveProperty('batchId');
    expect(lines.content.limitation).toMatch(/trade structure/);
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
    // The ledger, fit and games read model must pin one calculation per season (the batch pin is gone).
    const ledgerContent = base.ledger.ledger.content;
    refuse(
      {
        ledger: {
          ...base.ledger,
          ledger: {
            ...base.ledger.ledger,
            content: {
              ...ledgerContent,
              inputs: {
                ...ledgerContent.inputs,
                pavCalculations: ledgerContent.inputs.pavCalculations.map((row) =>
                  row.season === 2020 ? { ...row, calculationId: 'hpn-pav-season:other' } : row
                ),
              },
            },
          },
        },
      },
      /Season 2020: .* pin different HPN PAV calculations/
    );
    // The structure is sealed: content changed under its id (the summary still counts), or another
    // candidate's structure, is refused.
    const [first, ...rest] = base.structure.content.trades;
    refuse(
      {
        structure: {
          ...base.structure,
          content: {
            ...base.structure.content,
            trades: [{ ...first!, tradeYear: first!.tradeYear + 1 }, ...rest],
          },
        },
      },
      /Identifier must equal the canonical afl-trade-structure content address/
    );
    refuse(
      {
        structure: buildAflTradeStructure({
          candidateId: `external-reconciliation:${'d'.repeat(64)}`,
          candidate: base.candidate as AflTradeStructureInputs['candidate'],
        }),
      },
      /not of the same candidate/
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

describe('value lines on the trade structure (issue 789, step 5)', () => {
  const netAt = (lines: AflTradeValueLines, tradeId: string, clubId: string, season: number) =>
    trade(lines, tradeId)
      .clubs.find((club) => club.clubId === clubId)!
      .points.find(
        ({ checkpoint }) => checkpoint.kind === 'season_end' && checkpoint.season === season
      )!;
  const tradeView = (lines: AflTradeValueLines, tradeId: string) => {
    const { legs, clubs } = trade(lines, tradeId);
    // The legs' at-trade views, and each club's nets: what the trade's result is made of.
    return { legs, clubs };
  };
  const withFit = (options: Parameters<typeof inputs>[0] = {}) =>
    computeAflTradeValueLines({ ...inputs(options), tradedPlayers: stubEvaluator() });

  // The spec's example ("Each trade is zero-sum; chains are linked"): B gets the orange (pick p2,
  // l3) from A in t1 for the apple (X), then trades the orange on to C in t2 for the pears (Y).
  it("leaves trade 1 unchanged when the pears' value changes", () => {
    const base = withFit();
    const pears = BASE_ROWS.map((row) =>
      row.playerId === 'y' && row.clubId === 'b' ? { ...row, pav: row.pav + 5 } : row
    );
    const changed = withFit({ rows: pears });
    expect(tradeView(changed, 't1')).toEqual(tradeView(base, 't1'));
    expect(netAt(changed, 't2', 'b', 2023).net).not.toBeCloseTo(
      netAt(base, 't2', 'b', 2023).net,
      3
    );
  });

  it("moves both trades with the orange's drafted player, and the chain cancels it", () => {
    const base = withFit();
    const orange = BASE_ROWS.map((row) =>
      row.playerId === 'd2' ? { ...row, games: 22, pav: row.pav + 6 } : row
    );
    const changed = withFit({ rows: orange });
    for (const season of [2022, 2024, LAST]) {
      const t1 = netAt(changed, 't1', 'b', season).net - netAt(base, 't1', 'b', season).net;
      const t2 = netAt(changed, 't2', 'b', season).net - netAt(base, 't2', 'b', season).net;
      expect(t1).toBeGreaterThan(0);
      // B received the orange in t1 and gave it in t2: one line, so B's chain is unchanged.
      expect(t1 + t2).toBeCloseTo(0, 6);
      // A gave it in t1: its line moves A's result too, and C's in t2.
      expect(
        netAt(changed, 't1', 'a', season).net - netAt(base, 't1', 'a', season).net
      ).toBeCloseTo(-t1, 6);
      expect(
        netAt(changed, 't2', 'c', season).net - netAt(base, 't2', 'c', season).net
      ).toBeCloseTo(t1, 6);
    }
    // The at-trade view stays fixed and is never subtracted from the result.
    expect(trade(changed, 't1').legs.map(({ atTrade }) => atTrade)).toEqual(
      trade(base, 't1').legs.map(({ atTrade }) => atTrade)
    );
    const b2024 = netAt(changed, 't1', 'b', 2024).net;
    const line = (key: string) => pointOf(changed, key, at('season_end', 2024)).value!;
    expect(b2024).toBeCloseTo(line(P('p1')) + line(P('p2')) - line(PLAYER_X), 6);
  });

  it('follows a special entitlement chain the batch dropped while its onward side was blocked', () => {
    // With the pears unresolved the batch blocked B's side of t2, so its old traded-on valuation of
    // l3 was blocked and the leg carried no successor. The structure still links l3 to l4.
    const options = { special: true, unresolvedPears: true };
    const { structure, candidate } = inputs(options);
    const batch = gradeAflTradesOnRealizedValue({
      candidateId: CANDIDATE,
      candidate: candidate as AflTradeRealizedTradeGradeInputs['candidate'],
      specialEntitlementCustody: SPECIAL_CUSTODY,
      pavCalculations: range(2019, 2021).map((season) => ({
        season,
        calculationId: `hpn-pav-season:${season}`,
        official: true,
      })),
      pav: [],
      seasonSpells: [],
      spellSeasons: range(2019, 2021),
      reviewedArrivals: [],
      pickProjectionBenchmarkId: `hpn-pick-benchmark:${'b'.repeat(64)}`,
      spellCutoffAt: '2026-10-21T00:00:00.000Z',
      gradedAt: '2026-10-21T01:00:00.000Z',
    });
    const graded = batch.content.trades
      .flatMap(({ legs }) => legs)
      .find((leg) => leg.transferId === transferId('l3'))!;
    expect(graded).toMatchObject({ state: 'blocked', reasons: ['traded_on_return_blocked'] });
    expect(graded).not.toHaveProperty('specialEntitlement');
    const l3 = structure.content.trades
      .flatMap(({ legs }) => legs)
      .find((leg) => leg.transferId === transferId('l3'))!;
    expect(l3.onward).toEqual({
      kind: 'special_entitlement_successor',
      transactionId: 't2',
      transferId: transferId('l4'),
      entitlementId: ENTITLEMENT,
    });
    const lines = withFit(options);
    const leg = trade(lines, 't1').legs.find(({ transferId: id }) => id === transferId('l3'))!;
    expect(leg.assetKey).toBe(P('p2'));
    const line = (key: string) => pointOf(lines, key, at('season_end', 2024)).value!;
    expect(netAt(lines, 't1', 'b', 2024).net).toBeCloseTo(
      line(P('p1')) + line(P('p2')) - line(PLAYER_X),
      6
    );
    // B's side of t2 is the orange given and an unresolved player received: provisional, not lost.
    expect(netAt(lines, 't2', 'b', 2024)).toMatchObject({
      provisional: true,
      pending: [
        {
          assetKey: `unresolved|${transferId('l5')}`,
          direction: 'received',
          reason: 'unavailable',
        },
      ],
    });
  });

  it('refuses a structure leg or onward link that does not continue the asset', () => {
    // Any caller can seal a structure, so its legs and links are checked against the candidate.
    const resealed = (
      options: Parameters<typeof inputs>[0],
      change: (leg: AflTradeStructureLeg) => AflTradeStructureLeg
    ) => {
      const base = inputs(options);
      const content = base.structure.content;
      return () =>
        computeAflTradeValueLines({
          ...base,
          structure: createAflTradeStructure({
            ...content,
            trades: content.trades.map((trade) => ({ ...trade, legs: trade.legs.map(change) })),
          }),
        });
    };
    const l3 = transferId('l3');
    // l3 (A to B, pick p2) linked as a pick trail to l7 (C to A, pick p4): another club, another pick.
    expect(
      resealed({}, (leg) =>
        leg.transferId === l3
          ? {
              ...leg,
              onward: { kind: 'pick_trail', transactionId: 't3', transferId: transferId('l7') },
            }
          : leg
      )
    ).toThrow(/does not continue/);
    // l3 linked to l6 (A to C, pick p3): A did not receive l3, and p3 is not p2.
    expect(
      resealed({}, (leg) =>
        leg.transferId === l3
          ? {
              ...leg,
              onward: { kind: 'pick_trail', transactionId: 't3', transferId: transferId('l6') },
            }
          : leg
      )
    ).toThrow(/does not continue/);
    // A special entitlement successor of another entitlement.
    expect(
      resealed({ special: true }, (leg) =>
        leg.onward?.kind === 'special_entitlement_successor'
          ? {
              ...leg,
              onward: {
                ...leg.onward,
                entitlementId: `special-draft-entitlement:${'f'.repeat(64)}`,
              },
            }
          : leg
      )
    ).toThrow(/does not continue/);
    // A pick trail from a special entitlement: the link is not a pick trail.
    expect(
      resealed({ special: true }, (leg) =>
        leg.onward?.kind === 'special_entitlement_successor'
          ? {
              ...leg,
              onward: { kind: 'pick_trail', transactionId: 't2', transferId: transferId('l4') },
            }
          : leg
      )
    ).toThrow(/does not continue/);
    // A leg whose clubs are not its transfer's.
    expect(
      resealed({}, (leg) =>
        leg.transferId === transferId('l1') ? { ...leg, receivingClubId: 'c' } : leg
      )
    ).toThrow(/clubs are not the candidate transfer's/);
  });

  it('keeps every trade zero-sum at every checkpoint, for every structure', () => {
    const variants = [
      {},
      { special: true },
      { unresolvedPears: true },
      { special: true, unresolvedPears: true },
      { custody: [] },
    ];
    for (const options of variants)
      for (const result of [computeAflTradeValueLines(inputs(options)), withFit(options)])
        for (const { clubs, legs } of result.content.trades) {
          expect(legs.length).toBeGreaterThan(0);
          const sum = (pick: (club: (typeof clubs)[number]) => number) =>
            clubs.reduce((total, club) => total + pick(club), 0);
          expect(sum((club) => club.atTrade.net)).toBeCloseTo(0, 6);
          clubs[0]!.points.forEach((_, index) =>
            expect(sum((club) => club.points[index]!.net)).toBeCloseTo(0, 6)
          );
        }
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

  it('takes an optional traded-player fit, an absolute path given once', () => {
    expect(parseComputeValueLinesArguments(argv, loopback).tradedPlayerFit).toBeNull();
    const withFit = [...argv, '--traded-player-fit', '/receipts/traded-player-fit.json'];
    expect(parseComputeValueLinesArguments(withFit, loopback).tradedPlayerFit).toBe(
      '/receipts/traded-player-fit.json'
    );
    expect(() =>
      parseComputeValueLinesArguments([...argv, '--traded-player-fit', 'fit.json'], loopback)
    ).toThrow(/--traded-player-fit must be an absolute path/);
    expect(() =>
      parseComputeValueLinesArguments([...withFit, '--traded-player-fit', '/x.json'], loopback)
    ).toThrow(/--traded-player-fit may be given once/);
    expect(() =>
      parseComputeValueLinesArguments([...argv, '--traded-player-fit'], loopback)
    ).toThrow(/--traded-player-fit needs a value/);
    expect(() =>
      parseComputeValueLinesArguments(
        [...argv, '--traded-player-fit', '/receipts/value-lines.json'],
        loopback
      )
    ).toThrow(/--out must not be the traded-player fit/);
    expect(() =>
      parseComputeValueLinesArguments(
        [...argv, '--traded-player-fit', '/receipts/fit.json'],
        loopback
      )
    ).toThrow(/--traded-player-fit must not be the value-line fit/);
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
