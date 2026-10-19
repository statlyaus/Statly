import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  buildAflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGamesOptions,
  type AflTradePlayerSeasonGamesRows,
} from './playerSeasonGames';

/**
 * Loads games and PAV per player-season-club in one read-only, repeatable-read transaction: the
 * current non-production AFLM HPN PAV head per season, the finalized calculations' player rows (games
 * from each row's stored `source.gamesPlayed`), and the calculations' own factual appearance
 * universes for the cross-check. It writes nothing.
 */
export async function loadAflTradePlayerSeasonGames(
  sql: AflOutcomeSqlClient,
  options: AflTradePlayerSeasonGamesOptions
): Promise<AflTradePlayerSeasonGames> {
  const rows = await sql.transaction(async (transaction) => {
    await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const heads = await transaction.query<AflTradePlayerSeasonGamesRows['heads'][number]>(
      `SELECT h.season_year, h.calculation_id, c.status, c.finalized_at
         FROM outcome_hpn_pav_calculation_head h
         JOIN outcome_hpn_pav_calculation c USING (calculation_id)
        WHERE h.environment = 'non_production' AND h.competition = 'AFLM'
          AND h.method_id = $1 AND h.season_year = ANY($2::int[])`,
      [options.methodId, options.seasons]
    );
    const finalized = heads.rows
      .filter((head) => head.status === 'finalized' && head.finalized_at !== null)
      .map(({ calculation_id }) => calculation_id);
    const players = await transaction.query<AflTradePlayerSeasonGamesRows['players'][number]>(
      `SELECT c.season_year, p.spell_version_id, p.player_id, p.team_id,
              (p.player_canonical_json::jsonb #>> '{source,gamesPlayed}')::int AS games_played,
              p.total_pav
         FROM outcome_hpn_pav_calculation_player p
         JOIN outcome_hpn_pav_calculation c USING (calculation_id)
        WHERE p.calculation_id = ANY($1::text[])`,
      [finalized]
    );
    const appearances = await transaction.query<
      AflTradePlayerSeasonGamesRows['appearances'][number]
    >(
      `SELECT c.season_year, f.player_id, f.represented_club_id AS club_id,
              count(DISTINCT f.match_id)::int AS matches
         FROM outcome_hpn_pav_calculation c
         JOIN outcome_hpn_pav_input_factual_appearance_member m ON m.input_set_id = c.input_set_id
         JOIN outcome_provider_player_appearance_fact f ON f.appearance_fact_id = m.fact_id
        WHERE c.calculation_id = ANY($1::text[])
          AND f.availability = 'measured' AND f.appeared = TRUE
        GROUP BY c.season_year, f.player_id, f.represented_club_id`,
      [finalized]
    );
    return { heads: heads.rows, players: players.rows, appearances: appearances.rows };
  });
  return buildAflTradePlayerSeasonGames(options, rows);
}
