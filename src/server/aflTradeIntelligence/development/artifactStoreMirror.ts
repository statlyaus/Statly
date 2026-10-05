import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createLocalAflTradeFileConditionalObjectStore } from './localFileConditionalObjectStore';

const LOCAL_STORE_ASSURANCE = 'local_non_production_filesystem';
const MIRROR_PATTERN = /^gs:\/\/[a-z0-9][a-z0-9._-]{1,61}[a-z0-9](\/[A-Za-z0-9._-]+)*$/u;

/** Runs one Cloud Storage CLI command; injected so the database rules are testable offline. */
export type AflTradeCloudStorageCommand = (args: readonly string[]) => Promise<void>;

interface LocalStore {
  storeId: string;
  environment: string;
  rootLocator: string;
  mirrorLocator: string | null;
}

async function loadLocalStore(client: AflOutcomeSqlClient, storeId: string): Promise<LocalStore> {
  const row = (
    await client.query<{
      environment: string;
      assurance: string;
      root_locator: string;
      mirror_locator: string | null;
    }>(
      `SELECT environment::text AS environment, assurance, root_locator, mirror_locator
         FROM outcome_artifact_store WHERE store_id=$1`,
      [storeId]
    )
  ).rows[0];
  if (row === undefined) throw new Error(`Artifact store ${storeId} is not registered.`);
  if (row.assurance !== LOCAL_STORE_ASSURANCE || row.environment !== 'non_production') {
    throw new Error(`Artifact store ${storeId} is not a local non-production store.`);
  }
  return {
    storeId,
    environment: row.environment,
    rootLocator: resolve(row.root_locator),
    mirrorLocator: row.mirror_locator,
  };
}

/**
 * Copies a store's envelopes to its versioned Cloud Storage mirror after a clean custody readback,
 * and records the mirror locator on the store the first time. The copy never deletes: a versioned
 * bucket keeps every object it has received, and a store keeps one mirror for life.
 */
export async function mirrorLocalAflTradeArtifactStore(input: {
  client: AflOutcomeSqlClient;
  storeId: string;
  mirrorLocator: string;
  runCloudStorage: AflTradeCloudStorageCommand;
}): Promise<{
  storeId: string;
  mirrorLocator: string;
  recordedLocator: boolean;
  syncedAt: string;
}> {
  if (!MIRROR_PATTERN.test(input.mirrorLocator)) {
    throw new TypeError('A mirror locator must be a gs:// bucket path.');
  }
  const store = await loadLocalStore(input.client, input.storeId);
  if (store.mirrorLocator !== null && store.mirrorLocator !== input.mirrorLocator) {
    throw new Error(
      `Artifact store ${store.storeId} already mirrors to ${store.mirrorLocator}; a store keeps one mirror.`
    );
  }
  const health = await input.client.query<{ healthy: boolean }>(
    `SELECT outcome_artifact_custody_healthy($1::"OutcomeEnvironment") AS healthy`,
    [store.environment]
  );
  if (health.rows[0]?.healthy !== true) {
    throw new Error('The store mirrors only after a clean custody readback under 48 hours old.');
  }
  const startedAt = await databaseNow(input.client);
  // Never copy an envelope the store is still writing (`.pending-*.json`, renamed on publish).
  await input.runCloudStorage([
    'rsync',
    '--recursive',
    '--exclude',
    PENDING_ENVELOPE_PATTERN,
    store.rootLocator,
    input.mirrorLocator,
  ]);
  let recordedLocator = false;
  if (store.mirrorLocator === null) {
    const updated = await input.client.query(
      `UPDATE outcome_artifact_store SET mirror_locator=$2 WHERE store_id=$1 AND mirror_locator IS NULL`,
      [store.storeId, input.mirrorLocator]
    );
    if (updated.rowCount === 1) {
      recordedLocator = true;
    } else if (
      (await loadLocalStore(input.client, store.storeId)).mirrorLocator !== input.mirrorLocator
    ) {
      throw new Error(
        `Artifact store ${store.storeId} recorded another mirror concurrently; a store keeps one mirror.`
      );
    }
  }
  const finishedAt = await databaseNow(input.client);
  await input.client.query(
    `INSERT INTO outcome_artifact_mirror_sync (sync_id,store_id,mirror_locator,started_at,finished_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      `artifact-mirror-sync:${randomUUID()}`,
      store.storeId,
      input.mirrorLocator,
      startedAt,
      finishedAt,
    ]
  );
  return {
    storeId: store.storeId,
    mirrorLocator: input.mirrorLocator,
    recordedLocator,
    syncedAt: finishedAt,
  };
}

/** Matches the store's in-progress envelopes at any depth (`gcloud storage rsync --exclude`). */
export const PENDING_ENVELOPE_PATTERN = String.raw`(^|.*/)\.pending-[^/]*\.json$`;

async function databaseNow(client: AflOutcomeSqlClient): Promise<string> {
  const result = await client.query<{ at: string }>(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
  );
  return result.rows[0]!.at;
}

export interface AflTradeMirrorRestoreReceipt {
  receipt: 'afl-trade-artifact-mirror-restore/v1';
  receiptId: string;
  storeId: string;
  mirrorLocator: string;
  artifactId: string;
  artifactClass: string;
  objectKey: string;
  mirrorObject: string;
  expected: { contentSha256: string; byteLength: number };
  restored: { contentSha256: string; byteLength: number } | null;
  verdict: 'exact' | 'mismatch' | 'unreadable';
  testedAt: string;
}

/**
 * Restore test: reads one random located artifact back from the store's mirror into a scratch
 * directory and verifies it through the store's own envelope reader against the custody row.
 */
export async function restoreTestLocalAflTradeArtifactMirror(input: {
  client: AflOutcomeSqlClient;
  storeId: string;
  runCloudStorage: AflTradeCloudStorageCommand;
}): Promise<AflTradeMirrorRestoreReceipt> {
  const store = await loadLocalStore(input.client, input.storeId);
  if (store.mirrorLocator === null) {
    throw new Error(`Artifact store ${store.storeId} has no recorded mirror.`);
  }
  // Only locations recorded before the latest finished sync started are known to be mirrored.
  const sync = (
    await input.client.query<{ started_at: Date }>(
      `SELECT started_at FROM outcome_artifact_mirror_sync
        WHERE store_id=$1 AND mirror_locator=$2 ORDER BY finished_at DESC LIMIT 1`,
      [store.storeId, store.mirrorLocator]
    )
  ).rows[0];
  if (sync === undefined) {
    throw new Error(`Artifact store ${store.storeId} has no finished mirror sync.`);
  }
  const row = (
    await input.client.query<{
      artifact_id: string;
      artifact_class: string;
      content_sha256: string;
      byte_length: string;
      object_key: string;
    }>(
      `SELECT custody.artifact_id,custody.artifact_class::text AS artifact_class,
              custody.content_sha256,custody.byte_length::text AS byte_length,location.object_key
         FROM outcome_artifact_custody_location location
         JOIN outcome_artifact_custody custody USING (artifact_id)
        WHERE location.store_id=$1 AND location.located_at<=$2
        ORDER BY random() LIMIT 1`,
      [store.storeId, sync.started_at]
    )
  ).rows[0];
  if (row === undefined) {
    throw new Error(`Artifact store ${store.storeId} has no custody mirrored by its latest sync.`);
  }
  const separator = row.object_key.indexOf('/');
  if (separator <= 0) throw new Error(`Location key ${row.object_key} names no repository.`);
  const repositoryId = row.object_key.slice(0, separator);
  const repositoryKey = row.object_key.slice(separator + 1);
  // The local store keeps each object as an envelope named by the SHA-256 of its repository key.
  const envelope = `${createHash('sha256').update(repositoryKey).digest('hex')}.json`;
  const mirrorObject = `${store.mirrorLocator}/${repositoryId}/${envelope}`;
  const scratch = await mkdtemp(join(tmpdir(), 'statly-mirror-restore-'));
  let restored: AflTradeMirrorRestoreReceipt['restored'] = null;
  try {
    await mkdir(join(scratch, repositoryId), { recursive: true });
    await input.runCloudStorage(['cp', mirrorObject, join(scratch, repositoryId, envelope)]);
    const identity = await createLocalAflTradeFileConditionalObjectStore({
      rootDirectory: join(scratch, repositoryId),
    }).headExact({ objectKey: repositoryKey });
    if (identity !== null) {
      restored = { contentSha256: identity.checksumSha256, byteLength: identity.byteLength };
    }
  } catch {
    restored = null;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const expected = { contentSha256: row.content_sha256, byteLength: Number(row.byte_length) };
  return {
    receipt: 'afl-trade-artifact-mirror-restore/v1',
    receiptId: `artifact-mirror-restore:${randomUUID()}`,
    storeId: store.storeId,
    mirrorLocator: store.mirrorLocator,
    artifactId: row.artifact_id,
    artifactClass: row.artifact_class,
    objectKey: row.object_key,
    mirrorObject,
    expected,
    restored,
    verdict:
      restored === null
        ? 'unreadable'
        : restored.contentSha256 === expected.contentSha256 &&
            restored.byteLength === expected.byteLength
          ? 'exact'
          : 'mismatch',
    testedAt: new Date().toISOString(),
  };
}
