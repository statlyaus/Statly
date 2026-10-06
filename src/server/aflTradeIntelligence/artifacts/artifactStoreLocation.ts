import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import { doesAflTradeArtifactRefMatchBytes, type AflTradeArtifactRef } from './artifactReference';
import type {
  AflTradeArtifactStoreLocation,
  AflTradeImmutableArtifactRepository,
} from './immutableArtifactRepository';

/**
 * One repository inside a registered artifact store. Reviewed registration writes evidence bytes
 * through it, and records the location it reports, before any record may cite the evidence.
 */
export interface AflTradeEvidenceStoreBinding {
  readonly storeId: string;
  putIfAbsent(
    reference: AflTradeArtifactRef,
    bytes: Uint8Array
  ): Promise<{ status: 'stored' | 'already_present'; reference: AflTradeArtifactRef }>;
  loadExact(
    reference: AflTradeArtifactRef,
    maximumBytes: number
  ): Promise<{ reference: AflTradeArtifactRef; bytes: Uint8Array } | null>;
  /** The store-relative key of the bytes; it ends in the artifact's own SHA-256 path. */
  objectKeyFor(reference: AflTradeArtifactRef): string;
}

/** Evidence cited by a reviewed record whose custody row has no recorded store location. */
export class AflTradeArtifactUnlocatedError extends Error {
  readonly code = 'ARTIFACT_UNLOCATED' as const;

  constructor(readonly artifactIds: readonly string[]) {
    super(`Evidence has no recorded store location: ${artifactIds.join(', ')}.`);
    this.name = 'AflTradeArtifactUnlocatedError';
  }
}

/**
 * Writes each artifact's bytes to the store and reads them back in full. It runs before the
 * transaction that records anything, so a failed write or read-back leaves no row behind.
 */
export async function storeAndReadBackAflTradeEvidence(
  store: AflTradeEvidenceStoreBinding,
  evidence: readonly { reference: AflTradeArtifactRef; bytes: Uint8Array }[]
): Promise<void> {
  for (const { reference, bytes } of evidence) {
    await store.putIfAbsent(reference, bytes);
    const readback = await store.loadExact(reference, reference.byteLength);
    if (readback === null || !doesAflTradeArtifactRefMatchBytes(reference, readback.bytes)) {
      throw new Error(
        `Evidence ${reference.artifactId} did not read back exactly from store ${store.storeId}.`
      );
    }
  }
}

/**
 * Records where each artifact's bytes live. Custody must already exist and match the reference; an
 * artifact that is already located keeps its location, since its bytes are known to be retained.
 */
export async function recordAflTradeEvidenceLocations(
  transaction: AflOutcomeSqlTransaction,
  store: AflTradeArtifactStoreLocation,
  references: readonly AflTradeArtifactRef[]
): Promise<void> {
  for (const reference of references) {
    const custody = await transaction.query<{
      content_sha256: string;
      media_type: string;
      byte_length: string;
    }>(
      `SELECT content_sha256, media_type, byte_length::text AS byte_length
         FROM outcome_artifact_custody WHERE artifact_id=$1`,
      [reference.artifactId]
    );
    const row = custody.rows[0];
    if (row === undefined) {
      throw new Error(`Evidence ${reference.artifactId} has no custody row.`);
    }
    if (
      row.content_sha256 !== reference.contentSha256 ||
      row.media_type !== reference.mediaType ||
      row.byte_length !== String(reference.byteLength)
    ) {
      throw new Error(`Evidence ${reference.artifactId} differs from its custody row.`);
    }
    await transaction.query(
      `INSERT INTO outcome_artifact_custody_location (artifact_id,store_id,object_key)
       VALUES ($1,$2,$3) ON CONFLICT (artifact_id) DO NOTHING`,
      [reference.artifactId, store.storeId, store.objectKeyFor(reference)]
    );
  }
}

/** Refuses with {@link AflTradeArtifactUnlocatedError} when any cited artifact has no location. */
export async function requireAflTradeEvidenceLocated(
  transaction: AflOutcomeSqlTransaction,
  artifactIds: readonly string[]
): Promise<void> {
  if (artifactIds.length === 0) return;
  const result = await transaction.query<{ artifact_id: string }>(
    `SELECT cited.artifact_id
       FROM unnest($1::text[]) AS cited(artifact_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM outcome_artifact_custody_location l WHERE l.artifact_id=cited.artifact_id)
      ORDER BY cited.artifact_id`,
    [[...new Set(artifactIds)]]
  );
  if (result.rows.length > 0) {
    throw new AflTradeArtifactUnlocatedError(result.rows.map((row) => row.artifact_id));
  }
}

/**
 * Records where a store-rooted repository keeps each artifact, in the transaction that wrote the
 * artifacts' custody rows. A repository outside any registered store records nothing.
 */
export async function recordAflTradeRepositoryLocations(
  transaction: AflOutcomeSqlTransaction,
  repository: Pick<AflTradeImmutableArtifactRepository, 'storeLocation'>,
  references: readonly AflTradeArtifactRef[]
): Promise<void> {
  if (repository.storeLocation === undefined || references.length === 0) return;
  await recordAflTradeEvidenceLocations(transaction, repository.storeLocation, references);
}

/** Reviewed registration while the environment's latest custody readback is stale or failed. */
export class AflTradeCustodyUnhealthyError extends Error {
  readonly code = 'CUSTODY_UNHEALTHY' as const;

  constructor(readonly environment: string) {
    super(
      `Evidence custody in ${environment} is not healthy: the latest readback is older than 48 hours, failed or absent.`
    );
    this.name = 'AflTradeCustodyUnhealthyError';
  }
}

/**
 * Refuses with {@link AflTradeCustodyUnhealthyError} unless the environment's latest custody
 * readback finished under 48 hours ago with zero failures (`outcome_artifact_custody_healthy`).
 */
export async function requireAflTradeCustodyHealthy(
  transaction: AflOutcomeSqlTransaction,
  environment: string
): Promise<void> {
  const result = await transaction.query<{ healthy: boolean }>(
    `SELECT outcome_artifact_custody_healthy($1::"OutcomeEnvironment") AS healthy`,
    [environment]
  );
  if (result.rows[0]?.healthy !== true) throw new AflTradeCustodyUnhealthyError(environment);
}
