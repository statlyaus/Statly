import type { LocalHpnPavDecodedRow } from './localHpnPavDirectCalculation';

/** The minimal query surface both a `pg` Pool and a test double provide. */
export interface LocalHpnPavQueryClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[]
  ): Promise<{ readonly rows: Row[] }>;
}

// The AFL Tables player identity lives on the row's identity candidate (at most one per decoded row),
// joined exactly as the governed reviewed-season assembler joins it.
const DECODED_ROW_SELECT = `SELECT
  identity.native_entity_id AS "nativeEntityId",
  decoded.typed_payload->'values'->'Player'->>'value' AS "player",
  decoded.typed_payload->'values'->'Playing.for'->>'value' AS "playingFor",
  decoded.typed_payload->'values'->'Date'->>'value' AS "matchDate",
  decoded.typed_payload->'values'->'Home.team'->>'value' AS "homeTeam",
  decoded.typed_payload->'values'->'Away.team'->>'value' AS "awayTeam",
  decoded.typed_payload->'values'->'Home.score'->>'value' AS "homeScore",
  decoded.typed_payload->'values'->'Away.score'->>'value' AS "awayScore",
  decoded.typed_payload->'values'->'Goals'->>'value' AS "goals",
  decoded.typed_payload->'values'->'Behinds'->>'value' AS "behinds",
  decoded.typed_payload->'values'->'Marks'->>'value' AS "marks",
  decoded.typed_payload->'values'->'Tackles'->>'value' AS "tackles",
  decoded.typed_payload->'values'->'Hit.Outs'->>'value' AS "hitOuts",
  decoded.typed_payload->'values'->'Rebounds'->>'value' AS "rebounds",
  decoded.typed_payload->'values'->'Clearances'->>'value' AS "clearances",
  decoded.typed_payload->'values'->'Inside.50s'->>'value' AS "inside50s",
  decoded.typed_payload->'values'->'Goal.Assists'->>'value' AS "goalAssists",
  decoded.typed_payload->'values'->'Frees.For'->>'value' AS "freesFor",
  decoded.typed_payload->'values'->'Frees.Against'->>'value' AS "freesAgainst",
  decoded.typed_payload->'values'->'One.Percenters'->>'value' AS "onePercenters",
  decoded.typed_payload->'values'->'Marks.Inside.50'->>'value' AS "marksInside50"
FROM outcome_provider_decoded_row decoded
LEFT JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
WHERE decoded.season_year = $1 AND decoded.capture_id = $2 AND decoded.normalization_run_id = $3`;

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
