import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresGovernedPrivateEvaluationWorkspace } from '@/server/aflTradeIntelligence/valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace';

class UnusedSqlClient implements AflOutcomeSqlClient {
  async query<Row>(): Promise<AflOutcomeSqlQueryResult<Row>> {
    throw new Error('Workspace construction must not query PostgreSQL.');
  }

  async transaction<T>(
    work: (transaction: AflOutcomeSqlTransaction) => Promise<T>
  ): Promise<T> {
    return work(this);
  }
}

describe('PostgreSQL governed private evaluation workspace', () => {
  it('rejects caller-supplied automated principal identity', () => {
    const dependencies = {
      client: new UnusedSqlClient(),
      artifactRepository: createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private' as const,
      }),
      maximumArtifactBytes: 1_000_000,
      principalId: 'fixture-reader',
      automatedPrincipalId: 'system:weekly-valuation-coordinator',
      authorizeReader: async () => true,
    };

    expect(() => createPostgresGovernedPrivateEvaluationWorkspace(dependencies)).toThrow(
      'does not accept a caller-supplied automated principal'
    );
  });
});
