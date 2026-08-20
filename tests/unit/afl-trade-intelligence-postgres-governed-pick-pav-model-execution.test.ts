import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeFixtureArtifactRepository,
  type AflTradeImmutableArtifactRepository,
} from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresGovernedPickPavModelExecutionRepository } from '@/server/aflTradeIntelligence/modeling/postgresGovernedPickPavModelExecutionRepository';

import { createGovernedPickPavModelExecutionFixture } from '../testUtils/governedPickPavModelExecutionFixture';

class GovernedPickExecutionSqlClient implements AflOutcomeSqlClient {
  row: Record<string, unknown> | null = null;

  constructor(private readonly executionArtifact: AflTradeArtifactRef) {}

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('SELECT 1 FROM outcome_governed_pick_pav_model_execution')) {
      return { rows: [], rowCount: this.row === null ? 0 : 1 };
    }
    if (sql.includes('SELECT') && sql.includes('outcome_governed_pick_pav_model_execution')) {
      return {
        rows: this.row === null ? [] : [this.row as Row],
        rowCount: this.row === null ? 0 : 1,
      };
    }
    if (sql.includes('INSERT INTO outcome_governed_pick_pav_model_execution')) {
      const artifact = this.executionArtifact;
      this.row = {
        execution_id: parameters[0],
        observation_set_id: parameters[1],
        dataset_id: parameters[2],
        dataset_artifact_id: parameters[3],
        dataset_admission_id: parameters[4],
        dataset_admission_artifact_id: parameters[5],
        dataset_admission_gate_ledger_revision: parameters[6],
        protocol_id: parameters[7],
        protocol_artifact_id: parameters[8],
        execution_artifact_id: parameters[9],
        final_test_evaluation_started_at: parameters[10],
        completed_at: parameters[11],
        content_sha256: parameters[12],
        content_canonical_json: parameters[13],
        execution_json: JSON.parse(String(parameters[14])),
        artifact_content_sha256: artifact.contentSha256,
        artifact_storage_uri: artifact.storageUri,
        artifact_media_type: artifact.mediaType,
        artifact_byte_length: artifact.byteLength,
        artifact_created_at: artifact.createdAt,
      };
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }
}

async function retain(
  repository: AflTradeImmutableArtifactRepository,
  value: unknown,
  createdAt: string
) {
  const reference = createAflTradeCanonicalJsonArtifactRef(value, createdAt);
  await repository.putIfAbsent(
    reference,
    new TextEncoder().encode(canonicalizeAflTradeJson(value))
  );
  return reference;
}

async function fixture() {
  const value = createGovernedPickPavModelExecutionFixture();
  const artifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  const authorityReferences = [
    value.execution.content.datasetArtifact,
    value.execution.content.datasetAdmissionArtifact,
    value.execution.content.protocolArtifact,
  ];
  for (const [index, document] of value.authorityDocuments.entries()) {
    const retained = await retain(artifacts, document, authorityReferences[index]!.createdAt);
    expect(retained).toEqual(authorityReferences[index]);
  }
  const executionArtifact = await retain(
    artifacts,
    value.execution,
    value.execution.content.completedAt
  );
  return { ...value, artifacts, executionArtifact };
}

describe('PostgreSQL governed pick-PAV execution repository', () => {
  it('registers and exactly replays one physically retained governed execution', async () => {
    const value = await fixture();
    const client = new GovernedPickExecutionSqlClient(value.executionArtifact);
    const repository = new PostgresGovernedPickPavModelExecutionRepository({
      client,
      artifactRepository: value.artifacts,
      maximumArtifactBytes: 1024 * 1024,
    });

    await expect(
      repository.register({
        execution: value.execution,
        artifact: value.executionArtifact,
      })
    ).resolves.toEqual({ execution: value.execution, artifact: value.executionArtifact });
    await expect(repository.loadExact(value.execution.executionId)).resolves.toEqual({
      execution: value.execution,
      artifact: value.executionArtifact,
    });
    await expect(
      repository.register({
        execution: value.execution,
        artifact: value.executionArtifact,
      })
    ).resolves.toEqual({ execution: value.execution, artifact: value.executionArtifact });
  });

  it('rejects relational substitution and substituted retained bytes', async () => {
    const value = await fixture();
    const client = new GovernedPickExecutionSqlClient(value.executionArtifact);
    const repository = new PostgresGovernedPickPavModelExecutionRepository({
      client,
      artifactRepository: value.artifacts,
      maximumArtifactBytes: 1024 * 1024,
    });
    await repository.register({ execution: value.execution, artifact: value.executionArtifact });

    const exactRow = structuredClone(client.row);
    client.row = { ...exactRow, dataset_id: `dataset:${'0'.repeat(64)}` };
    await expect(repository.loadExact(value.execution.executionId)).rejects.toThrow(
      /integrity|ancestry|disagree/i
    );
    client.row = exactRow;

    const substituted: AflTradeImmutableArtifactRepository = {
      ...value.artifacts,
      loadExact: async (reference, maximumBytes) =>
        reference.artifactId === value.executionArtifact.artifactId
          ? { reference, bytes: new TextEncoder().encode('substituted') }
          : value.artifacts.loadExact(reference, maximumBytes),
    };
    const rejecting = new PostgresGovernedPickPavModelExecutionRepository({
      client,
      artifactRepository: substituted,
      maximumArtifactBytes: 1024 * 1024,
    });
    await expect(rejecting.loadExact(value.execution.executionId)).rejects.toThrow(
      /artifact|bytes|custody|integrity/i
    );
  });
});
