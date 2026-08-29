import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradePrivateValuationDispatchTriggerSchema } from './privateValuationScheduling';

export const AFL_TRADE_CURRENT_VALUATION_NO_CHANGE_RESULT_SCHEMA_VERSION =
  'afl-current-valuation-refresh-result-v1' as const;
export const AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_RESULT_SCHEMA_VERSION =
  'afl-current-valuation-refresh-result-v2' as const;
export const AFL_TRADE_CURRENT_VALUATION_REFRESH_LIMITATION =
  'Private local non-production current-authority refresh trace only; no factual, model, prepared-input, private-evaluation, production, activation, or publication authority is granted.' as const;
export const AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_LIMITATION =
  'Private local non-production factual refresh authority only; no public release, registry, production, activation, or publication authority is granted.' as const;

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

const idSchema = z.string().trim().min(1).max(400);
const instantSchema = z.iso.datetime({ offset: true });

export const aflTradeCurrentValuationRefreshTriggerSchema =
  aflTradePrivateValuationDispatchTriggerSchema;

export const aflTradeCurrentValuationRefreshRequestSchema = z
  .object({
    scopeKey: idSchema,
    trigger: aflTradeCurrentValuationRefreshTriggerSchema,
    stableOperationKey: idSchema,
  })
  .strict();

export const aflTradeCurrentValuationRefreshAuthoritySchema = z
  .object({
    factualReleaseScopeKey: idSchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualReleaseRevision: z.number().int().positive(),
    modelQualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
    modelQualificationWorkId: aflTradeContentAddressedIdSchema('model-qualification-work'),
    modelPairRevision: z.number().int().positive(),
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    preparedInputSetRevision: z.number().int().positive(),
    privateBatchId: aflTradeContentAddressedIdSchema('private-evaluation-batch'),
    privateBatchRevision: z.number().int().positive(),
    privateBatchTransitionId: aflTradeContentAddressedIdSchema(
      'private-evaluation-batch-transition'
    ),
  })
  .strict();

const retainedNoChangeResultSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_CURRENT_VALUATION_NO_CHANGE_RESULT_SCHEMA_VERSION),
    operationId: aflTradeContentAddressedIdSchema('current-valuation-refresh-operation'),
    scopeKey: idSchema,
    trigger: aflTradeCurrentValuationRefreshTriggerSchema,
    stableOperationKey: idSchema,
    state: z.literal('no_change'),
    capturedAuthority: aflTradeCurrentValuationRefreshAuthoritySchema,
    capturedAt: instantSchema,
    completedAt: instantSchema,
    executionLocation: z.literal('local'),
    visibility: z.literal('private'),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(AFL_TRADE_CURRENT_VALUATION_REFRESH_LIMITATION),
  })
  .strict();

const privateFactualAuthoritySchema = z
  .object({
    valuationScopeKey: idSchema,
    candidateId: aflTradeContentAddressedIdSchema('private-factual-candidate'),
    evidenceScopeKey: idSchema,
    evidenceBundleId: aflTradeContentAddressedIdSchema('private-reviewed-evidence-bundle'),
    reviewDecisionId: aflTradeContentAddressedIdSchema(
      'private-reviewed-evidence-evaluation-decision'
    ),
    normalizedReconciledCustodySha256: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().positive(),
  })
  .strict();

const factualRefreshResultSchema = z
  .object({
    schemaVersion: z.literal(
      AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_RESULT_SCHEMA_VERSION
    ),
    operationId: aflTradeContentAddressedIdSchema(
      'current-valuation-factual-refresh-operation'
    ),
    scopeKey: idSchema,
    trigger: aflTradeCurrentValuationRefreshTriggerSchema,
    stableOperationKey: idSchema,
    state: z.literal('factual_refresh_complete'),
    factualStage: z.enum(['already_current', 'advanced']),
    privateFactualAuthority: privateFactualAuthoritySchema,
    capturedAt: instantSchema,
    completedAt: instantSchema,
    executionLocation: z.literal('local'),
    visibility: z.literal('private'),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_LIMITATION),
  })
  .strict();

const unavailableRefreshResultSchema = z
  .object({
    schemaVersion: z.literal(
      AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_RESULT_SCHEMA_VERSION
    ),
    operationId: aflTradeContentAddressedIdSchema(
      'current-valuation-factual-refresh-operation'
    ),
    scopeKey: idSchema,
    trigger: aflTradeCurrentValuationRefreshTriggerSchema,
    stableOperationKey: idSchema,
    state: z.literal('unavailable'),
    cause: z.enum([
      'source_authority_missing',
      'source_authority_stale',
      'source_authority_mismatched',
      'source_authority_unauthenticated',
    ]),
    capturedAt: instantSchema,
    completedAt: instantSchema,
    executionLocation: z.literal('local'),
    visibility: z.literal('private'),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_LIMITATION),
  })
  .strict();

export const aflTradeCurrentValuationRefreshResultSchema = z
  .discriminatedUnion('state', [
    retainedNoChangeResultSchema,
    factualRefreshResultSchema,
    unavailableRefreshResultSchema,
  ])
  .superRefine((result, context) => {
    if (Date.parse(result.completedAt) < Date.parse(result.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Current valuation refresh cannot complete before authority capture.',
      });
    }
  });

export type AflTradeCurrentValuationRefreshRequest = z.infer<
  typeof aflTradeCurrentValuationRefreshRequestSchema
>;
export type AflTradeCurrentValuationRefreshResult = z.infer<
  typeof aflTradeCurrentValuationRefreshResultSchema
>;

export interface AflTradeCurrentValuationRefresh {
  refreshCurrent(
    request: AflTradeCurrentValuationRefreshRequest
  ): Promise<AflTradeCurrentValuationRefreshResult>;
}

interface RetainedRefreshRow {
  readonly operation_id: string;
  readonly operation_json: unknown;
  readonly result_json: unknown;
}

export function createAflTradeCurrentValuationRefresh(dependencies: {
  readonly client: AflOutcomeSqlClient;
}): AflTradeCurrentValuationRefresh {
  return {
    async refreshCurrent(unparsedRequest) {
      const request = aflTradeCurrentValuationRefreshRequestSchema.parse(unparsedRequest);
      for (const statement of [
        'SELECT retain_outcome_current_valuation_factual_source($1,$2,$3)',
        'SELECT compose_outcome_current_valuation_factual_candidate($1,$2,$3)',
      ]) {
        await dependencies.client.transaction(async (transaction) => {
          await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
          await transaction.query(statement, [
            request.scopeKey,
            request.trigger,
            request.stableOperationKey,
          ]);
        });
      }
      const retained = await dependencies.client.transaction(async (transaction) => {
        await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
        return transaction.query<RetainedRefreshRow>(
          'SELECT * FROM refresh_outcome_current_valuation_factual($1,$2,$3)',
          [request.scopeKey, request.trigger, request.stableOperationKey]
        );
      });
      const row = retained.rows[0];
      if (row === undefined || retained.rows.length !== 1) {
        throw new TypeError('Current valuation refresh did not retain exactly one result.');
      }
      const result = aflTradeCurrentValuationRefreshResultSchema.parse(row.result_json);
      if (result.operationId !== row.operation_id) {
        throw new TypeError(
          'Current valuation refresh result disagrees with retained operation custody.'
        );
      }
      if (
        result.scopeKey !== request.scopeKey ||
        result.trigger !== request.trigger ||
        result.stableOperationKey !== request.stableOperationKey
      ) {
        throw new TypeError(
          'Current valuation refresh result conflicts with the requested operation.'
        );
      }
      return result;
    },
  };
}
