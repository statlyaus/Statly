import {
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
import {
  createAflTradeCurrentValuationTradePreparer,
  type AflTradeCurrentValuationTradePreparationDependencies,
} from './currentValuationTradePreparation';
import { PostgresGovernedPrivateEvaluationMaterializationManifestRepository } from './internal/postgresGovernedPrivateEvaluationMaterializationManifestRepository';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from './internal/postgresGovernedPrivateEvaluationStagingRepository';
import type {
  AflTradeCurrentPreparedValuationInputHead,
} from './postgresPreparedValuationInputSetStore';
import { PostgresAflTradePreparedValuationInputSetStore } from './postgresPreparedValuationInputSetStore';
import type { AflTradePreparedValuationInputSet } from './preparedValuationInputSet';

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
  AflTradeCurrentValuationCohortConstructionContext,
  | 'factualReleaseArtifact'
  | 'releaseMembershipArtifact'
  | 'releaseTradeIds'
  | 'sourceQualificationReportId'
  | 'sourceQualificationReportArtifact'
  | 'sourceQualificationEvidenceRefs'
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

export function createPostgresAflTradeCurrentValuationCohortAuthorityCapture(
  dependencies: {
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
) {
  if (dependencies.factualReleaseScopeKey.trim() === '') {
    throw new TypeError('Current cohort capture requires a factual release scope.');
  }
  return async function capture(
    request: AflTradeCurrentValuationCohortPreparationRequest
  ): Promise<AflTradeCurrentValuationCohortConstructionContext> {
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
        const retained = constructionContextFromPersisted(
          retainedOperation.rows[0].context_json
        );
        if (retained.operationId !== request.operationId || retained.scopeKey !== request.scopeKey) {
          throw new TypeError('Current cohort operation replay conflicts with retained authority.');
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
      const expectedOperationId =
        createAflTradeCurrentValuationCohortPreparationOperationId({
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
      const context = constructionContextFromPersisted(persistedContext);
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
        throw new TypeError('Current cohort operation registration conflicts with retained authority.');
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
        [input.context.operationId]
      );
      const release = await transaction.query<ActiveReleaseRow>(
        `SELECT release_id,revision FROM outcome_active_release
          WHERE scope_key=$1 FOR KEY SHARE`,
        [input.context.factualReleaseScopeKey]
      );
      if (
        release.rows.length !== 1 ||
        release.rows[0]!.release_id !== input.context.factualReleaseId ||
        release.rows[0]!.revision !== input.context.factualReleaseRevision
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
        [input.context.scopeKey]
      );
      if (
        model.rows.length !== 1 ||
        model.rows[0]!.revision !== input.context.modelQualificationRevision ||
        model.rows[0]!.qualification_id !== input.context.modelQualificationId ||
        model.rows[0]!.work_id !== input.context.modelQualificationWorkId ||
        model.rows[0]!.player_run_id !== input.context.playerRunId ||
        model.rows[0]!.pick_run_id !== input.context.pickRunId
      ) {
        return {
          state: 'stale_authority',
          reason: 'The qualified model pair changed while the cohort was being prepared.',
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
            reason: 'The retained cohort operation result is no longer the current head.',
          };
        }
        return { state: 'already_current', preparedInputSet: registered, head: current };
      }
      if (current?.preparedInputSetId === registered.preparedInputSetId) {
        throw new TypeError('A current prepared cohort lacks its exact operation result custody.');
      }
      if ((current?.revision ?? 0) !== input.context.expectedPreparedInputRevision) {
        return {
          state: 'stale_authority',
          reason: 'The prepared cohort head changed while the cohort was being prepared.',
        };
      }
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
        throw new TypeError('Prepared cohort activation returned an unexpected current head.');
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
  const preparedSets = new PostgresAflTradePreparedValuationInputSetStore(
    dependencies.client
  );
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
