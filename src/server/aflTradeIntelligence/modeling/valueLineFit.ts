import {
  aflTradeFirstStintGames,
  type AflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGamesRow,
} from './playerSeasonGames';

/**
 * Fits the value-line method's parameters from history (implementation order step 2,
 * statlyaus/Statly#789; docs/architecture/afl-trade-value-line-method.md, "Fit and back-test"). It is
 * pure: it reads national-draft selections and the player-season games read model and returns the
 * first-stint pick curve, the survival curves, expected games, and k. The owner's rules are fixed; the
 * modelling choices the spec leaves open are the constants below, each listed in the doc for the owner
 * to confirm.
 */

export const AFL_TRADE_VALUE_LINE_FIT_RULES = {
  /** Draft-slot groups for survival and games, the spec's back-test ranges. */
  bands: [
    { id: '1-10', from: 1, through: 10 },
    { id: '11-30', from: 11, through: 30 },
    { id: '31+', from: 31, through: null },
  ],
  /** Seasons after the draft summed for an expectation; a technical truncation, not a cap. */
  horizonSeasons: 20,
  /** A tenure's hazard and mean games are estimated only with at least this many draftees. */
  minimumAtRisk: 20,
  /** Beyond support, the hazard is the pooled hazard of the last supported tenures. */
  tailTenures: 3,
  /**
   * Two full seasons without a game for the club at the end of the record read (as seen at the
   * checkpoint) are a delisting or retirement. A return to the club after such a gap, with no game
   * elsewhere, reads as one stint once the return is read.
   */
  seasonsWithoutGameEndingStint: 2,
  /** Form window (Owner: three seasons) and its weights, oldest to newest. */
  formWeights: [1, 2, 3],
  /** k is searched on this integer grid of games. */
  kGrid: { from: 0, through: 2000 },
} as const;

type BandId = (typeof AFL_TRADE_VALUE_LINE_FIT_RULES.bands)[number]['id'];

export interface AflTradeValueLineDraftee {
  selectionId: string;
  draftYear: number;
  selectionNumber: number;
  /** The drafting club. */
  clubId: string;
  playerId: string;
}

/** One season of a draftee's first stint at the drafting club, as seen at the read's last season. */
export interface AflTradeValueLineStintSeason {
  /** Seasons after the draft: the season after the draft is tenure 1. */
  tenure: number;
  games: number;
  pav: number;
}

/**
 * A draftee's first stint as seen at season `asOfSeason`, with no later season read. `tenure` is the
 * last tenure he counts as at the club: the earlier of the move (the first season he appears for
 * another club, which still counts if he also played here) and two full seasons after his last game
 * here up to `asOfSeason`. `ended` is false while neither has happened by `asOfSeason` (censored).
 */
export interface AflTradeValueLineStint {
  draftee: AflTradeValueLineDraftee;
  band: BandId;
  asOfSeason: number;
  tenure: number;
  ended: boolean;
  /** Seasons 1..`tenure`, with 0 games and 0 PAV where he did not play for the club. */
  seasons: readonly AflTradeValueLineStintSeason[];
}

export const aflTradeValueLineBand = (selectionNumber: number): BandId => {
  const band = AFL_TRADE_VALUE_LINE_FIT_RULES.bands.find(
    ({ from, through }) =>
      selectionNumber >= from && (through === null || selectionNumber <= through)
  );
  if (!band || !Number.isInteger(selectionNumber))
    throw new RangeError(`Selection ${selectionNumber} is not a national-draft slot.`);
  return band.id;
};

/** Each player's rows, read once, so a stint never scans the whole model. */
export function indexAflTradeValueLineRows(
  model: AflTradePlayerSeasonGames
): ReadonlyMap<string, readonly AflTradePlayerSeasonGamesRow[]> {
  const index = new Map<string, AflTradePlayerSeasonGamesRow[]>();
  for (const row of model.rows) {
    const rows = index.get(row.playerId);
    if (rows) rows.push(row);
    else index.set(row.playerId, [row]);
  }
  return index;
}

export function aflTradeValueLineStint(
  model: AflTradePlayerSeasonGames,
  rowsByPlayer: ReadonlyMap<string, readonly AflTradePlayerSeasonGamesRow[]>,
  draftee: AflTradeValueLineDraftee,
  asOfSeason: number
): AflTradeValueLineStint {
  const observed = asOfSeason - draftee.draftYear;
  const band = aflTradeValueLineBand(draftee.selectionNumber);
  if (observed < 0) throw new RangeError(`${draftee.selectionId} is read before its draft.`);
  if (observed === 0) return { draftee, band, asOfSeason, tenure: 0, ended: false, seasons: [] };
  const seasons = model.seasons.filter(({ season }) => season <= asOfSeason);
  for (const needed of [draftee.draftYear + 1, asOfSeason])
    if (!seasons.some(({ season }) => season === needed))
      throw new RangeError(`Season ${needed} is not in the read model.`);
  const stint = aflTradeFirstStintGames(
    {
      methodId: model.methodId,
      seasons,
      rows: (rowsByPlayer.get(draftee.playerId) ?? []).filter((row) => row.season <= asOfSeason),
      discrepancies: [],
    },
    draftee.playerId,
    draftee.clubId,
    draftee.draftYear + 1
  );
  if (stint.seasonsUnavailable.length > 0)
    throw new Error(
      `Seasons ${stint.seasonsUnavailable.join(', ')} have no finalized calculation; the fit refuses.`
    );
  const counted = stint.seasons.map(({ season, games, pav }) => ({
    tenure: season - draftee.draftYear,
    games,
    pav,
  }));
  const lastGame = Math.max(0, ...counted.filter(({ games }) => games > 0).map((s) => s.tenure));
  const gapEnd = lastGame + AFL_TRADE_VALUE_LINE_FIT_RULES.seasonsWithoutGameEndingStint;
  const moved = stint.status === 'closed';
  const moveEnd = moved
    ? stint.endSeason === null
      ? 0
      : stint.endSeason - draftee.draftYear
    : observed;
  const tenure = Math.min(moveEnd, gapEnd, observed);
  return {
    draftee,
    band,
    asOfSeason,
    tenure,
    ended: moved || gapEnd < observed,
    seasons: counted.filter((season) => season.tenure <= tenure),
  };
}

export interface AflTradeValueLineSurvivalTenure {
  tenure: number;
  atRisk: number;
  exits: number;
  hazard: number;
  /** P(still at the drafting club in this tenure). */
  survival: number;
  /** False when fewer than `minimumAtRisk` draftees were at risk and the tail hazard stands in. */
  supported: boolean;
  /** Mean games for the club among draftees at the club in this tenure (0-game seasons included). */
  meanGames: number;
  gamesSupported: boolean;
}

export interface AflTradeValueLineBandFit {
  band: BandId;
  draftees: number;
  tailHazard: number;
  tenures: readonly AflTradeValueLineSurvivalTenure[];
  /** Σ survival × mean games over the horizon: expected first-stint games for the band. */
  expectedGames: number;
}

export interface AflTradeValueLineFit {
  window: {
    draftYears: { from: number; through: number };
    seasons: { from: number; through: number };
    draftees: number;
  };
  bands: readonly AflTradeValueLineBandFit[];
  /** Prior PAV per game by slot: max(0, intercept + slope × ln(slot)), games-weighted least squares. */
  rate: { intercept: number; slope: number; seasons: number; games: number };
  /** Expected first-stint games by slot: max(0, intercept + slope × ln(slot)), least squares. */
  games: { intercept: number; slope: number; draftees: number };
  /** expected_games = prior + rho × (own mean − prior mean) over the form window, rho in [0, 1]. */
  availability: { rho: number; pairs: number };
  /** Z = games / (games + k); k minimises games-weighted squared error of the remaining stint rate. */
  credibility: {
    k: number;
    pairs: number;
    games: number;
    weightedSquaredError: number;
    priorOnlySquaredError: number;
    onBoundary: boolean;
  };
}

const ln = Math.log;

function weightedLine(points: readonly { x: number; y: number; w: number }[]) {
  const w = points.reduce((sum, p) => sum + p.w, 0);
  if (w <= 0) throw new Error('No data to fit a line.');
  const mx = points.reduce((sum, p) => sum + p.w * p.x, 0) / w;
  const my = points.reduce((sum, p) => sum + p.w * p.y, 0) / w;
  const sxx = points.reduce((sum, p) => sum + p.w * (p.x - mx) ** 2, 0);
  const sxy = points.reduce((sum, p) => sum + p.w * (p.x - mx) * (p.y - my), 0);
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/** Kaplan-Meier retention and mean games for one band, from stints all read at the same season. */
export function fitAflTradeValueLineBand(
  band: BandId,
  stints: readonly AflTradeValueLineStint[]
): AflTradeValueLineBandFit {
  const { horizonSeasons, minimumAtRisk, tailTenures } = AFL_TRADE_VALUE_LINE_FIT_RULES;
  const raw = Array.from({ length: horizonSeasons }, (_, index) => {
    const tenure = index + 1;
    const atRiskStints = stints.filter(
      (stint) => stint.tenure >= tenure - 1 && (stint.ended || stint.tenure >= tenure)
    );
    const exits = atRiskStints.filter((stint) => stint.ended && stint.tenure === tenure - 1).length;
    const here = stints.filter((stint) => stint.tenure >= tenure);
    const games = here.reduce((sum, stint) => sum + stint.seasons[tenure - 1]!.games, 0);
    return { tenure, atRisk: atRiskStints.length, exits, here: here.length, games };
  });
  const supported = raw.filter(({ atRisk }) => atRisk >= minimumAtRisk);
  if (supported.length === 0) throw new Error(`Band ${band} has no supported tenure.`);
  const tail = supported.slice(-tailTenures);
  const tailHazard =
    tail.reduce((sum, { exits }) => sum + exits, 0) /
    tail.reduce((sum, { atRisk }) => sum + atRisk, 0);
  let survival = 1;
  let meanGames = 0;
  const tenures = raw.map((row) => {
    const isSupported = row.atRisk >= minimumAtRisk;
    const hazard = isSupported ? row.exits / row.atRisk : tailHazard;
    survival *= 1 - hazard;
    const gamesSupported = row.here >= minimumAtRisk;
    // Beyond support the last supported mean stands in.
    if (gamesSupported) meanGames = row.games / row.here;
    return {
      tenure: row.tenure,
      atRisk: row.atRisk,
      exits: row.exits,
      hazard,
      survival,
      supported: isSupported,
      meanGames,
      gamesSupported,
    };
  });
  if (!tenures[0]!.gamesSupported) throw new Error(`Band ${band} has no supported first season.`);
  return {
    band,
    draftees: stints.length,
    tailHazard,
    tenures,
    expectedGames: tenures.reduce((sum, t) => sum + t.survival * t.meanGames, 0),
  };
}

const bandFit = (fit: Pick<AflTradeValueLineFit, 'bands'>, band: BandId) => {
  const found = fit.bands.find((candidate) => candidate.band === band);
  if (!found) throw new Error(`Band ${band} was not fitted.`);
  return found;
};

const survivalAt = (band: AflTradeValueLineBandFit, tenure: number) =>
  tenure <= 0 ? 1 : band.tenures[Math.min(tenure, band.tenures.length) - 1]!.survival;

/** The slot's prior PAV per game. */
export const aflTradeValueLinePriorRate = (fit: Pick<AflTradeValueLineFit, 'rate'>, slot: number) =>
  Math.max(0, fit.rate.intercept + fit.rate.slope * ln(slot));

/** The slot's expected first-stint games. */
export const aflTradeValueLineExpectedGames = (
  fit: Pick<AflTradeValueLineFit, 'games'>,
  slot: number
) => Math.max(0, fit.games.intercept + fit.games.slope * ln(slot));

/** Prior games for the club at a tenure, for a draftee at the club then: the band's shape, scaled. */
function priorGames(
  fit: Pick<AflTradeValueLineFit, 'bands' | 'games'>,
  slot: number,
  tenure: number
) {
  const band = bandFit(fit, aflTradeValueLineBand(slot));
  const row = band.tenures[Math.min(tenure, band.tenures.length) - 1]!;
  return band.expectedGames === 0
    ? 0
    : (row.meanGames * aflTradeValueLineExpectedGames(fit, slot)) / band.expectedGames;
}

/** The first-stint pick curve: the slot's expected first-stint PAV at the draft. */
export const aflTradeValueLinePickValue = (
  fit: Pick<AflTradeValueLineFit, 'rate' | 'games'>,
  slot: number
) => aflTradeValueLinePriorRate(fit, slot) * aflTradeValueLineExpectedGames(fit, slot);

/** The form window at a tenure: the last up-to-three seasons, oldest first. */
function formWindow(stint: AflTradeValueLineStint, tenure: number) {
  const weights = AFL_TRADE_VALUE_LINE_FIT_RULES.formWeights;
  const seasons = stint.seasons.filter(
    (season) => season.tenure <= tenure && season.tenure > tenure - weights.length
  );
  const weightOf = (season: AflTradeValueLineStintSeason) =>
    weights[weights.length - 1 - (tenure - season.tenure)]!;
  const weightedGames = seasons.reduce((sum, s) => sum + weightOf(s) * s.games, 0);
  return {
    seasons,
    games: seasons.reduce((sum, s) => sum + s.games, 0),
    // Owner: a season with no games adds nothing to either sum, so it neither lowers nor props up.
    ownRate:
      weightedGames === 0
        ? null
        : seasons.reduce((sum, s) => sum + weightOf(s) * s.pav, 0) / weightedGames,
  };
}

const blendedRate = (k: number, prior: number, window: ReturnType<typeof formWindow>) => {
  if (window.ownRate === null || window.games === 0) return prior;
  const z = window.games / (window.games + k);
  return z * window.ownRate + (1 - z) * prior;
};

/**
 * Fits every parameter from the stints of `draftees`, each as seen at `asOfSeason` (no later season
 * read). Classes drafted in or after `asOfSeason` have no season and are left out.
 */
export function fitAflTradeValueLine(input: {
  model: AflTradePlayerSeasonGames;
  draftees: readonly AflTradeValueLineDraftee[];
  asOfSeason: number;
  rowsByPlayer?: ReadonlyMap<string, readonly AflTradePlayerSeasonGamesRow[]>;
}): AflTradeValueLineFit {
  const rowsByPlayer = input.rowsByPlayer ?? indexAflTradeValueLineRows(input.model);
  const stints = input.draftees
    .filter(({ draftYear }) => draftYear < input.asOfSeason)
    .map((draftee) => aflTradeValueLineStint(input.model, rowsByPlayer, draftee, input.asOfSeason));
  if (stints.length === 0) throw new Error('No draft class has a season to fit from.');
  const draftYears = stints.map(({ draftee }) => draftee.draftYear);
  const bands = AFL_TRADE_VALUE_LINE_FIT_RULES.bands.map(({ id }) =>
    fitAflTradeValueLineBand(
      id,
      stints.filter((stint) => stint.band === id)
    )
  );

  const ratePoints = stints.flatMap((stint) =>
    stint.seasons
      .filter(({ games }) => games > 0)
      .map(({ games, pav }) => ({ x: ln(stint.draftee.selectionNumber), y: pav / games, w: games }))
  );
  const rate = {
    ...weightedLine(ratePoints),
    seasons: ratePoints.length,
    games: ratePoints.reduce((sum, p) => sum + p.w, 0),
  };

  // Expected first-stint games: observed games, plus the band's expectation after a censored stint.
  const gamePoints = stints.map((stint) => {
    const band = bandFit({ bands }, stint.band);
    let games = stint.seasons.reduce((sum, s) => sum + s.games, 0);
    if (!stint.ended) {
      const base = survivalAt(band, stint.tenure);
      for (const row of band.tenures)
        if (row.tenure > stint.tenure && base > 0) games += (row.survival / base) * row.meanGames;
    }
    return { x: ln(stint.draftee.selectionNumber), y: games, w: 1 };
  });
  const games = { ...weightedLine(gamePoints), draftees: gamePoints.length };
  const partial = { bands, rate, games };

  // Availability: next season's games against the form window's games, both relative to the prior.
  let sxy = 0;
  let sxx = 0;
  let availabilityPairs = 0;
  for (const stint of stints)
    for (let tenure = 1; tenure < stint.tenure; tenure++) {
      const window = formWindow(stint, tenure);
      const slot = stint.draftee.selectionNumber;
      const priorMean =
        window.seasons.reduce((sum, s) => sum + priorGames(partial, slot, s.tenure), 0) /
        window.seasons.length;
      const x = window.games / window.seasons.length - priorMean;
      const y = stint.seasons[tenure]!.games - priorGames(partial, slot, tenure + 1);
      sxy += x * y;
      sxx += x * x;
      availabilityPairs++;
    }
  const rho = sxx === 0 ? 0 : Math.min(1, Math.max(0, sxy / sxx));

  // k: the remaining observed stint's PAV per game against the blend at each tenure.
  const pairs = stints.flatMap((stint) =>
    Array.from({ length: Math.max(0, stint.tenure - 1) }, (_, index) => index + 1).flatMap(
      (tenure) => {
        const rest = stint.seasons.filter((s) => s.tenure > tenure);
        const restGames = rest.reduce((sum, s) => sum + s.games, 0);
        if (restGames === 0) return [];
        return [
          {
            window: formWindow(stint, tenure),
            prior: aflTradeValueLinePriorRate(partial, stint.draftee.selectionNumber),
            target: rest.reduce((sum, s) => sum + s.pav, 0) / restGames,
            weight: restGames,
          },
        ];
      }
    )
  );
  if (pairs.length === 0) throw new Error('No stint has a later season to fit k from.');
  const errorAt = (k: number) =>
    pairs.reduce(
      (sum, pair) =>
        sum + pair.weight * (pair.target - blendedRate(k, pair.prior, pair.window)) ** 2,
      0
    );
  const { from, through } = AFL_TRADE_VALUE_LINE_FIT_RULES.kGrid;
  let k: number = from;
  let best = errorAt(from);
  for (let candidate = from + 1; candidate <= through; candidate++) {
    const error = errorAt(candidate);
    if (error < best) {
      best = error;
      k = candidate;
    }
  }
  const pairGames = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  return {
    window: {
      draftYears: { from: Math.min(...draftYears), through: Math.max(...draftYears) },
      seasons: { from: Math.min(...draftYears) + 1, through: input.asOfSeason },
      draftees: stints.length,
    },
    bands,
    rate,
    games,
    availability: { rho, pairs: availabilityPairs },
    credibility: {
      k,
      pairs: pairs.length,
      games: pairGames,
      weightedSquaredError: best / pairGames,
      priorOnlySquaredError:
        pairs.reduce((sum, pair) => sum + pair.weight * (pair.target - pair.prior) ** 2, 0) /
        pairGames,
      onBoundary: k === from || k === through,
    },
  };
}

export interface AflTradeValueLinePoint {
  /** Seasons after the draft the checkpoint sits at: 0 is the draft. */
  checkpoint: number;
  realized: number;
  expectedRemaining: number;
  value: number;
  state: 'open' | 'closed';
}

/**
 * A draftee's value line at a checkpoint, from his stint as seen at that checkpoint only:
 * PAV produced so far plus Σ P(still at club) × expected games × expected rate over later seasons,
 * through `throughTenure` (default: the horizon).
 */
export function aflTradeValueLinePoint(
  fit: AflTradeValueLineFit,
  stint: AflTradeValueLineStint,
  throughTenure: number = AFL_TRADE_VALUE_LINE_FIT_RULES.horizonSeasons
): AflTradeValueLinePoint {
  const checkpoint = stint.asOfSeason - stint.draftee.draftYear;
  const realized = stint.seasons.reduce((sum, s) => sum + s.pav, 0);
  if (stint.ended)
    return { checkpoint, realized, expectedRemaining: 0, value: realized, state: 'closed' };
  const slot = stint.draftee.selectionNumber;
  const band = bandFit(fit, stint.band);
  const base = survivalAt(band, checkpoint);
  const window = formWindow(stint, checkpoint);
  const rate = blendedRate(fit.credibility.k, aflTradeValueLinePriorRate(fit, slot), window);
  const adjustment =
    window.seasons.length === 0
      ? 0
      : fit.availability.rho *
        (window.games / window.seasons.length -
          window.seasons.reduce((sum, s) => sum + priorGames(fit, slot, s.tenure), 0) /
            window.seasons.length);
  let expectedRemaining = 0;
  const last = Math.min(throughTenure, AFL_TRADE_VALUE_LINE_FIT_RULES.horizonSeasons);
  for (let tenure = checkpoint + 1; tenure <= last && base > 0; tenure++)
    expectedRemaining +=
      (survivalAt(band, tenure) / base) *
      Math.max(0, priorGames(fit, slot, tenure) + adjustment) *
      rate;
  return {
    checkpoint,
    realized,
    expectedRemaining,
    value: realized + expectedRemaining,
    state: 'open',
  };
}
