import type { AflTradeDevelopmentReconciledAcquisitionOutcome } from '../modeling/developmentWorkbookValueProjection';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflOutcomesDevelopmentAcquisitionItem } from '../source/developmentWorkbookAcquisitionProjection';
import { LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 } from './localFiveSeasonAflTablesReview';
import { LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256 } from './localOfficialAfl2026Review';

interface StagedAcquisitionOutcomeRow {
  normalized_player_name: string;
  normalized_club_name: string;
  provider: string;
  season_year: number;
  identity_count: number;
  appearance_count: number;
  exact_goals: number | null;
  goals_complete: boolean;
  effective_through: string;
  source_through_season: number;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const unavailable = { state: 'unavailable', reason: 'source_missing' } as const;

/**
 * Builds a private development projection from finalized provider staging. Historical AFL Tables
 * rows are admitted only from the five completed full-season captures; current official rows must
 * be concluded. A missing player/club match produces no outcome, never a zero.
 */
export async function loadLocalAflTradeStagedWorkbookOutcomes(
  client: AflOutcomeSqlClient,
  acquisitions: readonly AflOutcomesDevelopmentAcquisitionItem[]
): Promise<ReadonlyMap<string, AflTradeDevelopmentReconciledAcquisitionOutcome>> {
  if (acquisitions.length === 0) return new Map();
  const requestedPlayerClubs = [
    ...new Map(
      acquisitions.map((acquisition) => {
        const playerName = normalizeName(acquisition.playerName);
        const clubName = normalizeName(acquisition.clubName);
        return [`${playerName}\0${clubName}`, { player_name: playerName, club_name: clubName }];
      })
    ).values(),
  ];
  const result = await client.query<StagedAcquisitionOutcomeRow>(
    `WITH requested_player_club AS MATERIALIZED (
       SELECT requested.player_name,requested.club_name
         FROM jsonb_to_recordset($1::jsonb) AS requested(player_name text,club_name text)
     ), candidate_rows AS MATERIALIZED (
       SELECT capture.provider,row.season_year,row.provider_decoded_row_id,
              identity.identity_candidate_id,identity.native_entity_id,
              identity.recorded_name,identity.recorded_club_name,
              match.match_candidate_id,match.order_independent_sha256,match.match_date_text,
              metric.metric_code,metric.definition_version,metric.availability::text AS availability,
              metric.numeric_value,metric.missing_reason
         FROM outcome_provider_identity_candidate identity
         JOIN requested_player_club requested
           ON requested.player_name=regexp_replace(lower(identity.recorded_name),'[^a-z0-9]+',' ','g')
          AND requested.club_name=regexp_replace(lower(identity.recorded_club_name),'[^a-z0-9]+',' ','g')
         JOIN outcome_provider_decoded_row row USING (provider_decoded_row_id)
         JOIN outcome_provider_normalization_run run
           ON run.normalization_run_id=row.normalization_run_id
         JOIN outcome_source_capture capture ON capture.capture_id=row.capture_id
         JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
         JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
        WHERE run.finalized_at IS NOT NULL
          AND capture.environment='non_production'
          AND capture.status='staged'
          AND identity.native_entity_id IS NOT NULL
          AND metric.metric_code='goals'
          AND ((capture.provider='afl_tables'
                AND capture.capability_id='afl-tables-player-stats'
                AND row.season_year BETWEEN 2021 AND 2025)
            OR (capture.provider='official_afl'
                AND capture.capability_id='official-afl-player-stats'
                AND row.season_year=2026
                AND match.provider_status='CONCLUDED'))
     ), historical_candidate_members AS MATERIALIZED (
       SELECT decoded.provider_decoded_row_id,
              identity.identity_candidate_id,match.match_candidate_id
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
     ), current_identity_review AS MATERIALIZED (
       SELECT decision.subject_id,decision.canonical_record_id,
              decision.evidence_json->>'evidenceSetSha256' AS evidence_set_sha256
         FROM outcome_review_decision decision
         JOIN candidate_rows candidate
           ON candidate.provider='official_afl'
          AND candidate.identity_candidate_id=decision.subject_id
         JOIN outcome_review_decision review_set
           ON review_set.decision_id='local-official-afl-review:set:' || $4
          AND review_set.subject_type='local_review_set'
          AND review_set.subject_id=$4
          AND review_set.decision='approved'
          AND review_set.decided_by='local-workbook-evidence-reviewer'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=review_set.decision_id
          )
         JOIN LATERAL jsonb_array_elements_text(review_set.evidence_json->'decisionIds')
                AS expected(decision_id)
           ON expected.decision_id=decision.decision_id
        WHERE decision.subject_type='provider_identity_candidate'
          AND decision.decision='approved'
          AND decision.decided_by='local-workbook-evidence-reviewer'
          AND decision.canonical_record_type='local_player_club'
          AND decision.evidence_json ? 'evidenceSetSha256'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
     ), current_match_review AS MATERIALIZED (
       SELECT decision.subject_id,
              decision.evidence_json->>'evidenceSetSha256' AS evidence_set_sha256
         FROM outcome_review_decision decision
         JOIN candidate_rows candidate
           ON candidate.provider='official_afl'
          AND candidate.match_candidate_id=decision.subject_id
         JOIN outcome_review_decision review_set
           ON review_set.decision_id='local-official-afl-review:set:' || $4
          AND review_set.subject_type='local_review_set'
          AND review_set.subject_id=$4
          AND review_set.decision='approved'
          AND review_set.decided_by='local-workbook-evidence-reviewer'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=review_set.decision_id
          )
         JOIN LATERAL jsonb_array_elements_text(review_set.evidence_json->'decisionIds')
                AS expected(decision_id)
           ON expected.decision_id=decision.decision_id
        WHERE decision.subject_type='provider_match_candidate'
          AND decision.decision='approved'
          AND decision.decided_by='local-workbook-evidence-reviewer'
          AND decision.canonical_record_type='local_afl_match'
          AND decision.evidence_json ? 'evidenceSetSha256'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
     ), current_factual_review AS MATERIALIZED (
       SELECT decision.subject_id,
              decision.evidence_json->>'identityCandidateId' AS identity_candidate_id,
              decision.evidence_json->>'matchCandidateId' AS match_candidate_id,
              decision.evidence_json->>'metricCode' AS metric_code,
              decision.evidence_json->>'metricAvailability' AS metric_availability,
              decision.evidence_json->>'definitionVersion' AS definition_version,
              decision.evidence_json->>'numericValue' AS numeric_value,
              decision.evidence_json->>'evidenceSetSha256' AS evidence_set_sha256
         FROM outcome_review_decision decision
         JOIN candidate_rows candidate
           ON candidate.provider='official_afl'
          AND candidate.provider_decoded_row_id=decision.subject_id
         JOIN outcome_review_decision review_set
           ON review_set.decision_id='local-official-afl-review:set:' || $4
          AND review_set.subject_type='local_review_set'
          AND review_set.subject_id=$4
          AND review_set.decision='approved'
          AND review_set.decided_by='local-workbook-evidence-reviewer'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=review_set.decision_id
          )
         JOIN LATERAL jsonb_array_elements_text(review_set.evidence_json->'decisionIds')
                AS expected(decision_id)
           ON expected.decision_id=decision.decision_id
        WHERE decision.subject_type='local_reconciled_player_match_fact'
          AND decision.decision='approved'
          AND decision.decided_by='local-workbook-evidence-reviewer'
          AND decision.canonical_record_type='local_player_match_fact'
          AND decision.evidence_json->>'appearanceObserved'='true'
          AND decision.evidence_json ? 'evidenceSetSha256'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
     ), current_review_set AS MATERIALIZED (
       SELECT decision.subject_id,decision.decided_by,decision.evidence_json
         FROM outcome_review_decision decision
        WHERE decision.subject_type='local_review_set'
          AND decision.decision='approved'
          AND decision.canonical_record_type='local_review_set'
          AND decision.canonical_record_id=decision.subject_id
          AND decision.evidence_json->>'evidenceSetSha256'=decision.subject_id
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
     ), historical_review_members AS MATERIALIZED (
       SELECT decision.decision_id
         FROM historical_candidate_members candidate
         JOIN outcome_review_decision decision
           ON decision.subject_id=candidate.identity_candidate_id
          AND decision.decision_id=
                'local-afl-tables-review:identity:' || candidate.identity_candidate_id
        WHERE decision.subject_type='provider_identity_candidate'
          AND decision.decision='approved'
          AND decision.canonical_record_type='local_player_club'
          AND decision.decided_by='local-five-season-evidence-reviewer'
          AND decision.evidence_json->>'evidenceSetSha256'=$2
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
       UNION ALL
       SELECT decision.decision_id
         FROM historical_candidate_members candidate
         JOIN outcome_review_decision decision
           ON decision.subject_id=candidate.match_candidate_id
          AND decision.decision_id='local-afl-tables-review:match:' || candidate.match_candidate_id
        WHERE decision.subject_type='provider_match_candidate'
          AND decision.decision='approved'
          AND decision.canonical_record_type='local_afl_match'
          AND decision.decided_by='local-five-season-evidence-reviewer'
          AND decision.evidence_json->>'evidenceSetSha256'=$2
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
       UNION ALL
       SELECT decision.decision_id
         FROM historical_candidate_members candidate
         JOIN outcome_review_decision decision
           ON decision.subject_id=candidate.provider_decoded_row_id
          AND decision.decision_id=
                'local-afl-tables-review:fact:' || candidate.provider_decoded_row_id
        WHERE decision.subject_type='local_reconciled_player_match_fact'
          AND decision.decision='approved'
          AND decision.canonical_record_type='local_player_match_fact'
          AND decision.decided_by='local-five-season-evidence-reviewer'
          AND decision.evidence_json->>'evidenceSetSha256'=$2
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
     ), historical_review_health AS MATERIALIZED (
       SELECT review_set.subject_id
         FROM current_review_set review_set
        WHERE review_set.subject_id=$2
          AND review_set.decided_by='local-five-season-evidence-reviewer'
          AND (
            SELECT count(*)
              FROM historical_review_members
          )=146307
     ), official_review_health AS MATERIALIZED (
       SELECT review_set.subject_id
         FROM current_review_set review_set
        WHERE review_set.subject_id=$4
          AND review_set.decided_by='local-workbook-evidence-reviewer'
          AND (review_set.evidence_json->>'appearanceCount')::integer=12
          AND (review_set.evidence_json->>'decisionCount')::integer=36
          AND jsonb_array_length(review_set.evidence_json->'decisionIds')=36
          AND (
            SELECT count(*)=36 AND count(DISTINCT expected.decision_id)=36
              FROM jsonb_array_elements_text(review_set.evidence_json->'decisionIds')
                     AS expected(decision_id)
              JOIN outcome_review_decision decision USING (decision_id)
             WHERE decision.decided_by='local-workbook-evidence-reviewer'
               AND decision.decision='approved'
               AND decision.subject_type=ANY($3::text[])
               AND decision.evidence_json->>'evidenceSetSha256'=review_set.subject_id
               AND NOT EXISTS (
                 SELECT 1 FROM outcome_review_decision successor
                  WHERE successor.supersedes_decision_id=decision.decision_id
               )
          )
     ), official_cutoff AS MATERIALIZED (
       SELECT max(row.season_year)::integer AS source_through_season,
              max(match.match_date_text) AS effective_through
         FROM official_review_health review_health
         JOIN current_review_set review_set
           ON review_set.subject_id=review_health.subject_id
          AND review_set.decided_by='local-workbook-evidence-reviewer'
         CROSS JOIN LATERAL jsonb_array_elements_text(review_set.evidence_json->'decisionIds')
                AS expected(decision_id)
         JOIN outcome_review_decision decision ON decision.decision_id=expected.decision_id
         JOIN outcome_provider_decoded_row row ON row.provider_decoded_row_id=decision.subject_id
         JOIN outcome_source_capture capture ON capture.capture_id=row.capture_id
         JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
        WHERE decision.subject_type='local_reconciled_player_match_fact'
          AND decision.decision='approved'
          AND decision.decided_by='local-workbook-evidence-reviewer'
          AND decision.evidence_json ? 'evidenceSetSha256'
          AND decision.evidence_json->>'metricAvailability'='exact'
          AND capture.provider='official_afl'
          AND capture.environment='non_production'
          AND capture.status='staged'
          AND match.provider_status='CONCLUDED'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
     ), provider_rows AS (
       SELECT candidate.provider,candidate.season_year,candidate.provider_decoded_row_id,
              'local_player_club:afl_tables:' || candidate.native_entity_id || ':' ||
                regexp_replace(lower(candidate.recorded_club_name),'[^a-z0-9]+','-','g')
                AS reviewed_player_club_id,
              regexp_replace(lower(candidate.recorded_name),'[^a-z0-9]+',' ','g')
                AS normalized_player_name,
              regexp_replace(lower(candidate.recorded_club_name),'[^a-z0-9]+',' ','g')
                AS normalized_club_name,
              candidate.order_independent_sha256,candidate.match_date_text,
              candidate.availability AS metric_availability,
              candidate.numeric_value,candidate.missing_reason
         FROM candidate_rows candidate
         CROSS JOIN historical_review_health
        WHERE candidate.provider='afl_tables'
       UNION ALL
       SELECT DISTINCT candidate.provider,candidate.season_year,candidate.provider_decoded_row_id,
              identity_review.canonical_record_id AS reviewed_player_club_id,
              regexp_replace(lower(candidate.recorded_name),'[^a-z0-9]+',' ','g')
                AS normalized_player_name,
              regexp_replace(lower(candidate.recorded_club_name),'[^a-z0-9]+',' ','g')
                AS normalized_club_name,
              candidate.order_independent_sha256,candidate.match_date_text,
              factual_review.metric_availability,
              candidate.numeric_value,candidate.missing_reason
         FROM candidate_rows candidate
         JOIN current_identity_review identity_review
           ON identity_review.subject_id=candidate.identity_candidate_id
         JOIN current_match_review match_review
           ON match_review.subject_id=candidate.match_candidate_id
         JOIN current_factual_review factual_review
           ON factual_review.subject_id=candidate.provider_decoded_row_id
          AND factual_review.identity_candidate_id=candidate.identity_candidate_id
          AND factual_review.match_candidate_id=candidate.match_candidate_id
          AND factual_review.metric_code=candidate.metric_code
          AND factual_review.definition_version=candidate.definition_version
          AND factual_review.metric_availability=candidate.availability
          AND factual_review.numeric_value::numeric
                IS NOT DISTINCT FROM candidate.numeric_value
         CROSS JOIN official_review_health review_health
        WHERE identity_review.evidence_set_sha256=factual_review.evidence_set_sha256
          AND match_review.evidence_set_sha256=factual_review.evidence_set_sha256
          AND factual_review.evidence_set_sha256=review_health.subject_id
          AND candidate.provider='official_afl'
     ), source_cutoff AS (
       SELECT source_through_season,effective_through FROM official_cutoff
     )
     SELECT provider_rows.normalized_player_name,provider_rows.normalized_club_name,
            provider_rows.provider,provider_rows.season_year,
            count(DISTINCT provider_rows.reviewed_player_club_id)::integer AS identity_count,
            count(DISTINCT provider_rows.order_independent_sha256)::integer AS appearance_count,
            CASE WHEN bool_and(provider_rows.metric_availability='exact')
                 THEN sum(provider_rows.numeric_value)::integer ELSE NULL END AS exact_goals,
            bool_and(provider_rows.metric_availability='exact') AS goals_complete,
            cutoff.effective_through,
            cutoff.source_through_season
       FROM provider_rows
       CROSS JOIN source_cutoff cutoff
      WHERE cutoff.effective_through IS NOT NULL
        AND cutoff.source_through_season IS NOT NULL
      GROUP BY provider_rows.normalized_player_name,provider_rows.normalized_club_name,
               provider_rows.provider,provider_rows.season_year,
               cutoff.effective_through,cutoff.source_through_season
     HAVING count(DISTINCT provider_rows.order_independent_sha256)>0`,
    [
      JSON.stringify(requestedPlayerClubs),
      LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
      [
        'provider_identity_candidate',
        'provider_match_candidate',
        'local_reconciled_player_match_fact',
      ],
      LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
    ]
  );
  const rowsByPlayerClub = new Map<string, StagedAcquisitionOutcomeRow[]>();
  for (const row of result.rows) {
    const key = `${row.normalized_player_name}\0${row.normalized_club_name}`;
    const rows = rowsByPlayerClub.get(key) ?? [];
    rows.push(row);
    rowsByPlayerClub.set(key, rows);
  }
  const outcomes = new Map<string, AflTradeDevelopmentReconciledAcquisitionOutcome>();
  for (const acquisition of acquisitions) {
    const key = `${normalizeName(acquisition.playerName)}\0${normalizeName(acquisition.clubName)}`;
    const rows = (rowsByPlayerClub.get(key) ?? []).filter(
      (row) =>
        row.identity_count === 1 &&
        row.season_year > acquisition.year &&
        row.season_year <= acquisition.year + 3
    );
    const appearanceCount = rows.reduce((sum, row) => sum + row.appearance_count, 0);
    if (appearanceCount <= 0) continue;
    const sourceThroughSeason = Math.max(...rows.map((row) => row.source_through_season));
    const effectiveThroughRaw = rows
      .map((row) => row.effective_through)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
    const effectiveThrough = new Date(effectiveThroughRaw).toISOString();
    const rightCensored = acquisition.year + 3 >= sourceThroughSeason;
    const games = rightCensored
      ? ({
          state: 'partial',
          observedValue: appearanceCount,
          reason: 'active_career_right_censored',
        } as const)
      : ({ state: 'observed', value: appearanceCount } as const);
    const goalsComplete = rows.every((row) => row.goals_complete && row.exact_goals !== null);
    const exactGoals = goalsComplete
      ? rows.reduce((sum, row) => sum + (row.exact_goals ?? 0), 0)
      : null;
    const goals =
      exactGoals !== null
        ? rightCensored
          ? ({
              state: 'partial',
              observedValue: exactGoals,
              reason: 'active_career_right_censored',
            } as const)
          : ({ state: 'observed', value: exactGoals } as const)
        : unavailable;
    outcomes.set(acquisition.eventId, {
      source: 'reconciled_acquisition_spell',
      effectiveThrough,
      metrics: { games, goals, coachesVotes: unavailable, brownlowVotes: unavailable },
    });
  }
  return outcomes;
}
