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
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';
import { PostgresGovernedValuationComponentRunRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationComponentRunRepository';

const retainedAt = '2026-08-20T09:00:00.000Z';
const registeredAt = '2026-08-20T10:00:00.000Z';
const id = (kind: string, marker: string) => `${kind}:${marker.repeat(64)}`;

class ComponentRunSqlClient implements AflOutcomeSqlClient {
  row: Record<string, unknown> | null = null;

  constructor(private readonly manifestArtifact: AflTradeArtifactRef) {}

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('SELECT') && sql.includes('outcome_governed_valuation_component_run')) {
      return {
        rows: this.row === null ? [] : [this.row as Row],
        rowCount: this.row === null ? 0 : 1,
      };
    }
    if (sql.includes('INSERT INTO outcome_governed_valuation_component_run')) {
      const artifact = this.manifestArtifact;
      expect(parameters[4]).toBe(artifact.artifactId);
      this.row = {
        run_id: parameters[0],
        role: parameters[1],
        native_execution_kind: parameters[2],
        native_execution_id: parameters[3],
        artifact_id: artifact.artifactId,
        native_execution_artifact_id: parameters[5],
        protocol_id: parameters[6],
        protocol_artifact_id: parameters[7],
        dataset_id: parameters[8],
        dataset_artifact_id: parameters[9],
        dataset_admission_id: parameters[10],
        dataset_admission_artifact_id: parameters[11],
        dataset_admission_gate_ledger_revision: parameters[12],
        registered_at: parameters[13],
        content_sha256: parameters[14],
        content_canonical_json: parameters[15],
        manifest_json: JSON.parse(String(parameters[16])),
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

async function retained(
  repository: AflTradeImmutableArtifactRepository,
  value: unknown,
  createdAt = retainedAt
) {
  const reference = createAflTradeCanonicalJsonArtifactRef(value, createdAt);
  const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(value));
  await repository.putIfAbsent(reference, bytes);
  return reference;
}

async function fixture() {
  const artifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  const nativeExecution = await retained(artifacts, { kind: 'pick-run' });
  const protocol = await retained(artifacts, { kind: 'pick-protocol' });
  const dataset = await retained(artifacts, { kind: 'pick-dataset' });
  const admission = await retained(artifacts, { kind: 'pick-admission' });
  const manifest = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'draft_pick_and_future_pick_distribution',
    nativeExecution: {
      kind: 'pick_pav_model_execution',
      executionId: id('pick-pav-model-execution', '1'),
      artifact: nativeExecution,
    },
    protocolId: id('model-protocol', '2'),
    protocolArtifact: protocol,
    datasetId: id('dataset', '3'),
    datasetArtifact: dataset,
    datasetAdmissionId: id('dataset-admission', '4'),
    datasetAdmissionArtifact: admission,
    datasetAdmissionGateLedgerRevision: 12,
    registeredAt,
  });
  const manifestArtifact = await retained(artifacts, manifest, registeredAt);
  return { artifacts, manifest, manifestArtifact, nativeExecution };
}

describe('PostgreSQL governed valuation component-run repository', () => {
  it('registers, exactly replays, and rejects substituted physical evidence', async () => {
    const value = await fixture();
    const client = new ComponentRunSqlClient(value.manifestArtifact);
    const repository = new PostgresGovernedValuationComponentRunRepository({
      client,
      artifactRepository: value.artifacts,
      maximumArtifactBytes: 1024 * 1024,
    });

    await expect(
      repository.register({ manifest: value.manifest, artifact: value.manifestArtifact })
    ).resolves.toEqual({ manifest: value.manifest, artifact: value.manifestArtifact });
    await expect(repository.loadExact(value.manifest.runId)).resolves.toEqual({
      manifest: value.manifest,
      artifact: value.manifestArtifact,
    });
    await expect(
      repository.register({ manifest: value.manifest, artifact: value.manifestArtifact })
    ).resolves.toEqual({ manifest: value.manifest, artifact: value.manifestArtifact });

    const substituted: AflTradeImmutableArtifactRepository = {
      ...value.artifacts,
      loadExact: async (reference, maximumBytes) =>
        reference.artifactId === value.nativeExecution.artifactId
          ? { reference, bytes: new TextEncoder().encode('substituted') }
          : value.artifacts.loadExact(reference, maximumBytes),
    };
    const rejecting = new PostgresGovernedValuationComponentRunRepository({
      client,
      artifactRepository: substituted,
      maximumArtifactBytes: 1024 * 1024,
    });
    await expect(rejecting.loadExact(value.manifest.runId)).rejects.toThrow(
      /artifact|bytes|custody|evidence/i
    );
  });
});
