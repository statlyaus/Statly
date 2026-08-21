import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createGovernedPrivateEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import { createPostgresGovernedPrivateEvaluationReadRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationReadRepository';
import { createGovernedPrivateEvaluationNarrativeFixture } from '../testUtils/governedPrivateEvaluationFixture';

const selector = {
  valuationScopeKey: 'afl-trade-history:test-fixture',
  tradeId: 'trade:adelaide-st-kilda',
};
const generatedAt = '2026-08-19T10:00:00.000Z';
const materialization = createGovernedPrivateEvaluationGeneration({
  selector,
  transitionIntentId: `private-evaluation-transition-intent:${'a'.repeat(64)}`,
  generatedAt,
  narrative: createGovernedPrivateEvaluationNarrativeFixture(),
});

class ReadSqlClient implements AflOutcomeSqlClient {
  status: 'active' | 'withdrawn' | 'absent' = 'active';
  activeGenerationId: string | null = materialization.generation.generationId;
  generationJson: unknown = materialization.generation;
  queryCount = 0;

  async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.queryCount += 1;
    if (sql.includes('FROM outcome_current_private_evaluation_batch h')) {
      return {
        rows:
          this.status === 'absent'
            ? []
            : [
                {
                  state: 'ready',
                  generation_json: this.generationJson,
                  withdrawal_id: this.status === 'withdrawn' ? 'withdrawal:fixture' : null,
                },
              ],
        rowCount: this.status === 'absent' ? 0 : 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('outcome_local_private_trade_evaluation_generation')) {
      return {
        rows: [
          {
            generation_json: this.generationJson,
            batch_current:
              this.status !== 'absent' &&
              this.activeGenerationId === materialization.generation.generationId,
            batch_withdrawn: this.status === 'withdrawn',
          },
        ],
        rowCount: 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  async transaction<T>(
    work: (transaction: AflOutcomeSqlTransaction) => Promise<T>
  ): Promise<T> {
    return work(this);
  }
}

async function retainedArtifacts(): Promise<AflTradeImmutableArtifactRepository> {
  const repository = createAflTradeFixtureArtifactRepository({
    artifactClass: 'derived_private',
  });
  for (const artifact of materialization.artifacts) {
    await repository.putIfAbsent(artifact.reference, artifact.bytes);
  }
  return repository;
}

describe('PostgreSQL governed private evaluation read repository', () => {
  it('authenticates current and explicit historical projection bytes', async () => {
    const client = new ReadSqlClient();
    const repository = createPostgresGovernedPrivateEvaluationReadRepository({
      client,
      artifactRepository: await retainedArtifacts(),
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:registered-reader',
      authorizeReader: async () => true,
    });

    await expect(
      repository.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'detail' },
      })
    ).resolves.toMatchObject({
      state: 'available',
      selector,
      selection: { kind: 'current' },
      generationId: materialization.generation.generationId,
      projectionManifestId: materialization.projectionManifest.projectionManifestId,
      lifecycle: { status: 'active', current: true },
      document: { kind: 'detail' },
    });

    const exported = await repository.read({
      selector,
      selection: {
        kind: 'generation',
        generationId: materialization.generation.generationId,
      },
      document: { kind: 'json_export' },
    });
    expect(exported).toMatchObject({
      state: 'available',
      lifecycle: { status: 'active', current: true },
    });
    if (exported.state !== 'available') throw new Error('Expected exact export bytes.');
    expect(new TextDecoder().decode(exported.bytes).endsWith('\n')).toBe(true);
  });

  it('keeps withdrawn current reads unavailable while preserving explicit history', async () => {
    const client = new ReadSqlClient();
    client.status = 'withdrawn';
    const repository = createPostgresGovernedPrivateEvaluationReadRepository({
      client,
      artifactRepository: await retainedArtifacts(),
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:registered-reader',
      authorizeReader: async () => true,
    });

    await expect(
      repository.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'archive_summary' },
      })
    ).resolves.toEqual({
      state: 'unavailable',
      selector,
      selection: { kind: 'current' },
      document: { kind: 'archive_summary' },
      reason: 'withdrawn',
    });
    await expect(
      repository.read({
        selector,
        selection: {
          kind: 'generation',
          generationId: materialization.generation.generationId,
        },
        document: { kind: 'archive_summary' },
      })
    ).resolves.toMatchObject({
      state: 'available',
      lifecycle: { status: 'withdrawn', current: false },
    });
  });

  it('labels an older explicit generation as superseded and inactive', async () => {
    const client = new ReadSqlClient();
    client.activeGenerationId = `local-private-trade-evaluation-generation:${'f'.repeat(64)}`;
    const repository = createPostgresGovernedPrivateEvaluationReadRepository({
      client,
      artifactRepository: await retainedArtifacts(),
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:registered-reader',
      authorizeReader: async () => true,
    });

    await expect(
      repository.read({
        selector,
        selection: {
          kind: 'generation',
          generationId: materialization.generation.generationId,
        },
        document: { kind: 'detail' },
      })
    ).resolves.toMatchObject({
      state: 'available',
      lifecycle: { status: 'superseded', current: false },
    });
  });

  it('fails closed when any retained generation byte is altered', async () => {
    const stored = await retainedArtifacts();
    const tampered: AflTradeImmutableArtifactRepository = {
      ...stored,
      async loadExact(reference, maximumBytes) {
        const result = await stored.loadExact(reference, maximumBytes);
        if (
          result === null ||
          reference.artifactId !== materialization.projectionManifest.content.documents[1]?.artifact.artifactId
        ) {
          return result;
        }
        return { ...result, bytes: new TextEncoder().encode('{"tampered":true}') };
      },
    };
    const repository = createPostgresGovernedPrivateEvaluationReadRepository({
      client: new ReadSqlClient(),
      artifactRepository: tampered,
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:registered-reader',
      authorizeReader: async () => true,
    });

    await expect(
      repository.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'detail' },
      })
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'authentication_failed' });
  });

  it('returns projection unavailable for an unsupported retained generation version', async () => {
    const client = new ReadSqlClient();
    client.generationJson = {
      ...materialization.generation,
      content: {
        ...materialization.generation.content,
        schemaVersion: 'local-private-trade-evaluation-generation/v999',
      },
    };
    const artifacts = await retainedArtifacts();
    const loadExact = vi.spyOn(artifacts, 'loadExact');
    const repository = createPostgresGovernedPrivateEvaluationReadRepository({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:registered-reader',
      authorizeReader: async () => true,
    });

    await expect(
      repository.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'detail' },
      })
    ).resolves.toEqual({
      state: 'unavailable',
      selector,
      selection: { kind: 'current' },
      document: { kind: 'detail' },
      reason: 'projection_unavailable',
    });
    expect(loadExact).not.toHaveBeenCalled();
  });

  it('returns projection unavailable for an unsupported retained manifest version', async () => {
    const unsupportedManifest = {
      ...materialization.projectionManifest,
      content: {
        ...materialization.projectionManifest.content,
        schemaVersion: 'governed-private-evaluation-projection-manifest/v999',
      },
    };
    const manifestBytes = new TextEncoder().encode(
      canonicalizeAflTradeJson(unsupportedManifest)
    );
    const manifestArtifact = createAflTradeByteArtifactRef(
      manifestBytes,
      'application/json',
      generatedAt
    );
    const generationContent = {
      ...materialization.generation.content,
      projectionManifestArtifact: manifestArtifact,
    };
    const generation = {
      generationId: createAflTradeContentAddress(
        'local-private-trade-evaluation-generation',
        generationContent
      ),
      content: generationContent,
    };
    const generationArtifact = createAflTradeCanonicalJsonArtifactRef(
      generation,
      generatedAt
    );
    const artifacts = await retainedArtifacts();
    await artifacts.putIfAbsent(manifestArtifact, manifestBytes);
    await artifacts.putIfAbsent(
      generationArtifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(generation))
    );
    const loadExact = vi.spyOn(artifacts, 'loadExact');
    const client = new ReadSqlClient();
    client.generationJson = generation;
    const repository = createPostgresGovernedPrivateEvaluationReadRepository({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:registered-reader',
      authorizeReader: async () => true,
    });

    await expect(
      repository.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'detail' },
      })
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'projection_unavailable' });
    const loadedArtifactIds = loadExact.mock.calls.map(([reference]) => reference.artifactId);
    for (const document of materialization.projectionManifest.content.documents) {
      expect(loadedArtifactIds).not.toContain(document.artifact.artifactId);
    }
  });

  it('denies an unauthorized principal before database or artifact access', async () => {
    const client = new ReadSqlClient();
    const artifacts = await retainedArtifacts();
    const loadExact = vi.spyOn(artifacts, 'loadExact');
    const authorizeReader = vi.fn(async () => false);
    const repository = createPostgresGovernedPrivateEvaluationReadRepository({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:unauthorized-reader',
      authorizeReader,
    });

    await expect(
      repository.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'detail' },
      })
    ).resolves.toEqual({
      state: 'unavailable',
      selector,
      selection: { kind: 'current' },
      document: { kind: 'detail' },
      reason: 'not_found',
    });
    expect(authorizeReader).toHaveBeenCalledWith({
      principalId: 'firebase:unauthorized-reader',
      selector,
    });
    expect(client.queryCount).toBe(0);
    expect(loadExact).not.toHaveBeenCalled();
  });
});
