import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createGovernedPrivateEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import {
  createAutomatedGovernedPrivateEvaluationTransitionIntent,
  createGovernedPrivateEvaluationTransitionIntent,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationLifecycle';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationStagingRepository';
import { createGovernedPrivateEvaluationNarrativeFixture } from '../testUtils/governedPrivateEvaluationFixture';

const selector = {
  valuationScopeKey: 'afl-trade-history:test-fixture',
  tradeId: 'trade:three-club:1',
};
const now = '2026-08-19T10:00:00.000Z';

class StagingSqlClient implements AflOutcomeSqlClient {
  readonly sql: string[] = [];
  readonly custodyParameters: readonly unknown[][] = [];
  intentParameters: readonly unknown[] | null = null;
  private readonly artifacts = new Map<string, AflTradeArtifactRef>();
  private intentRegistered = false;

  constructor(
    private readonly retainedIntent: unknown,
    private readonly retainedIntentArtifact: AflTradeArtifactRef
  ) {
    this.expectArtifact(retainedIntentArtifact);
  }

  expectArtifact(artifact: AflTradeArtifactRef): void {
    this.artifacts.set(artifact.artifactId, artifact);
  }

  async query<Row>(
    statement: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.sql.push(statement);
    if (statement.includes('pg_advisory_xact_lock(hashtextextended($1,0))')) {
      return { rows: [], rowCount: 1 } as AflOutcomeSqlQueryResult<Row>;
    }
    if (statement.includes("date_trunc('milliseconds',transaction_timestamp())")) {
      return {
        rows: [{ trusted_at: new Date(now) }],
        rowCount: 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    if (statement.includes('INSERT INTO outcome_artifact_custody')) {
      this.custodyParameters.push(parameters);
      return { rows: [], rowCount: 1 } as AflOutcomeSqlQueryResult<Row>;
    }
    if (statement.includes('FROM outcome_artifact_custody')) {
      const artifact = this.artifacts.get(String(parameters[0]));
      if (artifact === undefined) throw new Error('Unexpected artifact custody read.');
      return {
        rows: [
          {
            artifact_id: artifact.artifactId,
            content_sha256: artifact.contentSha256,
            storage_uri: artifact.storageUri,
            media_type: artifact.mediaType,
            byte_length: artifact.byteLength,
          },
        ],
        rowCount: 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    if (statement.includes('INSERT INTO outcome_private_evaluation_transition_intent')) {
      this.intentParameters = parameters;
      this.intentRegistered = true;
      return { rows: [], rowCount: 1 } as AflOutcomeSqlQueryResult<Row>;
    }
    if (statement.includes('FROM outcome_private_evaluation_transition_intent')) {
      if (!this.intentRegistered) {
        return { rows: [], rowCount: 0 } as AflOutcomeSqlQueryResult<Row>;
      }
      return {
        rows: [
          {
            intent_json: this.retainedIntent,
            artifact_id: this.retainedIntentArtifact.artifactId,
          },
        ],
        rowCount: 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  }

  async transaction<T>(
    work: (transaction: AflOutcomeSqlTransaction) => Promise<T>
  ): Promise<T> {
    return work(this);
  }
}

function withdrawalIntent() {
  return createGovernedPrivateEvaluationTransitionIntent({
    selector,
    inspectionId: `private-evaluation-inspection:${'a'.repeat(64)}`,
    authoritySnapshotId: null,
    operationId: `private-evaluation-operation:${'b'.repeat(64)}`,
    action: { kind: 'withdraw', reason: 'Operator safety withdrawal.' },
    expectedHead: {
      status: 'active',
      revision: 1,
      generationId: `local-private-trade-evaluation-generation:${'c'.repeat(64)}`,
    },
    review: {
      principalId: 'firebase:operator-1',
      rationale: 'Withdraw the active fixture generation.',
    },
    requestedAt: now,
    expiresAt: '2026-08-19T10:05:00.000Z',
  });
}

describe('PostgreSQL governed private evaluation staging repository', () => {
  it('retains, reads back, registers, and stages an exact transition intent', async () => {
    const intent = withdrawalIntent();
    const intentArtifact = createAflTradeCanonicalJsonArtifactRef(intent, now);
    const client = new StagingSqlClient(intent, intentArtifact);
    const artifacts = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const repository = createPostgresGovernedPrivateEvaluationStagingRepository({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1_000_000,
    });

    await expect(repository.stage({ intent, intentArtifact })).resolves.toEqual({
      transitionIntentId: intent.transitionIntentId,
      generationId: null,
    });
    const retained = await artifacts.loadExact(intentArtifact, 1_000_000);
    expect(new TextDecoder().decode(retained?.bytes)).toBe(canonicalizeAflTradeJson(intent));
    expect(client.sql.some((sql) => sql.includes('INSERT INTO outcome_artifact_custody'))).toBe(
      true
    );
    expect(
      client.sql.some((sql) => sql.includes('pg_advisory_xact_lock(hashtextextended($1,0))'))
    ).toBe(true);
    expect(
      client.sql.some((sql) =>
        sql.includes('authority_snapshot_id')
      )
    ).toBe(true);
    expect(client.intentParameters?.[2]).toBeNull();
    expect(client.custodyParameters[0]?.[6]).toBe(now);

    const receiptBytes = new TextEncoder().encode('{"receipt":true}');
    const receiptArtifact = createAflTradeByteArtifactRef(
      receiptBytes,
      'application/json',
      now
    );
    client.expectArtifact(receiptArtifact);
    await expect(
      repository.retainArtifact({
        reference: receiptArtifact,
        bytes: receiptBytes,
      })
    ).resolves.toEqual(receiptArtifact);
    expect(client.custodyParameters.at(-1)?.[6]).toBe(now);
    await expect(artifacts.loadExact(receiptArtifact, 1_000_000)).resolves.toMatchObject({
      reference: receiptArtifact,
    });
  });

  it('refuses to stage construction without one complete verified generation', async () => {
    const withdrawal = withdrawalIntent();
    const intent = createGovernedPrivateEvaluationTransitionIntent({
      ...withdrawal.content,
      authoritySnapshotId: `private-evaluation-authority-snapshot:${'d'.repeat(64)}`,
      operationId: `private-evaluation-operation:${'e'.repeat(64)}`,
      action: { kind: 'construct_and_activate' },
    });
    const artifact = createAflTradeCanonicalJsonArtifactRef(intent, now);
    const repository = createPostgresGovernedPrivateEvaluationStagingRepository({
      client: new StagingSqlClient(intent, artifact),
      artifactRepository: createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private',
      }),
      maximumArtifactBytes: 1_000_000,
    });

    await expect(repository.stage({ intent, intentArtifact: artifact })).rejects.toThrow(
      /complete verified generation/i
    );
  });

  it('rejects a legacy generation presented under automated construction authority', async () => {
    const automatedSelector = {
      valuationScopeKey: selector.valuationScopeKey,
      tradeId: 'trade:adelaide-st-kilda',
    };
    const intent = createAutomatedGovernedPrivateEvaluationTransitionIntent({
      selector: automatedSelector,
      inspectionId: `private-evaluation-inspection:${'a'.repeat(64)}`,
      authoritySnapshotId: `private-evaluation-authority-snapshot:${'b'.repeat(64)}`,
      operationId: `private-evaluation-operation:${'c'.repeat(64)}`,
      action: { kind: 'construct_and_activate' },
      expectedHead: { status: 'absent', revision: 0, generationId: null },
      constructionAuthority: {
        kind: 'automated_private_calculation_agent',
        principalId: 'system:weekly-valuation-coordinator',
      },
      requestedAt: now,
      expiresAt: '2026-08-19T10:05:00.000Z',
    });
    const intentArtifact = createAflTradeCanonicalJsonArtifactRef(intent, now);
    const legacy = createGovernedPrivateEvaluationGeneration({
      selector: automatedSelector,
      transitionIntentId: intent.transitionIntentId,
      generatedAt: now,
      narrative: createGovernedPrivateEvaluationNarrativeFixture(),
    });
    const repository = createPostgresGovernedPrivateEvaluationStagingRepository({
      client: new StagingSqlClient(intent, intentArtifact),
      artifactRepository: createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private',
      }),
      maximumArtifactBytes: 1_000_000,
      enableAutomatedPrivateCalculation: true,
    });

    await expect(
      repository.stage({ intent, intentArtifact, materialization: legacy })
    ).rejects.toThrow(/complete verified generation/i);
  });

  it('rejects automated construction when automated calculation is not enabled', async () => {
    const automatedSelector = {
      valuationScopeKey: selector.valuationScopeKey,
      tradeId: 'trade:adelaide-st-kilda',
    };
    const intent = createAutomatedGovernedPrivateEvaluationTransitionIntent({
      selector: automatedSelector,
      inspectionId: `private-evaluation-inspection:${'a'.repeat(64)}`,
      authoritySnapshotId: `private-evaluation-authority-snapshot:${'b'.repeat(64)}`,
      operationId: `private-evaluation-operation:${'c'.repeat(64)}`,
      action: { kind: 'construct_and_activate' },
      expectedHead: { status: 'absent', revision: 0, generationId: null },
      constructionAuthority: {
        kind: 'automated_private_calculation_agent',
        principalId: 'system:weekly-valuation-coordinator',
      },
      requestedAt: now,
      expiresAt: '2026-08-19T10:05:00.000Z',
    });
    const intentArtifact = createAflTradeCanonicalJsonArtifactRef(intent, now);
    const repository = createPostgresGovernedPrivateEvaluationStagingRepository({
      client: new StagingSqlClient(intent, intentArtifact),
      artifactRepository: createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private',
      }),
      maximumArtifactBytes: 1_000_000,
    });

    await expect(repository.stage({ intent, intentArtifact })).rejects.toThrow(
      /exact configured system principal/i
    );
  });

  it('registers local private artifact custody as non-production rather than fixture data', async () => {
    const intent = withdrawalIntent();
    const artifact = createAflTradeCanonicalJsonArtifactRef(intent, now);
    const client = new StagingSqlClient(intent, artifact);
    const fixtureRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const repository = createPostgresGovernedPrivateEvaluationStagingRepository({
      client,
      artifactRepository: {
        ...fixtureRepository,
        assurance: 'local_non_production_filesystem',
      },
      maximumArtifactBytes: 1_000_000,
    });

    await repository.retainArtifact({
      reference: artifact,
      bytes: new TextEncoder().encode(canonicalizeAflTradeJson(intent)),
    });

    expect(client.custodyParameters[0]?.[5]).toBe('non_production');
  });
});
