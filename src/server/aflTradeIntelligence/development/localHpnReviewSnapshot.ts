import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';

const publicIdSchema = z.string().trim().min(1).max(300);
const timestampSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const sourceSchema = z
  .object({
    seasonYear: z.number().int().min(1998).max(2200),
    captureId: publicIdSchema,
    provider: z.enum(['afl_tables', 'official_afl']),
    capabilityId: z.enum([
      'afl-tables-player-stats',
      'official-afl-player-stats',
    ]),
    normalizationRunId: publicIdSchema,
    providerDecodeMap: z.unknown(),
    rights: z.unknown(),
    rightsArtifact: aflTradeArtifactRefSchema,
    hpnResultProjection: z.unknown().nullable(),
    hpnPlayerProjection: z.unknown().nullable(),
    factualRunId: publicIdSchema.nullable(),
    hpnResolutionsCurrent: z.boolean(),
  })
  .strict();
const rowSchema = z
  .object({
    trusted_at: timestampSchema,
    reviewed_evidence_bundle_json: z.unknown(),
    reviewed_evaluation_decision_json: z.unknown(),
    evidence_current: z.boolean(),
    method_count: z.number().int().nonnegative(),
    method_json: z.unknown().nullable(),
    method_registered_at: timestampSchema.nullable(),
    sources_json: z.array(sourceSchema),
  })
  .strict();

export type LocalAflTradeHpnReviewSnapshot = Readonly<{
  trustedAt: string;
  reviewedEvidenceBundle: unknown;
  reviewedEvaluationDecision: unknown;
  evidenceCurrent: boolean;
  methodCount: number;
  method: unknown | null;
  methodRegisteredAt: string | null;
  sources: readonly Readonly<{
    seasonYear: number;
    captureId: string;
    provider: 'afl_tables' | 'official_afl';
    capabilityId: 'afl-tables-player-stats' | 'official-afl-player-stats';
    normalizationRunId: string;
    providerDecodeMap: unknown;
    rights: unknown;
    rightsArtifact: z.infer<typeof aflTradeArtifactRefSchema>;
    hpnResultProjection: unknown | null;
    hpnPlayerProjection: unknown | null;
    factualRunId: string | null;
    hpnResolutionsCurrent: boolean;
  }>[];
}>;

const LOAD_REVIEW_SNAPSHOT_SQL = `WITH authority AS MATERIALIZED (
  SELECT bundle.bundle_json,decision.decision_json
    FROM outcome_private_reviewed_evaluation_head head
    JOIN outcome_private_reviewed_evaluation_decision decision
      ON decision.decision_id=head.decision_id
    JOIN outcome_private_reviewed_evidence_bundle bundle
      ON bundle.evidence_bundle_id=head.evidence_bundle_id
   WHERE head.valuation_scope_key=$1
     AND head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
     AND head.status='authorized'
), methods AS MATERIALIZED (
  SELECT count(*)::INTEGER AS method_count,
         CASE WHEN count(*)=1 THEN jsonb_agg(method_json ORDER BY method_id)->0
              ELSE NULL END AS method_json,
         CASE WHEN count(*)=1 THEN max(registered_at) ELSE NULL END AS method_registered_at
    FROM outcome_hpn_pav_method
   WHERE environment='non_production'
), sources AS MATERIALIZED (
  SELECT capture.anchor_season_year AS season_year,capture.capture_id,
         capture.provider,capture.capability_id,run.normalization_run_id,
         decode_map.map_json AS provider_decode_map,rights.content_json AS rights_json,
         rights_ref.item AS rights_artifact,
         result_projection.projection_json AS hpn_result_projection_json,
         player_projection.projection_json AS hpn_player_projection_json,
         factual.factual_run_id
    FROM authority
    CROSS JOIN LATERAL jsonb_array_elements(
      authority.bundle_json->'content'->'sourceCaptures'
    ) capture_ref(item)
    JOIN outcome_source_capture capture ON capture.capture_id=capture_ref.item->>'captureId'
    JOIN LATERAL (
      SELECT candidate.* FROM outcome_provider_normalization_run candidate
       WHERE candidate.capture_id=capture.capture_id
         AND candidate.finalized_at IS NOT NULL
       ORDER BY candidate.finalized_at DESC,candidate.normalization_run_id DESC LIMIT 1
    ) run ON true
    JOIN outcome_provider_field_map decode_map ON decode_map.field_map_id=run.field_map_id
    JOIN outcome_source_rights_proposal rights
      ON rights.rights_artifact_id=
         capture.manifest_json->'sourceRightsProposal'->>'rightsArtifactId'
    JOIN LATERAL (
      SELECT item FROM jsonb_array_elements(
        authority.bundle_json->'content'->'sourceRightsEvidenceRefs'
      ) refs(item)
       WHERE item->>'contentSha256'=encode(sha256(convert_to(
         outcome_afl_trade_canonical_json(rights.content_json),'UTF8')),'hex')
       LIMIT 1
    ) rights_ref ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
               'map',map.map_json,
               'candidate',candidate.candidate_json,
               'candidateArtifact',candidate.candidate_artifact_json,
               'decision',review.decision_json,
               'decisionArtifact',review.decision_artifact_json
             ) AS projection_json
        FROM outcome_hpn_projected_field_map map
        JOIN outcome_hpn_field_map_candidate candidate
          ON candidate.candidate_id=map.candidate_id
        JOIN outcome_hpn_field_map_review_decision review
          ON review.decision_id=map.approval_decision_id
       WHERE map.environment='non_production'
         AND map.competition='AFLM'
         AND map.provider=capture.provider
         AND map.capability_id=capture.capability_id
         AND map.input_kind='completed_match_result'
         AND capture.anchor_season_year BETWEEN map.valid_from_season AND map.valid_through_season
         AND review.decision='approved'
         AND NOT EXISTS (
           SELECT 1 FROM outcome_hpn_field_map_review_decision successor
            WHERE successor.candidate_id=review.candidate_id
              AND (successor.registered_at,successor.decision_id)>
                  (review.registered_at,review.decision_id)
         )
       ORDER BY map.registered_at DESC,map.field_map_id DESC LIMIT 1
    ) result_projection ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
               'map',map.map_json,
               'candidate',candidate.candidate_json,
               'candidateArtifact',candidate.candidate_artifact_json,
               'decision',review.decision_json,
               'decisionArtifact',review.decision_artifact_json
             ) AS projection_json
        FROM outcome_hpn_projected_field_map map
        JOIN outcome_hpn_field_map_candidate candidate
          ON candidate.candidate_id=map.candidate_id
        JOIN outcome_hpn_field_map_review_decision review
          ON review.decision_id=map.approval_decision_id
       WHERE map.environment='non_production'
         AND map.provider=capture.provider
         AND map.capability_id=capture.capability_id
         AND map.input_kind='player_match_stats'
         AND capture.anchor_season_year BETWEEN map.valid_from_season AND map.valid_through_season
         AND review.decision='approved'
         AND NOT EXISTS (
           SELECT 1 FROM outcome_hpn_field_map_review_decision successor
            WHERE successor.candidate_id=review.candidate_id
              AND (successor.registered_at,successor.decision_id)>
                  (review.registered_at,review.decision_id)
         )
       ORDER BY map.registered_at DESC,map.field_map_id DESC LIMIT 1
    ) player_projection ON true
    LEFT JOIN LATERAL (
      SELECT factual_run.factual_run_id
        FROM outcome_factual_reconciliation_run factual_run
        JOIN outcome_factual_reconciliation_policy policy
          ON policy.policy_id=factual_run.policy_id
       WHERE factual_run.environment='non_production'
         AND factual_run.competition='AFLM'
         AND factual_run.season_year=capture.anchor_season_year
         AND factual_run.status='approved'
         AND factual_run.finalized_at IS NOT NULL
         AND factual_run.conflict_count=0
         AND policy.status='approved'
         AND NOT EXISTS (
           SELECT 1 FROM outcome_review_decision successor
            WHERE successor.supersedes_decision_id=policy.approval_decision_id
         )
       ORDER BY factual_run.finalized_at DESC,factual_run.factual_run_id DESC LIMIT 1
    ) factual ON true
   WHERE capture.environment='non_production' AND capture.status='staged'
     AND capture.anchor_season_year BETWEEN $2 AND $3
     AND capture.capability_id IN (
       'afl-tables-player-stats','official-afl-player-stats'
     )
)
SELECT transaction_timestamp() AS trusted_at,authority.bundle_json AS reviewed_evidence_bundle_json,
       authority.decision_json AS reviewed_evaluation_decision_json,
       outcome_private_reviewed_evidence_is_current() AS evidence_current,
       methods.method_count,methods.method_json,methods.method_registered_at,
       COALESCE(jsonb_agg(jsonb_build_object(
         'seasonYear',sources.season_year,'captureId',sources.capture_id,
         'provider',sources.provider,'capabilityId',sources.capability_id,
         'normalizationRunId',sources.normalization_run_id,
         'providerDecodeMap',sources.provider_decode_map,'rights',sources.rights_json,
         'rightsArtifact',sources.rights_artifact,
         'hpnResultProjection',sources.hpn_result_projection_json,
         'hpnPlayerProjection',sources.hpn_player_projection_json,
         'factualRunId',sources.factual_run_id,'hpnResolutionsCurrent',false
       ) ORDER BY sources.season_year,sources.provider) FILTER (
         WHERE sources.normalization_run_id IS NOT NULL
       ),'[]'::jsonb) AS sources_json
  FROM authority CROSS JOIN methods LEFT JOIN sources ON true
 GROUP BY authority.bundle_json,authority.decision_json,methods.method_count,
          methods.method_json,methods.method_registered_at`;

export async function loadLocalAflTradeHpnReviewSnapshot(
  client: AflOutcomeSqlClient,
  input: {
    readonly valuationScopeKey: string;
    readonly fromSeason: number;
    readonly throughSeason: number;
  }
): Promise<LocalAflTradeHpnReviewSnapshot> {
  return client.transaction(async (transaction) => {
    const result = await transaction.query(LOAD_REVIEW_SNAPSHOT_SQL, [
      input.valuationScopeKey,
      input.fromSeason,
      input.throughSeason,
    ]);
    const row = rowSchema.parse(result.rows[0]);
    return {
      trustedAt: new Date(row.trusted_at).toISOString(),
      reviewedEvidenceBundle: row.reviewed_evidence_bundle_json,
      reviewedEvaluationDecision: row.reviewed_evaluation_decision_json,
      evidenceCurrent: row.evidence_current,
      methodCount: row.method_count,
      method: row.method_json,
      methodRegisteredAt:
        row.method_registered_at === null
          ? null
          : new Date(row.method_registered_at).toISOString(),
      sources: row.sources_json.map((source) => ({
        seasonYear: source.seasonYear,
        captureId: source.captureId,
        provider: source.provider,
        capabilityId: source.capabilityId,
        normalizationRunId: source.normalizationRunId,
        providerDecodeMap: source.providerDecodeMap,
        rights: source.rights,
        rightsArtifact: source.rightsArtifact,
        hpnResultProjection: source.hpnResultProjection,
        hpnPlayerProjection: source.hpnPlayerProjection,
        factualRunId: source.factualRunId,
        hpnResolutionsCurrent: source.hpnResolutionsCurrent,
      })),
    };
  });
}
