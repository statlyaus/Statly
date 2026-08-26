import type { Pool } from 'pg';

import { createAflTradeAdmittedPlayerContributionExecutor } from '../modeling/admittedPlayerContributionCandidate';
import { AflTradeAdmittedModelRunner } from '../modeling/admittedModelRunAuthority';
import { createPgAflOutcomeSqlClient } from '../outcomes/pgOutcomeSqlClient';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../valuation/automatedPrivateEvaluationPolicy';
import { createPostgresAflTradePrivateCurrentValuationCohortCoordinator } from '../valuation/postgresCurrentValuationCohortPreparation';
import { createPostgresAflTradePrivateEvaluationCohortRunner } from '../valuation/postgresCurrentValuationCohortRunner';
import { createPostgresGovernedPrivateEvaluationWorkspace } from '../valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '../valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';
import {
  createAflTradeDispatchBoundAdmittedPlayerExecutor,
  createPostgresAflTradePrivateValuationModelPairDispatchRunner,
} from '../valuation/postgresPrivateValuationModelPair';
import {
  PostgresAflTradePrivateValuationScheduleRepository,
  createPostgresAflTradePrivateValuationDispatcher,
} from '../valuation/postgresPrivateValuationScheduling';
import { createLocalAflTradePrivateDerivedArtifactRepository } from './localFileConditionalObjectStore';
import { createLocalAflTradePostgresAdmittedPlayerAuthority } from './localPostgresAdmittedPlayerAuthority';

const MAXIMUM_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MISSING_ADMITTED_PLAYER_CONFIGURATION =
  'Local private valuation execution is not configured: an admitted player composition or dispatch-bound player adapter is required.';

type LocalPrivateValuationUpstream = Omit<
  Parameters<typeof createPostgresAflTradePrivateValuationModelPairDispatchRunner>[0],
  'client' | 'continueQualified' | 'repairCurrent' | 'playerExecutor'
> &
  Readonly<{
    readonly playerExecutor?: Parameters<
      typeof createPostgresAflTradePrivateValuationModelPairDispatchRunner
    >[0]['playerExecutor'];
    readonly admittedPlayer?: Omit<
      Parameters<typeof createAflTradeDispatchBoundAdmittedPlayerExecutor>[0],
      'admittedRunner'
    > & {
      readonly authority: ConstructorParameters<typeof AflTradeAdmittedModelRunner>[0];
      readonly authorizationStore: ConstructorParameters<typeof AflTradeAdmittedModelRunner>[2];
      readonly clock: ConstructorParameters<typeof AflTradeAdmittedModelRunner>[3];
      readonly completedRunStore: ConstructorParameters<typeof AflTradeAdmittedModelRunner>[4];
      readonly failureRecorder: ConstructorParameters<typeof AflTradeAdmittedModelRunner>[5];
      readonly postgresAuthority?: Parameters<
        typeof createLocalAflTradePostgresAdmittedPlayerAuthority
      >[0];
    };
  }> &
  Omit<
    Parameters<typeof createPostgresAflTradePrivateCurrentValuationCohortCoordinator>[0],
    'client' | 'artifactRepository' | 'maximumArtifactBytes'
  >;

export function createLocalAflTradePrivateValuationRuntime(input: {
  readonly pool: Pool;
  readonly artifactRoot: string;
  readonly workerId?: string;
  readonly upstream?: LocalPrivateValuationUpstream;
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
    principalId: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
    enableAutomatedPrivateCalculation: true,
    authorizeReader: async () => false,
  });
  const cohortRunner = createPostgresAflTradePrivateEvaluationCohortRunner({
    client,
    workspace,
    batchRepository: new PostgresGovernedPrivateEvaluationBatchRepository(
      client,
      async () => false
    ),
    workerId: input.workerId,
  });
  const dispatchRunner =
    input.upstream === undefined
      ? {
          run: async () => {
            throw new TypeError(
              'Local private valuation execution is not configured: admitted player execution, governed pick execution, model qualification, model targets, HPN preparation, and prepared-cohort construction adapters are required.'
            );
          },
          repairCurrent: (scopeKey: string, reason: string, repairOperationId: string) =>
            cohortRunner.repairCurrent(scopeKey, reason, repairOperationId),
        }
      : (() => {
          const admittedPlayer =
            input.upstream.admittedPlayer === undefined
              ? undefined
              : input.upstream.admittedPlayer.postgresAuthority === undefined
                ? input.upstream.admittedPlayer
                : {
                    ...input.upstream.admittedPlayer,
                    ...createLocalAflTradePostgresAdmittedPlayerAuthority(
                      input.upstream.admittedPlayer.postgresAuthority
                    ),
                  };
          const playerExecutor =
            input.upstream.playerExecutor ??
            (admittedPlayer === undefined
              ? {
                  execute: async () => {
                    throw new TypeError(MISSING_ADMITTED_PLAYER_CONFIGURATION);
                  },
                }
              : createAflTradeDispatchBoundAdmittedPlayerExecutor({
                  admittedRunner: new AflTradeAdmittedModelRunner(
                    admittedPlayer.authority,
                    createAflTradeAdmittedPlayerContributionExecutor({
                      artifactRepository: artifacts,
                      maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
                      now: () => admittedPlayer.clock.now(),
                    }),
                    admittedPlayer.authorizationStore,
                    admittedPlayer.clock,
                    admittedPlayer.completedRunStore,
                    admittedPlayer.failureRecorder
                  ),
                  authorityPreparation: admittedPlayer.authorityPreparation,
                  prepareRun: admittedPlayer.prepareRun,
                  registerComponent: admittedPlayer.registerComponent,
                }));
          const cohortCoordinator = createPostgresAflTradePrivateCurrentValuationCohortCoordinator({
            client,
            artifactRepository: artifacts,
            maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
            maximumConcurrency: input.upstream.maximumConcurrency,
            loadPrivateConstructionEvidence: input.upstream.loadPrivateConstructionEvidence,
            constructTrade: input.upstream.constructTrade,
          });
          return createPostgresAflTradePrivateValuationModelPairDispatchRunner({
            client,
            hpnPreparation: input.upstream.hpnPreparation,
            targets: input.upstream.targets,
            playerExecutor,
            pickExecutor: input.upstream.pickExecutor,
            qualificationRegistrar: input.upstream.qualificationRegistrar,
            continueQualified: async ({ request, claim }) => {
              const prepared = await cohortCoordinator.preparePrivate({
                requestId: request.requestId,
                claim,
              });
              if (prepared.state === 'stale_authority') return prepared;
              return cohortRunner.runPrivate({ request, claim });
            },
            repairCurrent: (scopeKey, reason, repairOperationId) =>
              cohortRunner.repairCurrent(scopeKey, reason, repairOperationId),
          });
        })();
  return createPostgresAflTradePrivateValuationDispatcher({
    repository: new PostgresAflTradePrivateValuationScheduleRepository(client),
    runner: dispatchRunner,
    workerId: input.workerId,
  });
}
