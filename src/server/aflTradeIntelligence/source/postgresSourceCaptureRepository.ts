import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeSourceSnapshotManifestSchema,
  type AflTradeSourceSnapshotManifest,
} from '../artifacts/sourceSnapshotManifest';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';

export interface PersistedAflTradeSourceCapture {
  captureId: string;
  attemptId: string;
  sourceSnapshotId: string;
  status: 'staged';
  idempotentReplay: boolean;
}

export class AflTradeSourceCapturePersistenceError extends Error {
  constructor(
    readonly code: 'INVALID_SNAPSHOT' | 'CAPTURE_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeSourceCapturePersistenceError';
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function exactIso(value: string, name: string): string {
  let normalized: string | null = null;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    normalized = null;
  }
  if (normalized !== value) {
    throw new AflTradeSourceCapturePersistenceError(
      'INVALID_SNAPSHOT',
      `${name} must be an exact UTC ISO-8601 instant.`
    );
  }
  return value;
}

export class PostgresAflTradeSourceCaptureRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persist(
    unparsedSnapshot: AflTradeSourceSnapshotManifest
  ): Promise<PersistedAflTradeSourceCapture> {
    const parsed = aflTradeSourceSnapshotManifestSchema.safeParse(unparsedSnapshot);
    if (!parsed.success || parsed.data.content.capture.kind !== 'fitzroy') {
      throw new AflTradeSourceCapturePersistenceError(
        'INVALID_SNAPSHOT',
        'Provider capture persistence requires one valid fitzRoy source snapshot.'
      );
    }
    const snapshot = parsed.data;
    const { content } = snapshot;
    if (content.capture.kind !== 'fitzroy') {
      throw new AflTradeSourceCapturePersistenceError(
        'INVALID_SNAPSHOT',
        'Provider capture persistence cannot accept workbook metadata.'
      );
    }
    const capture = content.capture;
    const captureReceipt = content.fitzRoyCaptureReceipt;
    if (captureReceipt === null) {
      throw new AflTradeSourceCapturePersistenceError(
        'INVALID_SNAPSHOT',
        'Provider capture persistence requires its exact capture receipt.'
      );
    }
    const environment = content.gate0aReceipt.content.request.environment;
    const competition = content.gate0aReceipt.content.request.competition;
    const season = content.gate0aReceipt.content.request.season;
    const startedAt = exactIso(
      content.gate0aReceipt.content.recordedAt,
      'authorization recordedAt'
    );
    const completedAt = exactIso(captureReceipt.content.capturedAt, 'capture completedAt');
    const attemptContent = {
      schemaVersion: 'afl-trade-source-capture-attempt/v1',
      sourceSnapshotId: snapshot.snapshotId,
      captureReceiptId: captureReceipt.captureReceiptId,
      authorizationReceiptId: content.gate0aReceipt.receiptId,
      status: 'captured',
      startedAt,
      completedAt,
    } as const;
    const attemptId = createAflTradeContentAddress('source-capture-attempt', attemptContent);
    const captureId = createAflTradeContentAddress('source-capture', {
      sourceSnapshotId: snapshot.snapshotId,
      attemptId,
      sourceArtifactId: content.sourceArtifact.artifactId,
    });
    const custodyBindings = [
      { artifact: content.sourceArtifact, readback: content.readbackReceipt },
      captureReceipt.content.invocationCustody,
      captureReceipt.content.diagnosticsCustody,
      captureReceipt.content.egressExecutionCustody,
    ].filter((binding) => binding !== null);

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `outcome-source-capture:${snapshot.snapshotId}`,
      ]);
      const existingCapture = await transaction.query<{ capture_id: string }>(
        `SELECT capture_id FROM outcome_source_capture WHERE source_snapshot_id = $1 FOR SHARE`,
        [snapshot.snapshotId]
      );
      const idempotentReplay = existingCapture.rows.length === 1;
      if (existingCapture.rows.length > 1) {
        throw new AflTradeSourceCapturePersistenceError(
          'CAPTURE_CONFLICT',
          'Source snapshot has more than one capture record.'
        );
      }
      for (const binding of custodyBindings) {
        const readback = binding.readback.content;
        await transaction.query(
          `INSERT INTO outcome_artifact_custody
            (artifact_id, content_sha256, storage_uri, media_type, byte_length, artifact_class,
             environment, custody_profile_id, created_at, verified_at, custody_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (artifact_id) DO NOTHING`,
          [
            binding.artifact.artifactId,
            binding.artifact.contentSha256,
            binding.artifact.storageUri,
            binding.artifact.mediaType,
            binding.artifact.byteLength,
            readback.artifactClass,
            readback.custodyEnvironment,
            readback.custodyProfileId,
            binding.artifact.createdAt,
            readback.verifiedAt,
            binding.readback,
          ]
        );
        const stored = await transaction.query<{
          content_sha256: string;
          storage_uri: string;
          media_type: string;
          byte_length: string | number;
          artifact_class: string;
          environment: string;
          custody_profile_id: string | null;
          custody_json: unknown;
        }>(
          `SELECT content_sha256, storage_uri, media_type, byte_length, artifact_class,
                  environment, custody_profile_id, custody_json
             FROM outcome_artifact_custody WHERE artifact_id = $1 FOR SHARE`,
          [binding.artifact.artifactId]
        );
        const row = stored.rows[0];
        if (
          stored.rows.length !== 1 ||
          row?.content_sha256 !== binding.artifact.contentSha256 ||
          row.storage_uri !== binding.artifact.storageUri ||
          row.media_type !== binding.artifact.mediaType ||
          Number(row.byte_length) !== binding.artifact.byteLength ||
          row.artifact_class !== readback.artifactClass ||
          row.environment !== readback.custodyEnvironment ||
          row.custody_profile_id !== readback.custodyProfileId ||
          !sameJson(row.custody_json, binding.readback)
        ) {
          throw new AflTradeSourceCapturePersistenceError(
            'CAPTURE_CONFLICT',
            'Artifact custody already binds different immutable evidence.'
          );
        }
      }

      await transaction.query(
        `INSERT INTO outcome_source_capture_attempt
          (attempt_id, environment, provider, dataset, capability_id, evidence_artifact_id,
           status, started_at, completed_at, attempt_json)
         VALUES ($1,$2,$3,$4,$5,$6,'captured',$7,$8,$9)
         ON CONFLICT (attempt_id) DO NOTHING`,
        [
          attemptId,
          environment,
          capture.upstreamProvider,
          capture.upstreamDataset,
          capture.capabilityId,
          captureReceipt.content.diagnosticsCustody.artifact.artifactId,
          startedAt,
          completedAt,
          attemptContent,
        ]
      );
      const storedAttempt = await transaction.query<{
        environment: string;
        provider: string;
        dataset: string;
        capability_id: string | null;
        evidence_artifact_id: string | null;
        status: string;
        attempt_json: unknown;
      }>(
        `SELECT environment, provider, dataset, capability_id, evidence_artifact_id, status,
                attempt_json
           FROM outcome_source_capture_attempt WHERE attempt_id = $1 FOR SHARE`,
        [attemptId]
      );
      const attemptRow = storedAttempt.rows[0];
      if (
        storedAttempt.rows.length !== 1 ||
        attemptRow?.environment !== environment ||
        attemptRow.provider !== capture.upstreamProvider ||
        attemptRow.dataset !== capture.upstreamDataset ||
        attemptRow.capability_id !== capture.capabilityId ||
        attemptRow.evidence_artifact_id !==
          captureReceipt.content.diagnosticsCustody.artifact.artifactId ||
        attemptRow.status !== 'captured' ||
        !sameJson(attemptRow.attempt_json, attemptContent)
      ) {
        throw new AflTradeSourceCapturePersistenceError(
          'CAPTURE_CONFLICT',
          'Capture attempt already binds different immutable evidence.'
        );
      }
      await transaction.query(
        `INSERT INTO outcome_source_capture
          (capture_id, attempt_id, source_snapshot_id, source_artifact_id, environment, provider,
           dataset, dataset_version, access_mechanism, capability_id, competition,
           anchor_season_year, effective_at, captured_at, status, manifest_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'staged',$15)
         ON CONFLICT (capture_id) DO NOTHING`,
        [
          captureId,
          attemptId,
          snapshot.snapshotId,
          content.sourceArtifact.artifactId,
          environment,
          capture.upstreamProvider,
          capture.upstreamDataset,
          capture.upstreamDatasetVersion,
          capture.accessMechanism,
          capture.capabilityId,
          competition,
          season,
          content.effectiveAt,
          content.retrievedAt,
          content,
        ]
      );
      const stored = await transaction.query<{
        capture_id: string;
        attempt_id: string;
        source_artifact_id: string;
        manifest_json: unknown;
      }>(
        `SELECT capture_id, attempt_id, source_artifact_id, manifest_json
           FROM outcome_source_capture WHERE source_snapshot_id = $1 FOR SHARE`,
        [snapshot.snapshotId]
      );
      const row = stored.rows[0];
      if (
        stored.rows.length !== 1 ||
        row?.capture_id !== captureId ||
        row.attempt_id !== attemptId ||
        row.source_artifact_id !== content.sourceArtifact.artifactId ||
        !sameJson(row.manifest_json, content)
      ) {
        throw new AflTradeSourceCapturePersistenceError(
          'CAPTURE_CONFLICT',
          'Source snapshot already binds a different immutable capture.'
        );
      }
      return {
        captureId,
        attemptId,
        sourceSnapshotId: snapshot.snapshotId,
        status: 'staged',
        idempotentReplay,
      };
    });
  }
}
