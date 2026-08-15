import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW } from './localFiveSeasonFitzRoyOutcomeLoad';

interface LocalFiveSeasonAflTablesReviewRow {
  capture_id: string;
  normalization_run_id: string;
  season_year: number;
  provider_decoded_row_id: string;
  identity_candidate_id: string;
  identity_candidate_sha256: string;
  native_entity_id: string;
  recorded_name: string;
  recorded_club_name: string;
  match_candidate_id: string;
  match_candidate_sha256: string;
  order_independent_sha256: string;
  match_date_text: string;
  definition_version: string;
  availability: 'exact' | 'quarantined';
  numeric_value: number | null;
  missing_reason: string | null;
  source_field: string;
}

export interface LocalFiveSeasonAflTablesReviewEvidence {
  seasons: readonly number[];
  captureCount: number;
  appearanceCount: number;
  exactGoalsAppearanceCount: number;
  unavailableGoalsAppearanceCount: number;
  evidenceSetSha256: string;
}

const EXPECTED_APPEARANCE_COUNT = 48_769;
export const LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 =
  'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb';
const DECIDED_AT = '2026-08-14T12:15:00.000Z';

const REVIEWED_ROWS_CTE = `WITH reviewed_rows AS (
  SELECT capture.capture_id,run.normalization_run_id,decoded.season_year,
         decoded.provider_decoded_row_id,
         identity.identity_candidate_id,identity.candidate_sha256 AS identity_candidate_sha256,
         identity.native_entity_id,identity.recorded_name,identity.recorded_club_name,
         match.match_candidate_id,match.candidate_sha256 AS match_candidate_sha256,
         match.order_independent_sha256,match.match_date_text,
         metric.definition_version,metric.availability::text AS availability,
         metric.numeric_value::double precision AS numeric_value,
         metric.missing_reason,metric.source_field
    FROM outcome_provider_decoded_row decoded
    JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
    JOIN outcome_provider_normalization_run run
      ON run.normalization_run_id=decoded.normalization_run_id
     AND run.capture_id=decoded.capture_id
    JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
    JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
    JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
   WHERE capture.provider='afl_tables'
     AND capture.capability_id='afl-tables-player-stats'
     AND capture.environment='non_production'
     AND capture.status='staged'
     AND decoded.season_year BETWEEN 2021 AND 2025
     AND run.finalized_at IS NOT NULL
     AND identity.native_entity_id IS NOT NULL
     AND identity.recorded_name IS NOT NULL
     AND identity.recorded_club_name IS NOT NULL
     AND metric.metric_code='goals'
     AND ($1::text IS NULL OR $1::text IS NOT NULL)
     AND ($2::timestamptz IS NULL OR $2::timestamptz IS NOT NULL)
     AND ($3::text[] IS NULL OR decoded.provider_decoded_row_id=ANY($3::text[]))
)`;

async function loadReviewRows(
  transaction: AflOutcomeSqlTransaction
): Promise<readonly LocalFiveSeasonAflTablesReviewRow[]> {
  const result = await transaction.query<LocalFiveSeasonAflTablesReviewRow>(
    `${REVIEWED_ROWS_CTE}
     SELECT * FROM reviewed_rows
      ORDER BY season_year,provider_decoded_row_id`,
    [null, null, null]
  );
  return result.rows;
}

function evidenceSetSha256(rows: readonly LocalFiveSeasonAflTablesReviewRow[]): string {
  return sha256AflTradeCanonicalJson(
    rows.map((row) => ({
      captureId: row.capture_id,
      normalizationRunId: row.normalization_run_id,
      seasonYear: row.season_year,
      providerDecodedRowId: row.provider_decoded_row_id,
      identityCandidateId: row.identity_candidate_id,
      identityCandidateSha256: row.identity_candidate_sha256,
      nativeEntityId: row.native_entity_id,
      recordedName: row.recorded_name,
      recordedClubName: row.recorded_club_name,
      matchCandidateId: row.match_candidate_id,
      matchCandidateSha256: row.match_candidate_sha256,
      orderIndependentSha256: row.order_independent_sha256,
      matchDateText: row.match_date_text,
      definitionVersion: row.definition_version,
      availability: row.availability,
      numericValue: row.numeric_value,
      missingReason: row.missing_reason,
      sourceField: row.source_field,
    }))
  );
}

function summarizeReviewRows(
  rows: readonly LocalFiveSeasonAflTablesReviewRow[]
): LocalFiveSeasonAflTablesReviewEvidence {
  const seasons = [...new Set(rows.map(({ season_year }) => season_year))].sort();
  const captures = new Set(rows.map(({ capture_id }) => capture_id));
  const exactGoalsAppearanceCount = rows.filter(
    ({ availability }) => availability === 'exact'
  ).length;
  const unavailableGoalsAppearanceCount = rows.filter(
    ({ availability }) => availability === 'quarantined'
  ).length;
  if (
    rows.length !== EXPECTED_APPEARANCE_COUNT ||
    new Set(rows.map(({ provider_decoded_row_id }) => provider_decoded_row_id)).size !==
      rows.length ||
    new Set(rows.map(({ identity_candidate_id }) => identity_candidate_id)).size !== rows.length ||
    new Set(rows.map(({ match_candidate_id }) => match_candidate_id)).size !== rows.length ||
    captures.size !== LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW.length ||
    seasons.join(',') !== LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW.join(',') ||
    exactGoalsAppearanceCount + unavailableGoalsAppearanceCount !== rows.length ||
    rows.some(
      (row) =>
        row.native_entity_id.length === 0 ||
        row.order_independent_sha256.length === 0 ||
        row.recorded_name.length === 0 ||
        row.recorded_club_name.length === 0 ||
        (row.availability === 'exact' && (row.numeric_value === null || row.numeric_value <= 0)) ||
        (row.availability === 'quarantined' && row.numeric_value !== null)
    )
  ) {
    throw new TypeError(
      'The AFL Tables 2021-2025 candidate set is incomplete or internally inconsistent.'
    );
  }
  return {
    seasons,
    captureCount: captures.size,
    appearanceCount: rows.length,
    exactGoalsAppearanceCount,
    unavailableGoalsAppearanceCount,
    evidenceSetSha256: evidenceSetSha256(rows),
  };
}

export async function inspectLocalFiveSeasonAflTablesReviewEvidence(
  client: AflOutcomeSqlTransaction
): Promise<LocalFiveSeasonAflTablesReviewEvidence> {
  return summarizeReviewRows(await loadReviewRows(client));
}

async function insertIdentityReviews(
  transaction: AflOutcomeSqlTransaction,
  evidenceSet: LocalFiveSeasonAflTablesReviewEvidence,
  providerDecodedRowIds: readonly string[]
): Promise<void> {
  await transaction.query(
    `${REVIEWED_ROWS_CTE}
     INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,canonical_record_type,
        canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     SELECT 'local-afl-tables-review:identity:' || identity_candidate_id,
            'provider_identity_candidate',identity_candidate_id,'approved','local_player_club',
            'local_player_club:afl_tables:' || native_entity_id || ':' ||
              regexp_replace(lower(recorded_club_name),'[^a-z0-9]+','-','g'),
            NULL,
            'Approve this exact AFL Tables player-club identity only for private local evaluation.',
            jsonb_build_object(
              'evidenceSetSha256',$1::text,
              'captureId',capture_id,
              'normalizationRunId',normalization_run_id,
              'providerDecodedRowId',provider_decoded_row_id,
              'nativeEntityId',native_entity_id,
              'recordedName',recorded_name,
              'recordedClubName',recorded_club_name,
              'identityCandidateSha256',identity_candidate_sha256
            ),'local-five-season-evidence-reviewer',$2::timestamptz
       FROM reviewed_rows
     ON CONFLICT (decision_id) DO NOTHING`,
    [evidenceSet.evidenceSetSha256, DECIDED_AT, providerDecodedRowIds]
  );
}

async function insertMatchReviews(
  transaction: AflOutcomeSqlTransaction,
  evidenceSet: LocalFiveSeasonAflTablesReviewEvidence,
  providerDecodedRowIds: readonly string[]
): Promise<void> {
  await transaction.query(
    `${REVIEWED_ROWS_CTE}
     INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,canonical_record_type,
        canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     SELECT 'local-afl-tables-review:match:' || match_candidate_id,
            'provider_match_candidate',match_candidate_id,'approved','local_afl_match',
            'local_afl_match:afl_tables:' || order_independent_sha256,NULL,
            'Approve this exact AFL Tables match candidate only for private local evaluation.',
            jsonb_build_object(
              'evidenceSetSha256',$1::text,
              'captureId',capture_id,
              'normalizationRunId',normalization_run_id,
              'providerDecodedRowId',provider_decoded_row_id,
              'matchCandidateSha256',match_candidate_sha256,
              'orderIndependentSha256',order_independent_sha256,
              'matchDate',match_date_text
            ),'local-five-season-evidence-reviewer',$2::timestamptz
       FROM reviewed_rows
     ON CONFLICT (decision_id) DO NOTHING`,
    [evidenceSet.evidenceSetSha256, DECIDED_AT, providerDecodedRowIds]
  );
}

async function insertFactualReviews(
  transaction: AflOutcomeSqlTransaction,
  evidenceSet: LocalFiveSeasonAflTablesReviewEvidence,
  providerDecodedRowIds: readonly string[]
): Promise<void> {
  await transaction.query(
    `${REVIEWED_ROWS_CTE}
     INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,canonical_record_type,
        canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     SELECT 'local-afl-tables-review:fact:' || provider_decoded_row_id,
            'local_reconciled_player_match_fact',provider_decoded_row_id,'approved',
            'local_player_match_fact','local_player_match_fact:afl_tables:' || provider_decoded_row_id,
            NULL,
            'Reconcile one reviewed appearance and only an unambiguous goals value for private local evaluation.',
            jsonb_strip_nulls(jsonb_build_object(
              'evidenceSetSha256',$1::text,
              'identityCandidateId',identity_candidate_id,
              'matchCandidateId',match_candidate_id,
              'appearanceObserved',true,
              'metricCode','goals',
              'metricAvailability',availability,
              'definitionVersion',definition_version,
              'numericValue',numeric_value,
              'missingReason',missing_reason,
              'sourceField',source_field
            )),'local-five-season-evidence-reviewer',$2::timestamptz
       FROM reviewed_rows
     ON CONFLICT (decision_id) DO NOTHING`,
    [evidenceSet.evidenceSetSha256, DECIDED_AT, providerDecodedRowIds]
  );
}

export async function reviewLocalFiveSeasonAflTablesEvidence(
  client: AflOutcomeSqlClient
): Promise<LocalFiveSeasonAflTablesReviewEvidence> {
  const rows = await loadReviewRows(client);
  const evidenceSet = summarizeReviewRows(rows);
  if (evidenceSet.evidenceSetSha256 !== LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256) {
    throw new TypeError(
      'The AFL Tables 2021-2025 candidates do not match the exact reviewed evidence set.'
    );
  }
  const batchSize = 1_000;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const providerDecodedRowIds = rows
      .slice(offset, offset + batchSize)
      .map(({ provider_decoded_row_id }) => provider_decoded_row_id);
    await client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `local-five-season-afl-tables-review:${offset / batchSize}`,
      ]);
      await insertIdentityReviews(transaction, evidenceSet, providerDecodedRowIds);
      await insertMatchReviews(transaction, evidenceSet, providerDecodedRowIds);
      await insertFactualReviews(transaction, evidenceSet, providerDecodedRowIds);
    });
  }
  return client.transaction(async (transaction) => {
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      'local-five-season-afl-tables-review:admission',
    ]);
    const current = await transaction.query<{ decision_count: number }>(
      `SELECT count(*)::integer AS decision_count
         FROM outcome_review_decision decision
        WHERE decision.decided_by='local-five-season-evidence-reviewer'
          AND decision.decision='approved'
          AND decision.subject_type=ANY($2::text[])
          AND decision.evidence_json->>'evidenceSetSha256'=$1
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )`,
      [
        evidenceSet.evidenceSetSha256,
        [
          'provider_identity_candidate',
          'provider_match_candidate',
          'local_reconciled_player_match_fact',
        ],
      ]
    );
    if (current.rows[0]?.decision_count !== evidenceSet.appearanceCount * 3) {
      throw new TypeError('The exact private five-season review set is not current and complete.');
    }
    const reviewSetDecisionId = `local-afl-tables-review:set:${evidenceSet.evidenceSetSha256}`;
    await transaction.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,canonical_record_type,
         canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'local_review_set',$2,'approved','local_review_set',$2,NULL,$3,$4::jsonb,$5,$6)
       ON CONFLICT (decision_id) DO NOTHING`,
      [
        reviewSetDecisionId,
        evidenceSet.evidenceSetSha256,
        'Admit the complete exact 2021-2025 AFL Tables review set only for private local evaluation.',
        JSON.stringify(evidenceSet),
        'local-five-season-evidence-reviewer',
        DECIDED_AT,
      ]
    );
    const admitted = await transaction.query<{ decision_id: string }>(
      `SELECT decision_id FROM outcome_review_decision decision
        WHERE decision_id=$1 AND subject_type='local_review_set' AND subject_id=$2
          AND decision='approved' AND evidence_json->>'evidenceSetSha256'=$2
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )`,
      [reviewSetDecisionId, evidenceSet.evidenceSetSha256]
    );
    if (admitted.rows.length !== 1) {
      throw new TypeError('The complete private five-season review set was not admitted.');
    }
    return evidenceSet;
  });
}
