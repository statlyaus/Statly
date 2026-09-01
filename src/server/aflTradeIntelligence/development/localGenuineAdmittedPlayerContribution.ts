import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { createAflTradeAdmittedPlayerContributionExecutor } from '../modeling/admittedPlayerContributionCandidate';
import { AflTradeAdmittedModelRunner } from '../modeling/admittedModelRunAuthority';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeDispatchBoundAdmittedPlayerExecutor } from '../valuation/postgresPrivateValuationModelPair';
import type { PostgresGovernedValuationComponentRunRepository } from '../valuation/internal/postgresGovernedValuationComponentRunRepository';
import { attestLocalAflTradeAdmittedPlayerRunProfile } from './localAdmittedPlayerRunAttestation';
import { createLocalAflTradePostgresAdmittedPlayerAuthority } from './localPostgresAdmittedPlayerAuthority';
import { createLocalAflTradePostgresAdmittedPlayerPreparation } from './localPostgresAdmittedPlayerPreparation';

/**
 * Compose the genuine player contribution runner for the fixed local, private,
 * non-production dispatch policy. No caller-supplied operational authority enters this boundary.
 */
export function createLocalAflTradeGenuineAdmittedPlayerExecutor(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly gateDecisionLedgerRepository: AflTradeGateDecisionLedgerRepository;
  readonly componentRepository: Pick<
    PostgresGovernedValuationComponentRunRepository,
    'register' | 'loadExact'
  >;
  readonly seed: number;
  readonly operationalAuthorizationLifetimeMs?: number;
}) {
  const authority = createLocalAflTradePostgresAdmittedPlayerAuthority({
    sql: input.sql,
    gateDecisionLedgerRepository: input.gateDecisionLedgerRepository,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  const preparation = createLocalAflTradePostgresAdmittedPlayerPreparation({
    sql: input.sql,
    artifactRepository: input.artifactRepository,
    maximumArtifactBytes: input.maximumArtifactBytes,
    gateDecisionLedgerRepository: input.gateDecisionLedgerRepository,
    componentRepository: input.componentRepository,
    attestRunProfile: ({ createdAt, retainArtifact }) =>
      attestLocalAflTradeAdmittedPlayerRunProfile({
        seed: input.seed,
        createdAt,
        retainArtifact,
        operationalAuthorizationLifetimeMs: input.operationalAuthorizationLifetimeMs,
      }),
  });
  const runner = new AflTradeAdmittedModelRunner(
    authority.authority,
    createAflTradeAdmittedPlayerContributionExecutor({
      artifactRepository: input.artifactRepository,
      maximumArtifactBytes: input.maximumArtifactBytes,
      now: () => authority.clock.now(),
    }),
    authority.authorizationStore,
    authority.clock,
    authority.completedRunStore,
    preparation.failureRecorder
  );
  return createAflTradeDispatchBoundAdmittedPlayerExecutor({
    loadRetainedComponent: preparation.loadRetainedComponent,
    admittedRunner: runner,
    authorityPreparation: authority.authorityPreparation,
    prepareRun: preparation.prepareRun,
    registerComponent: preparation.registerComponent,
  });
}
