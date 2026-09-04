import { createHash } from 'node:crypto';

import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
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
import { aflTradeQualifiedCurrentValuationModelEvidenceResultSchema } from './currentValuationModelEvidence';
import {
  createAflTradeCurrentValuationTradePreparer,
  type AflTradeCurrentValuationTradePreparationDependencies,
} from './currentValuationTradePreparation';
import { PostgresGovernedPrivateEvaluationMaterializationManifestRepository } from './internal/postgresGovernedPrivateEvaluationMaterializationManifestRepository';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from './internal/postgresGovernedPrivateEvaluationStagingRepository';
import type { AflTradeCurrentPreparedValuationInputHead } from './postgresPreparedValuationInputSetStore';
import { PostgresAflTradePreparedValuationInputSetStore } from './postgresPreparedValuationInputSetStore';
import {
  aflTradePreparedValuationInputSetSchema,
  type AflTradePreparedValuationInputSet,
} from './preparedValuationInputSet';

type PublicCurrentValuationCohortConstructionContext = Extract<
  AflTradeCurrentValuationCohortConstructionContext,
  { readonly factualReleaseRevision: number }
>;
type PrivateCurrentValuationCohortConstructionContext = Extract<
  AflTradeCurrentValuationCohortConstructionContext,
  { readonly preparationAuthority: 'qualified_current_model_evidence' }
>;
type PersistedPublicCurrentValuationCohortConstructionContext = Extract<
  ReturnType<typeof aflTradePersistedCurrentValuationCohortConstructionContextSchema.parse>,
  { readonly factualReleaseRevision: number }
>;
const PRIVATE_EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

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

type QualifiedCurrentValuationModelEvidence = ReturnType<
  typeof aflTradeQualifiedCurrentValuationModelEvidenceResultSchema.parse
>;

interface PrivatePreparedAuthorityRow {
  readonly scope_key: string;
  readonly factual_release_scope_key: string;
  readonly factual_release_id: string;
  readonly factual_output_id: string;
  readonly hpn_calculation_id: string;
  readonly model_operation_id: string;
  readonly model_evidence_json: unknown;
}

interface PrivatePreparedAuthority {
  readonly requestId: string;
  readonly scopeKey: string;
  readonly factualReleaseScopeKey: string;
  readonly factualReleaseId: string;
  readonly factualOutputId: string;
  readonly hpnCalculationId: string;
  readonly modelOperationId: string;
  readonly modelEvidence: QualifiedCurrentValuationModelEvidence;
}

class PrivatePreparedAuthorityUnavailableError extends TypeError {}

export type AflTradePrivateCurrentValuationCohortConstructionEvidence = Pick<
  PrivateCurrentValuationCohortConstructionContext,
  | 'factualReleaseArtifact'
  | 'releaseMembershipArtifact'
  | 'releaseTradeIds'
  | 'valuationInputBundleId'
  | 'valuationInputBundleArtifact'
> & { readonly valuationInputBundle: AflTradeValuationInputBundle };

export type AflTradePrivateCurrentValuationInputBundleSelector = (input: {
  readonly transaction: AflOutcomeSqlTransaction;
  readonly requestId: string;
  readonly factualOutputId: string;
  readonly factualReleaseId: string;
  readonly modelEvidence: QualifiedCurrentValuationModelEvidence;
  readonly hpnCalculationId: string;
  readonly modelOperationId: string;
}) => Promise<string>;

type PrivatePreparedClaim = Readonly<{
  claimId: string;
  leaseToken: string;
}>;

function leaseTokenSha256(claim: PrivatePreparedClaim): string {
  return createHash('sha256').update(claim.leaseToken, 'utf8').digest('hex');
}

async function assertPrivatePreparedClaim(
  transaction: AflOutcomeSqlTransaction,
  requestId: string,
  claim: PrivatePreparedClaim
): Promise<void> {
  await transaction.query(
    `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
    [requestId, claim.claimId, leaseTokenSha256(claim)]
  );
}

async function loadPrivatePreparedAuthority(
  transaction: AflOutcomeSqlTransaction,
  requestId: string
): Promise<PrivatePreparedAuthority | null> {
  const result = await transaction.query<PrivatePreparedAuthorityRow>(
    `SELECT scope_key,factual_release_scope_key,factual_release_id,factual_output_id,
            hpn_calculation_id,model_operation_id,model_evidence_json
       FROM load_outcome_private_prepared_v3_authority($1)`,
    [requestId]
  );
  if (result.rows.length > 1) {
    throw new TypeError('Private prepared-v3 authority is ambiguous.');
  }
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    requestId,
    scopeKey: row.scope_key,
    factualReleaseScopeKey: row.factual_release_scope_key,
    factualReleaseId: row.factual_release_id,
    factualOutputId: row.factual_output_id,
    hpnCalculationId: row.hpn_calculation_id,
    modelOperationId: row.model_operation_id,
    modelEvidence: aflTradeQualifiedCurrentValuationModelEvidenceResultSchema.parse(
      row.model_evidence_json
    ),
  };
}

async function loadSelectedPrivateValuationInputBundleId(
  transaction: AflOutcomeSqlTransaction,
  authority: PrivatePreparedAuthority,
  selectValuationInputBundleId: AflTradePrivateCurrentValuationInputBundleSelector
): Promise<string> {
  return aflTradeContentAddressedIdSchema('valuation-input-bundle').parse(
    await selectValuationInputBundleId({
      transaction,
      requestId: authority.requestId,
      factualOutputId: authority.factualOutputId,
      factualReleaseId: authority.factualReleaseId,
      modelEvidence: authority.modelEvidence,
      hpnCalculationId: authority.hpnCalculationId,
      modelOperationId: authority.modelOperationId,
    })
  );
}

function privateContextMatchesAuthority(
  context: PrivateCurrentValuationCohortConstructionContext,
  authority: PrivatePreparedAuthority
): boolean {
  return (
    context.scopeKey === authority.scopeKey &&
    context.factualReleaseScopeKey === authority.factualReleaseScopeKey &&
    context.factualReleaseId === authority.factualReleaseId &&
    context.dispatchAuthority.requestId === authority.requestId &&
    context.dispatchAuthority.factualOutputId === authority.factualOutputId &&
    context.dispatchAuthority.hpnCalculationId === authority.hpnCalculationId &&
    context.dispatchAuthority.modelOperationId === authority.modelOperationId &&
    canonicalizeAflTradeJson(context.modelEvidence) ===
      canonicalizeAflTradeJson(authority.modelEvidence)
  );
}

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

async function loadPrivateHead(
  transaction: AflOutcomeSqlTransaction,
  scopeKey: string
): Promise<AflTradeCurrentPreparedValuationInputHead | null> {
  const result = await transaction.query<PreparedHeadRow>(
    `SELECT scope_key,prepared_input_set_id,revision,activated_at
       FROM load_outcome_private_current_prepared_valuation_input_head($1)`,
    [scopeKey]
  );
  if (result.rows.length > 1) {
    throw new TypeError('Current private prepared cohort head is not unique.');
  }
  return result.rows[0] === undefined ? null : head(result.rows[0]);
}

interface PreparedSetJsonRow {
  readonly prepared_set_json: unknown;
}

export async function loadPostgresAflTradePrivateCurrentPreparedValuationCohort(input: {
  readonly client: AflOutcomeSqlClient;
  readonly requestId: string;
  readonly claim: PrivatePreparedClaim;
  readonly selectValuationInputBundleId: AflTradePrivateCurrentValuationInputBundleSelector;
}): Promise<AflTradeCurrentValuationCohortPreparationResult | null> {
  return input.client.transaction(async (transaction) => {
    await transaction.query(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
    await transaction.query(`SET LOCAL ROLE ${PRIVATE_EXECUTION_DATABASE_ROLE}`);
    await assertPrivatePreparedClaim(transaction, input.requestId, input.claim);
    const authority = await loadPrivatePreparedAuthority(transaction, input.requestId);
    if (authority === null) return null;
    const current = await loadPrivateHead(transaction, authority.scopeKey);
    if (current === null) return null;
    const valuationInputBundleId = await loadSelectedPrivateValuationInputBundleId(
      transaction,
      authority,
      input.selectValuationInputBundleId
    );
    const result = await transaction.query<PreparedSetJsonRow>(
      `SELECT prepared.prepared_set_json
         FROM outcome_current_valuation_cohort_operation operation
         JOIN outcome_current_valuation_cohort_operation_result retained
           ON retained.operation_id=operation.operation_id
          AND retained.prepared_input_set_id=$2
          AND retained.head_revision=$3
         JOIN outcome_prepared_valuation_input_set prepared
           ON prepared.prepared_input_set_id=retained.prepared_input_set_id
        WHERE operation.scope_key=$1
          AND operation.preparation_authority='qualified_current_model_evidence'
          AND operation.dispatch_request_id=$4
          AND operation.current_model_evidence_operation_id=$5
          AND operation.valuation_input_bundle_id=$6`,
      [
        authority.scopeKey,
        current.preparedInputSetId,
        current.revision,
        input.requestId,
        authority.modelEvidence.operationId,
        valuationInputBundleId,
      ]
    );
    if (result.rows.length > 1) {
      throw new TypeError('Current private prepared-v3 custody is ambiguous.');
    }
    const row = result.rows[0];
    if (row === undefined) return null;
    const preparedInputSet = aflTradePreparedValuationInputSetSchema.parse(row.prepared_set_json);
    const content = preparedInputSet.content;
    if (
      content.schemaVersion !== 'afl-trade-prepared-valuation-input-set/v3' ||
      content.preparationAuthority !== 'qualified_current_model_evidence' ||
      content.scopeKey !== authority.scopeKey ||
      content.factualReleaseScopeKey !== authority.factualReleaseScopeKey ||
      content.factualReleaseId !== authority.factualReleaseId ||
      content.dispatchAuthority.requestId !== input.requestId ||
      content.dispatchAuthority.factualOutputId !== authority.factualOutputId ||
      content.dispatchAuthority.hpnCalculationId !== authority.hpnCalculationId ||
      content.dispatchAuthority.modelOperationId !== authority.modelOperationId ||
      content.valuationInputBundleId !== valuationInputBundleId ||
      canonicalizeAflTradeJson(content.modelEvidence) !==
        canonicalizeAflTradeJson(authority.modelEvidence)
    ) {
      return null;
    }
    await assertPrivatePreparedClaim(transaction, input.requestId, input.claim);
    return { state: 'already_current', preparedInputSet, head: current };
  });
}

export function createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly selectValuationInputBundleId: AflTradePrivateCurrentValuationInputBundleSelector;
  readonly loadConstructionEvidence: (input: {
    readonly transaction: AflOutcomeSqlTransaction;
    readonly requestId: string;
    readonly factualOutputId: string;
    readonly factualReleaseId: string;
    readonly capturedAt: string;
    readonly modelEvidence: QualifiedCurrentValuationModelEvidence;
    readonly hpnCalculationId: string;
    readonly modelOperationId: string;
  }) => Promise<AflTradePrivateCurrentValuationCohortConstructionEvidence>;
}) {
  return async function capture(input: {
    readonly requestId: string;
    readonly claim: PrivatePreparedClaim;
  }): Promise<PrivateCurrentValuationCohortConstructionContext> {
    return dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
      await transaction.query(`SET LOCAL ROLE ${PRIVATE_EXECUTION_DATABASE_ROLE}`);
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `private-current-valuation-cohort-capture:${input.requestId}`,
      ]);
      await assertPrivatePreparedClaim(transaction, input.requestId, input.claim);
      const authority = await loadPrivatePreparedAuthority(transaction, input.requestId);
      if (authority === null) {
        throw new PrivatePreparedAuthorityUnavailableError(
          'Private cohort capture requires exact qualified current model evidence.'
        );
      }
      const currentHead = await loadPrivateHead(transaction, authority.scopeKey);
      const valuationInputBundleId = await loadSelectedPrivateValuationInputBundleId(
        transaction,
        authority,
        dependencies.selectValuationInputBundleId
      );
      const retained = await transaction.query<CohortOperationRow>(
        `SELECT context_json
           FROM outcome_current_valuation_cohort_operation
          WHERE preparation_authority='qualified_current_model_evidence'
            AND dispatch_request_id=$1
            AND current_model_evidence_operation_id=$2
            AND expected_prepared_input_revision=$3
            AND valuation_input_bundle_id=$4`,
        [
          input.requestId,
          authority.modelEvidence.operationId,
          currentHead?.revision ?? 0,
          valuationInputBundleId,
        ]
      );
      if (retained.rows.length > 1) {
        throw new TypeError('Private cohort capture replay is ambiguous.');
      }
      if (retained.rows[0] !== undefined) {
        const persisted = aflTradePersistedCurrentValuationCohortConstructionContextSchema.parse(
          retained.rows[0].context_json
        );
        if (
          !('modelEvidence' in persisted) ||
          !privateContextMatchesAuthority(persisted, authority)
        ) {
          throw new TypeError('Private cohort capture replay lost exact current authority.');
        }
        await assertPrivatePreparedClaim(transaction, input.requestId, input.claim);
        const { valuationInputBundle: _retainedBundle, ...context } = persisted;
        return aflTradeCurrentValuationCohortConstructionContextSchema.parse(
          context
        ) as PrivateCurrentValuationCohortConstructionContext;
      }
      const trusted = await transaction.query<TrustedTimeRow>(
        `SELECT date_trunc('milliseconds',transaction_timestamp()) AS captured_at`
      );
      if (trusted.rows.length !== 1) {
        throw new TypeError('Private cohort capture requires trusted PostgreSQL time.');
      }
      const capturedAt = timestamp(trusted.rows[0]!.captured_at);
      const evidence = await dependencies.loadConstructionEvidence({
        transaction,
        requestId: input.requestId,
        factualOutputId: authority.factualOutputId,
        factualReleaseId: authority.factualReleaseId,
        capturedAt,
        modelEvidence: authority.modelEvidence,
        hpnCalculationId: authority.hpnCalculationId,
        modelOperationId: authority.modelOperationId,
      });
      if (evidence.valuationInputBundleId !== valuationInputBundleId) {
        throw new TypeError(
          'Private cohort construction evidence does not match the selected valuation input bundle.'
        );
      }
      const dispatchAuthority = {
        requestId: input.requestId,
        factualOutputId: authority.factualOutputId,
        hpnCalculationId: authority.hpnCalculationId,
        modelOperationId: authority.modelOperationId,
      } as const;
      const operationId = createAflTradePrivateCurrentValuationCohortPreparationOperationId({
        scopeKey: authority.scopeKey,
        factualReleaseId: authority.factualReleaseId,
        modelEvidence: authority.modelEvidence,
        dispatchAuthority,
        valuationInputBundleId: evidence.valuationInputBundleId,
        expectedPreparedInputRevision: currentHead?.revision ?? 0,
      });
      const persistedContext =
        aflTradePersistedCurrentValuationCohortConstructionContextSchema.parse({
          operationId,
          scopeKey: authority.scopeKey,
          factualReleaseScopeKey: authority.factualReleaseScopeKey,
          factualReleaseId: authority.factualReleaseId,
          factualReleaseArtifact: evidence.factualReleaseArtifact,
          releaseMembershipArtifact: evidence.releaseMembershipArtifact,
          releaseTradeIds: evidence.releaseTradeIds,
          preparationAuthority: 'qualified_current_model_evidence',
          modelEvidence: authority.modelEvidence,
          dispatchAuthority,
          expectedPreparedInputRevision: currentHead?.revision ?? 0,
          valuationInputBundleId: evidence.valuationInputBundleId,
          valuationInputBundleArtifact: evidence.valuationInputBundleArtifact,
          valuationInputBundle: evidence.valuationInputBundle,
          capturedAt,
        });
      if (!('modelEvidence' in persistedContext)) {
        throw new TypeError('Private cohort capture resolved to public authority.');
      }
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        operationId,
      ]);
      const canonicalContext = canonicalizeAflTradeJson(persistedContext);
      await transaction.query(
        `INSERT INTO outcome_current_valuation_cohort_operation
          (operation_id,scope_key,factual_release_id,factual_release_revision,
           model_qualification_id,model_qualification_work_id,model_qualification_revision,
           expected_prepared_input_revision,captured_at,context_sha256,
           context_canonical_json,context_json,preparation_authority,
           current_model_evidence_operation_id,dispatch_request_id,factual_output_id,
           hpn_calculation_id,model_operation_id,valuation_input_bundle_id)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (operation_id) DO NOTHING`,
        [
          operationId,
          persistedContext.scopeKey,
          persistedContext.factualReleaseId,
          persistedContext.modelEvidence.qualificationId,
          persistedContext.modelEvidence.qualificationWorkId,
          persistedContext.modelEvidence.modelRevision,
          persistedContext.expectedPreparedInputRevision,
          persistedContext.capturedAt,
          sha256AflTradeCanonicalJson(persistedContext),
          canonicalContext,
          canonicalContext,
          persistedContext.preparationAuthority,
          persistedContext.modelEvidence.operationId,
          persistedContext.dispatchAuthority.requestId,
          persistedContext.dispatchAuthority.factualOutputId,
          persistedContext.dispatchAuthority.hpnCalculationId,
          persistedContext.dispatchAuthority.modelOperationId,
          persistedContext.valuationInputBundleId,
        ]
      );
      const registered = await transaction.query<CohortOperationRow>(
        `SELECT context_json FROM outcome_current_valuation_cohort_operation
          WHERE operation_id=$1`,
        [operationId]
      );
      if (
        registered.rows.length !== 1 ||
        canonicalizeAflTradeJson(registered.rows[0]!.context_json) !== canonicalContext
      ) {
        throw new TypeError('Private cohort operation replay conflicts with retained authority.');
      }
      await assertPrivatePreparedClaim(transaction, input.requestId, input.claim);
      const { valuationInputBundle: _retainedBundle, ...context } = persistedContext;
      return aflTradeCurrentValuationCohortConstructionContextSchema.parse(
        context
      ) as PrivateCurrentValuationCohortConstructionContext;
    });
  };
}

interface PublicCohortCaptureDependencies {
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
}

interface PublicCohortAuthority {
  readonly capturedAt: string;
  readonly activeRelease: ActiveReleaseRow;
  readonly currentModel: CurrentModelPairRow & { readonly work_id: string };
  readonly expectedPreparedInputRevision: number;
}

async function loadRetainedPublicCohortContext(
  transaction: AflOutcomeSqlTransaction,
  request: AflTradeCurrentValuationCohortPreparationRequest
): Promise<PublicCurrentValuationCohortConstructionContext | null> {
  const retainedOperation = await transaction.query<CohortOperationRow>(
    `SELECT context_json
       FROM outcome_current_valuation_cohort_operation
      WHERE operation_id=$1 FOR KEY SHARE`,
    [request.operationId]
  );
  if (retainedOperation.rows.length > 1) {
    throw new TypeError('Current cohort operation identity is not unique.');
  }
  if (retainedOperation.rows[0] === undefined) return null;
  const retained = constructionContextFromPersisted(retainedOperation.rows[0].context_json);
  if (retained.operationId !== request.operationId || retained.scopeKey !== request.scopeKey) {
    throw new TypeError('Current cohort operation replay conflicts with retained authority.');
  }
  if (!('factualReleaseRevision' in retained)) {
    throw new TypeError('Public cohort operation replay resolved to private authority.');
  }
  return retained;
}

async function loadPublicCohortAuthority(
  transaction: AflOutcomeSqlTransaction,
  dependencies: PublicCohortCaptureDependencies,
  request: AflTradeCurrentValuationCohortPreparationRequest
): Promise<PublicCohortAuthority> {
  const trusted = await transaction.query<TrustedTimeRow>(
    `SELECT date_trunc('milliseconds',transaction_timestamp()) AS captured_at`
  );
  if (trusted.rows.length !== 1) {
    throw new TypeError('Current cohort capture requires trusted PostgreSQL time.');
  }
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
  const expectedPreparedInputRevision = currentHead?.revision ?? 0;
  const expectedOperationId = createAflTradeCurrentValuationCohortPreparationOperationId({
    scopeKey: request.scopeKey,
    factualReleaseId: activeRelease.release_id,
    factualReleaseRevision: activeRelease.revision,
    modelQualificationId: currentModel.qualification_id,
    modelQualificationWorkId: currentModel.work_id,
    modelQualificationRevision: currentModel.revision,
    expectedPreparedInputRevision,
  });
  if (request.operationId !== expectedOperationId) {
    throw new TypeError(
      'Current cohort operation identity does not match its captured release, model, and head authority.'
    );
  }
  return {
    capturedAt: timestamp(trusted.rows[0]!.captured_at),
    activeRelease,
    currentModel: { ...currentModel, work_id: currentModel.work_id },
    expectedPreparedInputRevision,
  };
}

async function buildPublicCohortContext(
  transaction: AflOutcomeSqlTransaction,
  dependencies: PublicCohortCaptureDependencies,
  request: AflTradeCurrentValuationCohortPreparationRequest,
  authority: PublicCohortAuthority
): Promise<PersistedPublicCurrentValuationCohortConstructionContext> {
  const { activeRelease, capturedAt, currentModel, expectedPreparedInputRevision } = authority;
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
  const persisted = aflTradePersistedCurrentValuationCohortConstructionContextSchema.parse({
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
    expectedPreparedInputRevision,
    capturedAt,
    ...evidence,
  });
  if (!('factualReleaseRevision' in persisted)) {
    throw new TypeError('Public cohort capture resolved to private authority.');
  }
  return persisted;
}

async function registerPublicCohortContext(
  transaction: AflOutcomeSqlTransaction,
  persistedContext: PersistedPublicCurrentValuationCohortConstructionContext
): Promise<PublicCurrentValuationCohortConstructionContext> {
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
    [persistedContext.operationId]
  );
  if (
    retained.rows.length !== 1 ||
    canonicalizeAflTradeJson(retained.rows[0]!.context_json) !== canonicalContext
  ) {
    throw new TypeError('Current cohort operation registration conflicts with retained authority.');
  }
  const context = constructionContextFromPersisted(persistedContext);
  if (!('factualReleaseRevision' in context)) {
    throw new TypeError('Public cohort capture context resolved to private authority.');
  }
  return context;
}

export function createPostgresAflTradeCurrentValuationCohortAuthorityCapture(
  dependencies: PublicCohortCaptureDependencies
) {
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
      const retained = await loadRetainedPublicCohortContext(transaction, request);
      if (retained !== null) return retained;
      const authority = await loadPublicCohortAuthority(transaction, dependencies, request);
      const context = await buildPublicCohortContext(transaction, dependencies, request, authority);
      return registerPublicCohortContext(transaction, context);
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
    if (!('factualReleaseRevision' in input.context)) {
      throw new TypeError('Public cohort commit requires factual-release authority.');
    }
    const context = input.context;
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
  readonly selectValuationInputBundleId: AflTradePrivateCurrentValuationInputBundleSelector;
  readonly registerPreparedInputSet: (
    prepared: AflTradePreparedValuationInputSet
  ) => Promise<AflTradePreparedValuationInputSet>;
}) {
  return async function commit(input: {
    readonly requestId: string;
    readonly claim: PrivatePreparedClaim;
    readonly context: PrivateCurrentValuationCohortConstructionContext;
    readonly preparedInputSet: AflTradePreparedValuationInputSet;
  }): Promise<AflTradeCurrentValuationCohortPreparationResult> {
    const authorityIsCurrent = await dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
      await transaction.query(`SET LOCAL ROLE ${PRIVATE_EXECUTION_DATABASE_ROLE}`);
      await assertPrivatePreparedClaim(transaction, input.requestId, input.claim);
      const authority = await loadPrivatePreparedAuthority(transaction, input.requestId);
      const valuationInputBundleId =
        authority === null
          ? null
          : await loadSelectedPrivateValuationInputBundleId(
              transaction,
              authority,
              dependencies.selectValuationInputBundleId
            );
      return (
        authority !== null &&
        valuationInputBundleId === input.context.valuationInputBundleId &&
        input.context.operationId ===
          createAflTradePrivateCurrentValuationCohortPreparationOperationId({
            scopeKey: input.context.scopeKey,
            factualReleaseId: input.context.factualReleaseId,
            modelEvidence: input.context.modelEvidence,
            dispatchAuthority: input.context.dispatchAuthority,
            valuationInputBundleId: input.context.valuationInputBundleId,
            expectedPreparedInputRevision: input.context.expectedPreparedInputRevision,
          }) &&
        privateContextMatchesAuthority(input.context, authority)
      );
    });
    if (!authorityIsCurrent) {
      return {
        state: 'stale_authority',
        reason: 'The qualified private dispatch authority changed during preparation.',
      };
    }

    const registered = await dependencies.registerPreparedInputSet(input.preparedInputSet);
    if (canonicalizeAflTradeJson(registered) !== canonicalizeAflTradeJson(input.preparedInputSet)) {
      throw new TypeError(
        'Private prepared cohort registration changed its authenticated identity.'
      );
    }

    return dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
      await transaction.query(`SET LOCAL ROLE ${PRIVATE_EXECUTION_DATABASE_ROLE}`);
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        input.context.operationId,
      ]);
      await assertPrivatePreparedClaim(transaction, input.requestId, input.claim);
      const authority = await loadPrivatePreparedAuthority(transaction, input.requestId);
      const valuationInputBundleId =
        authority === null
          ? null
          : await loadSelectedPrivateValuationInputBundleId(
              transaction,
              authority,
              dependencies.selectValuationInputBundleId
            );
      if (
        authority === null ||
        valuationInputBundleId !== input.context.valuationInputBundleId ||
        !privateContextMatchesAuthority(input.context, authority)
      ) {
        return {
          state: 'stale_authority',
          reason: 'The qualified private dispatch authority changed during commit.',
        };
      }

      const retainedResult = await transaction.query<CohortOperationResultRow>(
        `SELECT prepared_input_set_id,head_revision
           FROM outcome_current_valuation_cohort_operation_result
          WHERE operation_id=$1`,
        [input.context.operationId]
      );
      const current = await loadPrivateHead(transaction, input.context.scopeKey);
      if (retainedResult.rows[0] !== undefined) {
        if (
          retainedResult.rows.length !== 1 ||
          retainedResult.rows[0].prepared_input_set_id !== registered.preparedInputSetId ||
          current?.preparedInputSetId !== registered.preparedInputSetId ||
          current.revision !== retainedResult.rows[0].head_revision
        ) {
          return {
            state: 'stale_authority',
            reason: 'The retained private cohort result is no longer current.',
          };
        }
        await assertPrivatePreparedClaim(transaction, input.requestId, input.claim);
        return {
          state: 'already_current',
          preparedInputSet: registered,
          head: current,
        };
      }
      if (current?.preparedInputSetId === registered.preparedInputSetId) {
        throw new TypeError(
          'A current private prepared cohort lacks exact operation-result custody.'
        );
      }
      if ((current?.revision ?? 0) !== input.context.expectedPreparedInputRevision) {
        return {
          state: 'stale_authority',
          reason: 'The prepared cohort head changed during private preparation.',
        };
      }

      await assertPrivatePreparedClaim(transaction, input.requestId, input.claim);
      await transaction.query(
        `SELECT activate_outcome_private_current_prepared_valuation_input_set($1,$2,$3)`,
        [
          input.context.scopeKey,
          registered.preparedInputSetId,
          input.context.expectedPreparedInputRevision,
        ]
      );
      const activated = await loadPrivateHead(transaction, input.context.scopeKey);
      if (
        activated === null ||
        activated.preparedInputSetId !== registered.preparedInputSetId ||
        activated.revision !== input.context.expectedPreparedInputRevision + 1
      ) {
        throw new TypeError(
          'Private prepared cohort activation returned an unexpected current head.'
        );
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
      return {
        state: 'advanced',
        preparedInputSet: registered,
        head: activated,
      };
    });
  };
}

export function createPostgresAflTradeCurrentValuationCohortCoordinator(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly factualReleaseScopeKey: string;
  readonly maximumConcurrency?: number;
  readonly loadConstructionEvidence: Parameters<
    typeof createPostgresAflTradeCurrentValuationCohortAuthorityCapture
  >[0]['loadConstructionEvidence'];
  readonly constructTrade: AflTradeCurrentValuationTradePreparationDependencies['construct'];
}) {
  const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
  });
  const manifests = new PostgresGovernedPrivateEvaluationMaterializationManifestRepository(
    dependencies.client
  );
  const preparedSets = new PostgresAflTradePreparedValuationInputSetStore(dependencies.client);
  const tradePreparer = createAflTradeCurrentValuationTradePreparer({
    construct: dependencies.constructTrade,
    retainArtifact: (artifact) => staging.retainArtifact(artifact),
    registerManifest: (manifest) => manifests.register(manifest),
  });
  return createAflTradeCurrentValuationCohortCoordinator({
    ...(dependencies.maximumConcurrency === undefined
      ? {}
      : { maximumConcurrency: dependencies.maximumConcurrency }),
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

export function createPostgresAflTradePrivateCurrentValuationCohortCoordinator(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly maximumConcurrency?: number;
  readonly selectValuationInputBundleId: AflTradePrivateCurrentValuationInputBundleSelector;
  readonly loadConstructionEvidence: Parameters<
    typeof createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture
  >[0]['loadConstructionEvidence'];
  readonly constructTrade: AflTradeCurrentValuationTradePreparationDependencies['construct'];
}) {
  const capture = createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture({
    client: dependencies.client,
    selectValuationInputBundleId: dependencies.selectValuationInputBundleId,
    loadConstructionEvidence: dependencies.loadConstructionEvidence,
  });
  const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
  });
  const manifests = new PostgresGovernedPrivateEvaluationMaterializationManifestRepository(
    dependencies.client
  );
  const preparedSets = new PostgresAflTradePreparedValuationInputSetStore(dependencies.client);
  const tradePreparer = createAflTradeCurrentValuationTradePreparer({
    construct: dependencies.constructTrade,
    retainArtifact: (artifact) => staging.retainArtifact(artifact),
    registerManifest: (manifest) => manifests.register(manifest),
  });
  const commit = createPostgresAflTradePrivateCurrentValuationCohortCommitter({
    client: dependencies.client,
    selectValuationInputBundleId: dependencies.selectValuationInputBundleId,
    registerPreparedInputSet: (prepared) => preparedSets.register(prepared),
  });

  return {
    async prepare(input: {
      readonly requestId: string;
      readonly claim: PrivatePreparedClaim;
    }): Promise<AflTradeCurrentValuationCohortPreparationResult> {
      try {
        const current = await loadPostgresAflTradePrivateCurrentPreparedValuationCohort({
          client: dependencies.client,
          requestId: input.requestId,
          claim: input.claim,
          selectValuationInputBundleId: dependencies.selectValuationInputBundleId,
        });
        if (current !== null) return current;

        const context = await capture(input);
        const coordinator = createAflTradeCurrentValuationCohortCoordinator({
          ...(dependencies.maximumConcurrency === undefined
            ? {}
            : { maximumConcurrency: dependencies.maximumConcurrency }),
          captureCurrent: async () => context,
          prepareTrade: (preparation) => tradePreparer.prepare(preparation),
          commitIfCurrent: ({ context: unparsedContext, preparedInputSet }) => {
            const parsedContext =
              aflTradeCurrentValuationCohortConstructionContextSchema.parse(unparsedContext);
            if (!('modelEvidence' in parsedContext)) {
              throw new TypeError(
                'Private prepared cohort resolved to public construction authority.'
              );
            }
            return commit({
              requestId: input.requestId,
              claim: input.claim,
              context: parsedContext,
              preparedInputSet,
            });
          },
        });
        return coordinator.prepare({
          operationId: context.operationId,
          scopeKey: context.scopeKey,
        });
      } catch (error) {
        if (error instanceof PrivatePreparedAuthorityUnavailableError) {
          return {
            state: 'stale_authority',
            reason: error.message,
          };
        }
        throw error;
      }
    },
  };
}
