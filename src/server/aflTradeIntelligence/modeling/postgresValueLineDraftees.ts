import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeValueLineDraftee } from './valueLineFit';

export interface AflTradeValueLineDrafteeRow {
  selection_id: string;
  selection_number: number;
  player_id: string | null;
  club_id: string;
  draft_year: number;
}

/**
 * Maps current canonical national-draft selections to draftees, refusing what the fit cannot use:
 * a selection with no player, a selection read twice, and a player or slot taken twice in one draft.
 */
export function buildAflTradeValueLineDraftees(
  draftYears: readonly number[],
  rows: readonly AflTradeValueLineDrafteeRow[]
): AflTradeValueLineDraftee[] {
  const years = new Set(draftYears);
  const seen = new Set<string>();
  const draftees = rows.map((row) => {
    const draftYear = Number(row.draft_year);
    const selectionNumber = Number(row.selection_number);
    if (!years.has(draftYear))
      throw new Error(`Selection ${row.selection_id} is outside the drafts read.`);
    if (row.player_id === null) throw new Error(`Selection ${row.selection_id} names no player.`);
    if (!Number.isInteger(selectionNumber) || selectionNumber < 1)
      throw new Error(`Selection ${row.selection_id} has no usable number.`);
    for (const key of [
      `selection|${row.selection_id}`,
      `player|${draftYear}|${row.player_id}`,
      `slot|${draftYear}|${selectionNumber}`,
    ]) {
      if (seen.has(key)) throw new Error(`${key} is read twice; the fit refuses.`);
      seen.add(key);
    }
    return {
      selectionId: row.selection_id,
      draftYear,
      selectionNumber,
      clubId: row.club_id,
      playerId: row.player_id,
    };
  });
  for (const year of years)
    if (!draftees.some(({ draftYear }) => draftYear === year))
      throw new Error(`The ${year} national draft has no current canonical selection.`);
  return draftees.sort(
    (left, right) =>
      left.draftYear - right.draftYear || left.selectionNumber - right.selectionNumber
  );
}

/**
 * Loads the current canonical AFLM national-draft selections of `draftYears` (the same SQL function
 * the promoter's guards read), read-only. Rookie, pre-season and mid-season drafts are out of scope
 * (Owner), so only `national_draft` events are read.
 */
export async function loadAflTradeValueLineDraftees(
  sql: AflOutcomeSqlClient,
  draftYears: readonly number[]
): Promise<AflTradeValueLineDraftee[]> {
  const rows = await sql.transaction(async (transaction) => {
    await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const result = await transaction.query<AflTradeValueLineDrafteeRow>(
      `SELECT current.selection_id, current.selection_number, current.player_id, current.club_id,
              event.season_year AS draft_year
         FROM outcome_current_canonical_draft_selection_picks('AFLM') current
         JOIN outcome_event_version version ON version.event_version_id = current.event_version_id
         JOIN outcome_event event ON event.event_id = version.event_id
        WHERE version.kind = 'national_draft' AND event.season_year = ANY($1::int[])
        ORDER BY event.season_year, current.selection_number, current.selection_id`,
      [draftYears]
    );
    return result.rows;
  });
  return buildAflTradeValueLineDraftees(draftYears, rows);
}
