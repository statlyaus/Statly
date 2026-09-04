import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createGovernedPrivateEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import { createPostgresGovernedPrivateEvaluationReconstructionRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationReconstructionRepository';
import { createGovernedPrivateEvaluationNarrativeFixture } from '../testUtils/governedPrivateEvaluationFixture';

const selector = {
  valuationScopeKey: 'afl-trade-history:test-fixture',
  tradeId: 'trade:adelaide-st-kilda',
};
const verifiedAt = '2026-08-19T10:00:00.000Z';
const generation = createGovernedPrivateEvaluationGeneration({
  selector,
  transitionIntentId: `private-evaluation-transition-intent:${'a'.repeat(64)}`,
  generatedAt: verifiedAt,
  narrative: createGovernedPrivateEvaluationNarrativeFixture(),
});
const request = {
  selector,
  inspectionId: `private-evaluation-inspection:${'b'.repeat(64)}`,
  operationId: `private-evaluation-operation:${'c'.repeat(64)}`,
  generationId: generation.generation.generationId,
};

class ReconstructionSqlClient implements AflOutcomeSqlClient {
  readonly sql: string[] = [];
  existing: { verification_json: unknown; artifact_id: string } | null = null;
  trustedAt = verifiedAt;

  async query<Row>(statement: string): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.sql.push(statement);
    if (statement.includes("date_trunc('milliseconds',clock_timestamp())")) {
      return {
        rows: [{ trusted_at: new Date(this.trustedAt) }],
        rowCount: 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (statement.includes('FROM outcome_private_evaluation_reconstruction_verification')) {
      return {
        rows: this.existing === null ? [] : [this.existing],
        rowCount: this.existing === null ? 0 : 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (statement.includes('FROM outcome_private_evaluation_inspection_receipt')) {
      return {
        rows: [{ inspection_id: request.inspectionId }],
        rowCount: 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (statement.includes('FROM outcome_local_private_trade_evaluation_generation')) {
      return {
        rows: [{ generation_json: generation.generation }],
        rowCount: 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (statement.includes('INSERT INTO outcome_private_evaluation_reconstruction_verification')) {
      return { rows: [], rowCount: 1 } as AflOutcomeSqlQueryResult<Row>;
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }
}

async function retainedArtifacts(): Promise<AflTradeImmutableArtifactRepository> {
  const repository = createAflTradeFixtureArtifactRepository({
    artifactClass: 'derived_private',
  });
  for (const artifact of generation.artifacts) {
    await repository.putIfAbsent(artifact.reference, artifact.bytes);
  }
  return repository;
}

describe('PostgreSQL governed private evaluation reconstruction repository', () => {
  it('authenticates every retained artifact and persists an exact replayable verification', async () => {
    const client = new ReconstructionSqlClient();
    const retained: { reference: AflTradeArtifactRef; bytes: Uint8Array }[] = [];
    const repository = createPostgresGovernedPrivateEvaluationReconstructionRepository({
      client,
      artifactRepository: await retainedArtifacts(),
      maximumArtifactBytes: 4 * 1024 * 1024,
      retainArtifact: async (artifact) => {
        retained.push(artifact);
        return artifact.reference;
      },
    });

    const first = await repository.verify(request);
    expect(first).toMatchObject({
      state: 'verified',
      generationId: request.generationId,
      exactMatch: true,
      verifiedAt,
    });
    expect(retained).toHaveLength(1);
    expect(
      client.sql.some((sql) =>
        sql.includes('INSERT INTO outcome_private_evaluation_reconstruction_verification')
      )
    ).toBe(true);

    client.existing = {
      verification_json: first.verification,
      artifact_id: retained[0]!.reference.artifactId,
    };
    client.trustedAt = '2026-08-19T10:01:00.000Z';
    await expect(repository.verify(request)).resolves.toMatchObject({
      state: 'replayed',
      verificationId: first.verificationId,
      exactMatch: true,
      verifiedAt,
    });
  });

  it('does not retain a verification when reconstruction bytes are altered', async () => {
    const stored = await retainedArtifacts();
    const tampered: AflTradeImmutableArtifactRepository = {
      ...stored,
      async loadExact(reference, maximumBytes) {
        const result = await stored.loadExact(reference, maximumBytes);
        if (
          result === null ||
          reference.artifactId !==
            generation.projectionManifest.content.documents[0]?.artifact.artifactId
        ) {
          return result;
        }
        return { ...result, bytes: new TextEncoder().encode('{"tampered":true}') };
      },
    };
    const retainArtifact = vi.fn();
    const repository = createPostgresGovernedPrivateEvaluationReconstructionRepository({
      client: new ReconstructionSqlClient(),
      artifactRepository: tampered,
      maximumArtifactBytes: 4 * 1024 * 1024,
      retainArtifact,
    });

    await expect(repository.verify(request)).rejects.toThrow(/authentication|reconstruction/i);
    expect(retainArtifact).not.toHaveBeenCalled();
  });
});
