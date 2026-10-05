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
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

type LocalAflTradePlayerAssetReadinessBlocker =
  | 'transaction_not_confirmed'
  | 'asset_identity_unresolved'
  | 'acquisition_spell_unresolved'
  | 'calculation_field_unavailable'
  | 'calculation_method_unavailable'
  | 'calculation_evidence_incomplete';

export interface LocalAflTradePlayerAssetValuationReadinessInput {
  readonly assetId: string;
  readonly assetKind: 'player';
  readonly transaction: 'confirmed' | 'unconfirmed';
  readonly identity: 'resolved' | 'unresolved';
  readonly acquisitionSpell: 'resolved' | 'unresolved';
  readonly appearances: 'complete' | 'right_censored' | 'unavailable';
  readonly realizedPav:
    | 'calculated'
    | 'calculation_field_unavailable'
    | 'calculation_method_unavailable'
    | 'calculation_evidence_incomplete';
}

export interface LocalAflTradePlayerAssetValuationReadiness {
  readonly assetId: string;
  readonly assetKind: 'player';
  readonly appearances:
    | { readonly state: 'eligible'; readonly coverage: 'complete' | 'right_censored' }
    | {
        readonly state: 'blocked';
        readonly reasons: readonly LocalAflTradePlayerAssetReadinessBlocker[];
      };
  readonly realizedPav:
    | { readonly state: 'eligible' }
    | {
        readonly state: 'blocked';
        readonly reasons: readonly LocalAflTradePlayerAssetReadinessBlocker[];
      };
  readonly completeTradeContribution:
    | { readonly state: 'eligible' }
    | {
        readonly state: 'blocked';
        readonly reasons: readonly LocalAflTradePlayerAssetReadinessBlocker[];
      };
}

export function assessLocalAflTradeAssetValuationReadiness(
  input: LocalAflTradePlayerAssetValuationReadinessInput
): LocalAflTradePlayerAssetValuationReadiness {
  const commonBlockers: LocalAflTradePlayerAssetReadinessBlocker[] = [];
  if (input.transaction !== 'confirmed') commonBlockers.push('transaction_not_confirmed');
  if (input.identity !== 'resolved') commonBlockers.push('asset_identity_unresolved');
  if (input.acquisitionSpell !== 'resolved') {
    commonBlockers.push('acquisition_spell_unresolved');
  }

  const appearanceBlockers = [...commonBlockers];
  if (input.appearances === 'unavailable') {
    appearanceBlockers.push('calculation_evidence_incomplete');
  }
  const realizedBlockers = [...commonBlockers];
  if (input.realizedPav !== 'calculated') realizedBlockers.push(input.realizedPav);

  const appearances =
    appearanceBlockers.length === 0
      ? {
          state: 'eligible' as const,
          coverage: input.appearances as 'complete' | 'right_censored',
        }
      : { state: 'blocked' as const, reasons: appearanceBlockers };
  const realizedPav =
    realizedBlockers.length === 0
      ? { state: 'eligible' as const }
      : { state: 'blocked' as const, reasons: realizedBlockers };

  return {
    assetId: publicIdSchema.parse(input.assetId),
    assetKind: input.assetKind,
    appearances,
    realizedPav,
    completeTradeContribution: realizedPav,
  };
}

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
    private_confirmed_result_count: countSchema,
    private_hpn_calculation_count: countSchema,
    private_hpn_season_years: z.array(z.number().int().min(1998).max(2200)),
    release_draft_selection_count: countSchema,
    release_pick_realization_count: countSchema,
    release_pick_lineage_count: countSchema,
    private_workbook_selection_count: countSchema,
    pick_observation_set_count: countSchema,
    pick_model_execution_count: countSchema,
    player_observation_set_count: countSchema,
    player_model_run_count: countSchema,
  })
  .strict();

type CompleteTradeBlockerCode =
  | 'confirmed_player_pav_not_materialized'
  | 'selection_lineage_not_materialized'
  | 'pick_observation_set_not_materialized'
  | 'pick_model_execution_not_present'
  | 'player_model_execution_not_present';

export interface LocalAflTradeValuationCapabilities {
  readonly confirmedHistoricalPlayerPav: {
    readonly state: 'evidence_present' | 'evidence_absent';
    readonly calculationCount: number;
    readonly seasonYears: readonly number[];
  };
  readonly reviewedSelectionLineage: {
    readonly state: 'evidence_present' | 'partial_evidence' | 'evidence_absent';
    readonly draftSelectionCount: number;
    readonly pickRealizationCount: number;
    readonly lineageEdgeCount: number;
    readonly privateWorkbookSelectionCount: number;
  };
  readonly pickModel: {
    readonly state: 'unverified_evidence' | 'evidence_absent';
    readonly observationSetCount: number;
    readonly executionCount: number;
  };
  readonly playerModel: {
    readonly state: 'unverified_evidence' | 'evidence_absent';
    readonly observationSetCount: number;
    readonly executionCount: number;
  };
  readonly completeTrade: {
    readonly state: 'blocked' | 'evidence_ready_for_authentication';
    readonly blockerCodes: readonly CompleteTradeBlockerCode[];
  };
}

export interface LocalAflTradeValuationReadinessQueryClient {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface LocalAflTradeValuationReadiness {
  readonly state: 'blocked';
  readonly numericalCalculationsAvailable: boolean;
  readonly confirmedRealizedTradeCalculationCount: number;
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
  readonly capabilities: LocalAflTradeValuationCapabilities;
  readonly explanation: string;
}

function isoTimestamp(value: Date | string): string {
  return new Date(value).toISOString();
}

function numericCount(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function capabilitiesFromCounts(input: {
  readonly privateHpnCalculationCount: number;
  readonly privateHpnSeasonYears: readonly number[];
  readonly releaseDraftSelectionCount: number;
  readonly releasePickRealizationCount: number;
  readonly releasePickLineageCount: number;
  readonly privateWorkbookSelectionCount: number;
  readonly pickObservationSetCount: number;
  readonly pickModelExecutionCount: number;
  readonly playerObservationSetCount: number;
  readonly playerModelRunCount: number;
}): LocalAflTradeValuationCapabilities {
  const blockerCodes: CompleteTradeBlockerCode[] = [];
  if (input.privateHpnCalculationCount === 0) {
    blockerCodes.push('confirmed_player_pav_not_materialized');
  }
  const hasReleaseSelectionLineage =
    input.releaseDraftSelectionCount > 0 &&
    input.releasePickRealizationCount > 0 &&
    input.releasePickLineageCount > 0;
  if (!hasReleaseSelectionLineage && input.privateWorkbookSelectionCount === 0) {
    blockerCodes.push('selection_lineage_not_materialized');
  }
  if (input.pickObservationSetCount === 0) {
    blockerCodes.push('pick_observation_set_not_materialized');
  }
  if (input.pickModelExecutionCount === 0) {
    blockerCodes.push('pick_model_execution_not_present');
  }
  if (input.playerModelRunCount === 0) {
    blockerCodes.push('player_model_execution_not_present');
  }
  return {
    confirmedHistoricalPlayerPav: {
      state: input.privateHpnCalculationCount > 0 ? 'evidence_present' : 'evidence_absent',
      calculationCount: input.privateHpnCalculationCount,
      seasonYears: [...input.privateHpnSeasonYears],
    },
    reviewedSelectionLineage: {
      state:
        input.releaseDraftSelectionCount > 0 ||
        input.releasePickRealizationCount > 0 ||
        input.releasePickLineageCount > 0 ||
        input.privateWorkbookSelectionCount > 0
            ? 'partial_evidence'
            : 'evidence_absent',
      draftSelectionCount: input.releaseDraftSelectionCount,
      pickRealizationCount: input.releasePickRealizationCount,
      lineageEdgeCount: input.releasePickLineageCount,
      privateWorkbookSelectionCount: input.privateWorkbookSelectionCount,
    },
    pickModel: {
      state:
        input.pickObservationSetCount > 0 || input.pickModelExecutionCount > 0
          ? 'unverified_evidence'
          : 'evidence_absent',
      observationSetCount: input.pickObservationSetCount,
      executionCount: input.pickModelExecutionCount,
    },
    playerModel: {
      state:
        input.playerObservationSetCount > 0 || input.playerModelRunCount > 0
          ? 'unverified_evidence'
          : 'evidence_absent',
      observationSetCount: input.playerObservationSetCount,
      executionCount: input.playerModelRunCount,
    },
    completeTrade: {
      state: blockerCodes.length === 0 ? 'evidence_ready_for_authentication' : 'blocked',
      blockerCodes,
    },
  };
}

function emptyCapabilities(): LocalAflTradeValuationCapabilities {
  return capabilitiesFromCounts({
    privateHpnCalculationCount: 0,
    privateHpnSeasonYears: [],
    releaseDraftSelectionCount: 0,
    releasePickRealizationCount: 0,
    releasePickLineageCount: 0,
    privateWorkbookSelectionCount: 0,
    pickObservationSetCount: 0,
    pickModelExecutionCount: 0,
    playerObservationSetCount: 0,
    playerModelRunCount: 0,
  });
}

/**
 * Reads the two explicitly governed private-calculation lanes for one local valuation scope. The
 * retained-review lane is preferred because it owns the real reviewed player-match evidence used by
 * the workbook. Every stored artifact is authenticated before its status reaches the UI, and a
 * review set that is no longer current becomes an explicit blocker rather than partial numerical data.
 */
export async function inspectLocalAflTradeValuationReadiness(
  client: LocalAflTradeValuationReadinessQueryClient,
  input: { readonly scopeKey: string; readonly workbookSha256?: string }
): Promise<LocalAflTradeValuationReadiness> {
  const scopeKey = publicIdSchema.parse(input.scopeKey);
  const workbookSha256 =
    input.workbookSha256 === undefined
      ? null
      : sha256Schema.parse(input.workbookSha256.trim().toLowerCase());
  const scopeYearMatch = /^afl-men:(\d{4})-trades$/u.exec(scopeKey);
  const scopeYear = scopeYearMatch === null ? -1 : Number(scopeYearMatch[1]);
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
            reviewed.source_rights_count AS reviewed_source_rights_count,
            capabilities.private_confirmed_result_count,
            capabilities.private_hpn_calculation_count,
            capabilities.private_hpn_season_years,
            capabilities.release_draft_selection_count,
            capabilities.release_pick_realization_count,
            capabilities.release_pick_lineage_count,
            capabilities.private_workbook_selection_count,
            capabilities.pick_observation_set_count,
            capabilities.pick_model_execution_count,
            capabilities.player_observation_set_count,
            capabilities.player_model_run_count
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
       ) reviewed ON true
       LEFT JOIN LATERAL (
         SELECT CASE WHEN reviewed.evidence_current IS TRUE AND reviewed.status='authorized'
                     THEN (SELECT count(*)::integer
                             FROM outcome_private_confirmed_valuation_result_v2 result
                             JOIN outcome_private_confirmed_valuation_plan_v2 plan
                               ON plan.plan_id=result.plan_id
                             JOIN outcome_private_workbook_transaction_promotion promotion
                               ON promotion.promotion_id=plan.transaction_promotion_id
                              AND promotion.status='active'
                            WHERE result.valuation_scope_key=$1
                              AND plan.authority_decision_id=reviewed.decision_id
                              AND plan.evidence_bundle_id=reviewed.evidence_bundle_id
                              AND result.result_json->'content'->'authority'->>'decisionId'
                                    =reviewed.decision_id
                              AND result.result_json->'content'->'authority'->>'evidenceBundleId'
                                    =reviewed.evidence_bundle_id)
                     ELSE 0 END AS private_confirmed_result_count,
                CASE WHEN reviewed.evidence_current IS TRUE AND reviewed.status='authorized'
                     THEN (SELECT count(*)::integer
                             FROM outcome_private_reviewed_hpn_calculation calculation
                             JOIN outcome_hpn_reviewed_season_universe season
                               ON season.reviewed_season_id=calculation.reviewed_season_id
                            WHERE season.candidate_json->'content'->>'resolvedReviewSetSha256'
                                  IN (SELECT item->>'reviewSetId'
                                        FROM jsonb_array_elements(
                                          reviewed.bundle_json->'content'->'reviewSets'
                                        ) review_set(item)))
                     ELSE 0 END AS private_hpn_calculation_count,
                CASE WHEN reviewed.evidence_current IS TRUE AND reviewed.status='authorized'
                     THEN COALESCE((SELECT array_agg(
                                             DISTINCT calculation.season_year
                                             ORDER BY calculation.season_year
                                           )
                                      FROM outcome_private_reviewed_hpn_calculation calculation
                                      JOIN outcome_hpn_reviewed_season_universe season
                                        ON season.reviewed_season_id=calculation.reviewed_season_id
                                     WHERE season.candidate_json->'content'->>'resolvedReviewSetSha256'
                                           IN (SELECT item->>'reviewSetId'
                                                 FROM jsonb_array_elements(
                                                   reviewed.bundle_json->'content'->'reviewSets'
                                                 ) review_set(item))),ARRAY[]::integer[])
                     ELSE ARRAY[]::integer[] END AS private_hpn_season_years,
                (SELECT count(*)::integer FROM outcome_release_draft_selection member
                  WHERE member.release_id=selected.factual_release_id)
                  AS release_draft_selection_count,
                (SELECT count(*)::integer FROM outcome_release_pick_realization member
                  WHERE member.release_id=selected.factual_release_id)
                  AS release_pick_realization_count,
                (SELECT count(*)::integer FROM outcome_release_pick_lineage member
                  WHERE member.release_id=selected.factual_release_id)
                  AS release_pick_lineage_count,
                (SELECT count(*)::integer
                   FROM outcome_local_workbook_pick_selection_confirmation confirmation
                  WHERE confirmation.trade_year=$2
                    AND confirmation.workbook_sha256=$3
                    AND confirmation.valuation_scope_key=$1
                    AND outcome_private_reviewed_evidence_bundle_is_current(
                      confirmation.evidence_bundle_id
                    )
                    AND EXISTS (
                      SELECT 1
                        FROM outcome_private_reviewed_evaluation_head head
                       WHERE head.evidence_bundle_id=confirmation.evidence_bundle_id
                         AND head.valuation_scope_key=$1
                         AND head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
                         AND head.status='authorized'
                    )) AS private_workbook_selection_count,
                (SELECT count(*)::integer FROM outcome_pick_pav_observation_set observation_set
                  WHERE observation_set.release_id=selected.factual_release_id
                    AND observation_set.status='finalized'
                    AND observation_set.finalized_at IS NOT NULL)
                  AS pick_observation_set_count,
                (SELECT count(*)::integer FROM outcome_pick_pav_model_execution execution
                  WHERE execution.release_id=selected.factual_release_id
                    AND execution.status='succeeded') AS pick_model_execution_count,
                (SELECT count(*)::integer
                   FROM outcome_valuation_player_observation_set observation_set
                   JOIN outcome_valuation_dataset_candidate dataset
                     ON dataset.dataset_id=observation_set.dataset_id
                  WHERE dataset.factual_release_id=selected.factual_release_id)
                  AS player_observation_set_count,
                (SELECT count(*)::integer
                   FROM outcome_valuation_model_run model_run
                   JOIN outcome_valuation_model_run_intent intent
                     ON intent.intent_id=model_run.intent_id
                   JOIN outcome_valuation_player_observation_set observation_set
                     ON observation_set.observation_set_id=intent.observation_set_id
                   JOIN outcome_valuation_dataset_candidate dataset
                     ON dataset.dataset_id=observation_set.dataset_id
                  WHERE dataset.factual_release_id=selected.factual_release_id
                    AND model_run.status='succeeded') AS player_model_run_count
       ) capabilities ON true`,
    [scopeKey, scopeYear, workbookSha256]
  );
  const raw = result.rows[0];
  if (raw === undefined) {
    return {
      state: 'blocked',
      numericalCalculationsAvailable: false,
      confirmedRealizedTradeCalculationCount: 0,
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
      capabilities: emptyCapabilities(),
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
  const confirmedRealizedTradeCalculationCount = Number(row.private_confirmed_result_count);
  const capabilities = capabilitiesFromCounts({
    privateHpnCalculationCount: Number(row.private_hpn_calculation_count),
    privateHpnSeasonYears: row.private_hpn_season_years,
    releaseDraftSelectionCount: Number(row.release_draft_selection_count),
    releasePickRealizationCount: Number(row.release_pick_realization_count),
    releasePickLineageCount: Number(row.release_pick_lineage_count),
    privateWorkbookSelectionCount: Number(row.private_workbook_selection_count),
    pickObservationSetCount: Number(row.pick_observation_set_count),
    pickModelExecutionCount: Number(row.pick_model_execution_count),
    playerObservationSetCount: Number(row.player_observation_set_count),
    playerModelRunCount: Number(row.player_model_run_count),
  });
  const privateEvaluationAuthorityState: LocalAflTradeValuationReadiness['privateEvaluationAuthorityState'] =
    reviewedLaneExists
      ? row.reviewed_evidence_current === true
        ? reviewedDecision.content.status
        : 'evidence_invalid'
      : (releaseDecision?.content.status ?? 'not_authorized');
  const common = {
    state: 'blocked' as const,
    numericalCalculationsAvailable: confirmedRealizedTradeCalculationCount > 0,
    confirmedRealizedTradeCalculationCount,
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
    capabilities,
  };
  if (privateEvaluationAuthorityState === 'authorized') {
    return {
      ...common,
      blockerCodes: ['model_not_approved'],
      requiredNextAuthority: 'authenticated_private_calculation_inputs',
      explanation: reviewedLaneExists
        ? confirmedRealizedTradeCalculationCount > 0
          ? `${confirmedRealizedTradeCalculationCount === 1 ? 'One confirmed realized trade calculation exists' : `${confirmedRealizedTradeCalculationCount} confirmed realized trade calculations exist`} in this private local scope. Pick values, predictive remaining value, complete package totals, and grades remain unavailable until their exact inputs and model authority exist; every publication or production use remains prohibited.`
          : 'The exact retained review sets and source artifacts are authorized for private local non-production derived calculations only. Authenticated player and pick calculation inputs are still required; model training and every publication or production use remain prohibited.'
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
