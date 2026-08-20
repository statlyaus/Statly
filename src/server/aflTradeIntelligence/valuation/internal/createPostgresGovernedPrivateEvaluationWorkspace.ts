import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '../../outcomes/postgresOutcomeReleaseRepository';
import { createGovernedPrivateEvaluationWorkspaceForInternalComposition } from './createGovernedPrivateEvaluationWorkspace';
import { createPostgresGovernedPrivateEvaluationExecutionService } from './postgresGovernedPrivateEvaluationExecutionService';
import { createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture } from './postgresGovernedPrivateEvaluationCalculationAuthority';
import { createPostgresGovernedPrivateEvaluationInspectionRepository } from './postgresGovernedPrivateEvaluationInspectionRepository';
import { createPostgresGovernedPrivateEvaluationLifecycleRepository } from './postgresGovernedPrivateEvaluationLifecycleRepository';
import { createPostgresGovernedPrivateEvaluationReadRepository } from './postgresGovernedPrivateEvaluationReadRepository';
import { createPostgresGovernedPrivateEvaluationReconstructionRepository } from './postgresGovernedPrivateEvaluationReconstructionRepository';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from './postgresGovernedPrivateEvaluationStagingRepository';
import type { GovernedPrivateEvaluationReadRequest } from './governedPrivateEvaluationWorkspaceContracts';

export function createPostgresGovernedPrivateEvaluationWorkspace(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly principalId: string;
  readonly authorizeReader: (input: {
    readonly principalId: string;
    readonly selector: GovernedPrivateEvaluationReadRequest['selector'];
  }) => Promise<boolean>;
}) {
  const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
  });
  const lifecycle = createPostgresGovernedPrivateEvaluationLifecycleRepository({
    client: dependencies.client,
    artifactRepository: dependencies.artifactRepository,
    maximumArtifactBytes: dependencies.maximumArtifactBytes,
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

  return createGovernedPrivateEvaluationWorkspaceForInternalComposition({
    inspect: (request) => inspection.inspect(request),
    execute: (request) => execution.execute(request),
    read: (request) => read.read(request),
  });
}
