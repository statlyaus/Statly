/**
 * The traded-player value-line evaluator's interface (owner decision 2026-10-19, statlyaus/Statly#789):
 * a traded player's open stint is estimated like a pick, from what traded players at the same career
 * stage produce at the receiving club, with his own form blended in by the same credibility rule. The
 * fit itself (`modeling/tradedPlayerValueLineFit.ts`, `fitAflTradeTradedPlayerValueLine`) is built
 * separately; it reads only the published parameters, so a value line is reproducible from the stored
 * fit. These types are the seam the value-line calculator is injected through: the fit module's
 * `aflTradeTradedPlayerValueAt` and `aflTradeTradedPlayerValueLineParameters` must stay assignable to
 * them.
 */

export type AflTradeTradedPlayerStageBasis = 'draft' | 'first_game' | 'assumed_youngest';
export type AflTradeTradedPlayerStageBand =
  '1' | '2-3' | '4-5' | '6-7' | '8-9' | '10-11' | '12-13' | '14+';
export type AflTradeTradedPlayerPhase = 'pre_trade' | 'tenure_1' | 'tenure_2' | 'tenure_3+';

export interface AflTradeTradedPlayerCurve {
  stageIntercepts: readonly { band: AflTradeTradedPlayerStageBand; intercept: number }[];
  /** tenure_1 is the reference (0); survival has no pre_trade phase. */
  phaseEffects: readonly { phase: AflTradeTradedPlayerPhase; effect: number }[];
}

/** The `parameters` block of a sealed afl-trade-traded-player-value-line-fit/v1 artifact, plus its id. */
export interface AflTradeTradedPlayerValueLineParameters {
  /** `traded-player-value-line-fit:<sha256>` */
  fitId: string;
  survivalHazardLogit: AflTradeTradedPlayerCurve;
  gamesLog: AflTradeTradedPlayerCurve;
  pavPerGameLog: AflTradeTradedPlayerCurve;
  gamesCredibilitySeasons: number;
  rateCredibilityGames: number;
}

export interface AflTradeTradedPlayerValueInput {
  playerId: string;
  receivingClubId: string;
  /** The trade period season Y; the stint starts in Y + 1. */
  tradeSeason: number;
  /** The stage of season s is s - originSeason; leftCensored means originSeason is an upper bound. */
  stage: { basis: AflTradeTradedPlayerStageBasis; originSeason: number; leftCensored: boolean };
  /** Every read season from stage 1 (or the first read season) onward, at any club, 0/0 when he played nowhere. */
  career: readonly { season: number; games: number; pav: number }[];
  /** The ledger stint (AflTradeAssetLedgerStint) seasons with games joined from the read model. */
  stint: {
    status: 'open' | 'closed';
    endSeason: number | null;
    seasons: readonly { season: number; games: number; pav: number }[];
  };
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
  /** produced + expectedRemaining */
  value: number;
  stageAtTrade: number;
  stageBasis: AflTradeTradedPlayerStageBasis;
  leftCensored: boolean;
  effect: { games: number; rate: number; seasons: number; gamesPlayed: number };
}

/**
 * Value of a traded player's first stint at the receiving club at the end of `checkpointSeason`
 * (>= tradeSeason). Only seasons <= checkpointSeason are read (no hindsight). The fit module's
 * `aflTradeTradedPlayerValueAt` has this shape.
 */
export type AflTradeTradedPlayerValueAt = (
  parameters: AflTradeTradedPlayerValueLineParameters,
  input: AflTradeTradedPlayerValueInput,
  checkpointSeason: number
) => AflTradeTradedPlayerValuePoint;

/**
 * What the value-line calculator is injected with: the stored fit's validated parameters (from
 * `aflTradeTradedPlayerValueLineParameters`) and the pure evaluator. Without it, a traded player's
 * open stint is pending (`traded_player_fit_not_stored`) and its trades' nets are provisional.
 */
export interface AflTradeTradedPlayerValueEvaluator {
  readonly parameters: AflTradeTradedPlayerValueLineParameters;
  readonly valueAt: AflTradeTradedPlayerValueAt;
}
