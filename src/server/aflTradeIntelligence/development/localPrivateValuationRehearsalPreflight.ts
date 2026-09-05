import { z } from 'zod';

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
  })
  .strict();

export interface LocalPrivateValuationPreflightQueryClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

type RetainedHead = Readonly<{ present: boolean; revision: number | null }>;

export interface Exact2025AflPrivateValuationRehearsalPreflight {
  readonly schemaVersion: 'afl-private-valuation-rehearsal-preflight/v2';
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
  client: LocalPrivateValuationPreflightQueryClient
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
            (SELECT unavailable_count FROM private_batch) AS unavailable_count`,
    [SCOPE_KEY]
  );
  if (result.rows.length !== 1) {
    throw new TypeError('Exact 2025 private valuation authority inventory is not unique.');
  }
  const row = inventoryRowSchema.parse(result.rows[0]);
  const blockerCodes = [
    ...(row.private_factual_present ? [] : ['current_private_factual_head_missing']),
    ...(row.qualified_model_present ? [] : ['qualified_model_evidence_missing']),
    ...(row.prepared_v3_present ? [] : ['prepared_v3_head_missing']),
    ...(row.private_batch_present ? [] : ['exhaustive_private_batch_head_missing']),
  ];

  return {
    schemaVersion: 'afl-private-valuation-rehearsal-preflight/v2',
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
    limitationCodes: [
      'source_authority_authentication_not_performed',
      'retained_artifact_replay_not_performed',
      'complete_private_loop_not_executed',
    ],
  };
}
