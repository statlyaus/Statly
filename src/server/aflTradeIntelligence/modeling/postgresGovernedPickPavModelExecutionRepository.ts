import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  governedAflTradePickPavModelExecutionSchema,
  type GovernedAflTradePickPavModelExecution,
} from './governedPickPavModelExecution';

interface GovernedPickExecutionRow {
  readonly execution_id: string;
  readonly observation_set_id: string;
  readonly dataset_id: string;
  readonly dataset_artifact_id: string;
  readonly dataset_admission_id: string;
  readonly dataset_admission_artifact_id: string;
  readonly dataset_admission_gate_ledger_revision: number | string;
  readonly protocol_id: string;
  readonly protocol_artifact_id: string;
  readonly execution_artifact_id: string;
  readonly final_test_evaluation_started_at: Date | string;
  readonly completed_at: Date | string;
  readonly content_sha256: string;
  readonly content_canonical_json: string;
  readonly execution_json: unknown;
  readonly artifact_content_sha256: string;
  readonly artifact_storage_uri: string;
  readonly artifact_media_type: string;
  readonly artifact_byte_length: number | string | bigint;
  readonly artifact_created_at: Date | string;
}

export interface RetainedGovernedPickPavModelExecution {
  readonly execution: GovernedAflTradePickPavModelExecution;
  readonly artifact: AflTradeArtifactRef;
}

export class GovernedPickPavModelExecutionRepositoryError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INTEGRITY_MISMATCH' | 'REPLAY_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'GovernedPickPavModelExecutionRepositoryError';
  }
}

function instant(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new GovernedPickPavModelExecutionRepositoryError(
      'INTEGRITY_MISMATCH',
      'Stored governed pick-execution time is malformed.'
    );
  }
  return parsed.toISOString();
}

async function authenticatePhysicalEvidence(input: {
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
      throw new GovernedPickPavModelExecutionRepositoryError(
        'INTEGRITY_MISMATCH',
        `Governed pick-execution artifact custody failed for ${reference.artifactId}.`
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
  executionId: string
): Promise<RetainedGovernedPickPavModelExecution> {
  const result = await client.query<GovernedPickExecutionRow>(
    `SELECT execution.execution_id,execution.observation_set_id,execution.dataset_id,
       execution.dataset_artifact_id,execution.dataset_admission_id,
       execution.dataset_admission_artifact_id,
       execution.dataset_admission_gate_ledger_revision,execution.protocol_id,
       execution.protocol_artifact_id,execution.execution_artifact_id,
       execution.final_test_evaluation_started_at,execution.completed_at,
       execution.content_sha256,execution.content_canonical_json,execution.execution_json,
       artifact.content_sha256 AS artifact_content_sha256,
       artifact.storage_uri AS artifact_storage_uri,artifact.media_type AS artifact_media_type,
       artifact.byte_length AS artifact_byte_length,artifact.created_at AS artifact_created_at
       FROM outcome_governed_pick_pav_model_execution execution
       JOIN outcome_artifact_custody artifact
         ON artifact.artifact_id=execution.execution_artifact_id
      WHERE execution.execution_id=$1`,
    [executionId]
  );
  if (result.rows.length !== 1 || result.rows[0] === undefined) {
    throw new GovernedPickPavModelExecutionRepositoryError(
      'NOT_FOUND',
      'Governed pick-PAV model execution was not found.'
    );
  }
  const row = result.rows[0];
  const parsed = governedAflTradePickPavModelExecutionSchema.safeParse(row.execution_json);
  const artifact = aflTradeArtifactRefSchema.safeParse({
    artifactId: row.execution_artifact_id,
    contentSha256: row.artifact_content_sha256,
    storageUri: row.artifact_storage_uri,
    mediaType: row.artifact_media_type,
    byteLength: Number(row.artifact_byte_length),
    createdAt: instant(row.artifact_created_at),
  });
  if (!parsed.success || !artifact.success) {
    throw new GovernedPickPavModelExecutionRepositoryError(
      'INTEGRITY_MISMATCH',
      'Stored governed pick execution or custody metadata is malformed.'
    );
  }
  const execution = parsed.data;
  const content = execution.content;
  if (
    execution.executionId !== executionId ||
    row.execution_id !== executionId ||
    row.content_sha256 !== executionId.slice('pick-pav-model-execution:'.length) ||
    row.observation_set_id !== content.observationSetId ||
    row.dataset_id !== content.datasetId ||
    row.dataset_artifact_id !== content.datasetArtifact.artifactId ||
    row.dataset_admission_id !== content.datasetAdmissionId ||
    row.dataset_admission_artifact_id !== content.datasetAdmissionArtifact.artifactId ||
    Number(row.dataset_admission_gate_ledger_revision) !==
      content.datasetAdmissionGateLedgerRevision ||
    row.protocol_id !== content.protocolId ||
    row.protocol_artifact_id !== content.protocolArtifact.artifactId ||
    instant(row.final_test_evaluation_started_at) !== content.finalTestEvaluationStartedAt ||
    instant(row.completed_at) !== content.completedAt ||
    row.content_canonical_json !== canonicalizeAflTradeJson(content) ||
    artifact.data.createdAt !== content.completedAt ||
    !doesAflTradeArtifactRefMatchCanonicalJson(artifact.data, execution)
  ) {
    throw new GovernedPickPavModelExecutionRepositoryError(
      'INTEGRITY_MISMATCH',
      'Stored governed pick-execution columns disagree with immutable ancestry.'
    );
  }
  await authenticatePhysicalEvidence({
    repository: dependencies.artifactRepository,
    maximumBytes: dependencies.maximumArtifactBytes,
    references: [
      artifact.data,
      content.datasetArtifact,
      content.datasetAdmissionArtifact,
      content.protocolArtifact,
    ],
  });
  return { execution, artifact: artifact.data };
}

export class PostgresGovernedPickPavModelExecutionRepository {
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
      throw new TypeError(
        'Governed pick-execution custody requires bounded private artifact storage.'
      );
    }
  }

  async register(input: {
    readonly execution: GovernedAflTradePickPavModelExecution;
    readonly artifact: AflTradeArtifactRef;
  }): Promise<RetainedGovernedPickPavModelExecution> {
    const execution = governedAflTradePickPavModelExecutionSchema.parse(input.execution);
    const artifact = aflTradeArtifactRefSchema.parse(input.artifact);
    if (
      artifact.createdAt !== execution.content.completedAt ||
      !doesAflTradeArtifactRefMatchCanonicalJson(artifact, execution)
    ) {
      throw new GovernedPickPavModelExecutionRepositoryError(
        'INTEGRITY_MISMATCH',
        'Governed pick-execution artifact does not authenticate the exact execution.'
      );
    }
    await authenticatePhysicalEvidence({
      repository: this.dependencies.artifactRepository,
      maximumBytes: this.dependencies.maximumArtifactBytes,
      references: [
        artifact,
        execution.content.datasetArtifact,
        execution.content.datasetAdmissionArtifact,
        execution.content.protocolArtifact,
      ],
    });
    return this.dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `governed-pick-pav-model-execution:${execution.executionId}`,
      ]);
      const existing = await transaction.query(
        `SELECT 1 FROM outcome_governed_pick_pav_model_execution WHERE execution_id=$1`,
        [execution.executionId]
      );
      if (existing.rowCount) {
        const replay = await loadExactFrom(
          transaction,
          this.dependencies,
          execution.executionId
        );
        if (
          canonicalizeAflTradeJson(replay) !==
          canonicalizeAflTradeJson({ execution, artifact })
        ) {
          throw new GovernedPickPavModelExecutionRepositoryError(
            'REPLAY_CONFLICT',
            'Governed pick-execution replay conflicts with retained evidence.'
          );
        }
        return replay;
      }
      const content = execution.content;
      await transaction.query(
        `INSERT INTO outcome_governed_pick_pav_model_execution
          (execution_id,observation_set_id,dataset_id,dataset_artifact_id,
           dataset_admission_id,dataset_admission_artifact_id,
           dataset_admission_gate_ledger_revision,protocol_id,protocol_artifact_id,
           execution_artifact_id,final_test_evaluation_started_at,completed_at,
           content_sha256,content_canonical_json,execution_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
        [
          execution.executionId,
          content.observationSetId,
          content.datasetId,
          content.datasetArtifact.artifactId,
          content.datasetAdmissionId,
          content.datasetAdmissionArtifact.artifactId,
          content.datasetAdmissionGateLedgerRevision,
          content.protocolId,
          content.protocolArtifact.artifactId,
          artifact.artifactId,
          content.finalTestEvaluationStartedAt,
          content.completedAt,
          execution.executionId.slice('pick-pav-model-execution:'.length),
          canonicalizeAflTradeJson(content),
          canonicalizeAflTradeJson(execution),
        ]
      );
      return loadExactFrom(transaction, this.dependencies, execution.executionId);
    });
  }

  loadExact(executionId: string): Promise<RetainedGovernedPickPavModelExecution> {
    return loadExactFrom(this.dependencies.client, this.dependencies, executionId);
  }
}
