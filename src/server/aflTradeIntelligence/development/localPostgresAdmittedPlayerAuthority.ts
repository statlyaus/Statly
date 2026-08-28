import type { AflTradeDurableObjectArtifactRepository } from '../artifacts/durableObjectArtifactRepository';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { AflTradeAdmittedModelRunAuthorityService } from '../modeling/admittedModelRunAuthority';
import { PostgresAflTradeAdmittedModelRunAuthority } from '../modeling/postgresAdmittedModelRunAuthority';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';

/** Wire local execution to durable admitted-model authority and custody. */
export function createLocalAflTradePostgresAdmittedPlayerAuthority(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly gateDecisionLedgerRepository: AflTradeGateDecisionLedgerRepository;
  readonly artifactRepository:
    | Pick<AflTradeDurableObjectArtifactRepository, 'loadExactWithObservation'>
    | Pick<AflTradeImmutableArtifactRepository, 'loadExact'>;
  readonly maximumArtifactBytes?: number;
}) {
  const authority = new PostgresAflTradeAdmittedModelRunAuthority(input);
  const service = new AflTradeAdmittedModelRunAuthorityService({
    authenticator: authority,
    clock: authority,
    authorizationStore: authority,
  });
  return {
    authority: service,
    authorityPreparation: authority,
    authorizationStore: authority,
    clock: authority,
    completedRunStore: authority,
  } as const;
}
