import { z } from 'zod';

import type { LocalPrivateValuationConstructionReadinessReport } from './localPrivateValuationConstructionReadiness';

const SCOPE_KEY = 'afl-men:2025-trades';

const inventoryRowSchema = z
  .object({
    private_factual_present: z.boolean(),
    private_factual_revision: z.number().int().positive().nullable(),
    qualified_model_present: z.boolean(),
    qualified_model_revision: z.number().int().positive().nullable(),
    prepared_v3_present: z.boolean(),
    prepared_v3_revision: z.number().int().positive().nullable(),
    private_batch_present: z.boolean(),
    private_batch_revision: z.number().int().positive().nullable(),
    trade_count: z.number().int().positive().nullable(),
    ready_count: z.number().int().nonnegative().nullable(),
    unavailable_count: z.number().int().nonnegative().nullable(),
    cohort_admission_count: z.number().int().nonnegative(),
    cohort_trade_count: z.number().int().positive().nullable(),
    current_registered_acquisition_spell_count: z.number().int().nonnegative(),
    finalized_hpn_input_set_count: z.number().int().nonnegative(),
    finalized_hpn_calculation_count: z.number().int().nonnegative(),
    max_finalized_hpn_corroborating_player_row_count: z.number().int().nonnegative(),
  })
  .strict();

export interface LocalPrivateValuationPreflightQueryClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

type RetainedHead = Readonly<{ present: boolean; revision: number | null }>;

export interface Exact2025AflPrivateValuationRehearsalPreflight {
  readonly schemaVersion: 'afl-private-valuation-rehearsal-preflight/v4';
  readonly scopeKey: typeof SCOPE_KEY;
  readonly competitionCode: 'AFLM';
  readonly season: 2025;
  readonly inspectionMode: 'read_only';
  readonly state: 'blocked' | 'inconclusive';
  readonly authorityAssessment: 'inventory_only';
  readonly publicationEligible: false;
  readonly sourceAuthority: {
    readonly genuineDraftTrade: 'not_inspected';
    readonly genuineHpnCorroboration: 'not_inspected';
  };
  /**
   * Construction compatibility of the selected policy and input metadata, reported separately from
   * `sourceAuthority`: composition inputs do not establish source rights or admission. Without a
   * supplied selection this stays `not_inspected` with a named reason rather than assuming success.
   */
  readonly constructionReadiness: {
    readonly status: 'inspected' | 'not_inspected';
    readonly reason: 'selection_not_supplied' | null;
    readonly report: LocalPrivateValuationConstructionReadinessReport | null;
  };
  readonly retainedSourceInventory: {
    readonly cohortCandidates: {
      readonly admissionCount: number;
      readonly tradeCount: number | null;
    };
    readonly measurementEvidence: {
      readonly currentRegisteredAcquisitionSpellCount: number;
      readonly finalizedHpnInputSetCount: number;
      readonly finalizedHpnCalculationCount: number;
      readonly maxFinalizedHpnCorroboratingPlayerRowCount: number;
    };
  };
  readonly retainedAuthority: {
    readonly privateFactualHead: RetainedHead;
    readonly qualifiedModelEvidence: RetainedHead;
    readonly preparedV3: RetainedHead;
    readonly exhaustivePrivateBatch: RetainedHead & {
      readonly tradeCount: number | null;
      readonly readyCount: number | null;
      readonly unavailableCount: number | null;
    };
  };
  readonly blockerCodes: readonly string[];
  readonly limitationCodes: readonly string[];
}

/**
 * Inventories the exact retained 2025 private-valuation chain without dispatching work or changing
 * any authority head. Linked retained rows establish inventory, not authenticated source rights or
 * replay. This query does not inspect source admission, so it cannot establish source absence or
 * declare the complete rehearsal ready even when every retained stage is present.
 */
export async function inspectExact2025AflPrivateValuationRehearsalPreflight(
  client: LocalPrivateValuationPreflightQueryClient,
  options: {
    /** Supplied by a caller able to select the construction policy and inputs through current authority. */
    readonly inspectConstructionReadiness?: () => Promise<LocalPrivateValuationConstructionReadinessReport>;
  } = {}
): Promise<Exact2025AflPrivateValuationRehearsalPreflight> {
  const result = await client.query(
    `WITH factual AS (
       SELECT head.candidate_id,head.revision
         FROM outcome_current_private_factual_authority head
        WHERE head.valuation_scope_key=$1
     ), qualified_model AS (
       SELECT pair.revision,operation.operation_id
         FROM outcome_current_governed_valuation_model_pair pair
         JOIN outcome_current_valuation_model_evidence_operation operation
           ON operation.scope_key=pair.scope_key
          AND operation.result_state='qualified'
          AND (operation.result_json->>'modelRevision')::integer=pair.revision
         JOIN factual
           ON factual.candidate_id=operation.factual_candidate_id
          AND factual.revision=operation.factual_revision
        WHERE pair.scope_key=$1
        ORDER BY operation.completed_at DESC,operation.operation_id DESC
        LIMIT 1
     ), prepared_v3 AS (
       SELECT head.prepared_input_set_id,head.revision
         FROM outcome_current_prepared_valuation_input_set head
         JOIN outcome_prepared_valuation_input_set prepared
           ON prepared.prepared_input_set_id=head.prepared_input_set_id
          AND prepared.scope_key=head.scope_key
          AND prepared.schema_version='afl-trade-prepared-valuation-input-set/v3'
          AND prepared.finalized_at IS NOT NULL
         JOIN qualified_model model
           ON prepared.prepared_set_json#>>'{content,modelEvidence,operationId}'=
              model.operation_id
          AND (prepared.prepared_set_json#>>'{content,modelEvidence,modelRevision}')::integer=
              model.revision
        WHERE head.scope_key=$1
          AND prepared.prepared_set_json#>>'{content,preparationAuthority}'=
              'qualified_current_model_evidence'
     ), private_batch AS (
       SELECT head.revision,batch.trade_count,batch.ready_count,batch.unavailable_count
         FROM outcome_current_private_evaluation_batch head
         JOIN outcome_private_evaluation_batch batch
           ON batch.batch_id=head.batch_id AND batch.scope_key=head.scope_key
         JOIN prepared_v3 prepared
           ON prepared.prepared_input_set_id=batch.prepared_input_set_id
          AND prepared.revision=batch.prepared_input_set_revision
        WHERE head.scope_key=$1
          AND validate_outcome_private_evaluation_batch_complete(
                head.scope_key,head.batch_id)=TRUE
     ), cohort_inventory AS (
       SELECT count(DISTINCT binding.lineage_admission_id)::integer AS admission_count,
              CASE WHEN count(DISTINCT binding.lineage_admission_id)=1
                THEN max(jsonb_array_length(binding.binding_json->'cohortTradeIds'))
                ELSE NULL
              END AS trade_count
         FROM outcome_private_valuation_cohort_binding binding
        WHERE binding.binding_json->>'cohortScopeKey'=$1
     ), acquisition_inventory AS (
       SELECT count(*)::integer AS current_registered_count
         FROM outcome_acquisition_spell_version spell
         JOIN outcome_event_version event_version
           ON event_version.event_version_id=spell.start_event_version_id
         JOIN outcome_event event ON event.event_id=event_version.event_id
        WHERE spell.status='approved'
          AND spell.registration_canonical_json IS NOT NULL
          AND spell.registration_approval_decision_id IS NOT NULL
          AND spell.registered_at IS NOT NULL
          AND event.competition='AFLM' AND event.season_year=2025
          AND NOT EXISTS (
            SELECT 1 FROM outcome_acquisition_spell_version successor
             WHERE successor.supersedes_spell_version_id=spell.spell_version_id
          )
     ), hpn_input_inventory AS (
       SELECT count(*)::integer AS finalized_count,
              COALESCE(max(input_set.corroborating_player_row_count),0)::integer
                AS max_corroborating_player_row_count
         FROM outcome_hpn_pav_input_set input_set
        WHERE input_set.environment='non_production'
          AND input_set.competition='AFLM' AND input_set.season_year=2025
          AND input_set.status='finalized' AND input_set.finalized_at IS NOT NULL
     ), hpn_calculation_inventory AS (
       SELECT count(*)::integer AS finalized_count
         FROM outcome_hpn_pav_calculation calculation
         JOIN outcome_hpn_pav_input_set input_set
           ON input_set.input_set_id=calculation.input_set_id
        WHERE calculation.environment='non_production'
          AND calculation.competition='AFLM' AND calculation.season_year=2025
          AND calculation.status='finalized' AND calculation.finalized_at IS NOT NULL
          AND input_set.environment=calculation.environment
          AND input_set.competition=calculation.competition
          AND input_set.season_year=calculation.season_year
     )
     SELECT EXISTS(SELECT 1 FROM factual) AS private_factual_present,
            (SELECT revision FROM factual) AS private_factual_revision,
            EXISTS(SELECT 1 FROM qualified_model) AS qualified_model_present,
            (SELECT revision FROM qualified_model) AS qualified_model_revision,
            EXISTS(SELECT 1 FROM prepared_v3) AS prepared_v3_present,
            (SELECT revision FROM prepared_v3) AS prepared_v3_revision,
            EXISTS(SELECT 1 FROM private_batch) AS private_batch_present,
            (SELECT revision FROM private_batch) AS private_batch_revision,
            (SELECT trade_count FROM private_batch) AS trade_count,
            (SELECT ready_count FROM private_batch) AS ready_count,
            (SELECT unavailable_count FROM private_batch) AS unavailable_count,
            (SELECT admission_count FROM cohort_inventory) AS cohort_admission_count,
            (SELECT trade_count FROM cohort_inventory) AS cohort_trade_count,
            (SELECT current_registered_count FROM acquisition_inventory)
              AS current_registered_acquisition_spell_count,
            (SELECT finalized_count FROM hpn_input_inventory) AS finalized_hpn_input_set_count,
            (SELECT finalized_count FROM hpn_calculation_inventory)
              AS finalized_hpn_calculation_count,
            (SELECT max_corroborating_player_row_count FROM hpn_input_inventory)
              AS max_finalized_hpn_corroborating_player_row_count`,
    [SCOPE_KEY]
  );
  if (result.rows.length !== 1) {
    throw new TypeError('Exact 2025 private valuation authority inventory is not unique.');
  }
  const row = inventoryRowSchema.parse(result.rows[0]);
  // Inspect the caller-selected construction inputs when they are available, so a blocked asset or view
  // is named rather than assumed. Composition inputs do not establish source rights, so this is
  // reported beside `sourceAuthority` and never as a substitute for it.
  const constructionReadiness =
    options.inspectConstructionReadiness === undefined
      ? null
      : await options.inspectConstructionReadiness();
  const blockerCodes = [
    ...(row.private_factual_present ? [] : ['current_private_factual_head_missing']),
    ...(row.qualified_model_present ? [] : ['qualified_model_evidence_missing']),
    ...(row.prepared_v3_present ? [] : ['prepared_v3_head_missing']),
    ...(row.private_batch_present ? [] : ['exhaustive_private_batch_head_missing']),
    ...(row.cohort_admission_count === 1
      ? []
      : [
          row.cohort_admission_count === 0
            ? 'retained_cohort_candidate_missing'
            : 'retained_cohort_candidate_ambiguous',
        ]),
    ...(row.finalized_hpn_input_set_count > 0 &&
    row.finalized_hpn_calculation_count > 0 &&
    row.max_finalized_hpn_corroborating_player_row_count > 0
      ? []
      : ['retained_hpn_corroboration_missing']),
    ...(constructionReadiness?.blockerCodes ?? []),
  ];

  return {
    schemaVersion: 'afl-private-valuation-rehearsal-preflight/v4',
    scopeKey: SCOPE_KEY,
    competitionCode: 'AFLM',
    season: 2025,
    inspectionMode: 'read_only',
    state: blockerCodes.length > 0 ? 'blocked' : 'inconclusive',
    authorityAssessment: 'inventory_only',
    publicationEligible: false,
    sourceAuthority: {
      genuineDraftTrade: 'not_inspected',
      genuineHpnCorroboration: 'not_inspected',
    },
    retainedSourceInventory: {
      cohortCandidates: {
        admissionCount: row.cohort_admission_count,
        tradeCount: row.cohort_trade_count,
      },
      measurementEvidence: {
        currentRegisteredAcquisitionSpellCount: row.current_registered_acquisition_spell_count,
        finalizedHpnInputSetCount: row.finalized_hpn_input_set_count,
        finalizedHpnCalculationCount: row.finalized_hpn_calculation_count,
        maxFinalizedHpnCorroboratingPlayerRowCount:
          row.max_finalized_hpn_corroborating_player_row_count,
      },
    },
    retainedAuthority: {
      privateFactualHead: {
        present: row.private_factual_present,
        revision: row.private_factual_revision,
      },
      qualifiedModelEvidence: {
        present: row.qualified_model_present,
        revision: row.qualified_model_revision,
      },
      preparedV3: {
        present: row.prepared_v3_present,
        revision: row.prepared_v3_revision,
      },
      exhaustivePrivateBatch: {
        present: row.private_batch_present,
        revision: row.private_batch_revision,
        tradeCount: row.trade_count,
        readyCount: row.ready_count,
        unavailableCount: row.unavailable_count,
      },
    },
    blockerCodes,
    constructionReadiness:
      constructionReadiness === null
        ? ({ status: 'not_inspected', reason: 'selection_not_supplied', report: null } as const)
        : ({ status: 'inspected', reason: null, report: constructionReadiness } as const),
    limitationCodes: [
      'source_authority_authentication_not_performed',
      'retained_artifact_replay_not_performed',
      'complete_private_loop_not_executed',
    ],
  };
}
