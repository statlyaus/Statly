import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { parseAflTradeExternalReconciliationCandidate } from '../source/externalReconciliationCandidateContracts';
import type { AflTradeRealizedTradeGradeInputs } from '../valuation/realizedTradeGrade';

const SEASON_SPELLS = 'afl-trade-acquisition-registration/v3';
const REVIEWED_ARRIVALS = 'afl-trade-acquisition-registration/v4';

export interface AflTradeRealizedTradeGradeInputOptions {
  candidateId: string;
  /** The HPN PAV method whose current per-season calculations the grade uses. */
  methodId: string;
  seasons: readonly number[];
  /** Seasons whose PAV is official; the rest are graded but flagged. */
  officialSeasons: readonly number[];
  pickProjectionBenchmarkId: string;
  /** Spells recorded after this instant are ignored, so a rerun reads the same spells. */
  spellCutoffAt: string;
  gradedAt: string;
}

export interface AflTradeRealizedTradeGradeRows {
  candidate: { candidate_json: unknown; environment: string; status: string } | undefined;
  heads: readonly {
    season_year: number;
    calculation_id: string;
    status: string;
    finalized_at: string | Date | null;
  }[];
  pav: readonly {
    season_year: number;
    spell_version_id: string;
    player_id: string;
    team_id: string;
    total_pav: number;
  }[];
  /** `season` is the first season played under the spell (see the loader's SQL). */
  spells: readonly {
    spell_version_id: string;
    player_id: string;
    club_id: string;
    season: number;
    schema: string;
  }[];
}

/** Maps the loaded rows to grader inputs, refusing anything the grade must not silently assume. */
export function buildAflTradeRealizedTradeGradeInputs(
  options: AflTradeRealizedTradeGradeInputOptions,
  rows: AflTradeRealizedTradeGradeRows
): AflTradeRealizedTradeGradeInputs {
  if (!rows.candidate) throw new Error(`Unknown candidate ${options.candidateId}.`);
  if (rows.candidate.status !== 'finalized' || rows.candidate.environment !== 'non_production')
    throw new Error(`${options.candidateId} is not a finalized non-production candidate.`);
  const candidate = parseAflTradeExternalReconciliationCandidate(rows.candidate.candidate_json);
  if (candidate.candidateId !== options.candidateId)
    throw new Error(`The stored candidate does not carry ${options.candidateId}.`);
  if (options.seasons.length === 0 || new Set(options.seasons).size !== options.seasons.length)
    throw new Error('Grade one or more distinct seasons.');
  const heads = new Map(rows.heads.map((head) => [head.season_year, head]));
  const missing = options.seasons.filter((season) => heads.get(season)?.status !== 'finalized');
  if (missing.length)
    throw new Error(`No finalized current HPN PAV calculation for ${missing.join(', ')}.`);
  const cutoff = Date.parse(options.spellCutoffAt);
  const advanced = options.seasons.filter((season) => {
    const finalizedAt = heads.get(season)!.finalized_at;
    return finalizedAt === null || new Date(finalizedAt).getTime() > cutoff;
  });
  // A head that moved after the cutoff would make a rerun read different PAV.
  if (advanced.length)
    throw new Error(
      `The HPN PAV calculation for ${advanced.join(', ')} was finalized after the cutoff.`
    );
  const official = new Set(options.officialSeasons);
  if (options.officialSeasons.some((season) => !options.seasons.includes(season)))
    throw new Error('An official season must be one of the graded seasons.');
  const spells = (schema: string) =>
    rows.spells
      .filter((row) => row.schema === schema)
      .map((row) => ({ playerId: row.player_id, clubId: row.club_id, season: row.season }));
  const seasonSpells = spells(SEASON_SPELLS);
  const coveredSeasons = new Set(seasonSpells.map(({ season }) => season));
  const uncovered = options.seasons.filter((season) => !coveredSeasons.has(season));
  // Without a season's appearances, every departure in it would silently read as an open stint.
  if (uncovered.length) throw new Error(`No season spells for ${uncovered.join(', ')}.`);
  const seasonSpellIds = new Set(
    rows.spells.filter((row) => row.schema === SEASON_SPELLS).map((row) => row.spell_version_id)
  );
  const pavKeys = new Set<string>();
  for (const row of rows.pav) {
    const key = `${row.season_year}|${row.player_id}|${row.team_id}`;
    if (pavKeys.has(key))
      throw new Error(`Two PAV rows for ${row.player_id} at ${row.team_id} in ${row.season_year}.`);
    pavKeys.add(key);
    if (!seasonSpellIds.has(row.spell_version_id))
      throw new Error(`PAV row ${row.spell_version_id} is not bound to a current season spell.`);
  }
  return {
    candidateId: candidate.candidateId,
    candidate: candidate.content,
    pavCalculations: [...options.seasons]
      .sort((left, right) => left - right)
      .map((season) => ({
        season,
        calculationId: heads.get(season)!.calculation_id,
        official: official.has(season),
      })),
    pav: rows.pav.map((row) => ({
      playerId: row.player_id,
      season: row.season_year,
      clubId: row.team_id,
      value: row.total_pav,
    })),
    seasonSpells,
    spellSeasons: [...new Set(seasonSpells.map(({ season }) => season))].sort((a, b) => a - b),
    reviewedArrivals: spells(REVIEWED_ARRIVALS),
    pickProjectionBenchmarkId: options.pickProjectionBenchmarkId,
    spellCutoffAt: options.spellCutoffAt,
    gradedAt: options.gradedAt,
  };
}

/**
 * Loads the grader's inputs in one read-only, repeatable-read transaction. Set-based: one query per
 * table, no per-spell registration check. A spell is current here when it is approved and nothing
 * recorded by the cutoff supersedes it; the full registration-currency check is Phase 4 work.
 */
export async function loadAflTradeRealizedTradeGradeInputs(
  sql: AflOutcomeSqlClient,
  options: AflTradeRealizedTradeGradeInputOptions
): Promise<AflTradeRealizedTradeGradeInputs> {
  const rows = await sql.transaction(async (transaction) => {
    await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const candidate = await transaction.query<
      NonNullable<AflTradeRealizedTradeGradeRows['candidate']>
    >(
      `SELECT candidate_json, environment::text AS environment, status::text AS status
         FROM outcome_external_reconciliation_candidate WHERE candidate_id = $1`,
      [options.candidateId]
    );
    const heads = await transaction.query<AflTradeRealizedTradeGradeRows['heads'][number]>(
      `SELECT h.season_year, h.calculation_id, c.status, c.finalized_at
         FROM outcome_hpn_pav_calculation_head h
         JOIN outcome_hpn_pav_calculation c USING (calculation_id)
        WHERE h.environment = 'non_production' AND h.competition = 'AFLM'
          AND h.method_id = $1 AND h.season_year = ANY($2::int[])`,
      [options.methodId, options.seasons]
    );
    const pav = await transaction.query<AflTradeRealizedTradeGradeRows['pav'][number]>(
      `SELECT c.season_year, p.spell_version_id, p.player_id, p.team_id, p.total_pav
         FROM outcome_hpn_pav_calculation_player p
         JOIN outcome_hpn_pav_calculation c USING (calculation_id)
        WHERE p.calculation_id = ANY($1::text[])`,
      [heads.rows.map(({ calculation_id }) => calculation_id)]
    );
    const spells = await transaction.query<AflTradeRealizedTradeGradeRows['spells'][number]>(
      // A v3 spell names its season. A v4 arrival's first season is its start date's year, or the next
      // year when it starts after the season ends (October to December, as draft nights do).
      `SELECT s.spell_version_id, s.player_id, s.club_id,
              CASE WHEN r ->> 'schemaVersion' = $3 THEN (r ->> 'seasonYear')::int
                   ELSE extract(year FROM s.start_date)::int
                        + CASE WHEN extract(month FROM s.start_date) >= 10 THEN 1 ELSE 0 END
              END AS season,
              r ->> 'schemaVersion' AS schema
         FROM outcome_acquisition_spell_version s
        CROSS JOIN LATERAL (SELECT s.registration_canonical_json::jsonb AS r) registration
        WHERE s.status::text = 'approved' AND s.recorded_at <= $1::timestamptz
          AND r ->> 'schemaVersion' = ANY($2::text[])
          AND r ->> 'environment' = 'non_production' AND r ->> 'competition' = 'AFLM'
          AND NOT EXISTS (
                SELECT 1 FROM outcome_acquisition_spell_version successor
                 WHERE successor.supersedes_spell_version_id = s.spell_version_id
                   AND successor.recorded_at <= $1::timestamptz)
        ORDER BY s.spell_version_id`,
      [options.spellCutoffAt, [SEASON_SPELLS, REVIEWED_ARRIVALS], SEASON_SPELLS]
    );
    return { candidate: candidate.rows[0], heads: heads.rows, pav: pav.rows, spells: spells.rows };
  });
  return buildAflTradeRealizedTradeGradeInputs(options, rows);
}
