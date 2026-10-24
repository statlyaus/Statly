/**
 * Fits and back-tests the traded-player value line (value-line method, "Traded-player fit";
 * statlyaus/Statly#789, owner decision 2026-10-19): a traded player's open first stint at the
 * receiving club is estimated like a pick's. The prior is what traded players at the same career
 * stage produce from there (stage = his age less 18 for a mature-age draftee whose birth date is
 * known, owner 2026-10-24; else seasons since his draft, standing in for age), his own form is
 * blended in by the pick fit's credibility rule, and survival at the receiving club is fitted from the
 * same legs. Pure and deterministic: the same legs, draft origins and games give the same fit, byte
 * for byte. It reuses the pick fit's generic pieces (`solve`, `varianceComponents`, `errorRow`,
 * `round`) and changes nothing of it.
 */
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflTradeAssetLedgerStint } from '../valuation/assetLedgerContracts';
import type { AflTradePlayerSeasonGames } from './playerSeasonGames';
import {
  AFL_TRADE_VALUE_LINE_FIT_RULES,
  errorRow,
  round,
  solve,
  varianceComponents,
  type VarianceComponents,
  type VarianceRow,
} from './valueLineFit';

export const AFL_TRADE_TRADED_PLAYER_VALUE_LINE_FIT_SCHEMA_VERSION =
  'afl-trade-traded-player-value-line-fit/v3' as const;
const FIT_PREFIX = 'traded-player-value-line-fit';

export type AflTradeTradedPlayerStageBasis = 'birth' | 'draft' | 'first_game' | 'assumed_youngest';
export type AflTradeTradedPlayerStageBand =
  '1' | '2-3' | '4-5' | '6-7' | '8-9' | '10-11' | '12-13' | '14+';
export type AflTradeTradedPlayerPhase = 'pre_trade' | 'tenure_1' | 'tenure_2' | 'tenure_3+';

const PICK_RULES = AFL_TRADE_VALUE_LINE_FIT_RULES;

/** Every fixed choice of the traded-player fit; published with the fit. */
export const AFL_TRADE_TRADED_PLAYER_VALUE_LINE_FIT_RULES = {
  /**
   * Stage by real age (owner decisions 2026-10-24, issue 789): only for a mature-age draftee, one
   * drafted in or after the year he turns `matureAgeDraftAge`, whose birth date is known. His origin
   * is his birth year + 18, so season s is stage s - birthYear - 18. Every other player keeps his
   * career stage ("everyone drafted at 18-20 stays exactly as now"). Never later than the season
   * before his career begins.
   */
  ageStageOriginOffset: 18,
  matureAgeDraftAge: 21,
  /** Career stage of season s is s minus the origin; each band has its own intercept. */
  stageBands: [
    { band: '1', from: 1, through: 1 },
    { band: '2-3', from: 2, through: 3 },
    { band: '4-5', from: 4, through: 5 },
    { band: '6-7', from: 6, through: 7 },
    { band: '8-9', from: 8, through: 9 },
    // 10+ was one band until 2026-10-20: it valued a stage-18 veteran as a stage-10 one, and the
    // back-test put pre-2011 entrants 12 to 16 PAV high (issue 789).
    { band: '10-11', from: 10, through: 11 },
    { band: '12-13', from: 12, through: 13 },
    { band: '14+', from: 14, through: null },
  ],
  /** Band 1 holds only pre-trade seasons: a traded player's first stint season is stage 2 or later. */
  survivalBands: ['2-3', '4-5', '6-7', '8-9', '10-11', '12-13', '14+'],
  /** tenure_1 is the reference phase (effect 0); survival has no pre_trade phase. */
  phases: ['pre_trade', 'tenure_1', 'tenure_2', 'tenure_3+'],
  referencePhase: 'tenure_1',
  /** Tenures 3 and later at the receiving club share one phase. */
  pooledTenureFrom: 3,
  /** Seasons after the trade summed for a value at the full horizon. */
  horizonSeasons: 20,
  inactivityClosureSeasons: PICK_RULES.inactivityClosureSeasons,
  /**
   * Form in the exit hazard (2026-10-23, Fable review of the Petracca trade): the survival logit adds a
   * fitted slope on the player's shrunk PAV-per-game effect (`u_rate`) at the season before, so a
   * player scoring above his band is less likely to leave or retire. Before this the hazard was
   * form-blind and the back-test under-predicted high-form players (40-80 calibration bin).
   */
  survivalFormCovariate: 'rate_effect_at_previous_season' as const,
  /**
   * Retirement (2026-10-20, issue 789). An inactivity closure is an exit in the season after his last
   * game in the stint, not after the third empty season, and his empty seasons are out of the games
   * curve. At a checkpoint whose stint ends in an empty run of 1 or 2 seasons, expected remaining is
   * scaled by the fitted chance that a player in that state plays in the stint again, by stage group.
   */
  inactiveReturn: { emptyRuns: [1, 2], stageGroups: [{ from: 1 }, { from: 10 }] },
  /**
   * Own form: the owner's credibility rule (2026-10-19), read over every career season through the
   * checkpoint, pre-trade at any club included, against the prior of its own stage band and phase;
   * additive, shrunk by k. Counting pre-trade seasons is an implementation choice, not an owner rule:
   * the back-test's post-trade-only baseline tests it, for owner review.
   */
  ownFormUpdate: 'stage_and_phase_adjusted_additive_credibility',
  minimumRateCredibilityGames: PICK_RULES.minimumRateCredibilityGames,
  /** Half an event and half a non-event per survival band and tenure phase. */
  hazardPseudoCount: PICK_RULES.hazardPseudoCount,
  backTestCheckpoints: PICK_RULES.backTestCheckpoints,
  /** A trade season is held out once this many seasons after it are observed. */
  backTestMinimumObservedSeasons: 2,
  intervalQuantiles: PICK_RULES.intervalQuantiles,
  calibrationBins: PICK_RULES.calibrationBins,
} as const;

const RULES = AFL_TRADE_TRADED_PLAYER_VALUE_LINE_FIT_RULES;
type Band = AflTradeTradedPlayerStageBand;
type Phase = AflTradeTradedPlayerPhase;
const ALL_BANDS: readonly Band[] = RULES.stageBands.map(({ band }) => band);
const SURVIVAL_BANDS: readonly Band[] = RULES.survivalBands;
const ALL_PHASES: readonly Phase[] = RULES.phases;
const TENURE_PHASES: readonly Phase[] = ['tenure_1', 'tenure_2', 'tenure_3+'];

/** One player leg of a candidate trade, with its ledger stint at the receiving club from Y + 1. */
export interface AflTradeTradedPlayerFitLeg {
  transferId: string;
  transactionId: string;
  tradeSeason: number;
  playerId: string;
  receivingClubId: string;
  /** A reviewed (v4) arrival at the receiving club, the grader's check. */
  arrivalReviewed: boolean;
  stint: AflTradeAssetLedgerStint;
}

export type AflTradeTradedPlayerLegExclusion = 'player_identity_unresolved' | 'club_unresolved';

export interface AflTradeTradedPlayerDraftOrigin {
  playerId: string;
  draftYear: number;
  draftType: string;
  selectionId: string;
}

/** A player's birth year, from `outcome_player.birth_date`. */
export interface AflTradeTradedPlayerBirthYear {
  playerId: string;
  birthYear: number;
}

export interface AflTradeTradedPlayerValueLineFitInputs {
  /** The trade periods fitted, ascending and distinct. */
  tradeSeasons: readonly number[];
  legs: readonly AflTradeTradedPlayerFitLeg[];
  /** Player legs with no usable player or receiving club: counted, never fitted. */
  excludedLegs: readonly {
    transferId: string;
    transactionId: string;
    tradeSeason: number;
    reason: AflTradeTradedPlayerLegExclusion;
  }[];
  /** Every canonical draft row of the players, any draft type and year. */
  draftOrigins: readonly AflTradeTradedPlayerDraftOrigin[];
  /** The legs' players' known birth years; they stage only mature-age draftees. */
  birthYears: readonly AflTradeTradedPlayerBirthYear[];
  /** The grader's pinned PAV calculation per season, which the ledger stints read. */
  stintCalculations: readonly { season: number; calculationId: string }[];
  /** The player-season games read model, from the first season read through the last. */
  games: AflTradePlayerSeasonGames;
}

export interface AflTradeTradedPlayerCurve {
  stageIntercepts: readonly { band: AflTradeTradedPlayerStageBand; intercept: number }[];
  /** tenure_1 is the reference (0); survival has no pre_trade phase. */
  phaseEffects: readonly { phase: AflTradeTradedPlayerPhase; effect: number }[];
  /**
   * Survival only (2026-10-23): the logit's slope on the player's shrunk PAV-per-game effect at the
   * season before (`u_rate`). Absent on fits before it, read as 0.
   */
  rateEffectSlope?: number;
}

/** The `parameters` block of a sealed afl-trade-traded-player-value-line-fit/v3 artifact, plus its id. */
export interface AflTradeTradedPlayerValueLineParameters {
  fitId: string;
  survivalHazardLogit: AflTradeTradedPlayerCurve;
  gamesLog: AflTradeTradedPlayerCurve;
  pavPerGameLog: AflTradeTradedPlayerCurve;
  gamesCredibilitySeasons: number;
  rateCredibilityGames: number;
  /** The first season the fit read: a career begins no earlier than this. */
  firstReadSeason: number;
  /** P(plays in the stint again | it ends in an empty run of `emptySeasons`, stage >= stageFrom). */
  inactiveReturn: readonly AflTradeTradedPlayerInactiveReturn[];
}

export interface AflTradeTradedPlayerInactiveReturn {
  stageFrom: number;
  emptySeasons: number;
  probability: number;
  /** Resolved runs fitted (pseudo-counts excluded) and those that played again. */
  runs: number;
  returned: number;
}

export interface AflTradeTradedPlayerValueInput {
  playerId: string;
  receivingClubId: string;
  /** The trade period season Y; the stint starts in Y + 1. */
  tradeSeason: number;
  /** The stage of season s is s - originSeason; leftCensored means originSeason is an upper bound. */
  stage: AflTradeTradedPlayerStage;
  /** Every read season from stage 1 (or the first read season) onward, at any club, 0/0 when he played nowhere. */
  career: readonly { season: number; games: number; pav: number }[];
  /** The ledger stint (AflTradeAssetLedgerStint) seasons with games joined from the read model. */
  stint: {
    status: 'open' | 'closed';
    endSeason: number | null;
    seasons: readonly { season: number; games: number; pav: number }[];
  };
  /** His earlier trades in the window, before `tradeSeason`; their tenures set his seasons' phases. */
  earlierTradeSeasons?: readonly number[];
}

export interface AflTradeTradedPlayerValuePoint {
  fitId: string;
  checkpointSeason: number;
  /** Post-trade seasons counted; 0 is the at-trade view. */
  tenure: number;
  state: 'open' | 'closed';
  closeReason: 'moved' | 'inactive' | null;
  produced: number;
  /** 0 when closed. */
  expectedRemaining: number;
  /** produced + expectedRemaining. */
  value: number;
  stageAtTrade: number;
  stageBasis: AflTradeTradedPlayerStageBasis;
  leftCensored: boolean;
  effect: { games: number; rate: number; seasons: number; gamesPlayed: number };
}

/** A player's career stage: season s is stage s - originSeason; leftCensored means originSeason is an upper bound. */
export interface AflTradeTradedPlayerStage {
  basis: AflTradeTradedPlayerStageBasis;
  originSeason: number;
  leftCensored: boolean;
  /**
   * Birth basis only, and only when it is not originSeason + 1: the first season of his AFL career
   * (after his draft, or his first game), so the seasons before he was listed are not empty seasons.
   */
  careerFromSeason?: number;
}

type Stage = AflTradeTradedPlayerStage;

interface Season {
  season: number;
  games: number;
  pav: number;
}

interface PhasedSeason extends Season {
  phase: Phase;
}

/** A leg as the value line reads it; built the same way by the fit and by the calculator. */
interface Valued {
  tradeSeason: number;
  stage: Stage;
  /** Career seasons through the trade season, each with its phase (earlier trades set tenures). */
  history: readonly PhasedSeason[];
  /** In-stint seasons from Y + 1, contiguous, cut after the inactivity closure. */
  stint: readonly Season[];
  /** The first season at whose end the stint is known to be closed, or null while open. */
  closureKnownSeason: number | null;
  closeReason: 'moved' | 'inactive' | null;
  /** PAV at the receiving club in ledger stint seasons after an inactivity closure. */
  returnedPav: number;
}

interface Curve {
  intercepts: Partial<Record<Band, number>>;
  effects: Partial<Record<Phase, number>>;
  /** Survival only: the slope on the rate effect (`u_rate`). */
  slope?: number;
}

interface Priors {
  survival: Curve;
  games: Curve;
  rate: Curve;
  gamesCredibilitySeasons: number;
  rateCredibilityGames: number;
  inactiveReturn: readonly AflTradeTradedPlayerInactiveReturn[];
}

interface FittedPriors extends Priors {
  varianceComponents: { games: VarianceComponents; rate: VarianceComponents };
}

const logistic = (value: number) => 1 / (1 + Math.exp(-value));
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Each player's stage origin: his earliest draft row of any type (canonical AFLM or reviewed Draftguru
 * 2000-2010), ties broken by draft type, then selection id.
 */
export function aflTradeTradedPlayerFirstDraftOrigins(
  origins: readonly AflTradeTradedPlayerDraftOrigin[]
): Map<string, AflTradeTradedPlayerDraftOrigin> {
  const first = new Map<string, AflTradeTradedPlayerDraftOrigin>();
  for (const origin of origins) {
    const known = first.get(origin.playerId);
    if (
      !known ||
      origin.draftYear < known.draftYear ||
      (origin.draftYear === known.draftYear &&
        (compare(origin.draftType, known.draftType) ||
          compare(origin.selectionId, known.selectionId)) < 0)
    )
      first.set(origin.playerId, origin);
  }
  return first;
}

/** Each player's birth year, refusing two different ones for a player. */
export function aflTradeTradedPlayerBirthYears(
  rows: readonly AflTradeTradedPlayerBirthYear[]
): Map<string, number> {
  const years = new Map<string, number>();
  for (const { playerId, birthYear } of rows) {
    const known = years.get(playerId);
    if (known !== undefined && known !== birthYear)
      throw new Error(`Player ${playerId} has two birth years, ${known} and ${birthYear}.`);
    years.set(playerId, birthYear);
  }
  return years;
}

/**
 * The one stage rule, the fit's and the value lines': taken against the player's first trade in the
 * window. Null when his earliest draft origin is at or after that trade, which the fit refuses. For a
 * mature-age draftee (draft year less birth year at least `matureAgeDraftAge`), his real age (owner
 * decisions 2026-10-24): the origin is birthYear + 18, never left-censored, and no later than the season before his career begins (the season after his
 * draft, his first game through that trade, or that trade season, whichever is first). Else his
 * earliest draft origin; else the season before his first game through that trade, left-censored when
 * that game is in the first season read; else (no draft and no game) assumed youngest, the season
 * before that trade.
 */
export function aflTradeTradedPlayerStage(input: {
  draftOrigin: { draftYear: number } | null;
  /** His birth year, or null when his birth date is unknown. */
  birthYear: number | null;
  /** Read seasons in which he played a game, at any club. */
  gameSeasons: Iterable<number>;
  firstTradeSeason: number;
  firstReadSeason: number;
}): AflTradeTradedPlayerStage | null {
  const { draftOrigin, birthYear, firstTradeSeason, firstReadSeason } = input;
  if (draftOrigin && draftOrigin.draftYear >= firstTradeSeason) return null;
  const firstGame = Math.min(
    Infinity,
    ...[...input.gameSeasons].filter((season) => season <= firstTradeSeason)
  );
  if (
    birthYear !== null &&
    draftOrigin !== null &&
    draftOrigin.draftYear - birthYear >= RULES.matureAgeDraftAge
  ) {
    const careerFrom = Math.min(
      draftOrigin ? draftOrigin.draftYear + 1 : Infinity,
      firstGame,
      firstTradeSeason
    );
    const originSeason = Math.min(birthYear + RULES.ageStageOriginOffset, careerFrom - 1);
    return careerFrom === originSeason + 1
      ? { basis: 'birth', originSeason, leftCensored: false }
      : { basis: 'birth', originSeason, leftCensored: false, careerFromSeason: careerFrom };
  }
  if (draftOrigin)
    return { basis: 'draft', originSeason: draftOrigin.draftYear, leftCensored: false };
  return firstGame === Infinity
    ? { basis: 'assumed_youngest', originSeason: firstTradeSeason - 1, leftCensored: false }
    : {
        basis: 'first_game',
        originSeason: firstGame - 1,
        leftCensored: firstGame === firstReadSeason,
      };
}

/** The first season of his career read: his career's first season, or the first season read. */
export const aflTradeTradedPlayerCareerStart = (stage: Stage, firstReadSeason: number) =>
  Math.max(stage.careerFromSeason ?? stage.originSeason + 1, firstReadSeason);

const bandOf = (stage: number): Band =>
  RULES.stageBands.find(
    ({ from, through }) => stage >= from && (through === null || stage <= through)
  )?.band ?? '1';

/** The band a season is scored at (a left-censored stage is its lower bound). */
const scoringBand = (stage: Stage, season: number) => bandOf(season - stage.originSeason);

/** The open-ended oldest band: a left-censored stage at or past its lower bound is exactly in it. */
const TOP_BAND = RULES.stageBands[RULES.stageBands.length - 1]!.band as Band;

/** Null when a left-censored stage's lower bound leaves the true band unknown. */
const knownBand = (stage: Stage, season: number): Band | null => {
  const band = scoringBand(stage, season);
  return stage.leftCensored && band !== TOP_BAND ? null : band;
};

const tenurePhase = (tenure: number): Phase =>
  tenure >= RULES.pooledTenureFrom ? 'tenure_3+' : tenure === 2 ? 'tenure_2' : 'tenure_1';

/** The phase of a season relative to the most recent trade before it (a trade in Y is after season Y). */
const phaseOf = (season: number, tradeSeasons: readonly number[]): Phase => {
  const latest = Math.max(-Infinity, ...tradeSeasons.filter((trade) => trade < season));
  return latest === -Infinity ? 'pre_trade' : tenurePhase(season - latest);
};

const linear = (curve: Curve, band: Band, phase: Phase) => {
  const intercept = curve.intercepts[band];
  if (intercept === undefined) throw new Error(`The curve has no stage band ${band}.`);
  return intercept + (curve.effects[phase] ?? 0);
};

/**
 * Builds the valued leg: the history through the trade season, the stint cut by the inactivity
 * closure, and when its closure is first visible. A ledger closure at the end season e is visible at
 * e when he also played elsewhere in e, and otherwise at e + 1, so no closure is read early.
 */
function valuedLeg(
  tradeSeason: number,
  stage: Stage,
  career: ReadonlyMap<number, Season>,
  careerStart: number,
  earlierTrades: readonly number[],
  stint: { status: 'open' | 'closed'; endSeason: number | null; seasons: readonly Season[] }
): Valued {
  const history: PhasedSeason[] = [];
  for (let season = careerStart; season <= tradeSeason; season++) {
    const row = career.get(season);
    if (row) history.push({ ...row, phase: phaseOf(season, earlierTrades) });
  }
  const cut: Season[] = [];
  let zeroRun = 0;
  let inactiveAt: number | null = null;
  let returnedPav = 0;
  for (const season of stint.seasons) {
    if (inactiveAt !== null) {
      returnedPav += season.pav;
      continue;
    }
    cut.push(season);
    zeroRun = season.games === 0 ? zeroRun + 1 : 0;
    if (zeroRun >= RULES.inactivityClosureSeasons) inactiveAt = season.season;
  }
  if (inactiveAt !== null)
    return {
      tradeSeason,
      stage,
      history,
      stint: cut,
      closureKnownSeason: inactiveAt,
      closeReason: 'inactive',
      returnedPav,
    };
  if (stint.status === 'open')
    return {
      tradeSeason,
      stage,
      history,
      stint: cut,
      closureKnownSeason: null,
      closeReason: null,
      returnedPav,
    };
  const end = stint.endSeason ?? tradeSeason;
  const here = cut.find(({ season }) => season === end)?.games ?? 0;
  const elsewhere = end > tradeSeason && (career.get(end)?.games ?? 0) > here;
  return {
    tradeSeason,
    stage,
    history,
    stint: cut,
    closureKnownSeason: elsewhere ? end : end + 1,
    closeReason: 'moved',
    returnedPav,
  };
}

/** The empty seasons that end `seasons` (0 when the last one has games). */
const trailingEmpty = (seasons: readonly Season[]) => {
  let run = 0;
  for (let index = seasons.length - 1; index >= 0 && seasons[index]!.games === 0; index--) run++;
  return run;
};

/** The fitted chance a player whose stint ends in `run` empty seasons, at `stage`, plays in it again. */
const returnProbability = (priors: Pick<Priors, 'inactiveReturn'>, stage: number, run: number) => {
  const groups = priors.inactiveReturn.filter(
    (row) => row.emptySeasons === run && stage >= row.stageFrom
  );
  const row = groups.sort((left, right) => right.stageFrom - left.stageFrom)[0];
  if (!row) throw new Error(`The fit has no return probability after ${run} empty seasons.`);
  return row.probability;
};

/**
 * Per tenure 1..horizon along a stint: P(season in stint), expected games, expected PAV per game. The
 * exit hazard reads the player's rate effect as of the checkpoint (`rateEffect`, 0 for the prior alone):
 * a player scoring above his band's rate is less likely to leave or retire (2026-10-23, Fable review).
 */
function stintCurves(priors: Priors, stageAtTrade: number, rateEffect = 0) {
  const survival = [1];
  const games = [0];
  const rate = [0];
  for (let tenure = 1; tenure <= RULES.horizonSeasons; tenure++) {
    const band = bandOf(stageAtTrade - 1 + tenure);
    const phase = tenurePhase(tenure);
    survival.push(
      survival[tenure - 1]! *
        (1 -
          logistic(
            linear(priors.survival, band, phase) + (priors.survival.slope ?? 0) * rateEffect
          ))
    );
    games.push(Math.exp(linear(priors.games, band, phase)));
    rate.push(Math.exp(linear(priors.rate, band, phase)));
  }
  return { survival, games, rate };
}

type OwnForm = 'full' | 'none' | 'post_trade_only';

interface Effect {
  games: number;
  rate: number;
  seasons: number;
  gamesPlayed: number;
}

/**
 * The player's additive effects at checkpoint `c`, each against its own season's stage and phase. A
 * season whose band is unknown (a left-censored stage below the top band, 14+) is left out: scored at its lower bound,
 * a veteran's season reads against a far younger expectation and inflates his effect.
 */
function playerEffect(priors: Priors, leg: Valued, checkpoint: number, mode: OwnForm): Effect {
  const candidates: PhasedSeason[] = [];
  if (mode === 'full') candidates.push(...leg.history.filter(({ season }) => season <= checkpoint));
  if (mode !== 'none') {
    // A trailing empty run is the retirement signal valueAt reads, not form.
    const read = leg.stint.filter(({ season }) => season <= checkpoint);
    for (const season of read.slice(0, read.length - trailingEmpty(read)))
      candidates.push({ ...season, phase: tenurePhase(season.season - leg.tradeSeason) });
  }
  const seasons = candidates.filter(({ season }) => knownBand(leg.stage, season) !== null);
  let gamesResidual = 0;
  let rateResidual = 0;
  let games = 0;
  for (const season of seasons) {
    const band = knownBand(leg.stage, season.season)!;
    gamesResidual += season.games - Math.exp(linear(priors.games, band, season.phase));
    rateResidual += season.pav - season.games * Math.exp(linear(priors.rate, band, season.phase));
    games += season.games;
  }
  return {
    games:
      seasons.length === 0 ? 0 : gamesResidual / (seasons.length + priors.gamesCredibilitySeasons),
    rate: games === 0 ? 0 : rateResidual / (games + priors.rateCredibilityGames),
    seasons: seasons.length,
    gamesPlayed: games,
  };
}

const stageAtTradeOf = (leg: Pick<Valued, 'tradeSeason' | 'stage'>) =>
  leg.tradeSeason - leg.stage.originSeason + 1;

/** The value line at the end of `checkpoint`, expected PAV summed through `throughTenure`. */
function valueAt(
  priors: Priors,
  leg: Valued,
  checkpoint: number,
  throughTenure: number,
  mode: OwnForm = 'full'
) {
  const tenure = checkpoint - leg.tradeSeason;
  if (tenure < 0) throw new Error('A value line has no checkpoint before the trade.');
  const produced = leg.stint
    .filter(({ season }) => season <= checkpoint)
    .reduce((sum, { pav }) => sum + pav, 0);
  const closed = leg.closureKnownSeason !== null && checkpoint >= leg.closureKnownSeason;
  const effect = playerEffect(priors, leg, checkpoint, mode);
  if (closed) return { tenure, closed, produced, expectedRemaining: 0, value: produced, effect };
  const curve = stintCurves(priors, stageAtTradeOf(leg), effect.rate);
  let expectedRemaining = 0;
  for (let t = tenure + 1; t <= Math.min(throughTenure, RULES.horizonSeasons); t++)
    expectedRemaining +=
      (curve.survival[t]! / curve.survival[tenure]!) *
      Math.max(0, curve.games[t]! + effect.games) *
      (curve.rate[t]! + effect.rate);
  const empty = trailingEmpty(leg.stint.filter(({ season }) => season <= checkpoint));
  if (empty > 0)
    expectedRemaining *= returnProbability(priors, stageAtTradeOf(leg) - 1 + tenure, empty);
  return {
    tenure,
    closed,
    produced,
    expectedRemaining,
    value: produced + expectedRemaining,
    effect,
  };
}

interface Observation {
  band: Band;
  phase: Phase;
  response: number;
  weight: number;
  offset: number;
  /** The covariate's value, read only by a fit with a covariate (survival: `u_rate`). */
  covariate?: number;
}

/**
 * Fits `link(mean) = intercept[band] + effect[phase] (+ slope × covariate) + offset` (tenure_1 the
 * reference) by iteratively reweighted least squares: binomial with the logit link, or quasi-Poisson
 * with the log.
 */
function fitCurve(
  family: 'binomial' | 'poisson',
  observations: readonly Observation[],
  bands: readonly Band[],
  phases: readonly Phase[],
  label: string,
  withCovariate = false
): Curve {
  const free: Phase[] = phases.filter((phase) => phase !== RULES.referencePhase);
  for (const band of bands) {
    const members = observations.filter((observation) => observation.band === band);
    if (members.length === 0 || members.reduce((sum, { response }) => sum + response, 0) <= 0)
      throw new Error(`The ${label} fit has no positive observations in stage band ${band}.`);
  }
  for (const phase of free)
    if (!observations.some((observation) => observation.phase === phase))
      throw new Error(`The ${label} fit has no observations in phase ${phase}.`);
  const size = bands.length + free.length + (withCovariate ? 1 : 0);
  /** The observation's design row: [column, value] pairs. */
  const columnsOf = (observation: Observation): [number, number][] => {
    const phase = free.indexOf(observation.phase);
    const row: [number, number][] = [[bands.indexOf(observation.band), 1]];
    if (phase >= 0) row.push([bands.length + phase, 1]);
    if (withCovariate) row.push([size - 1, observation.covariate ?? 0]);
    return row;
  };
  let beta = new Array<number>(size).fill(0);
  if (family === 'poisson') {
    const total = observations.reduce((sum, { response, weight }) => sum + weight * response, 0);
    const exposure = observations.reduce(
      (sum, { offset, weight }) => sum + weight * Math.exp(offset),
      0
    );
    beta = beta.map((_, index) => (index < bands.length ? Math.log(total / exposure) : 0));
  }
  for (let iteration = 0; iteration < 100; iteration++) {
    const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    const vector = new Array<number>(size).fill(0);
    for (const observation of observations) {
      const columns = columnsOf(observation);
      const eta =
        columns.reduce((sum, [column, value]) => sum + beta[column]! * value, 0) +
        observation.offset;
      const mean = family === 'binomial' ? logistic(eta) : Math.exp(eta);
      const variance = family === 'binomial' ? Math.max(mean * (1 - mean), 1e-12) : mean;
      const working = eta - observation.offset + (observation.response - mean) / variance;
      const weight = observation.weight * variance;
      for (const [a, x] of columns) {
        vector[a]! += weight * working * x;
        for (const [b, y] of columns) matrix[a]![b]! += weight * x * y;
      }
    }
    const next = solve(matrix, vector);
    const change = Math.max(...next.map((value, index) => Math.abs(value - beta[index]!)));
    beta = next;
    if (!beta.every(Number.isFinite)) throw new Error(`The ${label} fit diverged.`);
    if (change < 1e-10) {
      const effects: Partial<Record<Phase, number>> = {};
      for (const phase of phases)
        effects[phase] =
          phase === RULES.referencePhase ? 0 : beta[bands.length + free.indexOf(phase)]!;
      return {
        intercepts: Object.fromEntries(bands.map((band, index) => [band, beta[index]!])),
        effects,
        ...(withCovariate ? { slope: beta[size - 1]! } : {}),
      };
    }
  }
  throw new Error(`The ${label} fit did not converge.`);
}

/** A player in the fit: his stage, his active seasons for the curves, and his legs. */
interface FitPlayer {
  playerId: string;
  stage: Stage;
  draftType: string | null;
  /** Seasons through his last trade (career, any club) and his last leg's stint after it. */
  active: PhasedSeason[];
  legs: FitLegState[];
}

interface FitLegState {
  leg: AflTradeTradedPlayerFitLeg;
  valued: Valued;
  /** The leg as `aflTradeTradedPlayerValueAt` takes it. */
  input: AflTradeTradedPlayerValueInput;
}

/** Fits the three curves and both k on the training players. */
function fitPriors(players: readonly FitPlayer[], lastSeason: number): FittedPriors {
  const hazard: Observation[] = [];
  const games: Observation[] = [];
  const rate: Observation[] = [];
  // Each time a stint's empty run reaches 1 or 2 seasons: did he play in it again? Resolved by a later
  // game (yes) or the stint's close (no); a run still open at the last season read is not counted.
  const { emptyRuns, stageGroups } = RULES.inactiveReturn;
  const returnRuns = stageGroups.flatMap(({ from }) =>
    emptyRuns.map((emptySeasons) => ({ stageFrom: from, emptySeasons, runs: 0, returned: 0 }))
  );
  for (const player of players)
    for (const { leg, valued } of player.legs) {
      if (!leg.arrivalReviewed) continue;
      let run = 0;
      valued.stint.forEach((season, index) => {
        run = season.games === 0 ? run + 1 : 0;
        if (!(emptyRuns as readonly number[]).includes(run)) return;
        const later = valued.stint.slice(index + 1).some(({ games: played }) => played > 0);
        if (!later && valued.closeReason === null) return;
        const stage = stageAtTradeOf(valued) - 1 + (season.season - valued.tradeSeason);
        const group = [...stageGroups].reverse().find(({ from }) => stage >= from)!.from;
        const row = returnRuns.find(
          (candidate) => candidate.stageFrom === group && candidate.emptySeasons === run
        )!;
        row.runs++;
        if (later) row.returned++;
      });
    }
  const inactiveReturn = returnRuns.map((row) => ({
    ...row,
    probability:
      (row.returned + RULES.hazardPseudoCount) / (row.runs + 2 * RULES.hazardPseudoCount),
  }));
  for (const player of players) {
    for (const season of player.active) {
      const band = knownBand(player.stage, season.season);
      if (band === null) continue;
      games.push({ band, phase: season.phase, response: season.games, weight: 1, offset: 0 });
      if (season.games > 0)
        rate.push({
          band,
          phase: season.phase,
          response: season.pav,
          weight: 1,
          offset: Math.log(season.games),
        });
    }
  }
  const rateGames = {
    games: fitCurve('poisson', games, ALL_BANDS, ALL_PHASES, 'games'),
    rate: fitCurve('poisson', rate, ALL_BANDS, ALL_PHASES, 'rate'),
  };
  const gamesRows: VarianceRow[][] = [];
  const rateRows: VarianceRow[][] = [];
  for (const player of players) {
    const known = player.active.flatMap((season) => {
      const band = knownBand(player.stage, season.season);
      return band === null ? [] : [{ ...season, band }];
    });
    gamesRows.push(
      known.map((season) => ({
        value: season.games - Math.exp(linear(rateGames.games, season.band, season.phase)),
        weight: 1,
      }))
    );
    rateRows.push(
      known
        .filter(({ games: played }) => played > 0)
        .map((season) => ({
          value:
            season.pav / season.games - Math.exp(linear(rateGames.rate, season.band, season.phase)),
          weight: season.games,
        }))
    );
  }
  const gamesComponents = varianceComponents(gamesRows, 'games');
  const rateComponents = varianceComponents(rateRows, 'PAV per game');
  const gamesCredibilitySeasons = gamesComponents.within / gamesComponents.between;
  const rateCredibilityGames = Math.max(
    RULES.minimumRateCredibilityGames,
    rateComponents.within / rateComponents.between
  );
  // The exit hazard's form covariate (2026-10-23): each stint season's rate effect as of the season
  // before, from the games and rate curves and both k just fitted, as the value line reads it.
  const formPriors = {
    ...rateGames,
    survival: { intercepts: {}, effects: {} },
    gamesCredibilitySeasons,
    rateCredibilityGames,
    inactiveReturn,
  } as Priors;
  const formAt = (valued: Valued, tenure: number) =>
    playerEffect(formPriors, valued, valued.tradeSeason + tenure - 1, 'full').rate;
  for (const player of players) {
    for (const { leg, valued } of player.legs) {
      if (!leg.arrivalReviewed) continue;
      const observed = lastSeason - valued.tradeSeason;
      // His last season with a game: an inactivity closure exits the season after it, and an open
      // stint ending in empty seasons is censored there (whether he retired is not yet known).
      const played = valued.stint.length - trailingEmpty(valued.stint);
      const inStint = valued.closeReason === 'moved' ? valued.stint.length : played;
      const exitAt = valued.closeReason !== null ? inStint + 1 : null;
      const through = exitAt ?? Math.min(inStint, observed);
      for (let tenure = 1; tenure <= through; tenure++) {
        const band = knownBand(valued.stage, valued.tradeSeason + tenure);
        if (band === null) continue;
        hazard.push({
          band,
          phase: tenurePhase(tenure),
          response: tenure === exitAt ? 1 : 0,
          weight: 1,
          offset: 0,
          covariate: formAt(valued, tenure),
        });
      }
      // An open stint ending in 1 or 2 empty seasons: the season after his last game is an exit with
      // the chance he does not return, else a survived season (fractional weights, so a recent
      // retirement is not read as survival).
      const pending = trailingEmpty(valued.stint);
      if (exitAt === null && pending > 0 && played + 1 <= observed) {
        const tenure = played + 1;
        const band = knownBand(valued.stage, valued.tradeSeason + tenure);
        const back = returnProbability(
          { inactiveReturn },
          stageAtTradeOf(valued) - 1 + tenure,
          Math.min(pending, Math.max(...RULES.inactiveReturn.emptyRuns))
        );
        if (band !== null)
          for (const [response, weight] of [
            [1, 1 - back],
            [0, back],
          ] as const)
            hazard.push({
              band,
              phase: tenurePhase(tenure),
              response,
              weight,
              offset: 0,
              covariate: formAt(valued, tenure),
            });
      }
    }
  }
  for (const band of SURVIVAL_BANDS)
    for (const phase of TENURE_PHASES)
      for (const response of [0, 1])
        hazard.push({ band, phase, response, weight: RULES.hazardPseudoCount, offset: 0 });
  const curves = {
    survival: fitCurve('binomial', hazard, SURVIVAL_BANDS, TENURE_PHASES, 'survival', true),
    ...rateGames,
  };
  return {
    ...curves,
    inactiveReturn,
    gamesCredibilitySeasons,
    rateCredibilityGames,
    varianceComponents: { games: gamesComponents, rate: rateComponents },
  };
}

type BasisGroup = 'birth' | 'draft' | 'first_game' | 'first_game_censored' | 'assumed_youngest';
const BASIS_GROUPS: readonly BasisGroup[] = [
  'birth',
  'draft',
  'first_game',
  'first_game_censored',
  'assumed_youngest',
];
const basisGroupOf = (stage: Stage): BasisGroup =>
  stage.basis === 'first_game' && stage.leftCensored ? 'first_game_censored' : stage.basis;
/** Stages counted by basis, a left-censored first game apart, as `fitWindow.legsByTradeSeason` records them. */
export const aflTradeTradedPlayerStageBasisCounts = (stages: readonly Stage[]) =>
  Object.fromEntries(
    BASIS_GROUPS.map((group) => [
      group,
      stages.filter((stage) => basisGroupOf(stage) === group).length,
    ])
  ) as Record<BasisGroup, number>;

/**
 * The sha256 of a trade season's legs as staged: each leg's player and stage (its career start
 * included, v3), sorted. Recorded per trade season in `fitWindow.legsByTradeSeason` (v2), so a re-read
 * whose origins, birth years or players moved a stage, even within one basis, cannot pass for the fit's.
 */
export const aflTradeTradedPlayerStageDigest = (
  legs: readonly { playerId: string; stage: Stage }[]
) =>
  sha256AflTradeCanonicalJson(
    legs
      .map(({ playerId, stage }) =>
        [
          playerId,
          stage.basis,
          stage.originSeason,
          stage.leftCensored,
          stage.careerFromSeason ?? '',
        ].join('|')
      )
      .sort(compare)
  );

/** Validates the inputs and builds every player's stage, career and legs. */
function prepare(inputs: AflTradeTradedPlayerValueLineFitInputs) {
  const { games } = inputs;
  if (games.discrepancies.length > 0)
    throw new Error('The games read model has discrepancies; the fit refuses it.');
  const unavailable = games.seasons.filter(({ availability }) => availability !== 'available');
  if (unavailable.length > 0)
    throw new Error(
      `Seasons ${unavailable.map(({ season }) => season).join(', ')} are not available.`
    );
  const readSeasons = games.seasons.map(({ season }) => season);
  const firstReadSeason = Math.min(...readSeasons);
  const lastSeason = Math.max(...readSeasons);
  const tradeSeasons = [...inputs.tradeSeasons].sort((left, right) => left - right);
  if (tradeSeasons.length === 0 || new Set(tradeSeasons).size !== tradeSeasons.length)
    throw new Error('Fit one or more distinct trade seasons.');
  for (const season of tradeSeasons) {
    if (season >= lastSeason)
      throw new Error(`Trade season ${season} has no season observed after it.`);
    if (season < firstReadSeason) throw new Error(`Read every season from ${season}.`);
    if (lastSeason - season > RULES.horizonSeasons)
      throw new Error(
        `Trade season ${season} has more than ${RULES.horizonSeasons} seasons observed.`
      );
  }
  const calculation = new Map(
    games.seasons.map(({ season, calculationId }) => [season, calculationId])
  );
  for (const { season, calculationId } of inputs.stintCalculations)
    if (calculation.get(season) !== calculationId)
      throw new Error(
        `The HPN PAV calculation for ${season} differs between the ledger stints and the games read model.`
      );

  const bySeason = new Map<
    string,
    Map<number, { games: number; pav: number; clubs: Map<string, Season> }>
  >();
  for (const row of games.rows) {
    const seasons = bySeason.get(row.playerId) ?? new Map();
    bySeason.set(row.playerId, seasons);
    const entry = seasons.get(row.season) ?? { games: 0, pav: 0, clubs: new Map() };
    entry.games += row.games;
    entry.pav += row.pav;
    entry.clubs.set(row.clubId, { season: row.season, games: row.games, pav: row.pav });
    seasons.set(row.season, entry);
  }
  const firstDraft = aflTradeTradedPlayerFirstDraftOrigins(inputs.draftOrigins);
  const birthYears = aflTradeTradedPlayerBirthYears(inputs.birthYears);

  const legs = [...inputs.legs].sort((left, right) => compare(left.transferId, right.transferId));
  const transferIds = new Set<string>();
  const legsByPlayer = new Map<string, AflTradeTradedPlayerFitLeg[]>();
  for (const leg of legs) {
    if (transferIds.has(leg.transferId)) throw new Error(`Leg ${leg.transferId} is duplicated.`);
    transferIds.add(leg.transferId);
    if (!tradeSeasons.includes(leg.tradeSeason))
      throw new Error(`Leg ${leg.transferId} is outside the trade seasons fitted.`);
    if (leg.stint.startSeason !== leg.tradeSeason + 1 || leg.stint.clubId !== leg.receivingClubId)
      throw new Error(
        `Leg ${leg.transferId}'s stint does not start at the receiving club in Y + 1.`
      );
    if (leg.stint.seasonsMissingPav.length > 0)
      throw new Error(`Leg ${leg.transferId}'s stint has seasons missing PAV.`);
    const seasons = bySeason.get(leg.playerId);
    for (const { season, pav } of leg.stint.seasons) {
      const read = seasons?.get(season)?.clubs.get(leg.receivingClubId)?.pav ?? 0;
      if (Math.abs(read - pav) > 1e-9)
        throw new Error(`Leg ${leg.transferId}'s ${season} PAV differs from the games read model.`);
    }
    legsByPlayer.set(leg.playerId, [...(legsByPlayer.get(leg.playerId) ?? []), leg]);
  }

  let unknownBandSeasonsExcluded = 0;
  const players: FitPlayer[] = [...legsByPlayer.keys()].sort(compare).map((playerId) => {
    const playerLegs = legsByPlayer.get(playerId)!;
    const trades = [...new Set(playerLegs.map(({ tradeSeason }) => tradeSeason))].sort(
      (a, b) => a - b
    );
    const firstTrade = trades[0]!;
    const seasons = bySeason.get(playerId) ?? new Map();
    const draft = firstDraft.get(playerId);
    const stage = aflTradeTradedPlayerStage({
      draftOrigin: draft ?? null,
      birthYear: birthYears.get(playerId) ?? null,
      gameSeasons: [...seasons].filter(([, row]) => row.games > 0).map(([season]) => season),
      firstTradeSeason: firstTrade,
      firstReadSeason,
    });
    if (stage === null)
      throw new Error(
        `Player ${playerId}'s draft origin ${draft!.draftYear} is at or after the trade season ${firstTrade}.`
      );
    const careerStart = aflTradeTradedPlayerCareerStart(stage, firstReadSeason);
    const career = new Map<number, Season>();
    for (let season = careerStart; season <= lastSeason; season++) {
      const row = seasons.get(season);
      career.set(season, { season, games: row?.games ?? 0, pav: row?.pav ?? 0 });
    }
    const legStates = playerLegs.map((leg): FitLegState => {
      const stintSeasons = leg.stint.seasons.map(({ season, pav }) => ({
        season,
        pav,
        games: seasons.get(season)?.clubs.get(leg.receivingClubId)?.games ?? 0,
      }));
      const earlierTradeSeasons = trades.filter((trade) => trade < leg.tradeSeason);
      const stint = {
        status: leg.stint.status,
        endSeason: leg.stint.endSeason,
        seasons: stintSeasons,
      };
      return {
        leg,
        valued: valuedLeg(leg.tradeSeason, stage, career, careerStart, earlierTradeSeasons, stint),
        input: {
          playerId,
          receivingClubId: leg.receivingClubId,
          tradeSeason: leg.tradeSeason,
          stage,
          career: [...career.values()],
          stint,
          earlierTradeSeasons,
        },
      };
    });
    // Active seasons: every career season through his last trade (he was on a list to be traded),
    // then his last reviewed leg's stint. Seasons after a stint with no later trade are out.
    const lastTrade = trades[trades.length - 1]!;
    const active: PhasedSeason[] = [];
    for (let season = careerStart; season <= lastTrade; season++)
      active.push({ ...career.get(season)!, phase: phaseOf(season, trades) });
    const last = legStates.find(({ leg }) => leg.tradeSeason === lastTrade && leg.arrivalReviewed);
    // His stint's trailing empty seasons are retirement (or not yet known), not low games.
    const stint = last?.valued.stint ?? [];
    for (const season of stint.slice(0, stint.length - trailingEmpty(stint)))
      active.push({ ...season, phase: tenurePhase(season.season - lastTrade) });
    if (playerLegs.some(({ arrivalReviewed }) => arrivalReviewed))
      unknownBandSeasonsExcluded += active.filter(
        ({ season }) => knownBand(stage, season) === null
      ).length;
    return { playerId, stage, draftType: draft?.draftType ?? null, active, legs: legStates };
  });
  return { players, tradeSeasons, firstReadSeason, lastSeason, unknownBandSeasonsExcluded };
}

const publishCurve = (curve: Curve, bands: readonly Band[], phases: readonly Phase[]) => ({
  stageIntercepts: bands.map((band) => ({ band, intercept: round(curve.intercepts[band]!, 9) })),
  phaseEffects: phases.map((phase) => ({ phase, effect: round(curve.effects[phase]!, 9) })),
});

const publishComponents = (components: VarianceComponents) => ({
  /** The pick fit's `stints` count: here one group per training player. */
  players: components.stints,
  observations: components.observations,
  weight: components.weight,
  within: round(components.within, 9),
  between: round(components.between, 9),
});

const VETERAN_BANDS: readonly Band[] = ['10-11', '12-13', '14+'];

const ENTRY_GROUPS = [
  // Draft or birth basis: his career began in or before the first season read.
  'career_began_by_first_read',
  'left_censored',
  'entered_from_first_read',
] as const;
export type AflTradeTradedPlayerEntryGroup = (typeof ENTRY_GROUPS)[number];
type EntryGroup = AflTradeTradedPlayerEntryGroup;

/**
 * A back-test leg's entry: left-censored; else, on the draft or birth basis, whether his career (its
 * first season, not his age) began in or before the first season read; else entered from it. One rule
 * for both bases, so a player keeps his group whether or not his birth date is known.
 */
export function aflTradeTradedPlayerEntryGroup(stage: Stage, firstReadSeason: number): EntryGroup {
  if (stage.leftCensored) return 'left_censored';
  if (stage.basis !== 'draft' && stage.basis !== 'birth') return 'entered_from_first_read';
  return (stage.careerFromSeason ?? stage.originSeason + 1) <= firstReadSeason
    ? 'career_began_by_first_read'
    : 'entered_from_first_read';
}

interface Pair {
  tradeSeason: number;
  band: Band;
  basis: BasisGroup;
  /** Whether he entered the AFL before the first season read: drafted earlier, or left-censored. */
  entry: EntryGroup;
  checkpoint: number;
  predicted: number;
  producedOnly: number;
  stageOnly: number;
  postTradeOnly: number;
  realized: number;
}

const legRow = (
  group: string,
  checkpoint: number,
  pairs: readonly { predicted: number; realized: number }[]
) => {
  const row = errorRow(group, checkpoint, pairs);
  // The standard error of the bias: the residuals' sample SD over sqrt(n), not RMSE / sqrt(n), which
  // counts the bias itself as noise (2026-10-20 review).
  const n = pairs.length;
  const residuals = pairs.map(({ predicted, realized }) => predicted - realized);
  const meanResidual = n === 0 ? 0 : residuals.reduce((sum, value) => sum + value, 0) / n;
  const deviation =
    n < 2
      ? 0
      : Math.sqrt(residuals.reduce((sum, value) => sum + (value - meanResidual) ** 2, 0) / (n - 1));
  return {
    group,
    checkpoint,
    legs: row.selections,
    meanPredicted: row.meanPredicted,
    meanRealized: row.meanRealized,
    bias: row.bias,
    meanAbsoluteError: row.meanAbsoluteError,
    rootMeanSquaredError: row.rootMeanSquaredError,
    standardError: n < 2 ? 0 : round(deviation / Math.sqrt(n), 3),
  };
};

const quantile = (values: readonly number[], q: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
};

/**
 * Holds out each trade season with enough observed seasons, its players removed from training.
 * `players` is the fit's own training set (players with a reviewed leg), so each fold is the
 * published model minus the held-out season.
 */
function backTest(
  players: readonly FitPlayer[],
  tradeSeasons: readonly number[],
  firstReadSeason: number,
  lastSeason: number
) {
  const heldOut = tradeSeasons.filter(
    (season) => lastSeason - season >= RULES.backTestMinimumObservedSeasons
  );
  const pairs: Pair[] = [];
  const seasons = [];
  for (const year of heldOut) {
    const training = players.filter(({ legs }) =>
      legs.every(({ leg }) => leg.tradeSeason !== year)
    );
    const priors = fitPriors(training, lastSeason);
    const observed = lastSeason - year;
    const held = players.flatMap(({ legs }) =>
      legs.filter(({ leg }) => leg.tradeSeason === year && leg.arrivalReviewed)
    );
    const totals = new Map<number, number>();
    for (const { valued } of held) {
      const realized = valued.stint.reduce((sum, { pav }) => sum + pav, 0);
      const band = bandOf(stageAtTradeOf(valued));
      for (const checkpoint of RULES.backTestCheckpoints) {
        if (observed <= checkpoint) continue;
        // No hindsight: the held-out leg's seasons count only up to the checkpoint.
        const at = year + checkpoint;
        const predicted = valueAt(priors, valued, at, observed).value;
        const full = valueAt(priors, valued, at, observed, 'none');
        pairs.push({
          tradeSeason: year,
          band,
          basis: basisGroupOf(valued.stage),
          entry: aflTradeTradedPlayerEntryGroup(valued.stage, firstReadSeason),
          checkpoint,
          predicted,
          producedOnly: full.produced,
          stageOnly: full.value,
          postTradeOnly: valueAt(priors, valued, at, observed, 'post_trade_only').value,
          realized,
        });
        totals.set(checkpoint, (totals.get(checkpoint) ?? 0) + predicted);
      }
    }
    const total = (checkpoint: number) =>
      observed > checkpoint ? round(totals.get(checkpoint) ?? 0, 3) : null;
    seasons.push({
      tradeSeason: year,
      observedSeasons: observed,
      legs: held.length,
      openStints: held.filter(({ valued }) => valued.closureKnownSeason === null).length,
      trainingPlayers: training.length,
      realized: round(
        held.reduce((sum, { valued }) => sum + valued.stint.reduce((s, { pav }) => s + pav, 0), 0),
        3
      ),
      predictedAtTrade: total(0),
      predictedAfterYear1: total(1),
      predictedAfterYear3: total(3),
      gamesCredibilitySeasons: round(priors.gamesCredibilitySeasons, 6),
      rateCredibilityGames: round(priors.rateCredibilityGames, 6),
    });
  }
  const bandGroups = [...SURVIVAL_BANDS, 'all'] as const;
  const basisGroups = [...BASIS_GROUPS, 'all'] as const;
  const at = (checkpoint: number) => pairs.filter((pair) => pair.checkpoint === checkpoint);
  const inBand = (group: string) => (pair: Pair) => group === 'all' || pair.band === group;
  const by = (
    groups: readonly string[],
    member: (group: string) => (pair: Pair) => boolean,
    value: (pair: Pair) => number = ({ predicted }) => predicted
  ) =>
    RULES.backTestCheckpoints.flatMap((checkpoint) =>
      groups.map((group) =>
        legRow(
          group,
          checkpoint,
          at(checkpoint)
            .filter(member(group))
            .map((pair) => ({ predicted: value(pair), realized: pair.realized }))
        )
      )
    );
  const bins = RULES.calibrationBins;
  const calibration = RULES.backTestCheckpoints.flatMap((checkpoint) =>
    [null, ...bins].map((from, index) => {
      const through = index === 0 ? bins[0]! : (bins[index] ?? null);
      const members = at(checkpoint).filter(
        ({ predicted }) =>
          (from === null || predicted >= from) && (through === null || predicted < through)
      );
      const row = legRow('all', checkpoint, members);
      return {
        checkpoint,
        predictedFrom: from,
        predictedBelow: through,
        legs: row.legs,
        meanPredicted: row.meanPredicted,
        meanRealized: row.meanRealized,
      };
    })
  );
  const intervals = RULES.backTestCheckpoints.flatMap((checkpoint) =>
    bandGroups.map((group) => {
      const residuals = at(checkpoint)
        .filter(inBand(group))
        .map(({ predicted, realized }) => realized - predicted);
      return {
        group,
        checkpoint,
        legs: residuals.length,
        lower: round(quantile(residuals, RULES.intervalQuantiles[0]), 3),
        upper: round(quantile(residuals, RULES.intervalQuantiles[1]), 3),
      };
    })
  );
  const checkpointSeasons = Object.fromEntries(
    RULES.backTestCheckpoints.map((checkpoint) => [
      String(checkpoint),
      heldOut.filter((season) => lastSeason - season > checkpoint),
    ])
  );
  return {
    heldOutTradeSeasons: heldOut,
    checkpointSeasons,
    leakageGuard:
      'every player with any leg in the held-out trade season is removed from that fold entirely',
    realized:
      "the leg's signed first-stint PAV at the receiving club (ledger stint, inactivity closure on top) through the last season read",
    predicted: 'value line at the checkpoint, expected PAV summed through the last season read',
    byStageBandAndCheckpoint: by(bandGroups, inBand),
    byStageBasisAndCheckpoint: by(
      basisGroups,
      (group) => (pair) => group === 'all' || pair.basis === group
    ),
    // Bands 10 and up pooled: each alone holds too few legs to test (2026-10-20 review).
    byVeteranBandsAndCheckpoint: by(['10+'], () => (pair) => VETERAN_BANDS.includes(pair.band)),
    // The veterans whose career the read seasons do not start: most fall in the oldest bands.
    byEntryAndCheckpoint: by(
      ['entered_before_first_read', ...ENTRY_GROUPS],
      (group) => (pair) =>
        group === 'entered_before_first_read'
          ? pair.entry !== 'entered_from_first_read'
          : pair.entry === group
    ),
    bySeasonAndCheckpoint: by(
      heldOut.map(String),
      (group) => (pair) => String(pair.tradeSeason) === group
    ),
    baselines: {
      producedOnly: by(bandGroups, inBand, ({ producedOnly }) => producedOnly),
      stageOnly: by(bandGroups, inBand, ({ stageOnly }) => stageOnly),
      postTradeOwnFormOnly: by(bandGroups, inBand, ({ postTradeOnly }) => postTradeOnly),
    },
    calibration,
    intervals,
    seasons,
    limitations: {
      checkpoint3TradeSeasons: checkpointSeasons['3']?.length ?? 0,
      longestObservedTenure: lastSeason - Math.min(...tradeSeasons),
      note: 'Checkpoint 3 rests on few trade seasons, and tenure past the longest observed cannot be back-tested: the pooled tenure_3+ phase and 14+ band carry that tail.',
    },
  };
}

/**
 * Every leg of the inputs, reviewed or not, as the fit values it: the input `aflTradeTradedPlayerValueAt`
 * takes, built by the fit's own rules (stage, career from the stage origin, stint, earlier trades).
 * Ordered by transfer id. Refuses what the fit refuses.
 */
export function aflTradeTradedPlayerFitLegInputs(inputs: AflTradeTradedPlayerValueLineFitInputs) {
  return prepare(inputs)
    .players.flatMap(({ legs }) => legs)
    .map(({ leg, input }) => ({ transferId: leg.transferId, input }))
    .sort((left, right) => compare(left.transferId, right.transferId));
}

/** Fits on every reviewed leg, then back-tests by holding out each trade season in turn. */
export function fitAflTradeTradedPlayerValueLine(inputs: AflTradeTradedPlayerValueLineFitInputs) {
  const { players, tradeSeasons, firstReadSeason, lastSeason, unknownBandSeasonsExcluded } =
    prepare(inputs);
  const training = players.filter(({ legs }) => legs.some(({ leg }) => leg.arrivalReviewed));
  const priors = fitPriors(training, lastSeason);
  const all = players.flatMap(({ legs }) => legs);
  const reviewed = all.filter(({ leg }) => leg.arrivalReviewed);
  const exclusions = (reason: AflTradeTradedPlayerLegExclusion) =>
    inputs.excludedLegs.filter((excluded) => excluded.reason === reason).length;

  const legsByTradeSeason = tradeSeasons.map((tradeSeason) => {
    const here = all.filter(({ leg }) => leg.tradeSeason === tradeSeason);
    const unresolved = inputs.excludedLegs.filter(
      (excluded) => excluded.tradeSeason === tradeSeason
    ).length;
    const legsReviewed = here.filter(({ leg }) => leg.arrivalReviewed).length;
    return {
      tradeSeason,
      observedSeasons: lastSeason - tradeSeason,
      legs: here.length + unresolved,
      reviewed: legsReviewed,
      unreviewed: here.length - legsReviewed,
      unresolved,
      byStageBasis: aflTradeTradedPlayerStageBasisCounts(here.map(({ valued }) => valued.stage)),
      stageDigest: aflTradeTradedPlayerStageDigest(
        here.map(({ leg, valued }) => ({ playerId: leg.playerId, stage: valued.stage }))
      ),
    };
  });

  const legDiagnostics = {
    legs: all.length + inputs.excludedLegs.length,
    reviewed: reviewed.length,
    unreviewedExcluded: all.length - reviewed.length,
    unresolvedExcluded: {
      player_identity_unresolved: exclusions('player_identity_unresolved'),
      club_unresolved: exclusions('club_unresolved'),
    },
    open: reviewed.filter(({ valued }) => valued.closeReason === null).length,
    closedMoved: reviewed.filter(({ valued }) => valued.closeReason === 'moved').length,
    closedInactive: reviewed.filter(({ valued }) => valued.closeReason === 'inactive').length,
    pavAfterInactiveClosure: round(
      reviewed.reduce((sum, { valued }) => sum + valued.returnedPav, 0),
      3
    ),
    firstStintPav: round(
      reviewed.reduce(
        (sum, { valued }) => sum + valued.stint.reduce((s, { pav }) => s + pav, 0),
        0
      ),
      3
    ),
    byStageBasis: aflTradeTradedPlayerStageBasisCounts(all.map(({ valued }) => valued.stage)),
    leftCensored: all.filter(({ valued }) => valued.stage.leftCensored).length,
    trainingPlayers: training.length,
    playerSeasonsFitted: training.reduce(
      (sum, player) =>
        sum + player.active.filter(({ season }) => knownBand(player.stage, season) !== null).length,
      0
    ),
    unknownBandSeasonsExcluded,
  };

  const priorTable = ALL_BANDS.flatMap((band) =>
    ALL_PHASES.map((phase) => ({
      band,
      phase,
      expectedGames: round(Math.exp(linear(priors.games, band, phase)), 4),
      expectedPavPerGame: round(Math.exp(linear(priors.rate, band, phase)), 4),
      hazard:
        SURVIVAL_BANDS.includes(band) && phase !== 'pre_trade'
          ? round(logistic(linear(priors.survival, band, phase)), 4)
          : null,
    }))
  );
  const atTradeCurve = Array.from({ length: 15 }, (_, index) => {
    const stageAtTrade = index + 2;
    const curve = stintCurves(priors, stageAtTrade);
    let expected = 0;
    for (let t = 1; t <= RULES.horizonSeasons; t++)
      expected += curve.survival[t]! * curve.games[t]! * curve.rate[t]!;
    return {
      stageAtTrade,
      expectedFirstStintPav: round(expected, 3),
      stillInStintAfterSeasons: {
        '1': round(curve.survival[1]!, 4),
        '3': round(curve.survival[3]!, 4),
        '5': round(curve.survival[5]!, 4),
      },
    };
  });

  const content = {
    schemaVersion: AFL_TRADE_TRADED_PLAYER_VALUE_LINE_FIT_SCHEMA_VERSION,
    methodId: inputs.games.methodId,
    rules: RULES,
    fitWindow: {
      tradeSeasons: { from: tradeSeasons[0]!, through: tradeSeasons[tradeSeasons.length - 1]! },
      seasons: inputs.games.seasons.map(({ season, calculationId }) => ({ season, calculationId })),
      firstReadSeason,
      lastSeason,
      legsByTradeSeason,
    },
    legs: legDiagnostics,
    parameters: {
      survivalHazardLogit: {
        ...publishCurve(priors.survival, SURVIVAL_BANDS, TENURE_PHASES),
        rateEffectSlope: round(priors.survival.slope ?? 0, 9),
      },
      gamesLog: publishCurve(priors.games, ALL_BANDS, ALL_PHASES),
      pavPerGameLog: publishCurve(priors.rate, ALL_BANDS, ALL_PHASES),
      gamesCredibilitySeasons: round(priors.gamesCredibilitySeasons, 6),
      rateCredibilityGames: round(priors.rateCredibilityGames, 6),
      varianceComponents: {
        games: publishComponents(priors.varianceComponents.games),
        rate: publishComponents(priors.varianceComponents.rate),
      },
      firstReadSeason,
      inactiveReturn: priors.inactiveReturn.map((row) => ({
        ...row,
        probability: round(row.probability, 6),
      })),
    },
    priorTable,
    atTradeCurve,
    backTest: backTest(training, tradeSeasons, firstReadSeason, lastSeason),
    knownLimitations: [
      "Survival reads own form only through the previous season's shrunk PAV-per-game effect.",
      'The 14+ band pools every veteran from stage 14.',
      'Stage is real age (birth year + 18) only for a mature-age draftee (drafted the year he turns 21 or later) with a birth date; every other player is staged by career, so a mature-age draftee without a birth date is still staged young.',
      'A player who entered before 2011 other than through a 2000-2010 national draft (pre-season, rookie or pre-draft listing) stays left-censored, birth date or not.',
      'First-game stages are understated for players listed before their debut.',
      'A birth year is a calendar year: players born early and late in one year share a stage.',
      "Recency is not weighted: a veteran's effect is his career average; decline shows only through the stage prior.",
      'A retirement is seen only after the stint ends in empty seasons; until then the return probability by empty-run length and stage group stands in for it.',
    ],
  };
  return { fitId: createAflTradeContentAddress(FIT_PREFIX, content), content };
}

export type AflTradeTradedPlayerValueLineFit = ReturnType<typeof fitAflTradeTradedPlayerValueLine>;

const curveOf = (curve: AflTradeTradedPlayerCurve): Curve => ({
  intercepts: Object.fromEntries(
    curve.stageIntercepts.map(({ band, intercept }) => [band, intercept])
  ),
  effects: Object.fromEntries(curve.phaseEffects.map(({ phase, effect }) => [phase, effect])),
  slope: curve.rateEffectSlope ?? 0,
});

/** Reads and validates the parameters from a sealed fit (refuses another schema version or a fitId mismatch). */
export function aflTradeTradedPlayerValueLineParameters(
  fit: AflTradeTradedPlayerValueLineFit
): AflTradeTradedPlayerValueLineParameters {
  if (fit.content.schemaVersion !== AFL_TRADE_TRADED_PLAYER_VALUE_LINE_FIT_SCHEMA_VERSION)
    throw new Error(
      `The fit's schema is not ${AFL_TRADE_TRADED_PLAYER_VALUE_LINE_FIT_SCHEMA_VERSION}.`
    );
  if (createAflTradeContentAddress(FIT_PREFIX, fit.content) !== fit.fitId)
    throw new Error('The fit id does not match its content.');
  const { parameters } = fit.content;
  return {
    fitId: fit.fitId,
    survivalHazardLogit: parameters.survivalHazardLogit,
    gamesLog: parameters.gamesLog,
    pavPerGameLog: parameters.pavPerGameLog,
    gamesCredibilitySeasons: parameters.gamesCredibilitySeasons,
    rateCredibilityGames: parameters.rateCredibilityGames,
    firstReadSeason: parameters.firstReadSeason,
    inactiveReturn: parameters.inactiveReturn,
  };
}

/**
 * Value of a traded player's first stint at the receiving club at the end of `checkpointSeason`
 * (>= tradeSeason). Only seasons <= checkpointSeason are read (no hindsight). Throws when a career
 * season between the stage origin and the checkpoint is missing, or when checkpointSeason < tradeSeason.
 */
export function aflTradeTradedPlayerValueAt(
  parameters: AflTradeTradedPlayerValueLineParameters,
  input: AflTradeTradedPlayerValueInput,
  checkpointSeason: number
): AflTradeTradedPlayerValuePoint {
  const { tradeSeason, stage } = input;
  if (checkpointSeason < tradeSeason)
    throw new Error('A value line has no checkpoint before the trade.');
  if (stage.originSeason >= tradeSeason)
    throw new Error(`The stage origin ${stage.originSeason} is at or after the trade season.`);
  if (
    stage.careerFromSeason !== undefined &&
    (stage.careerFromSeason <= stage.originSeason || stage.careerFromSeason > tradeSeason)
  )
    throw new Error(
      `The career start ${stage.careerFromSeason} is outside the stage origin and the trade.`
    );
  const earlier = [...(input.earlierTradeSeasons ?? [])];
  if (earlier.some((season) => season >= tradeSeason))
    throw new Error('An earlier trade season must be before the trade season.');
  const careerStart = aflTradeTradedPlayerCareerStart(stage, parameters.firstReadSeason);
  const career = new Map<number, Season>();
  for (const row of input.career)
    if (row.season >= careerStart && row.season <= checkpointSeason) career.set(row.season, row);
  for (let season = careerStart; season <= checkpointSeason; season++)
    if (!career.has(season)) throw new Error(`The career season ${season} is missing.`);
  const stintSeasons = input.stint.seasons
    .filter(({ season }) => season <= checkpointSeason)
    .sort((left, right) => left.season - right.season);
  stintSeasons.forEach(({ season }, index) => {
    if (season !== tradeSeason + 1 + index)
      throw new Error('The stint seasons must run on from the season after the trade.');
  });
  const valued = valuedLeg(tradeSeason, stage, career, careerStart, earlier, {
    status: input.stint.status,
    endSeason: input.stint.endSeason,
    seasons: stintSeasons,
  });
  const priors: Priors = {
    survival: curveOf(parameters.survivalHazardLogit),
    games: curveOf(parameters.gamesLog),
    rate: curveOf(parameters.pavPerGameLog),
    gamesCredibilitySeasons: parameters.gamesCredibilitySeasons,
    rateCredibilityGames: parameters.rateCredibilityGames,
    inactiveReturn: parameters.inactiveReturn,
  };
  const point = valueAt(priors, valued, checkpointSeason, RULES.horizonSeasons);
  return {
    fitId: parameters.fitId,
    checkpointSeason,
    tenure: point.tenure,
    state: point.closed ? 'closed' : 'open',
    closeReason: point.closed ? valued.closeReason : null,
    produced: point.produced,
    expectedRemaining: point.expectedRemaining,
    value: point.value,
    stageAtTrade: stageAtTradeOf(valued),
    stageBasis: stage.basis,
    leftCensored: stage.leftCensored,
    effect: point.effect,
  };
}
