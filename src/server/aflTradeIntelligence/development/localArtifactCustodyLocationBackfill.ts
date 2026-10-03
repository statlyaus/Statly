import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  AflTradeConditionalObjectStoreError,
  type AflTradeConditionalObjectStore,
} from '../artifacts/conditionalObjectStore';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { createLocalAflTradeFileConditionalObjectStore } from './localFileConditionalObjectStore';

const LOCAL_STORE_ASSURANCE = 'local_non_production_filesystem';
const LOCAL_STORE_ENVIRONMENT = 'non_production';
const ENVELOPE_SCHEMA_VERSION = 'statly-local-conditional-object/v1';
const ENVELOPE_FILE_PATTERN = /^[a-f0-9]{64}\.json$/u;
const MAXIMUM_ENVELOPE_FILE_BYTES = 192 * 1024 * 1024 + 1024 * 1024;
const DEFAULT_BATCH_SIZE = 500;

interface StoreRow {
  environment: string;
  assurance: string;
  root_locator: string;
}

/**
 * Registers the one local non-production filesystem store. Re-registering the same id at the same
 * root is a no-op; any other root is refused, because a store's root is permanent.
 */
export async function registerLocalAflTradeArtifactStore(
  client: AflOutcomeSqlClient,
  input: { storeId: string; rootDirectory: string }
): Promise<{ status: 'registered' | 'already_registered' }> {
  const rootDirectory = requireAbsoluteRoot(input.rootDirectory);
  const inserted = await client.query(
    `INSERT INTO outcome_artifact_store (store_id,environment,assurance,root_locator)
     VALUES ($1,$2::"OutcomeEnvironment",$3,$4)
     ON CONFLICT (store_id) DO NOTHING`,
    [input.storeId, LOCAL_STORE_ENVIRONMENT, LOCAL_STORE_ASSURANCE, rootDirectory]
  );
  if (inserted.rowCount === 1) return { status: 'registered' };
  const existing = await readStore(client, input.storeId);
  if (
    existing === null ||
    existing.environment !== LOCAL_STORE_ENVIRONMENT ||
    existing.assurance !== LOCAL_STORE_ASSURANCE
  ) {
    throw new Error(`Artifact store ${input.storeId} is not a local non-production store.`);
  }
  if (existing.root_locator !== rootDirectory) {
    throw new Error(`Artifact store ${input.storeId} is already registered at a different root.`);
  }
  return { status: 'already_registered' };
}

export interface LocalArtifactLocationBackfillReport {
  mode: 'dry_run' | 'applied';
  storeId: string;
  rootDirectory: string;
  /** Files named like an envelope (`<64 hex>.json`) that held a valid store envelope. */
  envelopesRead: number;
  /** Custody rows given a location by this run (or that would be, on a dry run). */
  located: number;
  /** Custody rows that already had this exact location. */
  alreadyLocated: number;
  /** Envelope-named files that are ordinary JSON, not store envelopes. Paths are store-relative. */
  notEnvelopes: string[];
  /** Envelopes that failed exact read-back, with the store's error code. */
  invalidEnvelopes: { path: string; reason: string }[];
  /** A second readable copy of an artifact already found earlier in this run. */
  duplicateFiles: { artifactId: string; path: string }[];
  /** Readable envelopes with no custody row. */
  filesWithoutCustody: { artifactId: string; path: string }[];
  /** Envelopes whose custody row disagrees with them; the row is left unlocated. */
  conflicts: {
    artifactId: string;
    path: string;
    reason:
      'media_type_differs' | 'byte_length_differs' | 'environment_differs' | 'located_elsewhere';
  }[];
  /** Custody rows with no location once this run's locations are counted. */
  unlocated: {
    total: number;
    byClassAndCustody: { artifactClass: string; recordedCustody: string; count: number }[];
    artifactIds: string[];
  };
}

interface FoundEnvelope {
  path: string;
  objectKey: string;
  artifactId: string;
  contentSha256: string;
  mediaType: string;
  byteLength: number;
}

type ScanEntry =
  | { kind: 'envelope'; envelope: FoundEnvelope }
  | { kind: 'not_envelope'; path: string }
  | { kind: 'invalid_envelope'; path: string; reason: string };

/**
 * Finds the bytes of existing custody rows in one registered local store and records where they
 * live. Every envelope is read back in full through the local store before it is trusted. Custody
 * rows are never changed; a row whose bytes are not found stays unlocated and is reported.
 */
export async function backfillLocalAflTradeArtifactCustodyLocations(input: {
  client: AflOutcomeSqlClient;
  storeId: string;
  rootDirectory: string;
  apply: boolean;
  batchSize?: number;
}): Promise<LocalArtifactLocationBackfillReport> {
  const rootDirectory = requireAbsoluteRoot(input.rootDirectory);
  const registered = await readStore(input.client, input.storeId);
  if (registered === null && input.apply) {
    throw new Error(
      `Artifact store ${input.storeId} must be registered before locations are recorded.`
    );
  }
  // A dry run may precede registration; it then plans against the store registration would create.
  const store: StoreRow = registered ?? {
    environment: LOCAL_STORE_ENVIRONMENT,
    assurance: LOCAL_STORE_ASSURANCE,
    root_locator: rootDirectory,
  };
  if (store.assurance !== LOCAL_STORE_ASSURANCE) {
    throw new Error(`Artifact store ${input.storeId} is not a local store.`);
  }
  if (store.root_locator !== rootDirectory) {
    throw new Error(
      `Artifact store ${input.storeId} is not rooted at ${rootDirectory}; its registered root is ${store.root_locator}.`
    );
  }
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const report: LocalArtifactLocationBackfillReport = {
    mode: input.apply ? 'applied' : 'dry_run',
    storeId: input.storeId,
    rootDirectory,
    envelopesRead: 0,
    located: 0,
    alreadyLocated: 0,
    notEnvelopes: [],
    invalidEnvelopes: [],
    duplicateFiles: [],
    filesWithoutCustody: [],
    conflicts: [],
    unlocated: { total: 0, byClassAndCustody: [], artifactIds: [] },
  };
  const seen = new Set<string>();
  const plannedLocations = new Set<string>();
  let batch: FoundEnvelope[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const pending = batch;
    batch = [];
    await locateBatch(
      input.client,
      input.storeId,
      store,
      pending,
      input.apply,
      report,
      plannedLocations
    );
  };

  for await (const entry of scanLocalArtifactStore(rootDirectory)) {
    if (entry.kind === 'not_envelope') {
      report.notEnvelopes.push(entry.path);
      continue;
    }
    if (entry.kind === 'invalid_envelope') {
      report.invalidEnvelopes.push({ path: entry.path, reason: entry.reason });
      continue;
    }
    report.envelopesRead += 1;
    if (seen.has(entry.envelope.artifactId)) {
      report.duplicateFiles.push({
        artifactId: entry.envelope.artifactId,
        path: entry.envelope.path,
      });
      continue;
    }
    seen.add(entry.envelope.artifactId);
    batch.push(entry.envelope);
    if (batch.length >= batchSize) await flush();
  }
  await flush();

  report.unlocated = await readUnlocated(input.client, plannedLocations);
  return report;
}

interface CustodyMatchRow {
  artifact_id: string;
  media_type: string;
  byte_length: string;
  environment: string;
  store_id: string | null;
  object_key: string | null;
}

async function locateBatch(
  client: AflOutcomeSqlClient,
  storeId: string,
  store: StoreRow,
  envelopes: readonly FoundEnvelope[],
  apply: boolean,
  report: LocalArtifactLocationBackfillReport,
  plannedLocations: Set<string>
): Promise<void> {
  const work = async (transaction: AflOutcomeSqlTransaction) => {
    const rows = await transaction.query<CustodyMatchRow>(
      `SELECT c.artifact_id, c.media_type, c.byte_length::text AS byte_length,
              c.environment::text AS environment, l.store_id, l.object_key
         FROM outcome_artifact_custody c
         LEFT JOIN outcome_artifact_custody_location l ON l.artifact_id=c.artifact_id
        WHERE c.artifact_id = ANY($1::text[])`,
      [envelopes.map((envelope) => envelope.artifactId)]
    );
    const custody = new Map(rows.rows.map((row) => [row.artifact_id, row]));
    const toLocate: FoundEnvelope[] = [];
    for (const envelope of envelopes) {
      const row = custody.get(envelope.artifactId);
      if (row === undefined) {
        report.filesWithoutCustody.push({ artifactId: envelope.artifactId, path: envelope.path });
      } else if (row.store_id !== null) {
        if (row.store_id === storeId && row.object_key === envelope.objectKey) {
          report.alreadyLocated += 1;
        } else {
          report.conflicts.push({
            artifactId: envelope.artifactId,
            path: envelope.path,
            reason: 'located_elsewhere',
          });
        }
      } else if (row.media_type !== envelope.mediaType) {
        report.conflicts.push({
          artifactId: envelope.artifactId,
          path: envelope.path,
          reason: 'media_type_differs',
        });
      } else if (row.byte_length !== String(envelope.byteLength)) {
        report.conflicts.push({
          artifactId: envelope.artifactId,
          path: envelope.path,
          reason: 'byte_length_differs',
        });
      } else if (row.environment !== store.environment) {
        report.conflicts.push({
          artifactId: envelope.artifactId,
          path: envelope.path,
          reason: 'environment_differs',
        });
      } else {
        toLocate.push(envelope);
      }
    }
    if (toLocate.length === 0) return;
    if (apply) {
      const inserted = await transaction.query(
        `INSERT INTO outcome_artifact_custody_location (artifact_id,store_id,object_key)
         SELECT artifact_id, $1, object_key
           FROM unnest($2::text[], $3::text[]) AS located(artifact_id, object_key)`,
        [
          storeId,
          toLocate.map((envelope) => envelope.artifactId),
          toLocate.map((envelope) => envelope.objectKey),
        ]
      );
      if (inserted.rowCount !== toLocate.length) {
        throw new Error('Artifact location backfill inserted an unexpected number of rows.');
      }
    }
    report.located += toLocate.length;
    for (const envelope of toLocate) plannedLocations.add(envelope.artifactId);
  };
  if (apply) await client.transaction(work);
  else await work(client);
}

async function readUnlocated(
  client: AflOutcomeSqlClient,
  plannedLocations: ReadonlySet<string>
): Promise<LocalArtifactLocationBackfillReport['unlocated']> {
  const rows = await client.query<{
    artifact_id: string;
    artifact_class: string;
    recorded_custody: string;
  }>(
    `SELECT c.artifact_id, c.artifact_class::text AS artifact_class,
            COALESCE(c.custody_json->>'rootDirectory',
                     c.custody_json->'content'->>'repositoryAssurance',
                     'unrecorded') AS recorded_custody
       FROM outcome_artifact_custody c
      WHERE NOT EXISTS (
        SELECT 1 FROM outcome_artifact_custody_location l WHERE l.artifact_id=c.artifact_id)
      ORDER BY c.artifact_id`
  );
  const counts = new Map<
    string,
    { artifactClass: string; recordedCustody: string; count: number }
  >();
  const artifactIds: string[] = [];
  for (const row of rows.rows) {
    if (plannedLocations.has(row.artifact_id)) continue;
    artifactIds.push(row.artifact_id);
    const key = `${row.artifact_class}\u0000${row.recorded_custody}`;
    const group = counts.get(key) ?? {
      artifactClass: row.artifact_class,
      recordedCustody: row.recorded_custody,
      count: 0,
    };
    group.count += 1;
    counts.set(key, group);
  }
  const byClassAndCustody = [...counts.values()].sort(
    (left, right) =>
      left.artifactClass.localeCompare(right.artifactClass) ||
      left.recordedCustody.localeCompare(right.recordedCustody)
  );
  return { total: artifactIds.length, byClassAndCustody, artifactIds };
}

async function readStore(client: AflOutcomeSqlClient, storeId: string): Promise<StoreRow | null> {
  const result = await client.query<StoreRow>(
    `SELECT environment::text AS environment, assurance, root_locator
       FROM outcome_artifact_store WHERE store_id=$1`,
    [storeId]
  );
  return result.rows[0] ?? null;
}

function requireAbsoluteRoot(rootDirectory: string): string {
  if (!isAbsolute(rootDirectory)) {
    throw new TypeError('A local artifact store root must be an absolute path.');
  }
  return resolve(rootDirectory);
}

function toStoreRelative(rootDirectory: string, path: string): string {
  return relative(rootDirectory, path).split(sep).join('/');
}

/**
 * Walks a store root in sorted order, without following links. Each directory holding envelopes is
 * one repository; an artifact's object key is that directory, relative to the root, joined to the
 * envelope's own key, so the key alone resolves the file from the store root.
 */
async function* scanLocalArtifactStore(rootDirectory: string): AsyncGenerator<ScanEntry> {
  const repositories = new Map<string, AflTradeConditionalObjectStore>();
  const pending = [rootDirectory];
  while (pending.length > 0) {
    const directory = pending.shift() as string;
    const entries: Dirent[] = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const subdirectories: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        subdirectories.push(path);
        continue;
      }
      if (!entry.isFile() || !ENVELOPE_FILE_PATTERN.test(entry.name)) continue;
      yield await readEnvelopeFile(rootDirectory, directory, path, repositories);
    }
    pending.unshift(...subdirectories);
  }
}

async function readEnvelopeFile(
  rootDirectory: string,
  directory: string,
  path: string,
  repositories: Map<string, AflTradeConditionalObjectStore>
): Promise<ScanEntry> {
  const relativePath = toStoreRelative(rootDirectory, path);
  if ((await stat(path)).size > MAXIMUM_ENVELOPE_FILE_BYTES) {
    return { kind: 'invalid_envelope', path: relativePath, reason: 'OBJECT_TOO_LARGE' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { kind: 'not_envelope', path: relativePath };
  }
  const identity = (parsed as { schemaVersion?: unknown; identity?: { objectKey?: unknown } })
    ?.identity;
  if (
    (parsed as { schemaVersion?: unknown })?.schemaVersion !== ENVELOPE_SCHEMA_VERSION ||
    typeof identity?.objectKey !== 'string'
  ) {
    return { kind: 'not_envelope', path: relativePath };
  }
  const innerKey = identity.objectKey;
  const fileName = path.slice(directory.length + 1);
  if (`${createHash('sha256').update(innerKey, 'utf8').digest('hex')}.json` !== fileName) {
    return { kind: 'invalid_envelope', path: relativePath, reason: 'KEY_MISMATCH' };
  }
  let repository = repositories.get(directory);
  if (repository === undefined) {
    repository = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: directory });
    repositories.set(directory, repository);
  }
  try {
    // headExact re-reads the envelope and checks its bytes against their SHA-256.
    const head = await repository.headExact({ objectKey: innerKey });
    if (head === null) {
      return { kind: 'invalid_envelope', path: relativePath, reason: 'NOT_FOUND' };
    }
    const repositoryPath = toStoreRelative(rootDirectory, directory);
    return {
      kind: 'envelope',
      envelope: {
        path: relativePath,
        objectKey: repositoryPath === '' ? innerKey : `${repositoryPath}/${innerKey}`,
        artifactId: `artifact:${head.checksumSha256}`,
        contentSha256: head.checksumSha256,
        mediaType: head.mediaType,
        byteLength: head.byteLength,
      },
    };
  } catch (error) {
    return {
      kind: 'invalid_envelope',
      path: relativePath,
      reason: error instanceof AflTradeConditionalObjectStoreError ? error.code : 'UNREADABLE',
    };
  }
}
