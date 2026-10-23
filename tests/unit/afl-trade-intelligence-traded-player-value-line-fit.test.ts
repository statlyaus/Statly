import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { storeLocalAflTradeEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';
import {
  aflTradeFirstStintGames,
  buildAflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGamesRows,
} from '@/server/aflTradeIntelligence/modeling/playerSeasonGames';
import {
  aflTradeTradedPlayerTradeLegs,
  buildAflTradeTradedPlayerValueLineFitInputs,
  loadAflTradeTradedPlayerDraftOrigins,
  loadAflTradeTradedPlayerDraftguruOrigins,
  mergeAflTradeTradedPlayerDraftOrigins,
} from '@/server/aflTradeIntelligence/modeling/postgresTradedPlayerValueLineFitInputs';
import {
  AFL_TRADE_TRADED_PLAYER_VALUE_LINE_FIT_SCHEMA_VERSION,
  aflTradeTradedPlayerFirstDraftOrigins,
  aflTradeTradedPlayerFitLegInputs,
  aflTradeTradedPlayerStage,
  aflTradeTradedPlayerStageBasisCounts,
  aflTradeTradedPlayerValueAt,
  aflTradeTradedPlayerValueLineParameters,
  fitAflTradeTradedPlayerValueLine,
  type AflTradeTradedPlayerDraftOrigin,
  type AflTradeTradedPlayerFitLeg,
  type AflTradeTradedPlayerValueInput,
  type AflTradeTradedPlayerValueLineFitInputs,
} from '@/server/aflTradeIntelligence/modeling/tradedPlayerValueLineFit';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeTradedPlayerValueEvaluator } from '@/server/aflTradeIntelligence/modeling/tradedPlayerValueLineEvaluator';
import type { AflTradeTradedPlayerValuePoint } from '@/server/aflTradeIntelligence/modeling/tradedPlayerValueLineContracts';
import type { AflTradeValueLineFitParameters } from '@/server/aflTradeIntelligence/modeling/valueLineFit';
import type { AflTradeAssetLedgerStint } from '@/server/aflTradeIntelligence/valuation/assetLedgerContracts';
import { AflTradeValueLineReader } from '@/server/aflTradeIntelligence/valuation/valueLineAssets';
import type { AflTradeGradingInputs } from '@/server/aflTradeIntelligence/valuation/gradingInputs';

import { readTradedPlayerValueLineFit } from '../../Scripts/compute-value-lines';
import {
  parseFitTradedPlayerValueLineArguments,
  runFitTradedPlayerValueLineCommand,
  storeTradedPlayerValueLineFit,
} from '../../Scripts/fit-traded-player-value-line';

vi.mock('@/server/aflTradeIntelligence/development/localEvidenceStorage', () => ({
  storeLocalAflTradeEvidence: vi.fn(async () => ({ custody: 'recorded' })),
}));

const FIRST_READ = 2011;
const LAST_SEASON = 2026;
const TRADE_SEASONS = range(2019, 2025);
const CLUBS = ['adelaide', 'brisbane', 'carlton', 'geelong', 'hawthorn', 'melbourne'];

type Row = { season: number; playerId: string; clubId: string; games: number; pav: number };

function range(from: number, through: number) {
  return Array.from({ length: through - from + 1 }, (_, index) => from + index);
}

/** A seeded linear congruential generator, so the fixture is the same on every run. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Games per season by career stage: rising to stage 4, flat, then falling after stage 10. */
const stageGames = (stage: number) =>
  20 * Math.min(1, stage / 4) * (stage > 10 ? Math.max(0.3, 1 - (stage - 10) * 0.12) : 1);
/** PAV per game by career stage: rising to stage 7, then falling slowly. */
const stageRate = (stage: number) =>
  0.3 * Math.min(1.4, 0.6 + stage * 0.12) * (stage > 11 ? 0.85 : 1);

interface Player {
  playerId: string;
  origin: number;
  drafted: boolean;
  trades: { season: number; to: string; reviewed: boolean }[];
}

/**
 * 900 players of origins 2003 to 2022: an older player at the trade leaves sooner and plays less;
 * each has a fixed form multiplier and availability; some are traded twice, some move on by free
 * agency, and every origin from 2011 has a canonical national draft row for most players.
 */
function fixture(seed = 17) {
  const next = random(seed);
  const players: Player[] = [];
  const rows: Row[] = [];
  for (let index = 0; index < 900; index++) {
    const playerId = `pl-${String(index).padStart(4, '0')}`;
    const origin = 2003 + Math.floor(next() * 20);
    const drafted = origin >= 2011 && next() < 0.85;
    const form = 0.6 + 0.8 * next();
    const availability = 0.6 + 0.4 * next();
    const debutDelay = next() < 0.25 ? 1 : 0;
    const end = origin + 6 + Math.floor(next() * 11);
    let club = CLUBS[index % CLUBS.length]!;
    const firstTrade = Math.max(2019, origin + 1);
    const lastTrade = Math.min(2025, end - 1);
    const trades: Player['trades'] = [];
    if (firstTrade <= lastTrade && next() < 0.75) {
      const season = firstTrade + Math.floor(next() * (lastTrade - firstTrade + 1));
      trades.push({ season, to: '', reviewed: next() < 0.93 });
      if (season + 2 <= lastTrade && next() < 0.2)
        trades.push({ season: season + 2, to: '', reviewed: true });
    }
    if (trades.length === 0) continue;
    const freeAgency = next() < 0.15 ? trades[trades.length - 1]!.season + 2 : null;
    players.push({ playerId, origin, drafted, trades });
    for (let season = Math.max(origin + 1, FIRST_READ); season <= LAST_SEASON; season++) {
      const trade = trades.find((t) => t.season === season - 1);
      if (trade) {
        club = CLUBS[(CLUBS.indexOf(club) + 1 + (index % 3)) % CLUBS.length]!;
        trade.to = club;
      }
      if (season === freeAgency) club = CLUBS[(CLUBS.indexOf(club) + 2) % CLUBS.length]!;
      if (season > end) continue;
      const stage = season - origin;
      if (stage <= debutDelay) continue;
      const games = Math.round(stageGames(stage) * availability * (0.6 + 0.8 * next()));
      if (games > 0)
        rows.push({ season, playerId, clubId: club, games, pav: games * stageRate(stage) * form });
    }
  }
  return { players, rows };
}

function model(rows: readonly Row[], seasons = range(FIRST_READ, LAST_SEASON)) {
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
  return buildAflTradePlayerSeasonGames(
    { methodId: `hpn-pav-method:${'b'.repeat(64)}`, seasons },
    raw
  );
}

/** The ledger stint by the shared stint rule, from appearances alone (no later reviewed arrival). */
function ledgerStint(
  games: AflTradePlayerSeasonGames,
  playerId: string,
  clubId: string,
  fromSeason: number,
  reviewed: boolean
): AflTradeAssetLedgerStint {
  const stint = aflTradeFirstStintGames(games, playerId, clubId, fromSeason);
  return {
    clubId,
    startSeason: fromSeason,
    endSeason: stint.endSeason,
    status: stint.status,
    arrivalReviewed: reviewed,
    beganBeforeCoverage: false,
    seasons: stint.seasons.map(({ season, pav }) => ({ season, pav, official: true })),
    seasonsMissingPav: [],
    total: stint.pav,
    value: Math.max(0, stint.pav),
  };
}

function inputsOf(players: readonly Player[], rows: readonly Row[]) {
  const games = model(rows);
  const legs: AflTradeTradedPlayerFitLeg[] = players.flatMap((player) =>
    player.trades.map((trade, index) => ({
      transferId: `transfer-${player.playerId}-${index}`,
      transactionId: `transaction-${player.playerId}-${index}`,
      tradeSeason: trade.season,
      playerId: player.playerId,
      receivingClubId: trade.to,
      arrivalReviewed: trade.reviewed,
      stint: ledgerStint(games, player.playerId, trade.to, trade.season + 1, trade.reviewed),
    }))
  );
  const draftOrigins: AflTradeTradedPlayerDraftOrigin[] = players
    .filter(({ drafted }) => drafted)
    .map(({ playerId, origin }) => ({
      playerId,
      draftYear: origin,
      draftType: 'national',
      selectionId: `selection-${playerId}`,
    }));
  const inputs: AflTradeTradedPlayerValueLineFitInputs = {
    tradeSeasons: TRADE_SEASONS,
    legs,
    excludedLegs: [
      {
        transferId: 'transfer-unresolved',
        transactionId: 'transaction-unresolved',
        tradeSeason: 2021,
        reason: 'player_identity_unresolved',
      },
    ],
    draftOrigins,
    stintCalculations: range(2019, LAST_SEASON).map((season) => ({
      season,
      calculationId: `hpn-pav-season:${season}`,
    })),
    games,
  };
  return inputs;
}

const { players, rows } = fixture();
const inputs = inputsOf(players, rows);
const fit = fitAflTradeTradedPlayerValueLine(inputs);
const parameters = aflTradeTradedPlayerValueLineParameters(fit);

describe('fitAflTradeTradedPlayerValueLine', () => {
  it('publishes the rules, the fit window and every coefficient', () => {
    const { content } = fit;
    expect(fit.fitId).toMatch(/^traded-player-value-line-fit:[0-9a-f]{64}$/);
    expect(content.schemaVersion).toBe(AFL_TRADE_TRADED_PLAYER_VALUE_LINE_FIT_SCHEMA_VERSION);
    expect(content.fitWindow.tradeSeasons).toEqual({ from: 2019, through: 2025 });
    expect(content.fitWindow.seasons).toHaveLength(16);
    expect(content.fitWindow.firstReadSeason).toBe(2011);
    expect(content.rules.stageBands.map(({ band }) => band)).toEqual([
      '1',
      '2-3',
      '4-5',
      '6-7',
      '8-9',
      '10-11',
      '12-13',
      '14+',
    ]);
    const { survivalHazardLogit, gamesLog, pavPerGameLog } = content.parameters;
    expect(survivalHazardLogit.stageIntercepts.map(({ band }) => band)).toEqual([
      '2-3',
      '4-5',
      '6-7',
      '8-9',
      '10-11',
      '12-13',
      '14+',
    ]);
    expect(survivalHazardLogit.phaseEffects.map(({ phase }) => phase)).toEqual([
      'tenure_1',
      'tenure_2',
      'tenure_3+',
    ]);
    for (const curve of [gamesLog, pavPerGameLog]) {
      expect(curve.stageIntercepts).toHaveLength(8);
      expect(curve.phaseEffects.map(({ phase }) => phase)).toEqual([
        'pre_trade',
        'tenure_1',
        'tenure_2',
        'tenure_3+',
      ]);
      expect(curve.phaseEffects.find(({ phase }) => phase === 'tenure_1')!.effect).toBe(0);
    }
    expect(content.priorTable).toHaveLength(32);
  });

  it('estimates each k from variance components, k_rate on its 10-game guard', () => {
    const { gamesCredibilitySeasons, rateCredibilityGames, varianceComponents } =
      fit.content.parameters;
    expect(varianceComponents.games.between).toBeGreaterThan(0);
    expect(varianceComponents.rate.between).toBeGreaterThan(0);
    expect(gamesCredibilitySeasons).toBeCloseTo(
      varianceComponents.games.within / varianceComponents.games.between,
      5
    );
    expect(rateCredibilityGames).toBeCloseTo(
      Math.max(10, varianceComponents.rate.within / varianceComponents.rate.between),
      5
    );
    // Grouped by player: one group per training player with a known-band season (a left-censored
    // player's seasons below 14+ have none).
    expect(varianceComponents.games.players).toBeGreaterThan(0);
    expect(varianceComponents.games.players).toBeLessThanOrEqual(fit.content.legs.trainingPlayers);
    expect(varianceComponents.rate.weight).toBeGreaterThan(varianceComponents.rate.observations);
  });

  it('sets the prior by career stage: an older player at the trade is worth less', () => {
    const curve = fit.content.atTradeCurve;
    const at = (stage: number) => curve.find(({ stageAtTrade }) => stageAtTrade === stage)!;
    expect(curve[0]!.stageAtTrade).toBe(2);
    expect(at(5).expectedFirstStintPav).toBeGreaterThan(at(12).expectedFirstStintPav);
    expect(at(5).stillInStintAfterSeasons['3']).toBeGreaterThan(
      at(12).stillInStintAfterSeasons['3']
    );
    const table = (band: string, phase: string) =>
      fit.content.priorTable.find((row) => row.band === band && row.phase === phase)!;
    // Survival has no pre-trade phase and no stage band 1.
    expect(table('1', 'tenure_1').hazard).toBeNull();
    expect(table('6-7', 'pre_trade').hazard).toBeNull();
    expect(table('14+', 'tenure_1').hazard).toBeGreaterThan(table('2-3', 'tenure_1').hazard!);
    expect(table('6-7', 'tenure_1').expectedGames).toBeGreaterThan(
      table('14+', 'tenure_1').expectedGames
    );
  });

  it('reports coverage per trade season and every exclusion, never dropping one silently', () => {
    const { legsByTradeSeason } = fit.content.fitWindow;
    expect(legsByTradeSeason.map(({ tradeSeason }) => tradeSeason)).toEqual(TRADE_SEASONS);
    const total = legsByTradeSeason.reduce((sum, row) => sum + row.legs, 0);
    expect(total).toBe(inputs.legs.length + 1);
    const unreviewed = inputs.legs.filter(({ arrivalReviewed }) => !arrivalReviewed).length;
    expect(unreviewed).toBeGreaterThan(0);
    expect(fit.content.legs.unreviewedExcluded).toBe(unreviewed);
    expect(fit.content.legs.unresolvedExcluded).toEqual({
      player_identity_unresolved: 1,
      club_unresolved: 0,
    });
    for (const row of legsByTradeSeason) {
      expect(row.stageDigest).toMatch(/^[0-9a-f]{64}$/);
      const basis = Object.values(row.byStageBasis).reduce((sum, count) => sum + count, 0);
      expect(basis).toBe(row.reviewed + row.unreviewed);
      expect(row.legs).toBe(row.reviewed + row.unreviewed + row.unresolved);
      expect(row.observedSeasons).toBe(LAST_SEASON - row.tradeSeason);
    }
    const { byStageBasis } = fit.content.legs;
    expect(byStageBasis.draft).toBeGreaterThan(0);
    expect(byStageBasis.first_game).toBeGreaterThan(0);
    expect(byStageBasis.first_game_censored).toBeGreaterThan(0);
    // Left-censored pre-trade seasons below the top band, 14+, are out of the curve fit, and counted.
    expect(fit.content.legs.unknownBandSeasonsExcluded).toBeGreaterThan(0);
  });

  it('holds out each trade season with two observed seasons, without its players', () => {
    const { backTest } = fit.content;
    expect(backTest.heldOutTradeSeasons).toEqual(range(2019, 2024));
    // Checkpoint 3 is scored only where more than three seasons are observed.
    expect(backTest.checkpointSeasons).toEqual({
      '0': range(2019, 2024),
      '1': range(2019, 2024),
      '3': range(2019, 2022),
    });
    expect(
      backTest.byStageBandAndCheckpoint.map(({ group, checkpoint }) => `${checkpoint}:${group}`)
    ).toEqual(
      [0, 1, 3].flatMap((checkpoint) =>
        ['2-3', '4-5', '6-7', '8-9', '10-11', '12-13', '14+', 'all'].map(
          (band) => `${checkpoint}:${band}`
        )
      )
    );
    expect(backTest.byStageBasisAndCheckpoint.map(({ group }) => group).slice(0, 5)).toEqual([
      'draft',
      'first_game',
      'first_game_censored',
      'assumed_youngest',
      'all',
    ]);
    const all = (rows: typeof backTest.byStageBandAndCheckpoint, checkpoint: number) =>
      rows.find((row) => row.group === 'all' && row.checkpoint === checkpoint)!;
    const scored = inputs.legs.filter(
      ({ arrivalReviewed, tradeSeason }) => arrivalReviewed && tradeSeason <= 2024
    ).length;
    expect(all(backTest.byStageBandAndCheckpoint, 0).legs).toBe(scored);
    const row = all(backTest.byStageBandAndCheckpoint, 1);
    expect(row.bias).toBeCloseTo(row.meanPredicted - row.meanRealized, 2);
    // The SE of the bias: the residuals' SD over sqrt(n), from RMSE^2 = bias^2 + SD^2 (n - 1 denominator).
    const deviation = Math.sqrt(
      ((row.rootMeanSquaredError ** 2 - row.bias ** 2) * row.legs) / (row.legs - 1)
    );
    expect(row.standardError).toBeCloseTo(deviation / Math.sqrt(row.legs), 1);
    expect(backTest.byVeteranBandsAndCheckpoint.map(({ group }) => group)).toEqual([
      '10+',
      '10+',
      '10+',
    ]);
    for (const baseline of ['producedOnly', 'stageOnly', 'postTradeOwnFormOnly'] as const)
      expect(backTest.baselines[baseline]).toHaveLength(24);
    // Produced-only shows what estimating adds: at the trade it predicts nothing.
    expect(all(backTest.baselines.producedOnly, 0).meanPredicted).toBe(0);
    expect(all(backTest.byStageBandAndCheckpoint, 0).meanAbsoluteError).toBeLessThan(
      all(backTest.baselines.producedOnly, 0).meanAbsoluteError
    );
    expect(backTest.bySeasonAndCheckpoint.length).toBeGreaterThan(0);
    // Veterans the read seasons do not start: left-censored, or drafted before the first read season.
    for (const checkpoint of [0, 1, 3]) {
      const entry = (group: string) =>
        backTest.byEntryAndCheckpoint.find(
          (r) => r.group === group && r.checkpoint === checkpoint
        )!;
      const censored = backTest.byStageBasisAndCheckpoint.find(
        (r) => r.group === 'first_game_censored' && r.checkpoint === checkpoint
      )!;
      expect(entry('entered_before_first_read').legs).toBeGreaterThanOrEqual(censored.legs);
      expect(entry('entered_before_first_read').legs + entry('entered_from_first_read').legs).toBe(
        all(backTest.byStageBandAndCheckpoint, checkpoint).legs
      );
    }
    expect(backTest.seasons.map(({ tradeSeason }) => tradeSeason)).toEqual(range(2019, 2024));
    for (const season of backTest.seasons)
      expect(season.trainingPlayers).toBeLessThan(fit.content.legs.trainingPlayers);
    expect(
      backTest.calibration
        .filter(({ checkpoint }) => checkpoint === 0)
        .map(({ predictedFrom }) => predictedFrom)
    ).toEqual([null, 0, 5, 10, 20, 40, 80, 160]);
    for (const interval of backTest.intervals)
      expect(interval.lower).toBeLessThanOrEqual(interval.upper);
    expect(backTest.limitations.checkpoint3TradeSeasons).toBe(4);
    expect(backTest.limitations.longestObservedTenure).toBe(7);
  });

  it('trains each back-test fold, like the fit, only on players with a reviewed leg', () => {
    // A player whose only leg is an unreviewed 2019 arrival, with a long pre-trade career.
    const extra: Player = {
      playerId: 'pl-unreviewed',
      origin: 2008,
      drafted: false,
      trades: [{ season: 2019, to: 'brisbane', reviewed: false }],
    };
    const extraRows: Row[] = range(2011, 2022).map((season) => ({
      season,
      playerId: extra.playerId,
      clubId: season <= 2019 ? 'adelaide' : 'brisbane',
      games: 22,
      pav: 22 * 1.5,
    }));
    const refit = fitAflTradeTradedPlayerValueLine(
      inputsOf([...players, extra], [...rows, ...extraRows])
    );
    expect(refit.content.legs.trainingPlayers).toBe(fit.content.legs.trainingPlayers);
    const later = (f: typeof fit) =>
      f.content.backTest.seasons
        .filter(({ tradeSeason }) => tradeSeason > 2019)
        .map(
          ({
            tradeSeason,
            trainingPlayers,
            gamesCredibilitySeasons,
            rateCredibilityGames,
            predictedAtTrade,
          }) => ({
            tradeSeason,
            trainingPlayers,
            gamesCredibilitySeasons,
            rateCredibilityGames,
            predictedAtTrade,
          })
        );
    expect(later(refit)).toEqual(later(fit));
  });

  it('values a held-out leg with no hindsight past its checkpoint', () => {
    // A 2019 leg's 2023 season moves its realized PAV, never its value at the trade or after year 1.
    const leg = inputs.legs.find(
      ({ tradeSeason, arrivalReviewed, stint }) =>
        tradeSeason === 2019 &&
        arrivalReviewed &&
        stint.status === 'open' &&
        stint.seasons.some(({ season, pav }) => season === 2023 && pav > 0)
    )!;
    const changed = rows.map((row) =>
      row.playerId === leg.playerId && row.season === 2023 ? { ...row, pav: row.pav + 40 } : row
    );
    const refit = fitAflTradeTradedPlayerValueLine(inputsOf(players, changed));
    const season = (f: typeof fit) =>
      f.content.backTest.seasons.find(({ tradeSeason }) => tradeSeason === 2019)!;
    expect(season(refit).realized).toBeCloseTo(season(fit).realized + 40, 3);
    expect(season(refit).predictedAtTrade).toBe(season(fit).predictedAtTrade);
    expect(season(refit).predictedAfterYear1).toBe(season(fit).predictedAfterYear1);
  });

  it('is deterministic and independent of input order', () => {
    const again = fitAflTradeTradedPlayerValueLine({
      ...inputs,
      legs: [...inputs.legs].reverse(),
      draftOrigins: [...inputs.draftOrigins].reverse(),
      games: model([...rows].reverse()),
    });
    expect(again.fitId).toBe(fit.fitId);
  });

  it('takes the first draft as the stage origin and refuses one after the trade', () => {
    const drafted = players.find(({ drafted, trades }) => drafted && trades[0]!.season > 2020)!;
    const redrafted = fitAflTradeTradedPlayerValueLine({
      ...inputs,
      draftOrigins: [
        ...inputs.draftOrigins,
        {
          playerId: drafted.playerId,
          draftYear: drafted.origin + 1,
          draftType: 'rookie',
          selectionId: 'selection-later',
        },
      ],
    });
    expect(redrafted.fitId).toBe(fit.fitId);
    expect(() =>
      fitAflTradeTradedPlayerValueLine({
        ...inputs,
        draftOrigins: inputs.draftOrigins.map((origin) =>
          origin.playerId === drafted.playerId
            ? { ...origin, draftYear: drafted.trades[0]!.season + 1 }
            : origin
        ),
      })
    ).toThrow(/draft origin .* after the trade/);
  });

  it('refuses inputs the specification excludes', () => {
    const leg = inputs.legs.find(({ stint }) => stint.seasons.length > 1)!;
    const replaceLeg = (stint: Partial<AflTradeAssetLedgerStint>) => ({
      ...inputs,
      legs: inputs.legs.map((other) =>
        other === leg ? { ...other, stint: { ...other.stint, ...stint } } : other
      ),
    });
    expect(() =>
      fitAflTradeTradedPlayerValueLine(replaceLeg({ seasonsMissingPav: [2026] }))
    ).toThrow(/seasons missing PAV/);
    expect(() =>
      fitAflTradeTradedPlayerValueLine(
        replaceLeg({
          seasons: leg.stint.seasons.map((season, index) =>
            index === 0 ? { ...season, pav: season.pav + 1 } : season
          ),
        })
      )
    ).toThrow(/differs from the games read model/);
    expect(() =>
      fitAflTradeTradedPlayerValueLine({
        ...inputs,
        stintCalculations: inputs.stintCalculations.map((row) =>
          row.season === 2022 ? { ...row, calculationId: 'hpn-pav-season:other' } : row
        ),
      })
    ).toThrow(/calculation for 2022 differs/);
    expect(() =>
      fitAflTradeTradedPlayerValueLine({
        ...inputs,
        games: {
          ...inputs.games,
          discrepancies: [
            { playerId: 'p', season: 2020, clubId: 'c', games: 1, factualMatches: 2 },
          ],
        },
      })
    ).toThrow(/discrepancies/);
    expect(() =>
      fitAflTradeTradedPlayerValueLine({
        ...inputs,
        games: {
          ...inputs.games,
          seasons: inputs.games.seasons.map((season) =>
            season.season === 2015 ? { ...season, availability: 'no_head' as const } : season
          ),
        },
      })
    ).toThrow(/2015 are not available/);
    expect(() =>
      fitAflTradeTradedPlayerValueLine({ ...inputs, tradeSeasons: [...TRADE_SEASONS, 2026] })
    ).toThrow(/no season observed after it/);
  });
});

describe('aflTradeTradedPlayerValueAt', () => {
  it("reads the player's form in his exit hazard through the fitted slope", () => {
    const slope = parameters.survivalHazardLogit.rateEffectSlope;
    expect(Number.isFinite(slope)).toBe(true);
    const at = (rateEffectSlope: number) =>
      aflTradeTradedPlayerValueAt(
        {
          ...parameters,
          survivalHazardLogit: { ...parameters.survivalHazardLogit, rateEffectSlope },
        },
        base,
        2022
      );
    const effect = at(0).effect.rate;
    expect(effect).not.toBe(0);
    // A negative slope lowers the hazard of a player above his band's rate, so more of his stint is
    // expected; a slope of 0 is the form-blind hazard of fits before 2026-10-23.
    const sign = Math.sign(effect);
    expect(at(-2 * sign).expectedRemaining).toBeGreaterThan(at(0).expectedRemaining);
    expect(at(2 * sign).expectedRemaining).toBeLessThan(at(0).expectedRemaining);
    // A fit stored before the slope existed reads as form-blind.
    const { rateEffectSlope: _dropped, ...legacy } = parameters.survivalHazardLogit;
    expect(
      aflTradeTradedPlayerValueAt({ ...parameters, survivalHazardLogit: legacy }, base, 2022)
        .expectedRemaining
    ).toBeCloseTo(at(0).expectedRemaining, 9);
  });

  it('publishes a return probability per empty run and stage group', () => {
    expect(
      parameters.inactiveReturn.map(({ stageFrom, emptySeasons }) => `${stageFrom}:${emptySeasons}`)
    ).toEqual(['1:1', '1:2', '10:1', '10:2']);
    for (const row of parameters.inactiveReturn) {
      expect(row.returned).toBeLessThanOrEqual(row.runs);
      expect(row.probability).toBeGreaterThan(0);
      expect(row.probability).toBeLessThan(1);
    }
  });

  const tradeSeason = 2021;
  /** A stage-6 player at the trade: drafted 2016, eleven to sixteen games a season. */
  const base: AflTradeTradedPlayerValueInput = {
    playerId: 'calc-player',
    receivingClubId: 'carlton',
    tradeSeason,
    stage: { basis: 'draft', originSeason: 2016, leftCensored: false },
    career: range(2017, 2026).map((season) => ({ season, games: 15, pav: 6 })),
    stint: {
      status: 'open',
      endSeason: null,
      seasons: range(2022, 2026).map((season) => ({ season, games: 15, pav: 6 })),
    },
  };
  const withSeason = (season: number, pav: number): AflTradeTradedPlayerValueInput => ({
    ...base,
    career: base.career.map((row) => (row.season === season ? { ...row, pav } : row)),
    stint: {
      ...base.stint,
      seasons: base.stint.seasons.map((row) => (row.season === season ? { ...row, pav } : row)),
    },
  });

  it('values a player at the trade from his pre-trade form, and moves with his stint', () => {
    const atTrade = aflTradeTradedPlayerValueAt(parameters, base, tradeSeason);
    expect(atTrade).toMatchObject({
      fitId: fit.fitId,
      tenure: 0,
      state: 'open',
      produced: 0,
      stageAtTrade: 6,
      stageBasis: 'draft',
      leftCensored: false,
    });
    expect(atTrade.effect.seasons).toBe(5);
    expect(atTrade.value).toBe(atTrade.expectedRemaining);
    // A better post-trade season does not move the at-trade value; it moves year 1.
    const better = withSeason(2022, 30);
    expect(aflTradeTradedPlayerValueAt(parameters, better, tradeSeason).value).toBe(atTrade.value);
    const year1 = aflTradeTradedPlayerValueAt(parameters, base, 2022);
    const betterYear1 = aflTradeTradedPlayerValueAt(parameters, better, 2022);
    expect(betterYear1.produced - year1.produced).toBeCloseTo(24, 6);
    expect(betterYear1.effect.rate).toBeGreaterThan(year1.effect.rate);
    expect(betterYear1.value - year1.value).toBeGreaterThan(24);
    // A better pre-trade season moves the at-trade value.
    expect(
      aflTradeTradedPlayerValueAt(parameters, withSeason(2020, 30), tradeSeason).value
    ).toBeGreaterThan(atTrade.value);
  });

  it('leaves a left-censored veteran’s unknown-band seasons out of his form', () => {
    // First seen in 2011, so stage >= s - 2010: only 2024 and later are certainly in the top band, 14+.
    const veteran: AflTradeTradedPlayerValueInput = {
      ...base,
      stage: { basis: 'first_game', originSeason: 2010, leftCensored: true },
      career: range(2011, 2026).map((season) => ({ season, games: 15, pav: 6 })),
    };
    const withCareerSeason = (season: number, pav: number) => ({
      ...veteran,
      career: veteran.career.map((row) => (row.season === season ? { ...row, pav } : row)),
    });
    const atTrade = aflTradeTradedPlayerValueAt(parameters, veteran, tradeSeason);
    expect(atTrade.effect.seasons).toBe(0);
    // A great 2015 or 2020 (lower bounds 5 and 10, true band unknown) does not move him.
    for (const season of [2015, 2020])
      expect(
        aflTradeTradedPlayerValueAt(parameters, withCareerSeason(season, 40), tradeSeason).value
      ).toBe(atTrade.value);
    // 2024 and 2025 are 14+ whatever his true stage, so they count once read.
    expect(aflTradeTradedPlayerValueAt(parameters, veteran, 2025).effect.seasons).toBe(2);
  });

  it('scales what remains after empty stint seasons, and leaves them out of form', () => {
    const empty2023: AflTradeTradedPlayerValueInput = {
      ...base,
      career: base.career.map((row) => (row.season === 2023 ? { ...row, games: 0, pav: 0 } : row)),
      stint: {
        ...base.stint,
        seasons: base.stint.seasons.map((row) =>
          row.season === 2023 ? { ...row, games: 0, pav: 0 } : row
        ),
      },
    };
    const point = aflTradeTradedPlayerValueAt(parameters, empty2023, 2023);
    // The empty 2023 is the retirement signal, not form: his effect is the 2022 view's.
    expect(point.effect).toEqual(aflTradeTradedPlayerValueAt(parameters, base, 2022).effect);
    const certain = aflTradeTradedPlayerValueAt(
      {
        ...parameters,
        inactiveReturn: parameters.inactiveReturn.map((row) => ({ ...row, probability: 1 })),
      },
      empty2023,
      2023
    );
    // Stage 8 at the 2023 checkpoint: the under-10 group after one empty season.
    const row = parameters.inactiveReturn.find(
      ({ stageFrom, emptySeasons }) => stageFrom === 1 && emptySeasons === 1
    )!;
    expect(point.expectedRemaining).toBeCloseTo(certain.expectedRemaining * row.probability, 9);
    expect(point.state).toBe('open');
  });

  it('gives a player with no history no effect at the trade', () => {
    const youngest = aflTradeTradedPlayerValueAt(
      parameters,
      {
        ...base,
        stage: { basis: 'assumed_youngest', originSeason: tradeSeason - 1, leftCensored: false },
        career: range(2021, 2026).map((season) => ({
          season,
          games: season === 2021 ? 0 : 10,
          pav: 3,
        })),
      },
      tradeSeason
    );
    expect(youngest.stageAtTrade).toBe(2);
    // His one pre-trade season (stage 1, no game) is scored against band 1.
    expect(youngest.effect.gamesPlayed).toBe(0);
    expect(youngest.effect.rate).toBe(0);
  });

  it('values a closed stint at what it produced, and closes after three seasons without a game', () => {
    const closed = aflTradeTradedPlayerValueAt(
      parameters,
      {
        ...base,
        stint: {
          status: 'closed',
          endSeason: 2023,
          seasons: [2022, 2023].map((season) => ({ season, games: 15, pav: 6 })),
        },
        career: base.career.map((row) => (row.season === 2024 ? { ...row, pav: 9 } : row)),
      },
      2024
    );
    expect(closed).toMatchObject({
      state: 'closed',
      closeReason: 'moved',
      produced: 12,
      expectedRemaining: 0,
      value: 12,
    });
    // Before the move shows (end of 2023, no game elsewhere yet), the stint still reads as open.
    expect(
      aflTradeTradedPlayerValueAt(
        parameters,
        {
          ...base,
          stint: {
            status: 'closed',
            endSeason: 2023,
            seasons: [2022, 2023].map((season) => ({ season, games: 15, pav: 6 })),
          },
        },
        2023
      ).state
    ).toBe('open');
    const idle = range(2022, 2026).map((season) => ({
      season,
      games: season === 2022 ? 15 : 0,
      pav: season === 2022 ? 6 : 0,
    }));
    const inactive = {
      ...base,
      career: base.career.map((row) => (row.season >= 2023 ? { ...row, games: 0, pav: 0 } : row)),
      stint: { ...base.stint, seasons: idle },
    };
    expect(aflTradeTradedPlayerValueAt(parameters, inactive, 2024).state).toBe('open');
    expect(aflTradeTradedPlayerValueAt(parameters, inactive, 2025)).toMatchObject({
      state: 'closed',
      closeReason: 'inactive',
      value: 6,
    });
    // Survival: the expected value still to come falls as fewer seasons are left in the horizon.
    const open = aflTradeTradedPlayerValueAt(parameters, base, 2026);
    expect(open.expectedRemaining).toBeLessThan(
      aflTradeTradedPlayerValueAt(parameters, base, tradeSeason).expectedRemaining
    );
  });

  it('refuses a missing career season and a checkpoint before the trade', () => {
    expect(() =>
      aflTradeTradedPlayerValueAt(
        parameters,
        { ...base, career: base.career.filter(({ season }) => season !== 2019) },
        tradeSeason
      )
    ).toThrow(/career season 2019 is missing/);
    expect(() => aflTradeTradedPlayerValueAt(parameters, base, 2020)).toThrow(/before the trade/);
  });

  it('reads parameters only from a sealed fit of this schema', () => {
    expect(parameters.fitId).toBe(fit.fitId);
    expect(() =>
      aflTradeTradedPlayerValueLineParameters({
        ...fit,
        content: { ...fit.content, schemaVersion: 'afl-trade-traded-player-value-line-fit/v0' },
      } as unknown as typeof fit)
    ).toThrow(/schema/);
    expect(() =>
      aflTradeTradedPlayerValueLineParameters({
        ...fit,
        fitId: `traded-player-value-line-fit:${'0'.repeat(64)}`,
      })
    ).toThrow(/does not match/);
  });
});

describe('aflTradeTradedPlayerStage', () => {
  const stage = (
    draftYear: number | null,
    gameSeasons: number[],
    firstTradeSeason = 2020,
    firstReadSeason = 2011
  ) =>
    aflTradeTradedPlayerStage({
      draftOrigin: draftYear === null ? null : { draftYear },
      gameSeasons,
      firstTradeSeason,
      firstReadSeason,
    });

  it('takes the draft origin before his first trade, and refuses one at or after it', () => {
    expect(stage(2015, [2011])).toEqual({
      basis: 'draft',
      originSeason: 2015,
      leftCensored: false,
    });
    expect(stage(2020, [])).toBeNull();
    expect(stage(2021, [])).toBeNull();
  });

  it('falls back to the season before his first game, left-censored in the first season read', () => {
    expect(stage(null, [2013, 2014, 2021])).toEqual({
      basis: 'first_game',
      originSeason: 2012,
      leftCensored: false,
    });
    expect(stage(null, [2014, 2011])).toEqual({
      basis: 'first_game',
      originSeason: 2010,
      leftCensored: true,
    });
    // A game after his first trade is no evidence of where his career began.
    expect(stage(null, [2021, 2022])).toEqual({
      basis: 'assumed_youngest',
      originSeason: 2019,
      leftCensored: false,
    });
  });

  it('takes the earliest draft origin, ties by draft type then selection', () => {
    const first = aflTradeTradedPlayerFirstDraftOrigins([
      { playerId: 'p1', draftYear: 2012, draftType: 'rookie', selectionId: 's1' },
      { playerId: 'p1', draftYear: 2008, draftType: 'rookie', selectionId: 's3' },
      { playerId: 'p1', draftYear: 2008, draftType: 'national', selectionId: 's4' },
      { playerId: 'p2', draftYear: 2006, draftType: 'national', selectionId: 's2' },
    ]);
    expect(first.get('p1')).toMatchObject({ draftYear: 2008, selectionId: 's4' });
    expect(first.get('p2')?.selectionId).toBe('s2');
  });

  it('gives each leg the input the fit values it from, its stage against his first trade', () => {
    const legInputs = aflTradeTradedPlayerFitLegInputs(inputs);
    expect(legInputs.map(({ transferId }) => transferId)).toEqual(
      inputs.legs.map(({ transferId }) => transferId).sort()
    );
    const twice = players.find(({ trades }) => trades.length === 2)!;
    const [first, second] = legInputs
      .filter(({ input }) => input.playerId === twice.playerId)
      .sort((left, right) => left.input.tradeSeason - right.input.tradeSeason);
    expect(second!.input.stage).toEqual(first!.input.stage);
    expect(second!.input.earlierTradeSeasons).toEqual([twice.trades[0]!.season]);
    expect(first!.input.earlierTradeSeasons).toEqual([]);
    for (const { tradeSeason, byStageBasis } of fit.content.fitWindow.legsByTradeSeason)
      expect(
        aflTradeTradedPlayerStageBasisCounts(
          legInputs
            .filter(({ input }) => input.tradeSeason === tradeSeason)
            .map(({ input }) => input.stage)
        )
      ).toEqual(byStageBasis);
  });
});

describe('createAflTradeTradedPlayerValueEvaluator', () => {
  const evidence = {
    fit,
    legs: inputs.legs,
    excludedLegs: inputs.excludedLegs,
    draftOrigins: inputs.draftOrigins,
    games: inputs.games,
  };
  const evaluator = createAflTradeTradedPlayerValueEvaluator(evidence);

  it("carries the fit, its trade seasons and each player's trades in the window", () => {
    expect(evaluator.parameters).toEqual(parameters);
    expect(evaluator.valueAt).toBe(aflTradeTradedPlayerValueAt);
    expect(evaluator.tradeSeasons).toEqual(TRADE_SEASONS);
    const twice = players.find(({ trades }) => trades.length === 2)!;
    expect(evaluator.playerTradeSeasons.get(twice.playerId)).toEqual(
      twice.trades.map(({ season }) => season)
    );
    // Unreviewed legs count, as in the fit: they set his first trade and phases.
    const unreviewed = players.find(({ trades }) => trades.some(({ reviewed }) => !reviewed))!;
    expect(evaluator.playerTradeSeasons.get(unreviewed.playerId)).toEqual(
      unreviewed.trades.map(({ season }) => season)
    );
  });

  it('refuses evidence that is not what the fit read', () => {
    const refuse = (change: Partial<typeof evidence>, message: RegExp) =>
      expect(() => createAflTradeTradedPlayerValueEvaluator({ ...evidence, ...change })).toThrow(
        message
      );
    refuse(
      { fit: { ...fit, fitId: `traded-player-value-line-fit:${'0'.repeat(64)}` } },
      /does not match/
    );
    refuse({ games: { ...inputs.games, methodId: 'hpn-pav-method:other' } }, /method/);
    refuse(
      {
        games: {
          ...inputs.games,
          seasons: inputs.games.seasons.map((row) =>
            row.season === 2015 ? { ...row, calculationId: 'hpn-pav-season:other' } : row
          ),
        },
      },
      /seasons and calculations are not the fit's/
    );
    refuse({ legs: inputs.legs.slice(1) }, /Trade season \d{4} has \d+ legs; the fit read \d+/);
    refuse({ excludedLegs: [] }, /Trade season 2021 has \d+ legs; the fit read \d+/);
    // A new origin (another Draftguru batch, say) moves a stage basis: refused, never re-read.
    const undrafted = players.find(({ drafted }) => !drafted)!;
    refuse(
      {
        draftOrigins: [
          ...inputs.draftOrigins,
          {
            playerId: undrafted.playerId,
            draftYear: undrafted.trades[0]!.season - 1,
            draftType: 'rookie',
            selectionId: 'external-evidence:new',
          },
        ],
      },
      /stages of trade season \d{4} are not the fit's/
    );
    // An earlier origin that keeps the basis ('draft' either way) still moves the stage: refused.
    const drafted = players.find(({ drafted, origin }) => drafted && origin >= 2012)!;
    refuse(
      {
        draftOrigins: [
          ...inputs.draftOrigins,
          {
            playerId: drafted.playerId,
            draftYear: drafted.origin - 1,
            draftType: 'rookie',
            selectionId: 'external-evidence:earlier',
          },
        ],
      },
      /stages of trade season \d{4} are not the fit's/
    );
    // A leg re-read under another player keeps every count: refused all the same.
    const season = TRADE_SEASONS.find((tradeSeason) => {
      const here = inputs.legs.filter((leg) => leg.tradeSeason === tradeSeason);
      return new Set(here.map(({ playerId }) => playerId)).size > 1;
    })!;
    const left = inputs.legs.find((leg) => leg.tradeSeason === season)!;
    const outside = players.find(
      ({ playerId, trades }) =>
        playerId !== left.playerId && trades.every((trade) => trade.season !== season)
    )!;
    refuse(
      {
        legs: inputs.legs.map((leg) =>
          leg === left ? { ...leg, playerId: outside.playerId } : leg
        ),
      },
      /stages of trade season \d{4} are not the fit's/
    );
  });

  it("gives the value lines the fit's own point for every leg at every checkpoint", () => {
    const points: AflTradeTradedPlayerValuePoint[] = [];
    const recording = {
      ...evaluator,
      valueAt: (...args: Parameters<typeof evaluator.valueAt>) => {
        const point = evaluator.valueAt(...args);
        points.push(point);
        return point;
      },
    };
    // The value lines read fewer seasons than the fit; careers before them come from the fit's games.
    const reader = new AflTradeValueLineReader(
      {} as AflTradeValueLineFitParameters,
      model(
        rows.filter(({ season }) => season >= 2019),
        range(2019, LAST_SEASON)
      ),
      recording
    );
    const legInputs = new Map(
      aflTradeTradedPlayerFitLegInputs(inputs).map(({ transferId, input }) => [transferId, input])
    );
    const seen = { open: 0, closed: 0, bases: new Set<string>() };
    for (const leg of inputs.legs) {
      const fitInput = legInputs.get(leg.transferId)!;
      for (let season = leg.tradeSeason; season <= LAST_SEASON; season++) {
        const kind = season === leg.tradeSeason ? 'trade' : 'season_end';
        points.length = 0;
        const line = reader.traded(leg.playerId, leg.tradeSeason, leg.stint, { kind, season });
        const expected = aflTradeTradedPlayerValueAt(parameters, fitInput, season);
        expect(line.state).toBe(expected.state);
        expect(line.produced).toBeCloseTo(expected.produced, 9);
        expect(line.expectedRemaining).toBeCloseTo(expected.expectedRemaining, 9);
        expect(line.value).toBeCloseTo(expected.value, 9);
        if (line.state === 'closed') {
          seen.closed++;
          continue;
        }
        seen.open++;
        expect(points).toHaveLength(1);
        expect(points[0]).toMatchObject({
          stageBasis: expected.stageBasis,
          leftCensored: expected.leftCensored,
          stageAtTrade: expected.stageAtTrade,
        });
        seen.bases.add(`${expected.stageBasis}${expected.leftCensored ? ':censored' : ''}`);
      }
    }
    expect(seen.open).toBeGreaterThan(500);
    expect(seen.closed).toBeGreaterThan(100);
    expect([...seen.bases].sort()).toEqual([
      'assumed_youngest',
      'draft',
      'first_game',
      'first_game:censored',
    ]);
  });
});

describe('buildAflTradeTradedPlayerValueLineFitInputs', () => {
  const transfer = (
    id: string,
    asset: Record<string, unknown>,
    toClubId: string | null = 'carlton'
  ) => ({
    transferId: `external-transfer:${id.padStart(64, '0')}`,
    transactionId: `external-transaction:${'1'.repeat(64)}`,
    fromClubId: 'adelaide',
    toClubId,
    asset,
    status: 'corroborated',
    evidenceIds: ['e'],
  });
  const grading = {
    candidateId: 'external-reconciliation:x',
    candidate: {
      transactions: [
        {
          transactionId: `external-transaction:${'1'.repeat(64)}`,
          providerEventId: 'event',
          seasonYear: 2024,
          occurredOn: null,
          transactionType: 'trade',
          title: null,
          parties: ['adelaide', 'carlton'],
          transferIds: [],
          status: 'corroborated',
          evidenceIds: ['e'],
        },
      ],
      transfers: [
        transfer('1', { kind: 'player', playerId: 'p1', recordedName: 'One' }),
        transfer('2', { kind: 'player', playerId: null, recordedName: 'Two' }),
        transfer('3', { kind: 'player', playerId: 'p3', recordedName: 'Three' }, null),
        transfer('4', { kind: 'pick_entitlement', draftYear: 2024 }),
      ],
      pickOutcomes: [],
    },
    pavCalculations: [2024, 2025].map((season) => ({
      season,
      calculationId: `hpn-pav-season:${season}`,
      official: true,
    })),
    pav: [{ playerId: 'p1', season: 2025, clubId: 'carlton', value: 5 }],
    seasonSpells: [
      { playerId: 'p1', season: 2024, clubId: 'adelaide' },
      { playerId: 'p1', season: 2025, clubId: 'carlton' },
    ],
    spellSeasons: [2024, 2025],
    reviewedArrivals: [{ playerId: 'p1', clubId: 'carlton', season: 2025 }],
    pickProjectionBenchmarkId: 'not-read',
    spellCutoffAt: '2026-10-19T00:00:00.000Z',
    gradedAt: '2026-10-19T00:00:00.000Z',
  } as unknown as AflTradeGradingInputs;

  it('takes each traded player leg with its ledger stint, and counts the unresolved ones', () => {
    const games = model(
      [
        { season: 2024, playerId: 'p1', clubId: 'adelaide', games: 10, pav: 3 },
        { season: 2025, playerId: 'p1', clubId: 'carlton', games: 12, pav: 5 },
      ],
      [2024, 2025]
    );
    const built = buildAflTradeTradedPlayerValueLineFitInputs({
      grading,
      games,
      draftOrigins: [],
      tradeSeasons: [2024],
    });
    expect(built.legs).toHaveLength(1);
    expect(built.legs[0]).toMatchObject({
      tradeSeason: 2024,
      playerId: 'p1',
      receivingClubId: 'carlton',
      arrivalReviewed: true,
      stint: {
        status: 'open',
        startSeason: 2025,
        seasons: [{ season: 2025, pav: 5, official: true }],
      },
    });
    expect(built.excludedLegs.map(({ reason }) => reason)).toEqual([
      'player_identity_unresolved',
      'club_unresolved',
    ]);
    // The value lines' evaluator reads the same legs through the same rule.
    const shared = aflTradeTradedPlayerTradeLegs(grading.candidate, [2024]);
    expect(shared.excludedLegs).toEqual(built.excludedLegs);
    expect(shared.legs).toEqual(
      built.legs.map(({ transferId, transactionId, tradeSeason, playerId, receivingClubId }) => ({
        transferId,
        transactionId,
        tradeSeason,
        playerId,
        receivingClubId,
      }))
    );
    expect(built.stintCalculations).toEqual([
      { season: 2024, calculationId: 'hpn-pav-season:2024' },
      { season: 2025, calculationId: 'hpn-pav-season:2025' },
    ]);
  });

  it('reads every canonical draft row, of every draft type and year', async () => {
    const statements: string[] = [];
    const query = async (sql: string) => {
      statements.push(sql);
      return {
        rows: [
          { player_id: 'p1', draft_year: 2018, draft_type: 'rookie', selection_id: 's1' },
          { player_id: null, draft_year: 2019, draft_type: 'national', selection_id: 's2' },
        ],
      };
    };
    const client = {
      query,
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
        work({ query }),
    } as unknown as AflOutcomeSqlClient;
    const origins = await loadAflTradeTradedPlayerDraftOrigins(client);
    expect(origins).toEqual([
      { playerId: 'p1', draftYear: 2018, draftType: 'rookie', selectionId: 's1' },
    ]);
    expect(statements[0]).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    expect(statements[1]).toMatch(/outcome_current_canonical_draft_selection_picks\('AFLM'\)/);
    expect(statements[1]).not.toMatch(/draft_type =/);
  });

  it('reads reviewed Draftguru 2000-2010 selections and listings through approved identities only', async () => {
    const statements: { sql: string; values?: unknown[] }[] = [];
    const query = async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      return {
        rows: [
          {
            player_id: 'p9',
            draft_year: 2004,
            draft_type: 'pre_season',
            evidence_id: 'external-evidence:e1',
          },
        ],
      };
    };
    const client = {
      query,
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
        work({ query }),
    } as unknown as AflOutcomeSqlClient;
    expect(await loadAflTradeTradedPlayerDraftguruOrigins(client)).toEqual([
      {
        playerId: 'p9',
        draftYear: 2004,
        draftType: 'pre_season',
        selectionId: 'external-evidence:e1',
      },
    ]);
    expect(statements[0]!.sql).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const read = statements[1]!;
    expect(read.values).toEqual([
      ['draftguru-national-year-page/v5', 'draftguru-national-year-page/v6'],
    ]);
    expect(read.sql).toMatch(/IN \('national', 'pre_season', 'rookie'\)/);
    expect(read.sql).toMatch(/batch\.status = 'finalized' AND batch\.issue_count = 0/);
    expect(read.sql).toMatch(/head\.status = 'approved'/);
    expect(read.sql).toMatch(/decision\.outcome = 'approved'/);
    expect(read.sql).toMatch(/BETWEEN 2000 AND 2010/);
    expect(read.sql).not.toMatch(/recorded_?[nN]ame|display_name/);
  });

  it('keeps every canonical and Draftguru origin, so the fit takes the earliest', () => {
    const canonical = [{ playerId: 'p1', draftYear: 2012, draftType: 'rookie', selectionId: 's1' }];
    const draftguru = [
      { playerId: 'p1', draftYear: 2008, draftType: 'national', selectionId: 'e1' },
      { playerId: 'p2', draftYear: 2006, draftType: 'national', selectionId: 'e2' },
    ];
    expect(mergeAflTradeTradedPlayerDraftOrigins(canonical, draftguru)).toEqual([
      canonical[0],
      ...draftguru,
    ]);
  });
});

const loopback = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };
const argv = (out: string) => [
  '--candidate',
  `external-reconciliation:${'c'.repeat(64)}`,
  '--method',
  `hpn-pav-method:${'b'.repeat(64)}`,
  '--trade-seasons',
  '2019-2025',
  '--seasons',
  '2011-2026',
  '--official-seasons',
  '2019-2025',
  '--store-id',
  'statly-grading-1-artifacts',
  '--out',
  out,
];

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('fit-traded-player-value-line', () => {
  it('parses the fit window and the store', () => {
    expect(
      parseFitTradedPlayerValueLineArguments(argv('/receipts/fit.json'), loopback)
    ).toMatchObject({
      tradeSeasons: TRADE_SEASONS,
      seasons: range(2011, 2026),
      officialSeasons: range(2019, 2025),
      storeId: 'statly-grading-1-artifacts',
      dryRun: false,
    });
    expect(() =>
      parseFitTradedPlayerValueLineArguments(
        argv('/receipts/fit.json').filter(
          (value) => value !== '--store-id' && value !== 'statly-grading-1-artifacts'
        ),
        loopback
      )
    ).toThrow(/--store-id is required/);
    expect(() =>
      parseFitTradedPlayerValueLineArguments(
        argv('/receipts/fit.json').map((value) => (value === '2011-2026' ? '2020-2026' : value)),
        loopback
      )
    ).toThrow(/--seasons must start at or before/);
  });

  it('stores the fit as private derived output in its own repository', async () => {
    const client = {} as AflOutcomeSqlClient;
    const bytes = new TextEncoder().encode('{"fitId":"x"}');
    await storeTradedPlayerValueLineFit(client, 'statly-grading-1-artifacts', bytes);
    expect(storeLocalAflTradeEvidence).toHaveBeenCalledWith(client, {
      storeId: 'statly-grading-1-artifacts',
      repositoryId: 'traded-player-value-line-fits',
      artifactClass: 'derived_private',
      bytes,
      mediaType: 'application/json',
      maximumObjectBytes: 8 * 1024 * 1024,
    });
  });

  it('refuses an existing --out before it opens the database', async () => {
    directory = await mkdtemp(join(tmpdir(), 'traded-player-fit-'));
    const out = join(directory, 'fit.json');
    await writeFile(out, '{}');
    await expect(
      runFitTradedPlayerValueLineCommand({ argv: argv(out), env: loopback })
    ).rejects.toThrow(/a fit is never overwritten/);
  });

  it('reads a stored fit for the value lines only when it is sealed and of this schema', async () => {
    directory = await mkdtemp(join(tmpdir(), 'traded-player-fit-'));
    const path = join(directory, 'fit.json');
    await writeFile(path, JSON.stringify(fit));
    expect((await readTradedPlayerValueLineFit(path)).fitId).toBe(fit.fitId);
    await writeFile(path, JSON.stringify({ ...fit, fitId: `${fit.fitId.slice(0, -1)}0` }));
    await expect(readTradedPlayerValueLineFit(path)).rejects.toThrow(/does not match/);
    await writeFile(path, '[]');
    await expect(readTradedPlayerValueLineFit(path)).rejects.toThrow(/not a sealed traded-player/);
  });

  it('takes the genuine database only on loopback', async () => {
    await expect(
      runFitTradedPlayerValueLineCommand({
        argv: argv('/receipts/fit.json'),
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@10.0.0.5:5432/outcomes' },
      })
    ).rejects.toThrow(/loopback/);
  });
});
