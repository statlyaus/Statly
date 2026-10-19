import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { loadAflTradePlayerSeasonGames } from './postgresPlayerSeasonGames';
import type { AflTradeValueLineFitInputs, AflTradeValueLineFitSelection } from './valueLineFit';

export interface AflTradeValueLineFitInputOptions {
  /** The HPN PAV method whose current per-season calculations are read. */
  methodId: string;
  /** The national draft classes fitted, ascending and consecutive. */
  draftYears: readonly number[];
  /** The last season read; every season from the first class's next season to it is read. */
  lastSeason: number;
}

/**
 * Loads the value-line fit's inputs (#789 step 2), read-only: every current canonical AFLM
 * national-draft selection of the classes fitted (`outcome_current_canonical_draft_selection_picks`,
 * the function the promoter and the candidate guards read), and the player-season games read model
 * over the seasons after them. Each read is its own repeatable-read, read-only transaction; it writes
 * nothing.
 */
export async function loadAflTradeValueLineFitInputs(
  sql: AflOutcomeSqlClient,
  options: AflTradeValueLineFitInputOptions
): Promise<AflTradeValueLineFitInputs> {
  const first = Math.min(...options.draftYears);
  const last = Math.max(...options.draftYears);
  if (options.draftYears.length !== last - first + 1)
    throw new Error('Fit a consecutive run of draft classes.');
  if (options.lastSeason <= last) throw new Error('Read at least one season after the last class.');
  const rows = await sql.transaction(async (transaction) => {
    await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const result = await transaction.query<{
      selection_id: string;
      draft_year: number;
      selection_number: number;
      club_id: string;
      player_id: string | null;
    }>(
      `SELECT selection_id, draft_year, selection_number, club_id, player_id
         FROM outcome_current_canonical_draft_selection_picks('AFLM')
        WHERE draft_type = 'national' AND draft_year BETWEEN $1 AND $2
        ORDER BY draft_year, selection_number, selection_id`,
      [first, last]
    );
    return result.rows;
  });
  const selections = rows.map((row): AflTradeValueLineFitSelection => {
    if (row.player_id === null)
      throw new Error(`Selection ${row.selection_id} has no canonical player.`);
    return {
      selectionId: row.selection_id,
      draftYear: Number(row.draft_year),
      slot: Number(row.selection_number),
      clubId: row.club_id,
      playerId: row.player_id,
    };
  });
  const missing = options.draftYears.filter(
    (year) => !selections.some(({ draftYear }) => draftYear === year)
  );
  if (missing.length > 0)
    throw new Error(`No national draft selections for ${missing.join(', ')}.`);
  const games = await loadAflTradePlayerSeasonGames(sql, {
    methodId: options.methodId,
    seasons: Array.from({ length: options.lastSeason - first }, (_, index) => first + 1 + index),
  });
  return { selections, games };
}
