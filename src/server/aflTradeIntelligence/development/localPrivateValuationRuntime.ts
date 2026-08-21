import type { Pool } from 'pg';

import { createPgAflOutcomeSqlClient } from '../outcomes/pgOutcomeSqlClient';
import { createPostgresAflTradePrivateEvaluationCohortRunner } from '../valuation/postgresCurrentValuationCohortRunner';
import { createPostgresGovernedPrivateEvaluationWorkspace } from '../valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '../valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';
import {
  PostgresAflTradePrivateValuationScheduleRepository,
  createPostgresAflTradePrivateValuationDispatcher,
} from '../valuation/postgresPrivateValuationScheduling';
import { createLocalAflTradePrivateDerivedArtifactRepository } from './localFileConditionalObjectStore';

const AUTOMATED_PRINCIPAL = 'system:weekly-valuation-coordinator';
const MAXIMUM_ARTIFACT_BYTES = 4 * 1024 * 1024;

export function createLocalAflTradePrivateValuationRuntime(input: {
  readonly pool: Pool;
  readonly artifactRoot: string;
  readonly workerId?: string;
}) {
  const client = createPgAflOutcomeSqlClient(input.pool);
  const artifacts = createLocalAflTradePrivateDerivedArtifactRepository({
    rootDirectory: input.artifactRoot,
    repositoryId: 'governed-private-evaluation',
    maximumObjectBytes: MAXIMUM_ARTIFACT_BYTES,
  });
  const workspace = createPostgresGovernedPrivateEvaluationWorkspace({
    client,
    artifactRepository: artifacts,
    maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
    principalId: AUTOMATED_PRINCIPAL,
    automatedPrincipalId: AUTOMATED_PRINCIPAL,
    authorizeReader: async () => false,
  });
  const runner = createPostgresAflTradePrivateEvaluationCohortRunner({
    client,
    workspace,
    batchRepository: new PostgresGovernedPrivateEvaluationBatchRepository(
      client,
      async () => false
    ),
    workerId: input.workerId,
  });
  return createPostgresAflTradePrivateValuationDispatcher({
    repository: new PostgresAflTradePrivateValuationScheduleRepository(client),
    runner,
    workerId: input.workerId,
  });
}
