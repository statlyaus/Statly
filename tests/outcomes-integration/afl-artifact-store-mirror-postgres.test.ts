import { chmod, cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { recordAflTradeEvidenceLocations } from '@/server/aflTradeIntelligence/artifacts/artifactStoreLocation';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  mirrorLocalAflTradeArtifactStore,
  PENDING_ENVELOPE_PATTERN,
  restoreTestLocalAflTradeArtifactMirror,
  type AflTradeCloudStorageCommand,
} from '@/server/aflTradeIntelligence/development/artifactStoreMirror';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { readBackLocalAflTradeArtifactCustody } from '@/server/aflTradeIntelligence/development/localArtifactCustodyReadback';
import { bindLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactStoreBinding';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `store_mirror_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const client = createPgAflOutcomeSqlClient(pool);
const STORE_ID = 'mirror-test-store';
const MIRROR = 'gs://statly-test-mirror/mirror-test-store';
let storeRoot = '';
let bucketRoot = '';

/** A local stand-in for `gcloud storage`: gs://statly-test-mirror maps to a scratch directory. */
const commands: string[][] = [];
const fakeCloudStorage: AflTradeCloudStorageCommand = async (args) => {
  commands.push([...args]);
  const local = (path: string) => path.replace('gs://statly-test-mirror', bucketRoot);
  if (args[0] === 'rsync') {
    const [source, destination] = args.slice(-2);
    await cp(source!, local(destination!), { recursive: true, force: false, errorOnExist: false });
  } else if (args[0] === 'cp') {
    await cp(local(args[1]!), args[2]!);
  } else {
    throw new Error(`Unexpected cloud storage command ${args[0]}.`);
  }
};

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  storeRoot = await mkdtemp(join(tmpdir(), 'statly-mirror-store-'));
  bucketRoot = await mkdtemp(join(tmpdir(), 'statly-mirror-bucket-'));
  await registerLocalAflTradeArtifactStore(client, { storeId: STORE_ID, rootDirectory: storeRoot });
  const store = await bindLocalAflTradeArtifactStore(client, {
    storeId: STORE_ID,
    repositoryId: 'mirror-raw',
    artifactClass: 'raw_source',
    maximumObjectBytes: 1024 * 1024,
  });
  for (const label of ['first', 'second']) {
    const ref = createAflTradeCanonicalJsonArtifactRef({ label }, '2026-09-01T00:00:00.000Z');
    await store.putIfAbsent(ref, new TextEncoder().encode(canonicalizeAflTradeJson({ label })));
    await pool.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',$6,$6,'{}')`,
      [
        ref.artifactId,
        ref.contentSha256,
        ref.storageUri,
        ref.mediaType,
        ref.byteLength,
        ref.createdAt,
      ]
    );
    await client.transaction((transaction) =>
      recordAflTradeEvidenceLocations(transaction, store, [ref])
    );
  }
}, 120_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  await admin.end();
  await rm(storeRoot, { recursive: true, force: true });
  await rm(bucketRoot, { recursive: true, force: true });
});

const mirrorLocator = async () =>
  (
    await pool.query<{ mirror_locator: string | null }>(
      'SELECT mirror_locator FROM outcome_artifact_store WHERE store_id=$1',
      [STORE_ID]
    )
  ).rows[0]!.mirror_locator;

it('mirrors only after a clean readback, records the mirror once and restores exactly', async () => {
  // No clean readback yet: nothing is copied and no mirror is recorded.
  await expect(
    mirrorLocalAflTradeArtifactStore({
      client,
      storeId: STORE_ID,
      mirrorLocator: MIRROR,
      runCloudStorage: fakeCloudStorage,
    })
  ).rejects.toThrow('clean custody readback');
  expect(commands).toEqual([]);
  expect(await mirrorLocator()).toBeNull();
  // No finished sync yet: there is nothing to restore-test.
  await expect(
    restoreTestLocalAflTradeArtifactMirror({
      client,
      storeId: STORE_ID,
      runCloudStorage: fakeCloudStorage,
    })
  ).rejects.toThrow('no recorded mirror');

  await readBackLocalAflTradeArtifactCustody({ client, storeId: STORE_ID });
  await expect(
    mirrorLocalAflTradeArtifactStore({
      client,
      storeId: STORE_ID,
      mirrorLocator: MIRROR,
      runCloudStorage: fakeCloudStorage,
    })
  ).resolves.toMatchObject({ storeId: STORE_ID, mirrorLocator: MIRROR, recordedLocator: true });
  expect(commands).toEqual([
    ['rsync', '--recursive', '--exclude', PENDING_ENVELOPE_PATTERN, storeRoot, MIRROR],
  ]);
  const pending = new RegExp(PENDING_ENVELOPE_PATTERN, 'u');
  expect(pending.test('mirror-raw/.pending-abc-123.json')).toBe(true);
  expect(pending.test('.pending-abc.json')).toBe(true);
  expect(pending.test(`mirror-raw/${'a'.repeat(64)}.json`)).toBe(false);
  expect(
    (
      await pool.query<{ syncs: number }>(
        'SELECT count(*)::integer AS syncs FROM outcome_artifact_mirror_sync WHERE store_id=$1',
        [STORE_ID]
      )
    ).rows[0]!.syncs
  ).toBe(1);
  expect(await mirrorLocator()).toBe(MIRROR);
  expect(await readdir(join(bucketRoot, 'mirror-test-store', 'mirror-raw'))).toHaveLength(2);

  // A later sync keeps the same mirror; another bucket is refused, and the locator cannot change.
  await expect(
    mirrorLocalAflTradeArtifactStore({
      client,
      storeId: STORE_ID,
      mirrorLocator: MIRROR,
      runCloudStorage: fakeCloudStorage,
    })
  ).resolves.toMatchObject({ recordedLocator: false });
  await expect(
    mirrorLocalAflTradeArtifactStore({
      client,
      storeId: STORE_ID,
      mirrorLocator: 'gs://another-bucket/store',
      runCloudStorage: fakeCloudStorage,
    })
  ).rejects.toThrow('keeps one mirror');
  await expect(
    pool.query(
      `UPDATE outcome_artifact_store SET mirror_locator='gs://another-bucket/x' WHERE store_id=$1`,
      [STORE_ID]
    )
  ).rejects.toThrow('mirror locator, once');

  // An artifact located after the latest sync is not yet mirrored and is never sampled.
  const late = await bindLocalAflTradeArtifactStore(client, {
    storeId: STORE_ID,
    repositoryId: 'mirror-raw',
    artifactClass: 'raw_source',
    maximumObjectBytes: 1024 * 1024,
  });
  const lateRef = createAflTradeCanonicalJsonArtifactRef(
    { label: 'late' },
    '2026-09-01T00:00:00.000Z'
  );
  await late.putIfAbsent(
    lateRef,
    new TextEncoder().encode(canonicalizeAflTradeJson({ label: 'late' }))
  );
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',$6,$6,'{}')`,
    [
      lateRef.artifactId,
      lateRef.contentSha256,
      lateRef.storageUri,
      lateRef.mediaType,
      lateRef.byteLength,
      lateRef.createdAt,
    ]
  );
  await client.transaction((transaction) =>
    recordAflTradeEvidenceLocations(transaction, late, [lateRef])
  );
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const sampled = await restoreTestLocalAflTradeArtifactMirror({
      client,
      storeId: STORE_ID,
      runCloudStorage: fakeCloudStorage,
    });
    expect(sampled.artifactId).not.toBe(lateRef.artifactId);
    expect(sampled.verdict).toBe('exact');
  }

  // The restore test reads a random located artifact back from the mirror.
  const restored = await restoreTestLocalAflTradeArtifactMirror({
    client,
    storeId: STORE_ID,
    runCloudStorage: fakeCloudStorage,
  });
  expect(restored).toMatchObject({
    receipt: 'afl-trade-artifact-mirror-restore/v1',
    storeId: STORE_ID,
    mirrorLocator: MIRROR,
    artifactClass: 'raw_source',
    verdict: 'exact',
  });
  expect(restored.restored).toEqual(restored.expected);

  // A corrupted mirror object is reported, never accepted.
  for (const file of await readdir(join(bucketRoot, 'mirror-test-store', 'mirror-raw'))) {
    const path = join(bucketRoot, 'mirror-test-store', 'mirror-raw', file);
    await chmod(path, 0o600);
    await writeFile(path, '{"corrupt":true}');
  }
  await expect(
    restoreTestLocalAflTradeArtifactMirror({
      client,
      storeId: STORE_ID,
      runCloudStorage: fakeCloudStorage,
    })
  ).resolves.toMatchObject({ verdict: 'unreadable', restored: null });
});
