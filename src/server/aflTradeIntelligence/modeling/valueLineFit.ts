/**
 * Fits and back-tests the value-line priors (value-line method, implementation order step 2;
 * statlyaus/Statly#789): the first-stint pick curve, the survival curve by slot and seasons at the
 * club, and the credibility weights. The rules are the "Fit specification (step 2)" section of
 * docs/architecture/afl-trade-value-line-method.md. Pure and deterministic: the same selections and
 * player-season games give the same fit, byte for byte. It reads no grade rule, no candidate and
 * nothing of the realized grader.
 */
import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import { HPN_DPVC_V3_LAST_SUPPORTED_PICK, hpnDpv3ValueForPick } from './hpnPickValueBenchmark';
import type { AflTradePlayerSeasonGames } from './playerSeasonGames';

export const AFL_TRADE_VALUE_LINE_FIT_SCHEMA_VERSION = 'afl-trade-value-line-fit/v2' as const;

/** Every fixed choice of the fit specification; published with the fit. */
export const AFL_TRADE_VALUE_LINE_FIT_RULES = {
  /** A stint closes after this many consecutive in-stint seasons with no game at the club. */
  inactivityClosureSeasons: 3,
  /** Tenure groups 1 to 9 each have their own intercept; 10 and later share one. */
  pooledTenureFrom: 10,
  /**
   * The slot slopes differ by tenure band (first tenure of each band): top picks play more early and
   * plateau lower, which one shared tenure curve misses (step 2 v1 residuals, 2026-10-19).
   */
  slotSlopeTenureBands: [1, 4],
  /** Seasons after the draft summed for a value at the full horizon. */
  horizonSeasons: 20,
  /**
   * Own form (owner decision 2026-10-19): each in-stint season's residual is its PAV minus the
   * expected in-stint PAV of the same slot at the same tenure (development-adjusted, additive). A
   * player's effect is the residuals' sum over (seasons + k), added to every remaining expected
   * season; k = within-player season variance / between-player variance, estimated by one-way
   * random-effects analysis of variance (method of moments) on the fitted classes.
   */
  ownFormUpdate: 'development_adjusted_additive_credibility',
  /** The back-test reports an interval between these quantiles of realized minus predicted. */
  intervalQuantiles: [0.1, 0.9],
  /** Calibration bins by predicted value at each checkpoint. */
  calibrationBins: [0, 5, 10, 20, 40, 80, 160],
  /** Half an event and half a non-event per tenure group keep a hazard with no events finite. */
  hazardPseudoCount: 0.5,
  backTestCheckpoints: [0, 1, 3],
  /** A class is back-tested once this many seasons after its draft are observed. */
  backTestMinimumObservedSeasons: 6,
  /** Classes with at least this many observed seasons form the mature DPVC comparison. */
  matureObservedSeasons: 12,
  pickRanges: [
    { label: '1-10', from: 1, through: 10 },
    { label: '11-30', from: 11, through: 30 },
    { label: '31+', from: 31, through: null },
  ],
} as const;

const RULES = AFL_TRADE_VALUE_LINE_FIT_RULES;

export interface AflTradeValueLineFitSelection {
  selectionId: string;
  draftYear: number;
  /** The selection number in the national draft. */
  slot: number;
  clubId: string;
  playerId: string;
}

export interface AflTradeValueLineFitInputs {
  /** Current canonical national-draft selections of the classes fitted. */
  selections: readonly AflTradeValueLineFitSelection[];
  /** The player-season games read model over the seasons after the first class through the last. */
  games: AflTradePlayerSeasonGames;
}

type CloseReason = 'moved' | 'redrafted' | 'inactive';

interface StintSeason {
  tenure: number;
  games: number;
  pav: number;
}

interface Stint {
  selection: AflTradeValueLineFitSelection;
  slotBasis: number[];
  /** Seasons observed after the draft (the last season read minus the draft year). */
  observed: number;
  /** In-stint seasons, tenure 1 upward, contiguous. */
  seasons: StintSeason[];
  /** First tenure not in the stint, when observed. */
  closedAtTenure: number | null;
  closeReason: CloseReason | null;
  /** Games and PAV at the drafting club after an inactivity closure, before any other club. */
  returnedGames: number;
  returnedPav: number;
}

interface Coefficients {
  /** One intercept per tenure group (tenure 1 ... pooledTenureFrom). */
  intercepts: number[];
  /**
   * Slopes on ln(slot) below pick 10, from 10 to 30, and beyond 30 (continuous at the knots), one
   * set per tenure band in band order.
   */
  slotSlopes: number[];
}

interface FittedPriors {
  survival: Coefficients;
  games: Coefficients;
  rate: Coefficients;
  /** k for games per season: seasons of own form that weigh as much as the prior. */
  gamesCredibilitySeasons: number;
  /** k for PAV per game: games of own form that weigh as much as the prior. */
  rateCredibilityGames: number;
  varianceComponents: { games: VarianceComponents; rate: VarianceComponents };
}

const round = (value: number, places = 6) => {
  const factor = 10 ** places;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};
const tenureGroup = (tenure: number) => Math.min(tenure, RULES.pooledTenureFrom) - 1;
const BANDS: readonly number[] = RULES.slotSlopeTenureBands;
/** The slot-slope band of a tenure group (group = tenure - 1, the pooled group last). */
const bandOfGroup = (group: number) =>
  BANDS.reduce((band, start, index) => (group + 1 >= start ? index : band), 0);
const logistic = (value: number) => 1 / (1 + Math.exp(-value));
const SLOT_KNOTS = [Math.log(10), Math.log(30)] as const;
/** Continuous piecewise-linear basis in ln(slot) with knots at picks 10 and 30. */
const slotBasis = (slot: number) => {
  const x = Math.log(slot);
  return [
    Math.min(x, SLOT_KNOTS[0]),
    Math.max(0, Math.min(x, SLOT_KNOTS[1]) - SLOT_KNOTS[0]),
    Math.max(0, x - SLOT_KNOTS[1]),
  ];
};

/** Cuts each selection's first stint at its drafting club, by the specification's three rules. */
function buildStints(inputs: AflTradeValueLineFitInputs): {
  stints: Stint[];
  lastSeason: number;
} {
  const { selections, games } = inputs;
  if (selections.length === 0) throw new Error('Fit at least one draft selection.');
  if (games.discrepancies.length > 0)
    throw new Error('The games read model has discrepancies; the fit refuses it.');
  const unavailable = games.seasons.filter(({ availability }) => availability !== 'available');
  if (unavailable.length > 0)
    throw new Error(
      `Seasons ${unavailable.map(({ season }) => season).join(', ')} are not available.`
    );
  const seasons = games.seasons.map(({ season }) => season);
  const lastSeason = Math.max(...seasons);
  const firstClass = Math.min(...selections.map(({ draftYear }) => draftYear));
  if (Math.min(...seasons) > firstClass + 1)
    throw new Error(`Read every season from ${firstClass + 1}.`);
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const selection of selections) {
    if (!Number.isInteger(selection.slot) || selection.slot < 1)
      throw new Error(`Selection ${selection.selectionId} has no positive slot.`);
    if (selection.draftYear >= lastSeason)
      throw new Error(`Draft ${selection.draftYear} has no season observed after it.`);
    // The curves run to the horizon; a class observed for longer would be read past them (#1001).
    if (lastSeason - selection.draftYear > RULES.horizonSeasons)
      throw new Error(
        `Draft ${selection.draftYear} has more than ${RULES.horizonSeasons} seasons observed, past the curves.`
      );
    const slotKey = `${selection.draftYear}|${selection.slot}`;
    if (ids.has(selection.selectionId) || slots.has(slotKey))
      throw new Error(`Selection ${selection.selectionId} is duplicated.`);
    ids.add(selection.selectionId);
    slots.add(slotKey);
  }
  const rowsByPlayer = new Map<string, Map<number, Map<string, { games: number; pav: number }>>>();
  for (const row of games.rows) {
    const bySeason = rowsByPlayer.get(row.playerId) ?? new Map();
    rowsByPlayer.set(row.playerId, bySeason);
    const byClub = bySeason.get(row.season) ?? new Map();
    bySeason.set(row.season, byClub);
    byClub.set(row.clubId, { games: row.games, pav: row.pav });
  }
  const draftsByPlayer = new Map<string, number[]>();
  for (const { playerId, draftYear } of selections)
    draftsByPlayer.set(playerId, [...(draftsByPlayer.get(playerId) ?? []), draftYear]);

  const ordered = [...selections].sort(
    (left, right) => left.draftYear - right.draftYear || left.slot - right.slot
  );
  const stints = ordered.map((selection): Stint => {
    const observed = lastSeason - selection.draftYear;
    const redraft = (draftsByPlayer.get(selection.playerId) ?? [])
      .filter((year) => year > selection.draftYear)
      .sort((left, right) => left - right)[0];
    const bySeason = rowsByPlayer.get(selection.playerId) ?? new Map();
    const stint: Stint = {
      selection,
      slotBasis: slotBasis(selection.slot),
      observed,
      seasons: [],
      closedAtTenure: null,
      closeReason: null,
      returnedGames: 0,
      returnedPav: 0,
    };
    let zeroRun = 0;
    for (let tenure = 1; tenure <= observed; tenure++) {
      const season = selection.draftYear + tenure;
      const clubs: Map<string, { games: number; pav: number }> = bySeason.get(season) ?? new Map();
      const elsewhere = [...clubs.keys()].some((club) => club !== selection.clubId);
      const reason: CloseReason | null =
        redraft !== undefined && season > redraft
          ? 'redrafted'
          : elsewhere
            ? 'moved'
            : zeroRun >= RULES.inactivityClosureSeasons
              ? 'inactive'
              : null;
      if (reason !== null) {
        stint.closedAtTenure = tenure;
        stint.closeReason = reason;
        if (reason === 'inactive') {
          for (let later = season; later <= lastSeason; later++) {
            const laterClubs: Map<string, { games: number; pav: number }> =
              bySeason.get(later) ?? new Map();
            if ([...laterClubs.keys()].some((club) => club !== selection.clubId)) break;
            if (redraft !== undefined && later > redraft) break;
            stint.returnedGames += laterClubs.get(selection.clubId)?.games ?? 0;
            stint.returnedPav += laterClubs.get(selection.clubId)?.pav ?? 0;
          }
        }
        break;
      }
      const here = clubs.get(selection.clubId);
      stint.seasons.push({ tenure, games: here?.games ?? 0, pav: here?.pav ?? 0 });
      zeroRun = (here?.games ?? 0) === 0 ? zeroRun + 1 : 0;
    }
    return stint;
  });
  return { stints, lastSeason };
}

/** Whether the stint is known to be closed at the end of season `tenure` after the draft. */
function closedAt(stint: Stint, tenure: number): boolean {
  if (stint.closedAtTenure !== null && stint.closedAtTenure <= tenure) return true;
  const last = stint.seasons.slice(Math.max(0, tenure - RULES.inactivityClosureSeasons), tenure);
  return (
    tenure >= RULES.inactivityClosureSeasons &&
    last.length === RULES.inactivityClosureSeasons &&
    last.every(({ games }) => games === 0)
  );
}

interface GlmObservation {
  group: number;
  slotBasis: number[];
  response: number;
  weight: number;
  offset: number;
}

/** Solves a small symmetric positive definite system by Cholesky decomposition. */
function solve(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const lower = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let row = 0; row < size; row++) {
    for (let column = 0; column <= row; column++) {
      let sum = matrix[row]![column]!;
      for (let k = 0; k < column; k++) sum -= lower[row]![k]! * lower[column]![k]!;
      if (row === column) {
        if (sum <= 0) throw new Error('The fit design is not of full rank.');
        lower[row]![row] = Math.sqrt(sum);
      } else lower[row]![column] = sum / lower[column]![column]!;
    }
  }
  const forward = new Array<number>(size).fill(0);
  for (let row = 0; row < size; row++) {
    let sum = vector[row]!;
    for (let k = 0; k < row; k++) sum -= lower[row]![k]! * forward[k]!;
    forward[row] = sum / lower[row]![row]!;
  }
  const result = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    let sum = forward[row]!;
    for (let k = row + 1; k < size; k++) sum -= lower[k]![row]! * result[k]!;
    result[row] = sum / lower[row]![row]!;
  }
  return result;
}

/**
 * Fits `link(mean) = intercept[tenure group] + Σ slope × slotBasis + offset` by iteratively
 * reweighted least squares: binomial with the logit link, or quasi-Poisson with the log link.
 */
function fitGlm(
  family: 'binomial' | 'poisson',
  observations: readonly GlmObservation[],
  label: string
): Coefficients {
  const groups = RULES.pooledTenureFrom;
  for (let group = 0; group < groups; group++) {
    const members = observations.filter((observation) => observation.group === group);
    if (members.length === 0 || members.reduce((sum, { response }) => sum + response, 0) <= 0)
      throw new Error(
        `The ${label} fit has no positive observations in tenure group ${group + 1}.`
      );
  }
  const slopesPerBand = SLOT_KNOTS.length + 1;
  const size = groups + slopesPerBand * BANDS.length;
  let beta = new Array<number>(size).fill(0);
  if (family === 'poisson') {
    const total = observations.reduce((sum, { response, weight }) => sum + weight * response, 0);
    const exposure = observations.reduce(
      (sum, { offset, weight }) => sum + weight * Math.exp(offset),
      0
    );
    beta = beta.map((_, index) => (index < groups ? Math.log(total / exposure) : 0));
  }
  for (let iteration = 0; iteration < 100; iteration++) {
    const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    const vector = new Array<number>(size).fill(0);
    for (const observation of observations) {
      const bandOffset = groups + bandOfGroup(observation.group) * slopesPerBand;
      const columns = [observation.group, ...observation.slotBasis.map((_, i) => bandOffset + i)];
      const values = [1, ...observation.slotBasis];
      const eta =
        values.reduce((sum, value, index) => sum + value * beta[columns[index]!]!, 0) +
        observation.offset;
      const mean = family === 'binomial' ? logistic(eta) : Math.exp(eta);
      const variance = family === 'binomial' ? Math.max(mean * (1 - mean), 1e-12) : mean;
      const working = eta - observation.offset + (observation.response - mean) / variance;
      const weight = observation.weight * variance;
      for (let a = 0; a < columns.length; a++) {
        vector[columns[a]!]! += weight * values[a]! * working;
        for (let b = 0; b < columns.length; b++)
          matrix[columns[a]!]![columns[b]!]! += weight * values[a]! * values[b]!;
      }
    }
    const next = solve(matrix, vector);
    const change = Math.max(...next.map((value, index) => Math.abs(value - beta[index]!)));
    beta = next;
    if (!beta.every(Number.isFinite)) throw new Error(`The ${label} fit diverged.`);
    if (change < 1e-10)
      return { intercepts: beta.slice(0, groups), slotSlopes: beta.slice(groups) };
  }
  throw new Error(`The ${label} fit did not converge.`);
}

const linear = (coefficients: Coefficients, tenure: number, basis: readonly number[]) => {
  const offset = bandOfGroup(tenureGroup(tenure)) * basis.length;
  return (
    coefficients.intercepts[tenureGroup(tenure)]! +
    basis.reduce((sum, value, index) => sum + value * coefficients.slotSlopes[offset + index]!, 0)
  );
};

/** Per tenure 1..horizon: P(season in stint), expected games when in it, expected PAV per game. */
function curves(
  priors: Pick<FittedPriors, 'survival' | 'games' | 'rate'>,
  basis: readonly number[]
) {
  const survival = [1];
  const games = [0];
  const rate = [0];
  for (let tenure = 1; tenure <= RULES.horizonSeasons; tenure++) {
    const hazard = logistic(linear(priors.survival, tenure, basis));
    survival.push(survival[tenure - 1]! * (1 - hazard));
    games.push(Math.exp(linear(priors.games, tenure, basis)));
    rate.push(Math.exp(linear(priors.rate, tenure, basis)));
  }
  return { survival, games, rate };
}

interface PlayerEffect {
  /** Games per season above the slot's expectation at the same tenures, shrunk. */
  games: number;
  /** PAV per game above the slot's expectation at the same tenures, shrunk. */
  rate: number;
}

const NO_EFFECT: PlayerEffect = { games: 0, rate: 0 };

/**
 * The player's development-adjusted effects at a checkpoint (owner decision 2026-10-19), each
 * additive and shrunk by its own credibility: games per season against the slot's expected games at
 * each tenure, over every in-stint season (a season with no game is evidence about playing time), and
 * PAV per game against the slot's expected PAV per game at each tenure, over the seasons he played (a
 * season with no game says nothing about his level).
 */
function playerEffect(
  stint: Stint,
  curve: ReturnType<typeof curves>,
  checkpoint: number,
  priors: Pick<FittedPriors, 'gamesCredibilitySeasons' | 'rateCredibilityGames'>
): PlayerEffect {
  let gamesResidual = 0;
  let seasons = 0;
  let rateResidual = 0;
  let games = 0;
  for (const season of stint.seasons) {
    if (season.tenure > checkpoint) continue;
    gamesResidual += season.games - curve.games[season.tenure]!;
    seasons += 1;
    rateResidual += season.pav - season.games * curve.rate[season.tenure]!;
    games += season.games;
  }
  return {
    games: seasons === 0 ? 0 : gamesResidual / (seasons + priors.gamesCredibilitySeasons),
    rate: games === 0 ? 0 : rateResidual / (games + priors.rateCredibilityGames),
  };
}

/**
 * Survival-weighted expected PAV still to come after `fromTenure`, with the additive effects:
 * `Σ S(t)/S(τ) × max(0, games(t) + u_games) × (rate(t) + u_rate)`.
 */
function remaining(
  curve: ReturnType<typeof curves>,
  fromTenure: number,
  throughTenure: number,
  effect: PlayerEffect
): number {
  let total = 0;
  for (let tenure = fromTenure + 1; tenure <= throughTenure; tenure++) {
    const still = curve.survival[tenure]! / curve.survival[fromTenure]!;
    total +=
      still *
      Math.max(0, curve.games[tenure]! + effect.games) *
      (curve.rate[tenure]! + effect.rate);
  }
  return total;
}

/**
 * The value line at a checkpoint: PAV produced so far plus expected PAV still to come. With
 * `ownForm` false (the draft-slot-only baseline) the player's own seasons move nothing.
 */
function valueAt(
  stint: Stint,
  priors: FittedPriors,
  checkpoint: number,
  throughTenure: number,
  ownForm = true
): number {
  const curve = curves(priors, stint.slotBasis);
  if (checkpoint === 0) return remaining(curve, 0, throughTenure, NO_EFFECT);
  const produced = stint.seasons
    .filter(({ tenure }) => tenure <= checkpoint)
    .reduce((sum, { pav }) => sum + pav, 0);
  if (closedAt(stint, checkpoint)) return produced;
  const effect = ownForm ? playerEffect(stint, curve, checkpoint, priors) : NO_EFFECT;
  return produced + remaining(curve, checkpoint, throughTenure, effect);
}

/** Fits the survival, games and rate curves, then the two credibility weights, on `stints`. */
function fitPriors(stints: readonly Stint[]): FittedPriors {
  const hazard: GlmObservation[] = [];
  const games: GlmObservation[] = [];
  const rate: GlmObservation[] = [];
  for (const stint of stints) {
    for (let tenure = 1; tenure <= stint.observed; tenure++) {
      const inStint = stint.seasons.some((season) => season.tenure === tenure);
      const previousInStint =
        tenure === 1 || stint.seasons.some((season) => season.tenure === tenure - 1);
      if (!previousInStint) break;
      const group = tenureGroup(tenure);
      hazard.push({
        group,
        slotBasis: stint.slotBasis,
        response: inStint ? 0 : 1,
        weight: 1,
        offset: 0,
      });
      if (!inStint) break;
    }
    for (const season of stint.seasons) {
      const group = tenureGroup(season.tenure);
      games.push({
        group,
        slotBasis: stint.slotBasis,
        response: season.games,
        weight: 1,
        offset: 0,
      });
      if (season.games > 0)
        rate.push({
          group,
          slotBasis: stint.slotBasis,
          response: season.pav,
          weight: 1,
          offset: Math.log(season.games),
        });
    }
  }
  for (let group = 0; group < RULES.pooledTenureFrom; group++) {
    const members = hazard.filter((observation) => observation.group === group);
    const basis = SLOT_KNOTS.concat(0).map((_, index) =>
      members.length === 0
        ? 0
        : members.reduce((sum, observation) => sum + observation.slotBasis[index]!, 0) /
          members.length
    );
    for (const response of [0, 1])
      hazard.push({
        group,
        slotBasis: basis,
        response,
        weight: RULES.hazardPseudoCount,
        offset: 0,
      });
  }
  const curvePriors = {
    survival: fitGlm('binomial', hazard, 'survival'),
    games: fitGlm('poisson', games, 'games'),
    rate: fitGlm('poisson', rate, 'rate'),
  };
  // Each k from variance components: a one-way random-effects ANOVA (method of moments, unbalanced)
  // on the residuals of every in-stint season against its slot's expectation at that tenure.
  const gamesRows: VarianceRow[][] = [];
  const rateRows: VarianceRow[][] = [];
  for (const stint of stints) {
    const curve = curves(curvePriors, stint.slotBasis);
    gamesRows.push(
      stint.seasons.map(({ tenure, games }) => ({
        value: games - curve.games[tenure]!,
        weight: 1,
      }))
    );
    rateRows.push(
      stint.seasons
        .filter(({ games }) => games > 0)
        .map(({ tenure, games, pav }) => ({
          value: pav / games - curve.rate[tenure]!,
          weight: games,
        }))
    );
  }
  const gamesComponents = varianceComponents(gamesRows, 'games');
  const rateComponents = varianceComponents(rateRows, 'PAV per game');
  return {
    ...curvePriors,
    gamesCredibilitySeasons: gamesComponents.within / gamesComponents.between,
    rateCredibilityGames: rateComponents.within / rateComponents.between,
    varianceComponents: { games: gamesComponents, rate: rateComponents },
  };
}

interface VarianceRow {
  value: number;
  /** Seasons weigh 1 for games; games weigh their count for PAV per game. */
  weight: number;
}

interface VarianceComponents {
  stints: number;
  observations: number;
  /** Total weight: seasons for games, games for PAV per game. */
  weight: number;
  /** Within-player variance of one unit of weight around the player's own level. */
  within: number;
  /** Between-player variance of the true effect. */
  between: number;
}

/**
 * The method-of-moments estimate for a weighted, unbalanced one-way random-effects model: within
 * from the weighted squares around each player's mean on N − I degrees of freedom; between from the
 * weighted squares of player means around the grand mean, less (I − 1) within, over W − Σ W_i² / W.
 */
function varianceComponents(groups: readonly VarianceRow[][], label: string): VarianceComponents {
  const players = groups.filter((rows) => rows.length > 0);
  const observations = players.reduce((sum, rows) => sum + rows.length, 0);
  if (players.length < 2 || observations <= players.length)
    throw new Error(`Too few in-stint seasons to estimate the ${label} variance components.`);
  const weightOf = (rows: readonly VarianceRow[]) =>
    rows.reduce((sum, { weight }) => sum + weight, 0);
  const meanOf = (rows: readonly VarianceRow[]) =>
    rows.reduce((sum, { value, weight }) => sum + value * weight, 0) / weightOf(rows);
  const weight = players.reduce((sum, rows) => sum + weightOf(rows), 0);
  const grand = meanOf(players.flat());
  let withinSquares = 0;
  let betweenSquares = 0;
  let squaredWeights = 0;
  for (const rows of players) {
    const mean = meanOf(rows);
    for (const row of rows) withinSquares += row.weight * (row.value - mean) ** 2;
    betweenSquares += weightOf(rows) * (mean - grand) ** 2;
    squaredWeights += weightOf(rows) ** 2;
  }
  const within = withinSquares / (observations - players.length);
  const between =
    (betweenSquares - (players.length - 1) * within) / (weight - squaredWeights / weight);
  if (!(within > 0) || !(between > 0))
    throw new Error(
      `The ${label} between-player variance is not positive; own form carries no signal.`
    );
  return { stints: players.length, observations, weight, within, between };
}

export interface AflTradeValueLineFitErrorRow {
  range: string;
  checkpoint: number;
  selections: number;
  meanPredicted: number;
  meanRealized: number;
  bias: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
}

function errorRow(
  range: string,
  checkpoint: number,
  pairs: readonly { predicted: number; realized: number }[]
): AflTradeValueLineFitErrorRow {
  const n = pairs.length;
  const mean = (values: number[]) =>
    n === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / n;
  return {
    range,
    checkpoint,
    selections: n,
    meanPredicted: round(mean(pairs.map(({ predicted }) => predicted)), 3),
    meanRealized: round(mean(pairs.map(({ realized }) => realized)), 3),
    bias: round(mean(pairs.map(({ predicted, realized }) => predicted - realized)), 3),
    meanAbsoluteError: round(
      mean(pairs.map(({ predicted, realized }) => Math.abs(predicted - realized))),
      3
    ),
    rootMeanSquaredError: round(
      Math.sqrt(mean(pairs.map(({ predicted, realized }) => (predicted - realized) ** 2))),
      3
    ),
  };
}

const rangeOf = (slot: number) =>
  RULES.pickRanges.find(
    ({ from, through }) => slot >= from && (through === null || slot <= through)
  )!.label;

const publishCoefficients = (coefficients: Coefficients) => ({
  interceptsByTenure: coefficients.intercepts.map((value, index) => ({
    tenure: index + 1 === RULES.pooledTenureFrom ? `${index + 1}+` : `${index + 1}`,
    intercept: round(value, 9),
  })),
  lnSlotSlopes: BANDS.flatMap((start, band) => {
    const end = BANDS[band + 1];
    const tenures = end === undefined ? `${start}+` : `${start}-${end - 1}`;
    return ['1-10', '10-30', '30+'].map((picks, index) => ({
      tenures,
      picks,
      slope: round(coefficients.slotSlopes[band * 3 + index]!, 9),
    }));
  }),
});

const publishComponents = (components: VarianceComponents) => ({
  stints: components.stints,
  observations: components.observations,
  weight: components.weight,
  within: round(components.within, 9),
  between: round(components.between, 9),
});

const publishPriors = (priors: FittedPriors) => ({
  survivalHazardLogit: publishCoefficients(priors.survival),
  gamesWhenInStintLog: publishCoefficients(priors.games),
  pavPerGameLog: publishCoefficients(priors.rate),
  gamesCredibilitySeasons: round(priors.gamesCredibilitySeasons, 6),
  rateCredibilityGames: round(priors.rateCredibilityGames, 6),
  varianceComponents: {
    games: publishComponents(priors.varianceComponents.games),
    rate: publishComponents(priors.varianceComponents.rate),
  },
});

/** Fits on every class, then back-tests by holding out each mature class in turn. */
export function fitAflTradeValueLine(inputs: AflTradeValueLineFitInputs) {
  const { stints, lastSeason } = buildStints(inputs);
  const classes = [...new Set(stints.map(({ selection }) => selection.draftYear))].sort(
    (left, right) => left - right
  );
  const priors = fitPriors(stints);
  const realizedOf = (stint: Stint) => stint.seasons.reduce((sum, { pav }) => sum + pav, 0);

  const heldOut = classes.filter(
    (year) => lastSeason - year >= RULES.backTestMinimumObservedSeasons
  );
  const pairs: {
    draftYear: number;
    slot: number;
    range: string;
    checkpoint: number | 'dpvc';
    predicted: number;
    /** The draft-slot-only baseline at the same checkpoint (own form moves nothing). */
    slotOnly: number;
    realized: number;
    mature: boolean;
  }[] = [];
  const classRows: {
    draftYear: number;
    selections: number;
    openStints: number;
    realized: number;
    fittedAtDraft: number;
    fittedAtYear1: number;
    fittedAtYear3: number;
    dpvcAtDraft: number;
    dpvcSelections: number;
    gamesCredibilitySeasons: number;
    rateCredibilityGames: number;
  }[] = [];
  for (const year of heldOut) {
    const held = stints.filter(({ selection }) => selection.draftYear === year);
    const fitted = fitPriors(stints.filter(({ selection }) => selection.draftYear !== year));
    const mature = lastSeason - year >= RULES.matureObservedSeasons;
    const fittedAt = new Map<number, number>();
    let dpvcAtDraft = 0;
    let dpvcSelections = 0;
    for (const stint of held) {
      const realized = realizedOf(stint);
      const slot = stint.selection.slot;
      const range = rangeOf(slot);
      for (const checkpoint of RULES.backTestCheckpoints) {
        // No hindsight: the held-out class's own seasons count only up to the checkpoint.
        const predicted = valueAt(stint, fitted, checkpoint, stint.observed);
        const slotOnly = valueAt(stint, fitted, checkpoint, stint.observed, false);
        pairs.push({
          draftYear: year,
          slot,
          range,
          checkpoint,
          predicted,
          slotOnly,
          realized,
          mature,
        });
        fittedAt.set(checkpoint, (fittedAt.get(checkpoint) ?? 0) + predicted);
      }
      if (slot <= HPN_DPVC_V3_LAST_SUPPORTED_PICK) {
        const dpvc = hpnDpv3ValueForPick(slot);
        pairs.push({
          draftYear: year,
          slot,
          range,
          checkpoint: 'dpvc',
          predicted: dpvc,
          slotOnly: dpvc,
          realized,
          mature,
        });
        dpvcAtDraft += dpvc;
        dpvcSelections++;
      }
    }
    classRows.push({
      draftYear: year,
      selections: held.length,
      openStints: held.filter(({ closedAtTenure }) => closedAtTenure === null).length,
      realized: round(
        held.reduce((sum, stint) => sum + realizedOf(stint), 0),
        3
      ),
      fittedAtDraft: round(fittedAt.get(0) ?? 0, 3),
      fittedAtYear1: round(fittedAt.get(1) ?? 0, 3),
      fittedAtYear3: round(fittedAt.get(3) ?? 0, 3),
      dpvcAtDraft: round(dpvcAtDraft, 3),
      dpvcSelections,
      gamesCredibilitySeasons: round(fitted.gamesCredibilitySeasons, 6),
      rateCredibilityGames: round(fitted.rateCredibilityGames, 6),
    });
  }
  const ranges = [...RULES.pickRanges.map(({ label }) => label), 'all'];
  const select = (range: string, checkpoint: number | 'dpvc', matureOnly: boolean) =>
    pairs.filter(
      (pair) =>
        (range === 'all' || pair.range === range) &&
        pair.checkpoint === checkpoint &&
        (!matureOnly || pair.mature)
    );
  const byRangeAndCheckpoint = RULES.backTestCheckpoints.flatMap((checkpoint) =>
    ranges.map((range) => errorRow(range, checkpoint, select(range, checkpoint, false)))
  );
  const slotOnlyByRangeAndCheckpoint = RULES.backTestCheckpoints.flatMap((checkpoint) =>
    ranges.map((range) =>
      errorRow(
        range,
        checkpoint,
        select(range, checkpoint, false).map(({ slotOnly, realized }) => ({
          predicted: slotOnly,
          realized,
        }))
      )
    )
  );
  // Calibration: mean realized against mean predicted, in bins of predicted value.
  const bins = RULES.calibrationBins;
  // A first bin below 0 catches a value line whose added effect leaves it negative.
  const calibration = RULES.backTestCheckpoints.flatMap((checkpoint) =>
    [null, ...bins].map((from, index) => {
      const through = index === 0 ? bins[0]! : (bins[index] ?? null);
      const members = select('all', checkpoint, false).filter(
        ({ predicted }) =>
          (from === null || predicted >= from) && (through === null || predicted < through)
      );
      const row = errorRow('all', checkpoint, members);
      return {
        checkpoint,
        predictedFrom: from,
        predictedBelow: through,
        selections: row.selections,
        meanPredicted: row.meanPredicted,
        meanRealized: row.meanRealized,
      };
    })
  );
  // An interval: the realized-minus-predicted quantiles by range and checkpoint.
  const quantile = (values: number[], q: number) => {
    const sorted = [...values].sort((left, right) => left - right);
    if (sorted.length === 0) return 0;
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
  };
  const intervals = RULES.backTestCheckpoints.flatMap((checkpoint) =>
    ranges.map((range) => {
      const residuals = select(range, checkpoint, false).map(
        ({ predicted, realized }) => realized - predicted
      );
      return {
        range,
        checkpoint,
        selections: residuals.length,
        lower: round(quantile(residuals, RULES.intervalQuantiles[0]), 3),
        upper: round(quantile(residuals, RULES.intervalQuantiles[1]), 3),
      };
    })
  );
  // The same selections DPVC covers (slots 1 to 90), so the two priors are compared like for like.
  const priorComparison = (matureOnly: boolean) =>
    ranges.map((range) => {
      const dpvc = select(range, 'dpvc', matureOnly);
      const fitted = select(range, 0, matureOnly).filter(
        ({ slot }) => slot <= HPN_DPVC_V3_LAST_SUPPORTED_PICK
      );
      return {
        range,
        fittedFirstStintCurve: errorRow(range, 0, fitted),
        hpnDpvcV3: errorRow(range, 0, dpvc),
      };
    });

  const stintDiagnostics = {
    selections: stints.length,
    open: stints.filter(({ closedAtTenure }) => closedAtTenure === null).length,
    closedMoved: stints.filter(({ closeReason }) => closeReason === 'moved').length,
    closedRedrafted: stints.filter(({ closeReason }) => closeReason === 'redrafted').length,
    closedInactive: stints.filter(({ closeReason }) => closeReason === 'inactive').length,
    neverPlayed: stints.filter(({ seasons }) => seasons.every(({ games }) => games === 0)).length,
    inactiveClosuresWithLaterGames: stints.filter(({ returnedGames }) => returnedGames > 0).length,
    pavAfterInactiveClosure: round(
      stints.reduce((sum, { returnedPav }) => sum + returnedPav, 0),
      3
    ),
    firstStintPav: round(
      stints.reduce((sum, stint) => sum + realizedOf(stint), 0),
      3
    ),
  };

  const pickCurve = Array.from({ length: HPN_DPVC_V3_LAST_SUPPORTED_PICK }, (_, index) => {
    const slot = index + 1;
    const curve = curves(priors, slotBasis(slot));
    return {
      slot,
      expectedFirstStintPav: round(remaining(curve, 0, RULES.horizonSeasons, NO_EFFECT), 3),
      hpnDpvcV3: round(hpnDpv3ValueForPick(slot), 3),
      stillInStintAfterSeasons: {
        '3': round(curve.survival[3]!, 4),
        '5': round(curve.survival[5]!, 4),
        '10': round(curve.survival[10]!, 4),
      },
    };
  });

  const content = {
    schemaVersion: AFL_TRADE_VALUE_LINE_FIT_SCHEMA_VERSION,
    methodId: inputs.games.methodId,
    rules: RULES,
    fitWindow: {
      draftClasses: { from: classes[0]!, through: classes[classes.length - 1]! },
      seasons: inputs.games.seasons.map(({ season, calculationId }) => ({ season, calculationId })),
      lastSeason,
      selectionsByClass: classes.map((year) => ({
        draftYear: year,
        selections: stints.filter(({ selection }) => selection.draftYear === year).length,
        observedSeasons: lastSeason - year,
      })),
    },
    stints: stintDiagnostics,
    parameters: publishPriors(priors),
    pickCurve,
    backTest: {
      heldOutClasses: heldOut,
      matureClasses: heldOut.filter((year) => lastSeason - year >= RULES.matureObservedSeasons),
      realized: 'first-stint PAV at the drafting club through the last season read',
      predicted: 'value line at the checkpoint, expected PAV summed through the last season read',
      byRangeAndCheckpoint,
      slotOnlyByRangeAndCheckpoint,
      calibration,
      intervals,
      priorAtDraft: { allHeldOut: priorComparison(false), matureOnly: priorComparison(true) },
      classes: classRows,
    },
  };
  return { fitId: createAflTradeContentAddress('value-line-fit', content), content };
}

export type AflTradeValueLineFit = ReturnType<typeof fitAflTradeValueLine>;
