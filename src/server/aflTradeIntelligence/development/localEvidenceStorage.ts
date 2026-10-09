import {
  createAflTradeByteArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  recordAflTradeEvidenceLocations,
  requireAflTradeCustodyHealthy,
  storeAndReadBackAflTradeEvidence,
} from '../artifacts/artifactStoreLocation';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { verifyAflTradeArtifactReadback } from '../artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { bindLocalAflTradeArtifactStore } from './localArtifactStoreBinding';
import { loadLocalAflTradeNonProductionStoredReference } from './localFileConditionalObjectStore';

/** The classes evidence may be stored as; `derived_private` holds private calculation outputs. */
export type AflTradeStoredEvidenceClass = 'raw_source' | 'capture_metadata' | 'derived_private';

const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

export interface AflTradeStoredEvidence {
  reference: AflTradeArtifactRef;
  storeId: string;
  objectKey: string;
  /** `recorded` writes a custody row; `already_recorded` found an identical one, and located it. */
  custody: 'recorded' | 'already_recorded';
}

/**
 * The reference to store the bytes under. A retry must reuse the original one, since the store
 * refuses the same bytes under any other creation time: first the reference already in the store
 * (bytes written by a run that stopped before recording custody), then the custody row's (a row
 * recorded as lost), and otherwise a new one.
 */
async function referenceForRetry(
  client: AflOutcomeSqlClient,
  input: {
    storeId: string;
    repositoryId: string;
    artifactClass: AflTradeStoredEvidenceClass;
    bytes: Uint8Array;
    mediaType: string;
  }
): Promise<AflTradeArtifactRef> {
  const fresh = createAflTradeByteArtifactRef(
    input.bytes,
    input.mediaType,
    new Date().toISOString()
  );
  const root = await client.query<{ root_locator: string }>(
    `SELECT root_locator FROM outcome_artifact_store WHERE store_id=$1`,
    [input.storeId]
  );
  const stored = await loadLocalAflTradeNonProductionStoredReference({
    rootDirectory: root.rows[0]!.root_locator,
    repositoryId: input.repositoryId,
    contentSha256: fresh.contentSha256,
  });
  const custody = (
    await client.query<{ created_at: string; media_type: string; artifact_class: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              media_type, artifact_class::text AS artifact_class
         FROM outcome_artifact_custody WHERE artifact_id=$1`,
      [fresh.artifactId]
    )
  ).rows[0];
  // Refused before any byte is written, so a corrected retry is not blocked by a wrong envelope.
  if (
    (custody !== undefined &&
      (custody.media_type !== input.mediaType || custody.artifact_class !== input.artifactClass)) ||
    (stored !== null && stored.mediaType !== input.mediaType)
  ) {
    throw new Error(`Evidence ${fresh.artifactId} differs from its custody row.`);
  }
  if (stored !== null) return stored;
  return custody === undefined
    ? fresh
    : createAflTradeByteArtifactRef(input.bytes, input.mediaType, custody.created_at);
}

/**
 * Stores one evidence file, such as an owner's approval record or a private grade batch, so a Gate
 * decision or reviewed record may cite it: the bytes are written to the registered local non-production store and read
 * back in full, then one transaction records the custody row and its location. Nothing is
 * recorded when the write or read-back fails. Storing the same bytes again is a no-op, and bytes
 * whose custody row already exists without a location (recorded as lost) are located again. Bytes whose custody row names another class are refused.
 */
export async function storeLocalAflTradeEvidence(
  client: AflOutcomeSqlClient,
  input: {
    storeId: string;
    repositoryId: string;
    artifactClass: AflTradeStoredEvidenceClass;
    bytes: Uint8Array;
    mediaType: string;
    maximumObjectBytes: number;
  }
): Promise<AflTradeStoredEvidence> {
  if (!MEDIA_TYPE_PATTERN.test(input.mediaType)) {
    throw new TypeError('Evidence media type must be a lowercase type/subtype.');
  }
  if (input.bytes.byteLength === 0) throw new TypeError('Evidence must not be empty.');
  // The binding refuses any store that is not a registered local non-production store.
  const store = await bindLocalAflTradeArtifactStore(client, input);
  // Refuse before writing any bytes; the transaction below checks again.
  await requireAflTradeCustodyHealthy(client, 'non_production');
  const reference = await referenceForRetry(client, input);
  await storeAndReadBackAflTradeEvidence(store, [{ reference, bytes: input.bytes }]);
  // The custody row records the read-back receipt the evidence writers record.
  const readback = await verifyAflTradeArtifactReadback(
    {
      assurance: 'local_non_production_filesystem',
      artifactClass: input.artifactClass,
      custodyProfile: null,
      putIfAbsent: (ref, bytes) => store.putIfAbsent(ref, bytes),
      loadExact: (ref, maximumBytes) => store.loadExact(ref, maximumBytes),
    },
    reference,
    new Date().toISOString(),
    input.maximumObjectBytes
  );
  return client.transaction(async (transaction) => {
    // Like reviewed registration, evidence is cited only while custody reads back cleanly.
    await requireAflTradeCustodyHealthy(transaction, 'non_production');
    const inserted = await transaction.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,$6::"OutcomeArtifactClass",'non_production',NULL,$7,$8,$9::jsonb)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [
        reference.artifactId,
        reference.contentSha256,
        reference.storageUri,
        reference.mediaType,
        reference.byteLength,
        input.artifactClass,
        reference.createdAt,
        readback.content.verifiedAt,
        canonicalizeAflTradeJson(readback),
      ]
    );
    const custody = inserted.rowCount === 1 ? 'recorded' : 'already_recorded';
    // recordAflTradeEvidenceLocations refuses a custody row whose identity differs from the bytes.
    const existing = await transaction.query<{ environment: string }>(
      `SELECT environment::text AS environment FROM outcome_artifact_custody WHERE artifact_id=$1`,
      [reference.artifactId]
    );
    if (existing.rows[0]?.environment !== 'non_production') {
      throw new Error(`Evidence ${reference.artifactId} has custody outside non_production.`);
    }
    await recordAflTradeEvidenceLocations(transaction, store, [reference]);
    const location = await transaction.query<{ store_id: string; object_key: string }>(
      `SELECT store_id, object_key FROM outcome_artifact_custody_location WHERE artifact_id=$1`,
      [reference.artifactId]
    );
    const located = location.rows[0];
    if (located === undefined) throw new Error(`Evidence ${reference.artifactId} was not located.`);
    return { reference, storeId: located.store_id, objectKey: located.object_key, custody };
  });
}
