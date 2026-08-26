import { createHash } from 'node:crypto';

import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflTradeValuationInputBundle } from '../artifacts/valuationInputBundle';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import type {
  AflTradeCurrentValuationCohortConstructionContext,
  AflTradeCurrentValuationCohortPreparationRequest,
  AflTradeCurrentValuationCohortPreparationResult,
} from './currentValuationCohortPreparation';
import { aflTradeCurrentValuationCohortConstructionContextSchema } from './currentValuationCohortPreparation';
import { aflTradePersistedCurrentValuationCohortConstructionContextSchema } from './currentValuationCohortPreparation';
import { createAflTradeCurrentValuationCohortCoordinator } from './currentValuationCohortPreparation';
import { createAflTradeCurrentValuationCohortPreparationOperationId } from './currentValuationCohortPreparation';
import { createAflTradePrivateCurrentValuationCohortPreparationOperationId } from './currentValuationCohortPreparation';
import {
  createAflTradeCurrentValuationTradePreparer,
  type AflTradeCurrentValuationTradePreparationDependencies,
} from './currentValuationTradePreparation';
import { PostgresGovernedPrivateEvaluationMaterializationManifestRepository } from './internal/postgresGovernedPrivateEvaluationMaterializationManifestRepository';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from './internal/postgresGovernedPrivateEvaluationStagingRepository';
import type { AflTradeCurrentPreparedValuationInputHead } from './postgresPreparedValuationInputSetStore';
import {
  PostgresAflTradePreparedValuationInputSetStore,
  registerAflTradePreparedValuationInputSetFromTransaction,
} from './postgresPreparedValuationInputSetStore';
import {
  aflTradePreparedValuationInputSetSchema,
  type AflTradePreparedValuationInputSet,
} from './preparedValuationInputSet';

interface ActiveReleaseRow {
  readonly release_id: string;
  readonly revision: number;
}

interface CurrentModelPairRow {
  readonly revision: number;
  readonly qualification_id: string;
  readonly player_run_id: string;
  readonly pick_run_id: string;
  readonly work_id?: string;
}

interface TrustedTimeRow {
  readonly captured_at: Date | string;
}

interface CohortOperationRow {
  readonly context_json: unknown;
}

interface CohortOperationResultRow {
  readonly prepared_input_set_id: string;
  readonly head_revision: number;
}

interface PrivateCohortAuthorityRow {
  readonly scope_key: string;
  readonly factual_release_scope_key: string;
  readonly factual_release_id: string;
  readonly factual_output_id: string;
  readonly hpn_calculation_id: string;
  readonly model_operation_id: string;
  readonly model_qualification_id: string;
  readonly model_qualification_work_id: string;
  readonly model_qualification_revision: number;
  readonly player_run_id: string;
  readonly pick_run_id: string;
}

interface CurrentPrivatePreparedCohortRow extends PreparedHeadRow {
  readonly prepared_set_json: unknown;
}

type PrivateCohortAuthorityExpectation = Readonly<{
  scopeKey: string;
  factualReleaseScopeKey: string;
  factualReleaseId: string;
  privateAuthority: Readonly<{
    dispatchRequestId: string;
    factualOutputId: string;
    hpnCalculationId: string;
    modelOperationId: string;
    modelQualificationId: string;
    modelQualificationWorkId: string;
    modelQualificationRevision: number;
    playerRunId: string;
    pickRunId: string;
  }>;
}>;

type PublicCurrentValuationCohortConstructionContext = Extract<
  AflTradeCurrentValuationCohortConstructionContext,
  { readonly factualReleaseRevision: number }
>;
type PrivateCurrentValuationCohortConstructionContext = Extract<
  AflTradeCurrentValuationCohortConstructionContext,
  { readonly preparationAuthority: 'dispatch_bound_private_factual_output' }
>;

export type AflTradeCurrentValuationCohortConstructionEvidence = Pick<
  PublicCurrentValuationCohortConstructionContext,
  | 'factualReleaseArtifact'
  | 'releaseMembershipArtifact'
  | 'releaseTradeIds'
  | 'sourceQualificationReportId'
  | 'sourceQualificationReportArtifact'
  | 'sourceQualificationEvidenceRefs'
  | 'valuationInputBundleId'
  | 'valuationInputBundleArtifact'
> & { readonly valuationInputBundle: AflTradeValuationInputBundle };

export type AflTradePrivateCurrentValuationCohortConstructionEvidence = Pick<
  PrivateCurrentValuationCohortConstructionContext,
  | 'factualReleaseArtifact'
  | 'releaseMembershipArtifact'
  | 'releaseTradeIds'
  | 'valuationInputBundleId'
  | 'valuationInputBundleArtifact'
> & { readonly valuationInputBundle: AflTradeValuationInputBundle };

function constructionContextFromPersisted(
  value: unknown
): AflTradeCurrentValuationCohortConstructionContext {
  const persisted = aflTradePersistedCurrentValuationCohortConstructionContextSchema.parse(value);
  const { valuationInputBundle: _retainedBundle, ...context } = persisted;
  return aflTradeCurrentValuationCohortConstructionContextSchema.parse(context);
}

interface PreparedHeadRow {
  readonly scope_key: string;
  readonly prepared_input_set_id: string;
  readonly revision: number;
  readonly activated_at: Date | string;
}

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Current prepared cohort head has an invalid activation time.');
  }
  return date.toISOString();
}

function head(row: PreparedHeadRow): AflTradeCurrentPreparedValuationInputHead {
  return {
    scopeKey: row.scope_key,
    preparedInputSetId: row.prepared_input_set_id,
    revision: row.revision,
    activatedAt: timestamp(row.activated_at),
  };
}

async function loadHead(
  transaction: AflOutcomeSqlTransaction,
  scopeKey: string
): Promise<AflTradeCurrentPreparedValuationInputHead | null> {
  const result = await transaction.query<PreparedHeadRow>(
    `SELECT scope_key,prepared_input_set_id,revision,activated_at
       FROM outcome_current_prepared_valuation_input_set
      WHERE scope_key=$1 FOR UPDATE`,
    [scopeKey]
  );
  if (result.rows.length > 1) {
    throw new TypeError('Current prepared cohort head is not unique.');
  }
  return result.rows[0] === undefined ? null : head(result.rows[0]);
}

async function loadPrivateCurrentValuationCohortAuthorityRow(
  transaction: AflOutcomeSqlTransaction,
  dispatchRequestId: string
): Promise<PrivateCohortAuthorityRow | null> {
  const result = await transaction.query<PrivateCohortAuthorityRow>(
    `SELECT request.scope_key,release.scope_key AS factual_release_scope_key,
            factual.factual_release_id,binding.factual_output_id,
            binding.hpn_calculation_id,binding.operation_id AS model_operation_id,
            operation.qualification_id AS model_qualification_id,
            model.work_id AS model_qualification_work_id,
            model.revision AS model_qualification_revision,
            operation.player_run_id,operation.pick_run_id
       FROM outcome_private_valuation_model_request_binding binding
       JOIN outcome_private_valuation_dispatch_request request
         ON request.request_id=binding.request_id
       JOIN outcome_private_valuation_factual_output factual
         ON factual.request_id=binding.request_id
        AND factual.output_id=binding.factual_output_id
       JOIN outcome_release_manifest release
         ON release.release_id=factual.factual_release_id
       JOIN outcome_private_valuation_model_operation operation
         ON operation.operation_id=binding.operation_id
        AND operation.qualification_outcome='qualified'
       JOIN outcome_current_governed_valuation_model_pair model
         ON model.scope_key=request.scope_key
        AND model.qualification_id=operation.qualification_id
        AND model.player_run_id=operation.player_run_id
        AND model.pick_run_id=operation.pick_run_id
       JOIN outcome_governed_model_qualification_work work
         ON work.work_id=model.work_id
        AND work.qualification_id=operation.qualification_id
      WHERE binding.request_id=$1`,
    [dispatchRequestId]
  );
  if (result.rows.length > 1) {
    throw new TypeError('Private current valuation cohort authority is ambiguous.');
  }
  return result.rows[0] ?? null;
}

export async function loadPostgresAflTradePrivateCurrentValuationCohortAuthority(
  transaction: AflOutcomeSqlTransaction,
  expected: PrivateCohortAuthorityExpectation
): Promise<boolean> {
  const row = await loadPrivateCurrentValuationCohortAuthorityRow(
    transaction,
    expected.privateAuthority.dispatchRequestId
  );
  const authority = expected.privateAuthority;
  return (
    row !== null &&
    row.scope_key === expected.scopeKey &&
    row.factual_release_scope_key === expected.factualReleaseScopeKey &&
    row.factual_release_id === expected.factualReleaseId &&
    row.factual_output_id === authority.factualOutputId &&
    row.hpn_calculation_id === authority.hpnCalculationId &&
    row.model_operation_id === authority.modelOperationId &&
    row.model_qualification_id === authority.modelQualificationId &&
    row.model_qualification_work_id === authority.modelQualificationWorkId &&
    Number(row.model_qualification_revision) === authority.modelQualificationRevision &&
    row.player_run_id === authority.playerRunId &&
    row.pick_run_id === authority.pickRunId
  );
}

export async function loadPostgresAflTradePrivateCurrentPreparedValuationCohort(input: {
  readonly client: AflOutcomeSqlClient;
  readonly requestId: string;
  readonly claim: { readonly claimId: string; readonly leaseToken: string };
}): Promise<AflTradeCurrentValuationCohortPreparationResult | null> {
  const leaseTokenSha256 = createHash('sha256')
    .update(input.claim.leaseToken, 'utf8')
    .digest('hex');
  return input.client.transaction(async (transaction) => {
    await transaction.query(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
    await transaction.query(
      `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
      [input.requestId, input.claim.claimId, leaseTokenSha256]
    );
    const result = await transaction.query<CurrentPrivatePreparedCohortRow>(
      `SELECT head.scope_key,head.prepared_input_set_id,head.revision,head.activated_at,
              prepared.prepared_set_json AS prepared_set_json
         FROM outcome_private_valuation_dispatch_request request
         JOIN outcome_current_prepared_valuation_input_set head
           ON head.scope_key=request.scope_key
         JOIN outcome_prepared_valuation_input_set prepared
           ON prepared.prepared_input_set_id=head.prepared_input_set_id
          AND prepared.prepared_set_json->'content'->>'preparationAuthority'=
              'dispatch_bound_private_factual_output'
        WHERE request.request_id=$1
        FOR KEY SHARE OF head,prepared`,
      [input.requestId]
    );
    if (result.rows.length > 1) {
      throw new TypeError('Current private prepared cohort is ambiguous.');
    }
    const row = result.rows[0];
    if (row === undefined) return null;
    const preparedInputSet = aflTradePreparedValuationInputSetSchema.parse(row.prepared_set_json);
    if (
      preparedInputSet.preparedInputSetId !== row.prepared_input_set_id ||
      !('privateAuthority' in preparedInputSet.content)
    ) {
      throw new TypeError('Current private prepared cohort disagrees with retained custody.');
    }
    const content = preparedInputSet.content;
    const incomingAuthority = await loadPrivateCurrentValuationCohortAuthorityRow(
      transaction,
      input.requestId
    );
    if (
      !(await loadPostgresAflTradePrivateCurrentValuationCohortAuthority(transaction, {
        scopeKey: content.scopeKey,
        factualReleaseScopeKey: content.factualReleaseScopeKey,
        factualReleaseId: content.factualReleaseId,
        privateAuthority: content.privateAuthority,
      })) ||
      incomingAuthority === null ||
      incomingAuthority.scope_key !== content.scopeKey ||
      incomingAuthority.factual_release_scope_key !== content.factualReleaseScopeKey ||
      incomingAuthority.model_operation_id !== content.privateAuthority.modelOperationId ||
      incomingAuthority.model_qualification_id !== content.privateAuthority.modelQualificationId ||
      incomingAuthority.model_qualification_work_id !==
        content.privateAuthority.modelQualificationWorkId ||
      Number(incomingAuthority.model_qualification_revision) !==
        content.privateAuthority.modelQualificationRevision ||
      incomingAuthority.player_run_id !== content.privateAuthority.playerRunId ||
      incomingAuthority.pick_run_id !== content.privateAuthority.pickRunId
    ) {
      return null;
    }
    return { state: 'already_current', preparedInputSet, head: head(row) };
  });
}

export function createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly loadConstructionEvidence: (input: {
    readonly transaction: AflOutcomeSqlTransaction;
    readonly requestId: string;
    readonly factualOutputId: string;
    readonly factualReleaseId: string;
    readonly capturedAt: string;
    readonly modelOperationId: string;
    readonly modelQualificationId: string;
    readonly modelQualificationWorkId: string;
    readonly playerRunId: string;
    readonly pickRunId: string;
  }) => Promise<AflTradePrivateCurrentValuationCohortConstructionEvidence>;
}) {
  return async function capture(input: {
    readonly requestId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }): Promise<PrivateCurrentValuationCohortConstructionContext> {
    return dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
      const leaseTokenSha256 = createHash('sha256')
        .update(input.claim.leaseToken, 'utf8')
        .digest('hex');
      await transaction.query(
        `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
        [input.requestId, input.claim.claimId, leaseTokenSha256]
      );
      const trusted = await transaction.query<TrustedTimeRow>(
        `SELECT date_trunc('milliseconds',transaction_timestamp()) AS captured_at`
      );
      if (trusted.rows.length !== 1) {
        throw new TypeError('Private cohort capture requires trusted PostgreSQL time.');
      }
      const capturedAt = timestamp(trusted.rows[0]!.captured_at);
      const row = await loadPrivateCurrentValuationCohortAuthorityRow(transaction, input.requestId);
      if (row === null) {
        throw new TypeError(
          'Private cohort capture requires one exact accepted factual output and qualified model pair.'
        );
      }
      const preparedHead = await transaction.query<{ readonly revision: number }>(
        `SELECT revision FROM outcome_current_prepared_valuation_input_set
          WHERE scope_key=$1 FOR KEY SHARE`,
        [row.scope_key]
      );
      if (preparedHead.rows.length > 1) {
        throw new TypeError('Private cohort prepared head is ambiguous.');
      }
      const expectedPreparedInputRevision = preparedHead.rows[0]?.revision ?? 0;
      const privateAuthority = {
        dispatchRequestId: input.requestId,
        factualOutputId: row.factual_output_id,
        hpnCalculationId: row.hpn_calculation_id,
        modelOperationId: row.model_operation_id,
        modelQualificationId: row.model_qualification_id,
        modelQualificationWorkId: row.model_qualification_work_id,
        modelQualificationRevision: row.model_qualification_revision,
        playerRunId: row.player_run_id,
        pickRunId: row.pick_run_id,
      } as const;
      const evidence = await dependencies.loadConstructionEvidence({
        transaction,
        requestId: input.requestId,
        factualOutputId: row.factual_output_id,
        factualReleaseId: row.factual_release_id,
        capturedAt,
        modelOperationId: row.model_operation_id,
        modelQualificationId: row.model_qualification_id,
        modelQualificationWorkId: row.model_qualification_work_id,
        playerRunId: row.player_run_id,
        pickRunId: row.pick_run_id,
      });
      const operationId = createAflTradePrivateCurrentValuationCohortPreparationOperationId({
        scopeKey: row.scope_key,
        factualReleaseId: row.factual_release_id,
        privateAuthority,
        valuationInputBundleId: evidence.valuationInputBundleId,
        expectedPreparedInputRevision,
      });
      const persistedContext =
        aflTradePersistedCurrentValuationCohortConstructionContextSchema.parse({
          operationId,
          scopeKey: row.scope_key,
          factualReleaseScopeKey: row.factual_release_scope_key,
          factualReleaseId: row.factual_release_id,
          preparationAuthority: 'dispatch_bound_private_factual_output',
          privateAuthority,
          expectedPreparedInputRevision,
          capturedAt,
          ...evidence,
        });
      if (!('privateAuthority' in persistedContext)) {
        throw new TypeError('Private cohort capture resolved to public authority.');
      }
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        operationId,
      ]);
      const retainedOperation = await transaction.query<CohortOperationRow>(
        `SELECT context_json FROM outcome_current_valuation_cohort_operation
          WHERE operation_id=$1 FOR KEY SHARE`,
        [operationId]
      );
      if (retainedOperation.rows.length > 1) {
        throw new TypeError('Private cohort operation identity is not unique.');
      }
      if (retainedOperation.rows[0] !== undefined) {
        const retainedContext =
          aflTradePersistedCurrentValuationCohortConstructionContextSchema.parse(
            retainedOperation.rows[0].context_json
          );
        if (
          !('privateAuthority' in retainedContext) ||
          retainedContext.operationId !== operationId ||
          !(await loadPostgresAflTradePrivateCurrentValuationCohortAuthority(transaction, {
            scopeKey: retainedContext.scopeKey,
            factualReleaseScopeKey: retainedContext.factualReleaseScopeKey,
            factualReleaseId: retainedContext.factualReleaseId,
            privateAuthority: retainedContext.privateAuthority,
          }))
        ) {
          throw new TypeError('Private cohort operation replay lost exact current authority.');
        }
        const { valuationInputBundle: _retainedBundle, ...context } = retainedContext;
        return aflTradeCurrentValuationCohortConstructionContextSchema.parse(
          context
        ) as PrivateCurrentValuationCohortConstructionContext;
      }
      const canonicalContext = canonicalizeAflTradeJson(persistedContext);
      if (retainedOperation.rows[0] === undefined) {
        await transaction.query(
          `INSERT INTO outcome_current_valuation_cohort_operation
            (operation_id,scope_key,factual_release_id,factual_release_revision,
             model_qualification_id,model_qualification_work_id,model_qualification_revision,
             expected_prepared_input_revision,captured_at,context_sha256,
             context_canonical_json,context_json,preparation_authority,
             dispatch_request_id,factual_output_id,hpn_calculation_id,model_operation_id)
           VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)
           ON CONFLICT (operation_id) DO NOTHING`,
          [
            operationId,
            persistedContext.scopeKey,
            persistedContext.factualReleaseId,
            privateAuthority.modelQualificationId,
            privateAuthority.modelQualificationWorkId,
            privateAuthority.modelQualificationRevision,
            persistedContext.expectedPreparedInputRevision,
            persistedContext.capturedAt,
            sha256AflTradeCanonicalJson(persistedContext),
            canonicalContext,
            canonicalContext,
            persistedContext.preparationAuthority,
            privateAuthority.dispatchRequestId,
            privateAuthority.factualOutputId,
            privateAuthority.hpnCalculationId,
            privateAuthority.modelOperationId,
          ]
        );
      }
      const retained = await transaction.query<CohortOperationRow>(
        `SELECT context_json FROM outcome_current_valuation_cohort_operation
          WHERE operation_id=$1 FOR KEY SHARE`,
        [operationId]
      );
      if (
        retained.rows.length !== 1 ||
        canonicalizeAflTradeJson(retained.rows[0]!.context_json) !== canonicalContext
      ) {
        throw new TypeError('Private cohort operation replay conflicts with retained authority.');
      }
      const { valuationInputBundle: _retainedBundle, ...context } = persistedContext;
      return aflTradeCurrentValuationCohortConstructionContextSchema.parse(
        context
      ) as PrivateCurrentValuationCohortConstructionContext;
    });
  };
}

export function createPostgresAflTradeCurrentValuationCohortAuthorityCapture(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly factualReleaseScopeKey: string;
  readonly loadConstructionEvidence: (input: {
    readonly transaction: AflOutcomeSqlTransaction;
    readonly request: AflTradeCurrentValuationCohortPreparationRequest;
    readonly factualReleaseId: string;
    readonly capturedAt: string;
    readonly modelQualificationId: string;
    readonly modelQualificationWorkId: string;
    readonly playerRunId: string;
    readonly pickRunId: string;
  }) => Promise<AflTradeCurrentValuationCohortConstructionEvidence>;
}) {
  if (dependencies.factualReleaseScopeKey.trim() === '') {
    throw new TypeError('Current cohort capture requires a factual release scope.');
  }
  return async function capture(
    request: AflTradeCurrentValuationCohortPreparationRequest
  ): Promise<PublicCurrentValuationCohortConstructionContext> {
    return dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        request.operationId,
      ]);
      const retainedOperation = await transaction.query<CohortOperationRow>(
        `SELECT context_json
           FROM outcome_current_valuation_cohort_operation
          WHERE operation_id=$1 FOR KEY SHARE`,
        [request.operationId]
      );
      if (retainedOperation.rows.length > 1) {
        throw new TypeError('Current cohort operation identity is not unique.');
      }
      if (retainedOperation.rows[0] !== undefined) {
        const retained = constructionContextFromPersisted(retainedOperation.rows[0].context_json);
        if (
          retained.operationId !== request.operationId ||
          retained.scopeKey !== request.scopeKey
        ) {
          throw new TypeError('Current cohort operation replay conflicts with retained authority.');
        }
        if (!('factualReleaseRevision' in retained)) {
          throw new TypeError('Public cohort operation replay resolved to private authority.');
        }
        return retained;
      }
      const trusted = await transaction.query<TrustedTimeRow>(
        `SELECT date_trunc('milliseconds',transaction_timestamp()) AS captured_at`
      );
      if (trusted.rows.length !== 1) {
        throw new TypeError('Current cohort capture requires trusted PostgreSQL time.');
      }
      const capturedAt = timestamp(trusted.rows[0]!.captured_at);
      const release = await transaction.query<ActiveReleaseRow>(
        `SELECT release_id,revision FROM outcome_active_release
          WHERE scope_key=$1 FOR KEY SHARE`,
        [dependencies.factualReleaseScopeKey]
      );
      const model = await transaction.query<CurrentModelPairRow>(
        `SELECT revision,qualification_id,player_run_id,pick_run_id,work_id
           FROM outcome_current_governed_valuation_model_pair
          WHERE scope_key=$1 FOR KEY SHARE`,
        [request.scopeKey]
      );
      if (release.rows.length !== 1 || model.rows.length !== 1) {
        throw new TypeError(
          'Current cohort capture requires one active factual release and qualified model pair.'
        );
      }
      const activeRelease = release.rows[0]!;
      const currentModel = model.rows[0]!;
      if (currentModel.work_id === undefined) {
        throw new TypeError('Current qualified model authority omitted its work identity.');
      }
      const currentHead = await loadHead(transaction, request.scopeKey);
      const expectedOperationId = createAflTradeCurrentValuationCohortPreparationOperationId({
        scopeKey: request.scopeKey,
        factualReleaseId: activeRelease.release_id,
        factualReleaseRevision: activeRelease.revision,
        modelQualificationId: currentModel.qualification_id,
        modelQualificationWorkId: currentModel.work_id,
        modelQualificationRevision: currentModel.revision,
        expectedPreparedInputRevision: currentHead?.revision ?? 0,
      });
      if (request.operationId !== expectedOperationId) {
        throw new TypeError(
          'Current cohort operation identity does not match its captured release, model, and head authority.'
        );
      }
      const evidence = await dependencies.loadConstructionEvidence({
        transaction,
        request,
        factualReleaseId: activeRelease.release_id,
        capturedAt,
        modelQualificationId: currentModel.qualification_id,
        modelQualificationWorkId: currentModel.work_id,
        playerRunId: currentModel.player_run_id,
        pickRunId: currentModel.pick_run_id,
      });
      const persistedContext =
        aflTradePersistedCurrentValuationCohortConstructionContextSchema.parse({
          operationId: request.operationId,
          scopeKey: request.scopeKey,
          factualReleaseScopeKey: dependencies.factualReleaseScopeKey,
          factualReleaseId: activeRelease.release_id,
          factualReleaseRevision: activeRelease.revision,
          modelQualificationId: currentModel.qualification_id,
          modelQualificationWorkId: currentModel.work_id,
          modelQualificationRevision: currentModel.revision,
          playerRunId: currentModel.player_run_id,
          pickRunId: currentModel.pick_run_id,
          expectedPreparedInputRevision: currentHead?.revision ?? 0,
          capturedAt,
          ...evidence,
        });
      if (!('factualReleaseRevision' in persistedContext)) {
        throw new TypeError('Public cohort capture resolved to private authority.');
      }
      const context = constructionContextFromPersisted(persistedContext);
      if (!('factualReleaseRevision' in context)) {
        throw new TypeError('Public cohort capture context resolved to private authority.');
      }
      const canonicalContext = canonicalizeAflTradeJson(persistedContext);
      await transaction.query(
        `INSERT INTO outcome_current_valuation_cohort_operation
          (operation_id,scope_key,factual_release_id,factual_release_revision,
           model_qualification_id,model_qualification_work_id,model_qualification_revision,
           expected_prepared_input_revision,captured_at,context_sha256,context_canonical_json,
           context_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         ON CONFLICT (operation_id) DO NOTHING`,
        [
          persistedContext.operationId,
          persistedContext.scopeKey,
          persistedContext.factualReleaseId,
          persistedContext.factualReleaseRevision,
          persistedContext.modelQualificationId,
          persistedContext.modelQualificationWorkId,
          persistedContext.modelQualificationRevision,
          persistedContext.expectedPreparedInputRevision,
          persistedContext.capturedAt,
          sha256AflTradeCanonicalJson(persistedContext),
          canonicalContext,
          canonicalContext,
        ]
      );
      const retained = await transaction.query<CohortOperationRow>(
        `SELECT context_json
           FROM outcome_current_valuation_cohort_operation
          WHERE operation_id=$1 FOR KEY SHARE`,
        [context.operationId]
      );
      if (
        retained.rows.length !== 1 ||
        canonicalizeAflTradeJson(retained.rows[0]!.context_json) !== canonicalContext
      ) {
        throw new TypeError(
          'Current cohort operation registration conflicts with retained authority.'
        );
      }
      return context;
    });
  };
}

export function createPostgresAflTradeCurrentValuationCohortCommitter(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly registerPreparedInputSet: (
    prepared: AflTradePreparedValuationInputSet
  ) => Promise<AflTradePreparedValuationInputSet>;
}) {
  return async function commit(input: {
    readonly context: AflTradeCurrentValuationCohortConstructionContext;
    readonly preparedInputSet: AflTradePreparedValuationInputSet;
  }): Promise<AflTradeCurrentValuationCohortPreparationResult> {
    const context = input.context;
    if (!('factualReleaseRevision' in context)) {
      throw new TypeError('Private cohort commit requires dispatch-fenced authority.');
    }
    const registered = await dependencies.registerPreparedInputSet(input.preparedInputSet);
    if (canonicalizeAflTradeJson(registered) !== canonicalizeAflTradeJson(input.preparedInputSet)) {
      throw new TypeError('Prepared cohort registration changed its authenticated identity.');
    }
    return dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
      const retainedResult = await transaction.query<CohortOperationResultRow>(
        `SELECT prepared_input_set_id,head_revision
           FROM outcome_current_valuation_cohort_operation_result
          WHERE operation_id=$1 FOR KEY SHARE`,
        [context.operationId]
      );
      const release = await transaction.query<ActiveReleaseRow>(
        `SELECT release_id,revision FROM outcome_active_release
          WHERE scope_key=$1 FOR KEY SHARE`,
        [context.factualReleaseScopeKey]
      );
      if (
        release.rows.length !== 1 ||
        release.rows[0]!.release_id !== context.factualReleaseId ||
        release.rows[0]!.revision !== context.factualReleaseRevision
      ) {
        return {
          state: 'stale_authority',
          reason: 'The factual release changed while the cohort was being prepared.',
        };
      }
      const model = await transaction.query<CurrentModelPairRow>(
        `SELECT revision,qualification_id,player_run_id,pick_run_id,work_id
           FROM outcome_current_governed_valuation_model_pair
          WHERE scope_key=$1 FOR KEY SHARE`,
        [context.scopeKey]
      );
      if (
        model.rows.length !== 1 ||
        model.rows[0]!.revision !== context.modelQualificationRevision ||
        model.rows[0]!.qualification_id !== context.modelQualificationId ||
        model.rows[0]!.work_id !== context.modelQualificationWorkId ||
        model.rows[0]!.player_run_id !== context.playerRunId ||
        model.rows[0]!.pick_run_id !== context.pickRunId
      ) {
        return {
          state: 'stale_authority',
          reason: 'The qualified model pair changed while the cohort was being prepared.',
        };
      }
      const current = await loadHead(transaction, context.scopeKey);
      if (retainedResult.rows[0] !== undefined) {
        if (
          retainedResult.rows.length !== 1 ||
          retainedResult.rows[0].prepared_input_set_id !== registered.preparedInputSetId ||
          current?.preparedInputSetId !== registered.preparedInputSetId ||
          current.revision !== retainedResult.rows[0].head_revision
        ) {
          return {
            state: 'stale_authority',
            reason: 'The retained cohort operation result is no longer the current head.',
          };
        }
        return { state: 'already_current', preparedInputSet: registered, head: current };
      }
      if (current?.preparedInputSetId === registered.preparedInputSetId) {
        throw new TypeError('A current prepared cohort lacks its exact operation result custody.');
      }
      if ((current?.revision ?? 0) !== context.expectedPreparedInputRevision) {
        return {
          state: 'stale_authority',
          reason: 'The prepared cohort head changed while the cohort was being prepared.',
        };
      }
      await transaction.query(
        `SELECT activate_outcome_current_prepared_valuation_input_set($1,$2,$3)`,
        [context.scopeKey, registered.preparedInputSetId, context.expectedPreparedInputRevision]
      );
      const activated = await loadHead(transaction, context.scopeKey);
      if (
        activated === null ||
        activated.preparedInputSetId !== registered.preparedInputSetId ||
        activated.revision !== context.expectedPreparedInputRevision + 1
      ) {
        throw new TypeError('Prepared cohort activation returned an unexpected current head.');
      }
      await transaction.query(
        `INSERT INTO outcome_current_valuation_cohort_operation_result
          (operation_id,prepared_input_set_id,head_revision,completed_at)
         VALUES ($1,$2,$3,$4)`,
        [
          context.operationId,
          registered.preparedInputSetId,
          activated.revision,
          activated.activatedAt,
        ]
      );
      return { state: 'advanced', preparedInputSet: registered, head: activated };
    });
  };
}

export function createPostgresAflTradePrivateCurrentValuationCohortCommitter(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly registerPreparedInputSet?: (
    transaction: AflOutcomeSqlTransaction,
    prepared: AflTradePreparedValuationInputSet
  ) => Promise<AflTradePreparedValuationInputSet>;
}) {
  return async function commit(input: {
    readonly context: PrivateCurrentValuationCohortConstructionContext;
    readonly preparedInputSet: AflTradePreparedValuationInputSet;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }): Promise<AflTradeCurrentValuationCohortPreparationResult> {
    const authority = input.context.privateAuthority;
    const leaseTokenSha256 = createHash('sha256')
      .update(input.claim.leaseToken, 'utf8')
      .digest('hex');
    return dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
      await transaction.query(
        `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
        [authority.dispatchRequestId, input.claim.claimId, leaseTokenSha256]
      );
      const registered = await (
        dependencies.registerPreparedInputSet ??
        registerAflTradePreparedValuationInputSetFromTransaction
      )(transaction, input.preparedInputSet);
      if (
        canonicalizeAflTradeJson(registered) !== canonicalizeAflTradeJson(input.preparedInputSet)
      ) {
        throw new TypeError('Private prepared cohort registration changed its identity.');
      }
      const retainedResult = await transaction.query<CohortOperationResultRow>(
        `SELECT prepared_input_set_id,head_revision
           FROM outcome_current_valuation_cohort_operation_result
          WHERE operation_id=$1 FOR KEY SHARE`,
        [input.context.operationId]
      );
      if (
        !(await loadPostgresAflTradePrivateCurrentValuationCohortAuthority(transaction, {
          scopeKey: input.context.scopeKey,
          factualReleaseScopeKey: input.context.factualReleaseScopeKey,
          factualReleaseId: input.context.factualReleaseId,
          privateAuthority: authority,
        }))
      ) {
        return {
          state: 'stale_authority',
          reason: 'The private factual or qualified-model authority changed during preparation.',
        };
      }
      const current = await loadHead(transaction, input.context.scopeKey);
      if (retainedResult.rows[0] !== undefined) {
        if (
          retainedResult.rows.length !== 1 ||
          retainedResult.rows[0].prepared_input_set_id !== registered.preparedInputSetId ||
          current?.preparedInputSetId !== registered.preparedInputSetId ||
          current.revision !== retainedResult.rows[0].head_revision
        ) {
          return {
            state: 'stale_authority',
            reason: 'The retained private cohort result is no longer the current prepared head.',
          };
        }
        return { state: 'already_current', preparedInputSet: registered, head: current };
      }
      if ((current?.revision ?? 0) !== input.context.expectedPreparedInputRevision) {
        return {
          state: 'stale_authority',
          reason: 'The prepared cohort head changed while private inputs were being constructed.',
        };
      }
      await transaction.query(
        `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
        [authority.dispatchRequestId, input.claim.claimId, leaseTokenSha256]
      );
      await transaction.query(
        `SELECT activate_outcome_current_prepared_valuation_input_set($1,$2,$3)`,
        [
          input.context.scopeKey,
          registered.preparedInputSetId,
          input.context.expectedPreparedInputRevision,
        ]
      );
      const activated = await loadHead(transaction, input.context.scopeKey);
      if (
        activated === null ||
        activated.preparedInputSetId !== registered.preparedInputSetId ||
        activated.revision !== input.context.expectedPreparedInputRevision + 1
      ) {
        throw new TypeError('Private prepared cohort activation returned an unexpected head.');
      }
      await transaction.query(
        `INSERT INTO outcome_current_valuation_cohort_operation_result
          (operation_id,prepared_input_set_id,head_revision,completed_at)
         VALUES ($1,$2,$3,$4)`,
        [
          input.context.operationId,
          registered.preparedInputSetId,
          activated.revision,
          activated.activatedAt,
        ]
      );
      return { state: 'advanced', preparedInputSet: registered, head: activated };
    });
  };
}

type PostgresCurrentValuationCohortCompositionDependencies = Readonly<{
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly maximumConcurrency?: number;
  readonly constructTrade: AflTradeCurrentValuationTradePreparationDependencies['construct'];
}>;

function createPostgresCurrentValuationCohortComposition(
  dependencies: PostgresCurrentValuationCohortCompositionDependencies
) {
  const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
  });
  const manifests = new PostgresGovernedPrivateEvaluationMaterializationManifestRepository(
    dependencies.client
  );
  return {
    coordinatorOptions:
      dependencies.maximumConcurrency === undefined
        ? {}
        : { maximumConcurrency: dependencies.maximumConcurrency },
    preparedSets: new PostgresAflTradePreparedValuationInputSetStore(dependencies.client),
    tradePreparer: createAflTradeCurrentValuationTradePreparer({
      construct: dependencies.constructTrade,
      retainArtifact: (artifact) => staging.retainArtifact(artifact),
      registerManifest: (manifest) => manifests.register(manifest),
    }),
  };
}

export function createPostgresAflTradeCurrentValuationCohortCoordinator(
  dependencies: PostgresCurrentValuationCohortCompositionDependencies & {
    readonly factualReleaseScopeKey: string;
    readonly loadConstructionEvidence: Parameters<
      typeof createPostgresAflTradeCurrentValuationCohortAuthorityCapture
    >[0]['loadConstructionEvidence'];
  }
) {
  const { coordinatorOptions, preparedSets, tradePreparer } =
    createPostgresCurrentValuationCohortComposition(dependencies);
  return createAflTradeCurrentValuationCohortCoordinator({
    ...coordinatorOptions,
    captureCurrent: createPostgresAflTradeCurrentValuationCohortAuthorityCapture({
      client: dependencies.client,
      factualReleaseScopeKey: dependencies.factualReleaseScopeKey,
      loadConstructionEvidence: dependencies.loadConstructionEvidence,
    }),
    prepareTrade: (input) => tradePreparer.prepare(input),
    commitIfCurrent: createPostgresAflTradeCurrentValuationCohortCommitter({
      client: dependencies.client,
      registerPreparedInputSet: (prepared) => preparedSets.register(prepared),
    }),
  });
}

export function createPostgresAflTradePrivateCurrentValuationCohortCoordinator(
  dependencies: PostgresCurrentValuationCohortCompositionDependencies & {
    readonly loadPrivateConstructionEvidence: Parameters<
      typeof createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture
    >[0]['loadConstructionEvidence'];
  }
) {
  const { coordinatorOptions, tradePreparer } =
    createPostgresCurrentValuationCohortComposition(dependencies);
  const capturePrivate = createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture({
    client: dependencies.client,
    loadConstructionEvidence: dependencies.loadPrivateConstructionEvidence,
  });
  const commitPrivate = createPostgresAflTradePrivateCurrentValuationCohortCommitter({
    client: dependencies.client,
  });
  return {
    async preparePrivate(input: {
      readonly requestId: string;
      readonly claim: { readonly claimId: string; readonly leaseToken: string };
    }) {
      const current = await loadPostgresAflTradePrivateCurrentPreparedValuationCohort({
        client: dependencies.client,
        requestId: input.requestId,
        claim: input.claim,
      });
      if (current !== null) return current;
      const context = await capturePrivate(input);
      const privateCoordinator = createAflTradeCurrentValuationCohortCoordinator({
        ...coordinatorOptions,
        captureCurrent: async () => context,
        prepareTrade: (tradeInput) => tradePreparer.prepare(tradeInput),
        commitIfCurrent: async (commitInput) => {
          if (!('privateAuthority' in commitInput.context)) {
            throw new TypeError('Private cohort coordinator captured public authority.');
          }
          return commitPrivate({
            context: commitInput.context,
            preparedInputSet: commitInput.preparedInputSet,
            claim: input.claim,
          });
        },
      });
      return privateCoordinator.prepare({
        scopeKey: context.scopeKey,
        operationId: context.operationId,
      });
    },
  };
}
