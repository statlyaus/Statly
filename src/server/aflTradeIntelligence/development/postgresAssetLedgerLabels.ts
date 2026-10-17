import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeAssetLedgerLabels } from '../valuation/assetLedgerContracts';

/**
 * Loads the asset ledger's labels (issue 789) in one read-only transaction: every approved canonical
 * player's display name and every club's current name. Labels carry no authority; the ledger's facts
 * come only from the realized grader's inputs (`loadAflTradeRealizedTradeGradeInputs`).
 */
export async function loadAflTradeAssetLedgerLabels(
  sql: AflOutcomeSqlClient
): Promise<AflTradeAssetLedgerLabels> {
  return sql.transaction(async (transaction) => {
    await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const players = await transaction.query<{ player_id: string; display_name: string }>(
      `SELECT player_id, display_name FROM outcome_player
        WHERE status = 'approved' ORDER BY player_id`
    );
    const clubs = await transaction.query<{ club_id: string; current_name: string }>(
      'SELECT club_id, current_name FROM outcome_club ORDER BY club_id'
    );
    return {
      players: players.rows.map((row) => ({ playerId: row.player_id, name: row.display_name })),
      clubs: clubs.rows.map((row) => ({ clubId: row.club_id, name: row.current_name })),
    };
  });
}
