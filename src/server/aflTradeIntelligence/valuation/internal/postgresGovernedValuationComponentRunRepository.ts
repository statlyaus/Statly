import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import {
  governedValuationComponentRunManifestSchema,
  type GovernedValuationComponentRunManifest,
} from './governedValuationComponentRunManifest';

interface ComponentRunRow {
  readonly run_id: string;
  readonly role: string;
  readonly native_execution_kind: string;
  readonly native_execution_id: string;
  readonly artifact_id: string;
  readonly native_execution_artifact_id: string;
  readonly protocol_id: string;
  readonly protocol_artifact_id: string;
  readonly dataset_id: string;
  readonly dataset_artifact_id: string;
  readonly dataset_admission_id: string;
  readonly dataset_admission_artifact_id: string;
  readonly dataset_admission_gate_ledger_revision: number | string;
  readonly registered_at: Date | string;
  readonly content_sha256: string;
  readonly content_canonical_json: string;
  readonly manifest_json: unknown;
  readonly artifact_content_sha256: string;
  readonly artifact_storage_uri: string;
  readonly artifact_media_type: string;
  readonly artifact_byte_length: number | string | bigint;
  readonly artifact_created_at: Date | string;
}

export interface RetainedGovernedValuationComponentRun {
  readonly manifest: GovernedValuationComponentRunManifest;
  readonly artifact: AflTradeArtifactRef;
}

export class GovernedValuationComponentRunRepositoryError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INTEGRITY_MISMATCH' | 'REPLAY_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'GovernedValuationComponentRunRepositoryError';
  }
}

function instant(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new GovernedValuationComponentRunRepositoryError(
      'INTEGRITY_MISMATCH',
      'Stored component-run time is malformed.'
    );
  }
  return parsed.toISOString();
}

async function loadPhysicalEvidence(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly maximumBytes: number;
  readonly references: readonly AflTradeArtifactRef[];
}): Promise<void> {
  for (const reference of input.references) {
    const loaded = await input.repository.loadExact(reference, input.maximumBytes);
    if (
      loaded === null ||
      canonicalizeAflTradeJson(loaded.reference) !== canonicalizeAflTradeJson(reference) ||
      !doesAflTradeArtifactRefMatchBytes(loaded.reference, loaded.bytes)
    ) {
      throw new GovernedValuationComponentRunRepositoryError(
        'INTEGRITY_MISMATCH',
        `Component-run artifact custody failed for ${reference.artifactId}.`
      );
    }
  }
}

async function loadExactFrom(
  client: AflOutcomeSqlTransaction,
  dependencies: {
    readonly artifactRepository: AflTradeImmutableArtifactRepository;
    readonly maximumArtifactBytes: number;
  },
  runId: string
): Promise<RetainedGovernedValuationComponentRun> {
  const result = await client.query<ComponentRunRow>(
    `SELECT run.run_id,run.role,run.native_execution_kind,run.native_execution_id,
       run.artifact_id,run.native_execution_artifact_id,run.protocol_id,
       run.protocol_artifact_id,run.dataset_id,run.dataset_artifact_id,
       run.dataset_admission_id,run.dataset_admission_artifact_id,
       run.dataset_admission_gate_ledger_revision,run.registered_at,run.content_sha256,
       run.content_canonical_json,run.manifest_json,
       artifact.content_sha256 AS artifact_content_sha256,
       artifact.storage_uri AS artifact_storage_uri,artifact.media_type AS artifact_media_type,
       artifact.byte_length AS artifact_byte_length,artifact.created_at AS artifact_created_at
       FROM outcome_governed_valuation_component_run run
       JOIN outcome_artifact_custody artifact ON artifact.artifact_id=run.artifact_id
      WHERE run.run_id=$1`,
    [runId]
  );
  if (result.rows.length !== 1 || result.rows[0] === undefined) {
    throw new GovernedValuationComponentRunRepositoryError(
      'NOT_FOUND',
      'Governed valuation component run was not found.'
    );
  }
  const row = result.rows[0];
  const parsed = governedValuationComponentRunManifestSchema.safeParse(row.manifest_json);
  const artifact = aflTradeArtifactRefSchema.safeParse({
    artifactId: row.artifact_id,
    contentSha256: row.artifact_content_sha256,
    storageUri: row.artifact_storage_uri,
    mediaType: row.artifact_media_type,
    byteLength: Number(row.artifact_byte_length),
    createdAt: instant(row.artifact_created_at),
  });
  if (!parsed.success || !artifact.success) {
    throw new GovernedValuationComponentRunRepositoryError(
      'INTEGRITY_MISMATCH',
      'Stored component-run manifest or custody metadata is malformed.'
    );
  }
  const manifest = parsed.data;
  const content = manifest.content;
  const admissionRevision = Number(row.dataset_admission_gate_ledger_revision);
  if (
    manifest.runId !== runId ||
    row.run_id !== runId ||
    row.content_sha256 !== runId.slice('model-run:'.length) ||
    row.role !== content.role ||
    row.native_execution_kind !== content.nativeExecution.kind ||
    row.native_execution_id !== content.nativeExecution.executionId ||
    row.native_execution_artifact_id !== content.nativeExecution.artifact.artifactId ||
    row.protocol_id !== content.protocolId ||
    row.protocol_artifact_id !== content.protocolArtifact.artifactId ||
    row.dataset_id !== content.datasetId ||
    row.dataset_artifact_id !== content.datasetArtifact.artifactId ||
    row.dataset_admission_id !== content.datasetAdmissionId ||
    row.dataset_admission_artifact_id !== content.datasetAdmissionArtifact.artifactId ||
    admissionRevision !== content.datasetAdmissionGateLedgerRevision ||
    instant(row.registered_at) !== content.registeredAt ||
    row.content_canonical_json !== canonicalizeAflTradeJson(content) ||
    artifact.data.createdAt !== content.registeredAt ||
    !doesAflTradeArtifactRefMatchCanonicalJson(artifact.data, manifest)
  ) {
    throw new GovernedValuationComponentRunRepositoryError(
      'INTEGRITY_MISMATCH',
      'Stored component-run columns disagree with immutable ancestry.'
    );
  }
  await loadPhysicalEvidence({
    repository: dependencies.artifactRepository,
    maximumBytes: dependencies.maximumArtifactBytes,
    references: [
      artifact.data,
      content.nativeExecution.artifact,
      content.protocolArtifact,
      content.datasetArtifact,
      content.datasetAdmissionArtifact,
    ],
  });
  return { manifest, artifact: artifact.data };
}

export class PostgresGovernedValuationComponentRunRepository {
  constructor(
    private readonly dependencies: {
      readonly client: AflOutcomeSqlClient;
      readonly artifactRepository: AflTradeImmutableArtifactRepository;
      readonly maximumArtifactBytes: number;
    }
  ) {
    if (
      dependencies.artifactRepository.artifactClass !== 'derived_private' ||
      !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
      dependencies.maximumArtifactBytes <= 0
    ) {
      throw new TypeError('Component-run custody requires bounded private artifact storage.');
    }
  }

  async register(input: {
    readonly manifest: GovernedValuationComponentRunManifest;
    readonly artifact: AflTradeArtifactRef;
  }): Promise<RetainedGovernedValuationComponentRun> {
    const manifest = governedValuationComponentRunManifestSchema.parse(input.manifest);
    const artifact = aflTradeArtifactRefSchema.parse(input.artifact);
    if (
      artifact.createdAt !== manifest.content.registeredAt ||
      !doesAflTradeArtifactRefMatchCanonicalJson(artifact, manifest)
    ) {
      throw new GovernedValuationComponentRunRepositoryError(
        'INTEGRITY_MISMATCH',
        'Component-run artifact does not authenticate the exact manifest.'
      );
    }
    await loadPhysicalEvidence({
      repository: this.dependencies.artifactRepository,
      maximumBytes: this.dependencies.maximumArtifactBytes,
      references: [
        artifact,
        manifest.content.nativeExecution.artifact,
        manifest.content.protocolArtifact,
        manifest.content.datasetArtifact,
        manifest.content.datasetAdmissionArtifact,
      ],
    });
    return this.dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `governed-valuation-component-run:${manifest.runId}`,
      ]);
      const existing = await transaction.query(
        `SELECT 1 FROM outcome_governed_valuation_component_run WHERE run_id=$1`,
        [manifest.runId]
      );
      if (existing.rowCount) {
        const replay = await loadExactFrom(transaction, this.dependencies, manifest.runId);
        if (
          canonicalizeAflTradeJson(replay) !== canonicalizeAflTradeJson({ manifest, artifact })
        ) {
          throw new GovernedValuationComponentRunRepositoryError(
            'REPLAY_CONFLICT',
            'Component-run replay conflicts with retained evidence.'
          );
        }
        return replay;
      }
      const content = manifest.content;
      await transaction.query(
        `INSERT INTO outcome_governed_valuation_component_run
          (run_id,role,native_execution_kind,native_execution_id,artifact_id,
           native_execution_artifact_id,protocol_id,protocol_artifact_id,dataset_id,
           dataset_artifact_id,dataset_admission_id,dataset_admission_artifact_id,
           dataset_admission_gate_ledger_revision,registered_at,content_sha256,
           content_canonical_json,manifest_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
        [
          manifest.runId,
          content.role,
          content.nativeExecution.kind,
          content.nativeExecution.executionId,
          artifact.artifactId,
          content.nativeExecution.artifact.artifactId,
          content.protocolId,
          content.protocolArtifact.artifactId,
          content.datasetId,
          content.datasetArtifact.artifactId,
          content.datasetAdmissionId,
          content.datasetAdmissionArtifact.artifactId,
          content.datasetAdmissionGateLedgerRevision,
          content.registeredAt,
          manifest.runId.slice('model-run:'.length),
          canonicalizeAflTradeJson(content),
          canonicalizeAflTradeJson(manifest),
        ]
      );
      return loadExactFrom(transaction, this.dependencies, manifest.runId);
    });
  }

  loadExact(runId: string): Promise<RetainedGovernedValuationComponentRun> {
    return loadExactFrom(this.dependencies.client, this.dependencies, runId);
  }
}
