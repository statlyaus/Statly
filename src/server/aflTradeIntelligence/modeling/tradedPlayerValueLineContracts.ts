/**
 * The traded-player value-line evaluator's interface (owner decision 2026-10-19, statlyaus/Statly#789):
 * a traded player's open stint is estimated like a pick, from what traded players at the same career
 * stage produce at the receiving club, with his own form blended in by the same credibility rule. The
 * fit itself (`modeling/tradedPlayerValueLineFit.ts`, `fitAflTradeTradedPlayerValueLine`) is built
 * separately; a value line reads only its published parameters and the same evidence the fit read, so
 * it is reproducible from the stored fit. Every type here is the fit module's own, re-exported, so the
 * seam cannot drift from the fit.
 */
import type {
  aflTradeTradedPlayerValueAt,
  AflTradeTradedPlayerValueLineParameters,
} from './tradedPlayerValueLineFit';

export type {
  AflTradeTradedPlayerCurve,
  AflTradeTradedPlayerDraftOrigin,
  AflTradeTradedPlayerInactiveReturn,
  AflTradeTradedPlayerPhase,
  AflTradeTradedPlayerStage,
  AflTradeTradedPlayerStageBand,
  AflTradeTradedPlayerStageBasis,
  AflTradeTradedPlayerValueInput,
  AflTradeTradedPlayerValueLineParameters,
  AflTradeTradedPlayerValuePoint,
} from './tradedPlayerValueLineFit';

/**
 * Value of a traded player's first stint at the receiving club at the end of `checkpointSeason`
 * (>= tradeSeason): the fit module's `aflTradeTradedPlayerValueAt`.
 */
export type AflTradeTradedPlayerValueAt = typeof aflTradeTradedPlayerValueAt;

/**
 * What the value-line calculator is injected with: the stored fit's validated parameters (from
 * `aflTradeTradedPlayerValueLineParameters`) and the pure evaluator. Without it, a traded player's
 * open stint is pending (`traded_player_fit_not_stored`) and its trades' nets are provisional.
 */
export interface AflTradeTradedPlayerValueEvaluator {
  readonly parameters: AflTradeTradedPlayerValueLineParameters;
  readonly valueAt: AflTradeTradedPlayerValueAt;
}
