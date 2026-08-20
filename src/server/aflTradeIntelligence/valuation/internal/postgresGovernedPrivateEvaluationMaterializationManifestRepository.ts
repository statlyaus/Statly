import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import {
  governedPrivateEvaluationMaterializationManifestSchema,
  type GovernedPrivateEvaluationMaterializationManifest,
} from './governedPrivateEvaluationMaterializationManifest';

interface MaterializationManifestRow {
  readonly materialization_manifest_id: string;
  readonly content_sha256: string;
  readonly valuation_scope_key: string;
  readonly trade_id: string;
  readonly created_at: Date | string;
  readonly content_canonical_json: string;
  readonly manifest_canonical_json: string;
  readonly manifest_json: unknown;
  readonly artifact_id: string;
  readonly artifact_content_sha256: string;
  readonly storage_uri: string;
  readonly media_type: string;
  readonly byte_length: string | number | bigint;
  readonly artifact_created_at: Date | string;
  readonly artifact_environment: string;
  readonly artifact_class: string;
}

export interface RetainedGovernedPrivateEvaluationMaterializationManifest {
  readonly manifest: GovernedPrivateEvaluationMaterializationManifest;
  readonly artifact: AflTradeArtifactRef;
}

export class GovernedPrivateEvaluationMaterializationManifestRepositoryError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INTEGRITY_MISMATCH' | 'REPLAY_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'GovernedPrivateEvaluationMaterializationManifestRepositoryError';
  }
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function digestFromManifestId(manifestId: string): string {
  return manifestId.slice('private-evaluation-materialization-manifest:'.length);
}

async function loadExactFrom(
  client: AflOutcomeSqlTransaction,
  manifestId: string
): Promise<RetainedGovernedPrivateEvaluationMaterializationManifest> {
  const result = await client.query<MaterializationManifestRow>(
    `SELECT manifest.materialization_manifest_id,manifest.content_sha256,
       manifest.valuation_scope_key,manifest.trade_id,manifest.created_at,
       manifest.content_canonical_json,manifest.manifest_canonical_json,manifest.manifest_json,
       artifact.artifact_id,artifact.content_sha256 AS artifact_content_sha256,
       artifact.storage_uri,artifact.media_type,artifact.byte_length,
       artifact.created_at AS artifact_created_at,artifact.environment::text AS artifact_environment,
       artifact.artifact_class::text AS artifact_class
      FROM outcome_private_evaluation_materialization_manifest manifest
      JOIN outcome_artifact_custody artifact ON artifact.artifact_id=manifest.artifact_id
     WHERE manifest.materialization_manifest_id=$1`,
    [manifestId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new GovernedPrivateEvaluationMaterializationManifestRepositoryError(
      'NOT_FOUND',
      'Private evaluation materialization manifest was not found.'
    );
  }

  const parsedManifest = governedPrivateEvaluationMaterializationManifestSchema.safeParse(
    row.manifest_json
  );
  const parsedArtifact = aflTradeArtifactRefSchema.safeParse({
    artifactId: row.artifact_id,
    contentSha256: row.artifact_content_sha256,
    storageUri: row.storage_uri,
    mediaType: row.media_type,
    byteLength: Number(row.byte_length),
    createdAt: instant(row.artifact_created_at),
  });
  if (!parsedManifest.success || !parsedArtifact.success) {
    throw new GovernedPrivateEvaluationMaterializationManifestRepositoryError(
      'INTEGRITY_MISMATCH',
      'Stored materialization manifest or artifact custody is malformed.'
    );
  }
  const manifest = parsedManifest.data;
  const artifact = parsedArtifact.data;
  if (
    manifest.manifestId !== manifestId ||
    row.materialization_manifest_id !== manifestId ||
    row.content_sha256 !== digestFromManifestId(manifestId) ||
    row.valuation_scope_key !== manifest.content.selector.valuationScopeKey ||
    row.trade_id !== manifest.content.selector.tradeId ||
    instant(row.created_at) !== manifest.content.createdAt ||
    row.content_canonical_json !== canonicalizeAflTradeJson(manifest.content) ||
    row.manifest_canonical_json !== canonicalizeAflTradeJson(manifest) ||
    row.artifact_environment !== 'non_production' ||
    row.artifact_class !== 'derived_private' ||
    artifact.createdAt !== manifest.content.createdAt ||
    !doesAflTradeArtifactRefMatchCanonicalJson(artifact, manifest)
  ) {
    throw new GovernedPrivateEvaluationMaterializationManifestRepositoryError(
      'INTEGRITY_MISMATCH',
      'Stored materialization manifest disagrees with its immutable identity or custody.'
    );
  }
  return { manifest, artifact };
}

export class PostgresGovernedPrivateEvaluationMaterializationManifestRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async register(input: {
    readonly manifest: GovernedPrivateEvaluationMaterializationManifest;
    readonly artifact: AflTradeArtifactRef;
  }): Promise<RetainedGovernedPrivateEvaluationMaterializationManifest> {
    const manifest = governedPrivateEvaluationMaterializationManifestSchema.parse(input.manifest);
    const artifact = aflTradeArtifactRefSchema.parse(input.artifact);
    if (
      artifact.createdAt !== manifest.content.createdAt ||
      !doesAflTradeArtifactRefMatchCanonicalJson(artifact, manifest)
    ) {
      throw new GovernedPrivateEvaluationMaterializationManifestRepositoryError(
        'INTEGRITY_MISMATCH',
        'Materialization manifest artifact does not authenticate the exact manifest bytes.'
      );
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `private-evaluation-materialization-manifest:${manifest.manifestId}`,
      ]);
      const existing = await transaction.query(
        `SELECT 1 FROM outcome_private_evaluation_materialization_manifest
          WHERE materialization_manifest_id=$1`,
        [manifest.manifestId]
      );
      if (existing.rowCount) {
        const replay = await loadExactFrom(transaction, manifest.manifestId);
        if (
          canonicalizeAflTradeJson(replay) !== canonicalizeAflTradeJson({ manifest, artifact })
        ) {
          throw new GovernedPrivateEvaluationMaterializationManifestRepositoryError(
            'REPLAY_CONFLICT',
            'Materialization manifest replay conflicts with retained evidence.'
          );
        }
        return replay;
      }
      await transaction.query(
        `INSERT INTO outcome_private_evaluation_materialization_manifest
          (materialization_manifest_id,content_sha256,valuation_scope_key,trade_id,artifact_id,
           created_at,content_canonical_json,manifest_canonical_json,manifest_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          manifest.manifestId,
          digestFromManifestId(manifest.manifestId),
          manifest.content.selector.valuationScopeKey,
          manifest.content.selector.tradeId,
          artifact.artifactId,
          manifest.content.createdAt,
          canonicalizeAflTradeJson(manifest.content),
          canonicalizeAflTradeJson(manifest),
          canonicalizeAflTradeJson(manifest),
        ]
      );
      return loadExactFrom(transaction, manifest.manifestId);
    });
  }

  loadExact(
    manifestId: string
  ): Promise<RetainedGovernedPrivateEvaluationMaterializationManifest> {
    return loadExactFrom(this.client, manifestId);
  }
}
