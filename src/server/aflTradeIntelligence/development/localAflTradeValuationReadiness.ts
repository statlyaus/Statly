import { z } from 'zod';

import {
  aflTradePrivateReviewedEvidenceBundleSchema,
  parseAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '../valuation/privateReviewedEvidenceEvaluation';
import { parseAflTradePrivateValuationEvaluationDecision } from '../valuation/privateValuationEvaluationDecision';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const countSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)]);

const readinessRowSchema = z
  .object({
    qualification_report_id: publicIdSchema.nullable(),
    factual_release_id: publicIdSchema.nullable(),
    decision_state: z.enum(['blocked', 'eligible_for_dataset_admission']).nullable(),
    evaluated_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
    source_ids: z.array(publicIdSchema),
    prepared_input_set_id: publicIdSchema.nullable(),
    private_evaluation_decision_id: publicIdSchema.nullable(),
    private_evaluation_status: z.enum(['authorized', 'withdrawn']).nullable(),
    private_evaluation_decided_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
    private_evaluation_decision_json: z.unknown().nullable().optional(),
    reviewed_evaluation_decision_id: publicIdSchema.nullable(),
    reviewed_evaluation_status: z.enum(['authorized', 'withdrawn']).nullable(),
    reviewed_evaluation_decided_at: z
      .union([z.date(), z.iso.datetime({ offset: true })])
      .nullable(),
    reviewed_evaluation_decision_json: z.unknown().nullable().optional(),
    reviewed_evidence_bundle_id: publicIdSchema.nullable(),
    reviewed_evidence_bundle_json: z.unknown().nullable().optional(),
    reviewed_evidence_current: z.boolean().nullable(),
    reviewed_candidate_count: countSchema.nullable(),
    reviewed_decision_count: countSchema.nullable(),
    reviewed_source_capture_count: countSchema.nullable(),
    reviewed_source_rights_count: countSchema.nullable(),
  })
  .strict();

export interface LocalAflTradeValuationReadinessQueryClient {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface LocalAflTradeValuationReadiness {
  readonly state: 'blocked';
  readonly numericalCalculationsAvailable: false;
  readonly qualificationReportCreated: boolean;
  readonly qualificationReportId: string | null;
  readonly factualReleaseId: string | null;
  readonly qualificationEvaluatedAt: string | null;
  readonly privateEvaluationAuthorityState:
    'not_authorized' | 'authorized' | 'withdrawn' | 'evidence_invalid';
  readonly privateEvaluationEvidenceKind: 'factual_release' | 'retained_private_review' | null;
  readonly privateEvaluationDecisionId: string | null;
  readonly privateEvaluationDecidedAt: string | null;
  readonly privateEvaluationEvidenceBundleId: string | null;
  readonly retainedEvidenceCandidateCount: number | null;
  readonly retainedEvidenceDecisionCount: number | null;
  readonly retainedEvidenceSourceCaptureCount: number | null;
  readonly retainedEvidenceSourceRightsCount: number | null;
  readonly preparedInputSetCreated: boolean;
  readonly preparedInputSetCount: 0 | 1;
  readonly preparedInputSetIds: readonly string[];
  readonly scopeKey: string;
  readonly blockerCodes: readonly (
    | 'source_qualification_not_run'
    | 'source_blocked'
    | 'private_evaluation_not_authorized'
    | 'private_evaluation_withdrawn'
    | 'private_evidence_not_current'
    | 'model_not_approved'
  )[];
  readonly sources: readonly string[];
  readonly requiredNextAuthority:
    | 'source_qualification'
    | 'model_training_and_derived_feature_creation'
    | 'authenticated_player_and_pick_model_runs'
    | 'private_nonproduction_derived_calculation_authority'
    | 'authenticated_private_calculation_inputs';
  readonly explanation: string;
}

function isoTimestamp(value: Date | string): string {
  return new Date(value).toISOString();
}

function numericCount(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Reads the two explicitly governed private-calculation lanes for one local valuation scope. The
 * retained-review lane is preferred because it owns the real reviewed player-match evidence used by
 * the workbook. Every stored artifact is authenticated before its status reaches the UI, and a
 * review set that is no longer current becomes an explicit blocker rather than partial numerical data.
 */
export async function inspectLocalAflTradeValuationReadiness(
  client: LocalAflTradeValuationReadinessQueryClient,
  input: { readonly scopeKey: string }
): Promise<LocalAflTradeValuationReadiness> {
  const scopeKey = publicIdSchema.parse(input.scopeKey);
  const result = await client.query(
    `WITH candidates AS (
       SELECT qualification.factual_release_id,qualification.evaluated_at AS event_at
         FROM outcome_valuation_source_qualification_report qualification
         JOIN outcome_active_release active
           ON active.release_id=qualification.factual_release_id
          AND active.scope_key=qualification.factual_release_scope_key
        WHERE qualification.environment='non_production'
          AND qualification.operation='valuation_model_training_and_derived_feature_creation'
          AND qualification.valuation_scope_key=$1
          AND qualification.finalized_at IS NOT NULL
       UNION ALL
       SELECT head.factual_release_id,head.updated_at AS event_at
         FROM outcome_private_valuation_evaluation_head head
         JOIN outcome_release_manifest release
           ON release.release_id=head.factual_release_id
          AND release.environment='non_production'
         JOIN outcome_active_release active
           ON active.release_id=release.release_id AND active.scope_key=release.scope_key
        WHERE head.valuation_scope_key=$1
     ), selected AS (
       SELECT factual_release_id FROM candidates
        ORDER BY event_at DESC,factual_release_id DESC LIMIT 1
     )
     SELECT qualification.qualification_report_id,
            selected.factual_release_id,
            qualification.decision_state,
            qualification.evaluated_at,
            COALESCE(ARRAY(
              SELECT blocker->'subject'->>'id'
                FROM jsonb_array_elements(
                  CASE WHEN qualification.decision_state='blocked'
                       THEN qualification.report_json->'content'->'decision'->'blockers'
                       ELSE '[]'::jsonb END
                ) blocker
               ORDER BY blocker->'subject'->>'id'
            ),ARRAY[]::text[]) AS source_ids,
            prepared.prepared_input_set_id,
            private_head.decision_id AS private_evaluation_decision_id,
            private_head.status AS private_evaluation_status,
            private_head.updated_at AS private_evaluation_decided_at,
            private_decision.decision_json AS private_evaluation_decision_json,
            reviewed.decision_id AS reviewed_evaluation_decision_id,
            reviewed.status AS reviewed_evaluation_status,
            reviewed.updated_at AS reviewed_evaluation_decided_at,
            reviewed.decision_json AS reviewed_evaluation_decision_json,
            reviewed.evidence_bundle_id AS reviewed_evidence_bundle_id,
            reviewed.bundle_json AS reviewed_evidence_bundle_json,
            reviewed.evidence_current AS reviewed_evidence_current,
            reviewed.candidate_count AS reviewed_candidate_count,
            reviewed.decision_count AS reviewed_decision_count,
            reviewed.source_capture_count AS reviewed_source_capture_count,
            reviewed.source_rights_count AS reviewed_source_rights_count
       FROM (SELECT 1) anchor
       LEFT JOIN selected ON true
       LEFT JOIN LATERAL (
         SELECT candidate.*
           FROM outcome_valuation_source_qualification_report candidate
          WHERE selected.factual_release_id IS NOT NULL
            AND candidate.environment='non_production'
            AND candidate.operation='valuation_model_training_and_derived_feature_creation'
            AND candidate.valuation_scope_key=$1
            AND candidate.factual_release_id=selected.factual_release_id
            AND candidate.finalized_at IS NOT NULL
          ORDER BY candidate.evaluated_at DESC,candidate.qualification_report_id DESC
          LIMIT 1
       ) qualification ON true
       LEFT JOIN LATERAL (
         SELECT prepared_input_set_id
           FROM outcome_prepared_valuation_input_set
          WHERE qualification_report_id=qualification.qualification_report_id
            AND finalized_at IS NOT NULL
          ORDER BY prepared_at DESC,prepared_input_set_id DESC
          LIMIT 1
       ) prepared ON true
       LEFT JOIN outcome_private_valuation_evaluation_head private_head
         ON private_head.valuation_scope_key=$1
        AND private_head.factual_release_id=selected.factual_release_id
       LEFT JOIN outcome_private_valuation_evaluation_decision private_decision
         ON private_decision.decision_id=private_head.decision_id
       LEFT JOIN LATERAL (
         SELECT head.decision_id,head.status,head.updated_at,head.evidence_bundle_id,
                decision.decision_json,bundle.bundle_json,bundle.candidate_count,
                bundle.decision_count,bundle.source_capture_count,bundle.source_rights_count,
                outcome_private_reviewed_evidence_bundle_is_current(
                  head.evidence_bundle_id
                ) AS evidence_current
           FROM outcome_private_reviewed_evaluation_head head
           JOIN outcome_private_reviewed_evaluation_decision decision
             ON decision.decision_id=head.decision_id
           JOIN outcome_private_reviewed_evidence_bundle bundle
             ON bundle.evidence_bundle_id=head.evidence_bundle_id
          WHERE head.valuation_scope_key=$1
            AND head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
          LIMIT 1
       ) reviewed ON true`,
    [scopeKey]
  );
  const raw = result.rows[0];
  if (raw === undefined) {
    return {
      state: 'blocked',
      numericalCalculationsAvailable: false,
      qualificationReportCreated: false,
      qualificationReportId: null,
      factualReleaseId: null,
      qualificationEvaluatedAt: null,
      privateEvaluationAuthorityState: 'not_authorized',
      privateEvaluationEvidenceKind: null,
      privateEvaluationDecisionId: null,
      privateEvaluationDecidedAt: null,
      privateEvaluationEvidenceBundleId: null,
      retainedEvidenceCandidateCount: null,
      retainedEvidenceDecisionCount: null,
      retainedEvidenceSourceCaptureCount: null,
      retainedEvidenceSourceRightsCount: null,
      preparedInputSetCreated: false,
      preparedInputSetCount: 0,
      preparedInputSetIds: [],
      scopeKey,
      blockerCodes: ['source_qualification_not_run', 'private_evaluation_not_authorized'],
      sources: [],
      requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
      explanation:
        'No exact current private calculation decision exists for this valuation scope. No scorer or numerical fallback was run.',
    };
  }
  const row = readinessRowSchema.parse(raw);
  const preparedInputSetIds = row.prepared_input_set_id === null ? [] : [row.prepared_input_set_id];

  const releaseDecision =
    row.private_evaluation_decision_json === undefined ||
    row.private_evaluation_decision_json === null
      ? null
      : parseAflTradePrivateValuationEvaluationDecision(row.private_evaluation_decision_json);
  if (
    (row.private_evaluation_decision_id === null) !== (releaseDecision === null) ||
    (releaseDecision !== null &&
      (row.factual_release_id === null ||
        releaseDecision.decisionId !== row.private_evaluation_decision_id ||
        releaseDecision.content.valuationScopeKey !== scopeKey ||
        releaseDecision.content.factualReleaseId !== row.factual_release_id ||
        releaseDecision.content.status !== row.private_evaluation_status ||
        releaseDecision.content.decidedAt !== isoTimestamp(row.private_evaluation_decided_at!)))
  ) {
    throw new TypeError('Private valuation readiness decision failed exact authentication.');
  }

  const reviewedDecision =
    row.reviewed_evaluation_decision_json === undefined ||
    row.reviewed_evaluation_decision_json === null
      ? null
      : parseAflTradePrivateReviewedEvidenceEvaluationDecision(
          row.reviewed_evaluation_decision_json
        );
  const reviewedBundle =
    row.reviewed_evidence_bundle_json === undefined || row.reviewed_evidence_bundle_json === null
      ? null
      : aflTradePrivateReviewedEvidenceBundleSchema.parse(row.reviewed_evidence_bundle_json);
  if (
    (row.reviewed_evaluation_decision_id === null) !== (reviewedDecision === null) ||
    (row.reviewed_evidence_bundle_id === null) !== (reviewedBundle === null) ||
    (reviewedDecision !== null &&
      reviewedBundle !== null &&
      (reviewedDecision.decisionId !== row.reviewed_evaluation_decision_id ||
        reviewedDecision.content.valuationScopeKey !== scopeKey ||
        reviewedDecision.content.evidenceBundleId !== row.reviewed_evidence_bundle_id ||
        reviewedBundle.evidenceBundleId !== row.reviewed_evidence_bundle_id ||
        reviewedDecision.content.status !== row.reviewed_evaluation_status ||
        reviewedDecision.content.decidedAt !== isoTimestamp(row.reviewed_evaluation_decided_at!) ||
        reviewedBundle.content.candidateCount !== Number(row.reviewed_candidate_count) ||
        reviewedBundle.content.decisionCount !== Number(row.reviewed_decision_count) ||
        reviewedBundle.content.sourceCaptures.length !==
          Number(row.reviewed_source_capture_count) ||
        reviewedBundle.content.sourceRightsEvidenceRefs.length !==
          Number(row.reviewed_source_rights_count)))
  ) {
    throw new TypeError(
      'Private reviewed-evidence readiness decision failed exact authentication.'
    );
  }

  const reviewedLaneExists = reviewedDecision !== null && reviewedBundle !== null;
  const privateEvaluationAuthorityState: LocalAflTradeValuationReadiness['privateEvaluationAuthorityState'] =
    reviewedLaneExists
      ? row.reviewed_evidence_current === true
        ? reviewedDecision.content.status
        : 'evidence_invalid'
      : (releaseDecision?.content.status ?? 'not_authorized');
  const common = {
    state: 'blocked' as const,
    numericalCalculationsAvailable: false as const,
    qualificationReportCreated: row.qualification_report_id !== null,
    qualificationReportId: row.qualification_report_id,
    factualReleaseId: row.factual_release_id,
    qualificationEvaluatedAt: row.evaluated_at === null ? null : isoTimestamp(row.evaluated_at),
    privateEvaluationAuthorityState,
    privateEvaluationEvidenceKind: reviewedLaneExists
      ? ('retained_private_review' as const)
      : releaseDecision === null
        ? null
        : ('factual_release' as const),
    privateEvaluationDecisionId: reviewedLaneExists
      ? reviewedDecision.decisionId
      : (releaseDecision?.decisionId ?? null),
    privateEvaluationDecidedAt: reviewedLaneExists
      ? reviewedDecision.content.decidedAt
      : (releaseDecision?.content.decidedAt ?? null),
    privateEvaluationEvidenceBundleId: reviewedBundle?.evidenceBundleId ?? null,
    retainedEvidenceCandidateCount: numericCount(row.reviewed_candidate_count),
    retainedEvidenceDecisionCount: numericCount(row.reviewed_decision_count),
    retainedEvidenceSourceCaptureCount: numericCount(row.reviewed_source_capture_count),
    retainedEvidenceSourceRightsCount: numericCount(row.reviewed_source_rights_count),
    preparedInputSetCreated: preparedInputSetIds.length === 1,
    preparedInputSetCount: preparedInputSetIds.length as 0 | 1,
    preparedInputSetIds,
    scopeKey,
    sources: row.source_ids,
  };
  if (privateEvaluationAuthorityState === 'authorized') {
    return {
      ...common,
      blockerCodes: ['model_not_approved'],
      requiredNextAuthority: 'authenticated_private_calculation_inputs',
      explanation: reviewedLaneExists
        ? 'The exact retained review sets and source artifacts are authorized for private local non-production derived calculations only. Authenticated player and pick calculation inputs are still required; model training and every publication or production use remain prohibited.'
        : 'The exact retained release artifacts are authorized for private local non-production derived calculations only. Authenticated calculation inputs are still required; model training and every publication or production use remain prohibited.',
    };
  }
  const sourceBlockers =
    row.decision_state === null
      ? (['source_qualification_not_run'] as const)
      : row.decision_state === 'blocked'
        ? (['source_blocked'] as const)
        : ([] as const);
  if (privateEvaluationAuthorityState === 'evidence_invalid') {
    return {
      ...common,
      blockerCodes: ['private_evidence_not_current'],
      requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
      explanation:
        'The retained reviewed-evidence authority no longer matches the exact current review sets. Calculation admission is blocked until a new exact bundle is reviewed; no partial or zero-valued fallback was used.',
    };
  }
  if (privateEvaluationAuthorityState === 'withdrawn') {
    return {
      ...common,
      blockerCodes: [...sourceBlockers, 'private_evaluation_withdrawn'],
      requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
      explanation:
        'Private local calculation authority has been withdrawn for this exact evidence. Model training and every publication or production use remain prohibited.',
    };
  }
  return {
    ...common,
    blockerCodes: [...sourceBlockers, 'private_evaluation_not_authorized'],
    requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
    explanation:
      'No exact current private calculation decision exists for this valuation scope. No scorer or numerical fallback was run.',
  };
}
