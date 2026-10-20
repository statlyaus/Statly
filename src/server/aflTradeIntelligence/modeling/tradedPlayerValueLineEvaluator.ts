import type { AflTradePlayerSeasonGames } from './playerSeasonGames';
import type { AflTradeTradedPlayerValueEvaluator } from './tradedPlayerValueLineContracts';
import {
  aflTradeTradedPlayerFirstDraftOrigins,
  aflTradeTradedPlayerStage,
  aflTradeTradedPlayerStageBasisCounts,
  aflTradeTradedPlayerValueAt,
  aflTradeTradedPlayerValueLineParameters,
  type AflTradeTradedPlayerDraftOrigin,
  type AflTradeTradedPlayerStage,
  type AflTradeTradedPlayerValueLineFit,
} from './tradedPlayerValueLineFit';

/**
 * Assembles the value lines' traded-player evaluator from a stored fit and the evidence it read
 * (statlyaus/Statly#789): the legs and exclusions of the fit's trade seasons
 * (`aflTradeTradedPlayerTradeLegs`), the merged draft origins and the games read model over the fit's
 * seasons. Refuses evidence that is not the fit's own: another schema or content address, another HPN PAV
 * method, other seasons or calculations, other leg counts per trade season, or other stage bases per
 * trade season (a draft origin added or lost since the fit, such as a new Draftguru batch). Pure.
 */
export function createAflTradeTradedPlayerValueEvaluator(input: {
  fit: AflTradeTradedPlayerValueLineFit;
  legs: readonly { playerId: string; tradeSeason: number }[];
  excludedLegs: readonly { tradeSeason: number }[];
  draftOrigins: readonly AflTradeTradedPlayerDraftOrigin[];
  games: AflTradePlayerSeasonGames;
}): AflTradeTradedPlayerValueEvaluator {
  const { fit, legs, excludedLegs, draftOrigins, games } = input;
  const parameters = aflTradeTradedPlayerValueLineParameters(fit);
  const { fitWindow } = fit.content;
  if (games.methodId !== fit.content.methodId)
    throw new Error("The games read model is not of the traded-player fit's HPN PAV method.");
  const seasonsOf = (rows: readonly { season: number; calculationId: string | null }[]) =>
    rows.map(({ season, calculationId }) => `${season}:${calculationId}`).join(',');
  if (seasonsOf(games.seasons) !== seasonsOf(fitWindow.seasons))
    throw new Error("The games read model's seasons and calculations are not the fit's.");

  const tradeSeasons = fitWindow.legsByTradeSeason.map(({ tradeSeason }) => tradeSeason);
  const byPlayer = new Map<string, number[]>();
  for (const leg of legs) {
    if (!tradeSeasons.includes(leg.tradeSeason))
      throw new Error(`A leg of ${leg.tradeSeason} is outside the fit's trade seasons.`);
    const seasons = byPlayer.get(leg.playerId) ?? [];
    if (!seasons.includes(leg.tradeSeason)) seasons.push(leg.tradeSeason);
    byPlayer.set(leg.playerId, seasons);
  }
  const playerTradeSeasons = new Map(
    [...byPlayer].map(([playerId, seasons]) => [playerId, seasons.sort((a, b) => a - b)] as const)
  );

  const gameSeasons = new Map<string, Map<number, number>>();
  for (const row of games.rows) {
    const seasons = gameSeasons.get(row.playerId) ?? new Map<number, number>();
    seasons.set(row.season, (seasons.get(row.season) ?? 0) + row.games);
    gameSeasons.set(row.playerId, seasons);
  }
  const origins = aflTradeTradedPlayerFirstDraftOrigins(draftOrigins);
  const stages = new Map<string, AflTradeTradedPlayerStage | null>();
  for (const [playerId, seasons] of playerTradeSeasons)
    stages.set(
      playerId,
      aflTradeTradedPlayerStage({
        draftOrigin: origins.get(playerId) ?? null,
        gameSeasons: [...(gameSeasons.get(playerId) ?? [])]
          .filter(([, played]) => played > 0)
          .map(([season]) => season),
        firstTradeSeason: seasons[0]!,
        firstReadSeason: parameters.firstReadSeason,
      })
    );
  for (const recorded of fitWindow.legsByTradeSeason) {
    const here = legs.filter(({ tradeSeason }) => tradeSeason === recorded.tradeSeason);
    const unresolved = excludedLegs.filter(
      ({ tradeSeason }) => tradeSeason === recorded.tradeSeason
    ).length;
    if (here.length + unresolved !== recorded.legs || unresolved !== recorded.unresolved)
      throw new Error(
        `Trade season ${recorded.tradeSeason} has ${here.length + unresolved} legs; the fit read ${recorded.legs}.`
      );
    const legStages = here.map(({ playerId }) => stages.get(playerId));
    if (
      legStages.some((stage) => !stage) ||
      JSON.stringify(
        aflTradeTradedPlayerStageBasisCounts(legStages as AflTradeTradedPlayerStage[])
      ) !== JSON.stringify(recorded.byStageBasis)
    )
      throw new Error(
        `The stage bases of trade season ${recorded.tradeSeason} are not the fit's: its draft origins or games differ.`
      );
  }
  return {
    parameters,
    valueAt: aflTradeTradedPlayerValueAt,
    tradeSeasons,
    playerTradeSeasons,
    draftOrigins,
    games,
  };
}
