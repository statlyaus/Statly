import { loadAflTradeRealizedTradeGradeInputs } from '../development/postgresRealizedTradeGradeInputs';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeAssetLedgerStintValue } from '../valuation/assetLedgerStints';
import type { AflTradeRealizedTradeGradeInputs } from '../valuation/realizedTradeGrade';
import type { AflTradePlayerSeasonGames } from './playerSeasonGames';
import { loadAflTradePlayerSeasonGames } from './postgresPlayerSeasonGames';
import type {
  AflTradeTradedPlayerDraftOrigin,
  AflTradeTradedPlayerFitLeg,
  AflTradeTradedPlayerValueLineFitInputs,
} from './tradedPlayerValueLineFit';

export interface AflTradeTradedPlayerValueLineFitInputOptions {
  /** The finalized reconciliation candidate whose trades are read, as the realized grader reads it. */
  candidateId: string;
  /** The HPN PAV method whose current per-season calculations are read. */
  methodId: string;
  /** The trade periods fitted, ascending and consecutive. */
  tradeSeasons: readonly number[];
  /** The games read model's seasons: consecutive, from the first career season read to the last. */
  seasons: readonly number[];
  /** Seasons whose PAV is official, as the grader takes them. */
  officialSeasons: readonly number[];
  /** Spells recorded after this instant are ignored, so a rerun reads the same spells. */
  spellCutoffAt: string;
}

/**
 * Composes the fit's inputs from the realized grader's inputs (#789): every player leg of a candidate
 * trade in the trade seasons, with its first stint at the receiving club from Y + 1 by the grader's own
 * rule (`createAflTradeAssetLedgerStintValue`) and the grader's reviewed-arrival check. A leg with no
 * canonical player or no receiving club is listed as excluded, never dropped.
 */
export function buildAflTradeTradedPlayerValueLineFitInputs(input: {
  grader: AflTradeRealizedTradeGradeInputs;
  games: AflTradePlayerSeasonGames;
  draftOrigins: readonly AflTradeTradedPlayerDraftOrigin[];
  tradeSeasons: readonly number[];
}): AflTradeTradedPlayerValueLineFitInputs {
  const { grader, games, draftOrigins, tradeSeasons } = input;
  const stintValue = createAflTradeAssetLedgerStintValue(grader);
  const trades = new Map(
    grader.candidate.transactions
      .filter(
        ({ transactionType, seasonYear }) =>
          transactionType === 'trade' && tradeSeasons.includes(seasonYear)
      )
      .map((transaction) => [transaction.transactionId, transaction])
  );
  const legs: AflTradeTradedPlayerFitLeg[] = [];
  const excludedLegs: AflTradeTradedPlayerValueLineFitInputs['excludedLegs'][number][] = [];
  const transfers = [...grader.candidate.transfers].sort((left, right) =>
    left.transferId < right.transferId ? -1 : left.transferId > right.transferId ? 1 : 0
  );
  for (const transfer of transfers) {
    const trade = trades.get(transfer.transactionId);
    if (!trade || transfer.asset.kind !== 'player') continue;
    const base = {
      transferId: transfer.transferId,
      transactionId: transfer.transactionId,
      tradeSeason: trade.seasonYear,
    };
    const { playerId } = transfer.asset;
    if (!playerId) {
      excludedLegs.push({ ...base, reason: 'player_identity_unresolved' });
      continue;
    }
    const receivingClubId = transfer.toClubId;
    if (!receivingClubId || receivingClubId === transfer.fromClubId) {
      excludedLegs.push({ ...base, reason: 'club_unresolved' });
      continue;
    }
    const stint = stintValue(playerId, receivingClubId, trade.seasonYear + 1);
    legs.push({
      ...base,
      playerId,
      receivingClubId,
      arrivalReviewed: stint.arrivalReviewed,
      stint,
    });
  }
  return {
    tradeSeasons,
    legs,
    excludedLegs,
    draftOrigins,
    stintCalculations: grader.pavCalculations.map(({ season, calculationId }) => ({
      season,
      calculationId,
    })),
    games,
  };
}

/**
 * Every current canonical AFLM draft row with a player, of every draft type and year
 * (`outcome_current_canonical_draft_selection_picks`, as the pick fit reads it), in one read-only,
 * repeatable-read transaction. The fit takes each player's earliest as his stage origin.
 */
export async function loadAflTradeTradedPlayerDraftOrigins(
  sql: AflOutcomeSqlClient
): Promise<AflTradeTradedPlayerDraftOrigin[]> {
  const rows = await sql.transaction(async (transaction) => {
    await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const result = await transaction.query<{
      player_id: string | null;
      draft_year: number;
      draft_type: string;
      selection_id: string;
    }>(
      `SELECT player_id, draft_year, draft_type, selection_id
         FROM outcome_current_canonical_draft_selection_picks('AFLM')
        ORDER BY player_id, draft_year, draft_type, selection_id`
    );
    return result.rows;
  });
  return rows.flatMap((row) =>
    row.player_id === null
      ? []
      : [
          {
            playerId: row.player_id,
            draftYear: Number(row.draft_year),
            draftType: row.draft_type,
            selectionId: row.selection_id,
          },
        ]
  );
}

/**
 * Loads the traded-player fit's inputs, read-only: the realized grader's inputs over the seasons from
 * the first trade season to the last season, the player-season games read model over `seasons`, and
 * every canonical draft row. Each read is its own repeatable-read, read-only transaction; it writes
 * nothing.
 */
export async function loadAflTradeTradedPlayerValueLineFitInputs(
  sql: AflOutcomeSqlClient,
  options: AflTradeTradedPlayerValueLineFitInputOptions
): Promise<AflTradeTradedPlayerValueLineFitInputs> {
  const firstTrade = Math.min(...options.tradeSeasons);
  const lastTrade = Math.max(...options.tradeSeasons);
  if (options.tradeSeasons.length !== lastTrade - firstTrade + 1)
    throw new Error('Fit a consecutive run of trade seasons.');
  const firstSeason = Math.min(...options.seasons);
  const lastSeason = Math.max(...options.seasons);
  if (firstSeason > firstTrade) throw new Error(`Read every season from ${firstTrade}.`);
  if (lastSeason <= lastTrade)
    throw new Error('Read at least one season after the last trade season.');
  const gradedSeasons = options.seasons.filter((season) => season >= firstTrade);
  const grader = await loadAflTradeRealizedTradeGradeInputs(sql, {
    candidateId: options.candidateId,
    methodId: options.methodId,
    seasons: gradedSeasons,
    officialSeasons: options.officialSeasons,
    // The fit reads no pick projection; the grader inputs carry the field only for the grader.
    pickProjectionBenchmarkId: 'not-read-by-traded-player-fit',
    spellCutoffAt: options.spellCutoffAt,
    gradedAt: options.spellCutoffAt,
  });
  const games = await loadAflTradePlayerSeasonGames(sql, {
    methodId: options.methodId,
    seasons: options.seasons,
  });
  return buildAflTradeTradedPlayerValueLineFitInputs({
    grader,
    games,
    draftOrigins: await loadAflTradeTradedPlayerDraftOrigins(sql),
    tradeSeasons: options.tradeSeasons,
  });
}
