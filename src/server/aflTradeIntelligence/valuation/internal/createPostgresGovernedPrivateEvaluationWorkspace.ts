import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '../../outcomes/postgresOutcomeReleaseRepository';
import { createGovernedPrivateEvaluationWorkspaceForInternalComposition } from './createGovernedPrivateEvaluationWorkspace';
import { createAutomatedGovernedPrivateEvaluationStagingService } from './automatedGovernedPrivateEvaluationStagingService';
import { authenticateGovernedPrivateEvaluationAuthorityInspection } from './governedPrivateEvaluationAuthoritySnapshot';
import { automatedGovernedPrivateEvaluationTransitionIntentSchema } from './governedPrivateEvaluationLifecycle';
import { createPostgresGovernedPrivateEvaluationExecutionService } from './postgresGovernedPrivateEvaluationExecutionService';
import { createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture } from './postgresGovernedPrivateEvaluationCalculationAuthority';
import { createPostgresGovernedPrivateEvaluationInspectionRepository } from './postgresGovernedPrivateEvaluationInspectionRepository';
import { createPostgresGovernedPrivateEvaluationLifecycleRepository } from './postgresGovernedPrivateEvaluationLifecycleRepository';
import { createPostgresGovernedPrivateEvaluationReadRepository } from './postgresGovernedPrivateEvaluationReadRepository';
import { createPostgresGovernedPrivateEvaluationReconstructionRepository } from './postgresGovernedPrivateEvaluationReconstructionRepository';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from './postgresGovernedPrivateEvaluationStagingRepository';
import { createPostgresGovernedPrivateEvaluationMaterializationReplay } from './postgresGovernedPrivateEvaluationMaterializationReplay';
import type { GovernedPrivateEvaluationReadRequest } from './governedPrivateEvaluationWorkspaceContracts';

export function createPostgresGovernedPrivateEvaluationWorkspace(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly principalId: string;
  readonly enableAutomatedPrivateCalculation?: true;
  readonly authorizeReader: (input: {
    readonly principalId: string;
    readonly selector: GovernedPrivateEvaluationReadRequest['selector'];
  }) => Promise<boolean>;
}) {
  if ('automatedPrincipalId' in dependencies) {
    throw new TypeError(
      'The PostgreSQL private evaluation workspace does not accept a caller-supplied automated principal.'
    );
  }
  const automatedCalculationEnabled =
    dependencies.enableAutomatedPrivateCalculation === true;
  const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
    ...(!automatedCalculationEnabled
      ? {}
      : { enableAutomatedPrivateCalculation: true as const }),
  });
  const lifecycle = createPostgresGovernedPrivateEvaluationLifecycleRepository({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
    ...(!automatedCalculationEnabled
      ? {}
      : { enableAutomatedPrivateCalculation: true as const }),
  });
  const captureCalculationAuthority =
    createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture({
      artifactRepository: dependencies.artifactRepository,
      maximumArtifactBytes: dependencies.maximumArtifactBytes,
    });
  const inspection = createPostgresGovernedPrivateEvaluationInspectionRepository({
    client: dependencies.client,
    retainArtifact: (artifact) => staging.retainArtifact(artifact),
    captureCalculationAuthority,
    validityMilliseconds: 5 * 60 * 1_000,
  });
  const read = createPostgresGovernedPrivateEvaluationReadRepository({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
    principalId: dependencies.principalId,
    authorizeReader: dependencies.authorizeReader,
  });
  const reconstruction = createPostgresGovernedPrivateEvaluationReconstructionRepository({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
    retainArtifact: (artifact) => staging.retainArtifact(artifact),
  });
  const execution = createPostgresGovernedPrivateEvaluationExecutionService({
    client: dependencies.client,
    principalId: dependencies.principalId,
    staging,
    lifecycle,
    reconstruction,
  });
  const replayMaterialization = createPostgresGovernedPrivateEvaluationMaterializationReplay({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
  });
  const automatedStaging =
    !automatedCalculationEnabled
      ? undefined
      : createAutomatedGovernedPrivateEvaluationStagingService({
          trustedNow: async () => {
            const result = await dependencies.client.query<{ readonly trusted_at: Date | string }>(
              `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
            );
            const value = result.rows[0]?.trusted_at;
            const parsed = value instanceof Date ? value : new Date(value ?? Number.NaN);
            if (result.rows.length !== 1 || !Number.isFinite(parsed.getTime())) {
              throw new TypeError('Automated private staging requires trusted PostgreSQL time.');
            }
            return parsed.toISOString();
          },
          loadStaged: async (operationId) => {
            const result = await dependencies.client.query<{
              readonly intent_json: unknown;
              readonly generation_id: string;
              readonly receipt_json: unknown;
            }>(
              `SELECT intent.intent_json,generation.generation_id,inspection.receipt_json
                 FROM outcome_private_evaluation_transition_intent intent
                 JOIN outcome_local_private_trade_evaluation_generation generation
                   ON generation.transition_intent_id=intent.transition_intent_id
                 JOIN outcome_private_evaluation_inspection_receipt inspection
                   ON inspection.inspection_id=intent.inspection_id
                WHERE intent.operation_id=$1`,
              [operationId]
            );
            if (result.rows.length > 1) {
              throw new TypeError('Automated private staging operation is not unique.');
            }
            if (result.rows[0] === undefined) return null;
            const intent = automatedGovernedPrivateEvaluationTransitionIntentSchema.parse(
              result.rows[0].intent_json
            );
            const inspection = result.rows[0].receipt_json as {
              readonly content?: { readonly lastTransitionId?: unknown };
            };
            const previousTransitionId = inspection.content?.lastTransitionId;
            if (previousTransitionId !== null && typeof previousTransitionId !== 'string') {
              throw new TypeError('Automated private staging lost its exact predecessor.');
            }
            return {
              selector: intent.content.selector,
              principalId: intent.content.constructionAuthority.principalId,
              generationId: result.rows[0].generation_id,
              intent,
              previousTransitionId,
            };
          },
          captureAuthority: async ({ selector }) => {
            const result = await inspection.inspect(selector);
            if (result.state === 'unavailable') return result;
            const retainedResult = await dependencies.client.query<{
              readonly snapshot_json: unknown;
              readonly receipt_json: unknown;
            }>(
              `SELECT snapshot.snapshot_json,inspection.receipt_json
                 FROM outcome_private_evaluation_inspection_receipt inspection
                 JOIN outcome_private_evaluation_authority_snapshot snapshot
                   ON snapshot.snapshot_id=inspection.snapshot_id
                WHERE inspection.inspection_id=$1`,
              [result.inspectionId]
            );
            if (retainedResult.rows.length !== 1) {
              throw new TypeError('Automated private staging lost its retained inspection.');
            }
            const retained = authenticateGovernedPrivateEvaluationAuthorityInspection({
              snapshot: retainedResult.rows[0]!.snapshot_json,
              inspection: retainedResult.rows[0]!.receipt_json,
            });
            const calculationAuthority = retained.inspection.content.calculationAuthority;
            if (
              retained.result.state !== 'ready' ||
              calculationAuthority.state !== 'ready' ||
              !('materializationManifestId' in calculationAuthority)
            ) {
              throw new TypeError('Automated private staging requires v3 calculation authority.');
            }
            return {
              state: 'ready' as const,
              selector: retained.result.selector,
              inspectionId: retained.inspection.inspectionId,
              authoritySnapshotId: retained.snapshot.snapshotId,
              validThrough: retained.result.validThrough,
              head: retained.result.head,
              previousTransitionId: retained.inspection.content.lastTransitionId,
              materializationManifestId: calculationAuthority.materializationManifestId,
            };
          },
          replayMaterialization,
          stage: (input) => staging.stage(input),
          retainArtifact: (input) => staging.retainArtifact(input),
          commit: (input) => lifecycle.commitAutomated(input),
        });

  return createGovernedPrivateEvaluationWorkspaceForInternalComposition({
    stageAutomated:
      automatedStaging === undefined
        ? undefined
        : (request) => automatedStaging.stage(request),
    inspect: (request) => inspection.inspect(request),
    execute: (request) => execution.execute(request),
    read: (request) => read.read(request),
  });
}
