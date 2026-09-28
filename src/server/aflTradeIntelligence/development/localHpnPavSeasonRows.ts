import type { LocalHpnPavDecodedRow } from './localHpnPavDirectCalculation';

/** The minimal query surface both a `pg` Pool and a test double provide. */
export interface LocalHpnPavQueryClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[]
  ): Promise<{ readonly rows: Row[] }>;
}

const DECODED_ROW_SELECT = `SELECT
  native_entity_id AS "nativeEntityId",
  typed_payload->'values'->'Player'->>'value' AS "player",
  typed_payload->'values'->'Playing.for'->>'value' AS "playingFor",
  typed_payload->'values'->'Date'->>'value' AS "matchDate",
  typed_payload->'values'->'Home.team'->>'value' AS "homeTeam",
  typed_payload->'values'->'Away.team'->>'value' AS "awayTeam",
  typed_payload->'values'->'Home.score'->>'value' AS "homeScore",
  typed_payload->'values'->'Away.score'->>'value' AS "awayScore",
  typed_payload->'values'->'Goals'->>'value' AS "goals",
  typed_payload->'values'->'Behinds'->>'value' AS "behinds",
  typed_payload->'values'->'Marks'->>'value' AS "marks",
  typed_payload->'values'->'Tackles'->>'value' AS "tackles",
  typed_payload->'values'->'Hit.Outs'->>'value' AS "hitOuts",
  typed_payload->'values'->'Rebounds'->>'value' AS "rebounds",
  typed_payload->'values'->'Clearances'->>'value' AS "clearances",
  typed_payload->'values'->'Inside.50s'->>'value' AS "inside50s",
  typed_payload->'values'->'Goal.Assists'->>'value' AS "goalAssists",
  typed_payload->'values'->'Frees.For'->>'value' AS "freesFor",
  typed_payload->'values'->'Frees.Against'->>'value' AS "freesAgainst",
  typed_payload->'values'->'One.Percenters'->>'value' AS "onePercenters",
  typed_payload->'values'->'Marks.Inside.50'->>'value' AS "marksInside50"
FROM outcome_provider_decoded_row
WHERE season_year = $1 AND capture_id = $2 AND normalization_run_id = $3`;

interface RunRow extends Record<string, unknown> {
  normalization_run_id: string;
}

/**
 * Loads one season's rows from exactly one normalization run. Without an explicit run it selects the
 * capture's latest finalized run, as the governed assembler does, so rescrapes are never mixed. Every
 * row of the run is included, whatever its review status; the database already requires a finalized
 * run to hold exactly its recorded source rows.
 */
export async function loadLocalHpnPavSeasonRows(
  client: LocalHpnPavQueryClient,
  input: Readonly<{ season: number; captureId: string; normalizationRunId?: string | null }>
): Promise<{ normalizationRunId: string; rows: LocalHpnPavDecodedRow[] }> {
  const runs = await client.query<RunRow>(
    `SELECT normalization_run_id
       FROM outcome_provider_normalization_run
      WHERE capture_id = $1 AND finalized_at IS NOT NULL
        AND ($2::text IS NULL OR normalization_run_id = $2)
      ORDER BY finalized_at DESC, normalization_run_id DESC
      LIMIT 1`,
    [input.captureId, input.normalizationRunId ?? null]
  );
  const run = runs.rows[0];
  if (!run) {
    throw new TypeError(`No finalized normalization run for capture ${input.captureId}.`);
  }
  const result = await client.query<LocalHpnPavDecodedRow & Record<string, unknown>>(
    DECODED_ROW_SELECT,
    [input.season, input.captureId, run.normalization_run_id]
  );
  return { normalizationRunId: run.normalization_run_id, rows: result.rows };
}
