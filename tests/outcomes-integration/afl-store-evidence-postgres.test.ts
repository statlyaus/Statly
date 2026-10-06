import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { createLocalAflTradeNonProductionArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { readBackLocalAflTradeArtifactCustody } from '@/server/aflTradeIntelligence/development/localArtifactCustodyReadback';
import { storeLocalAflTradeEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const schemaName = `store_evidence_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});
const client = createPgAflOutcomeSqlClient(pool);
const STORE_ID = 'test-evidence-store';
const MAXIMUM_BYTES = 1024 * 1024;
let root = '';

const text = (value: string) => new TextEncoder().encode(value);

function store(bytes: Uint8Array, mediaType = 'application/json') {
  return storeLocalAflTradeEvidence(client, {
    storeId: STORE_ID,
    repositoryId: 'governance-evidence',
    artifactClass: 'raw_source',
    bytes,
    mediaType,
    maximumObjectBytes: MAXIMUM_BYTES,
  });
}

async function rowCounts() {
  const result = await pool.query<{ custody: number; locations: number }>(
    `SELECT (SELECT count(*)::int FROM outcome_artifact_custody) AS custody,
            (SELECT count(*)::int FROM outcome_artifact_custody_location) AS locations`
  );
  return result.rows[0]!;
}

/** A custody row whose bytes were never located, like the 1,590 recorded as lost. */
async function insertLostCustody(bytes: Uint8Array, mediaType: string) {
  const reference = createAflTradeByteArtifactRef(bytes, mediaType, '2026-09-29T00:00:00.000Z');
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',NULL,$6,$6,'{}'::jsonb)`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      reference.createdAt,
    ]
  );
  return reference.artifactId;
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  root = await mkdtemp(join(tmpdir(), 'statly-store-evidence-'));
  await registerLocalAflTradeArtifactStore(client, { storeId: STORE_ID, rootDirectory: root });
}, 300_000);

afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

it('refuses while custody has no clean readback, recording nothing', async () => {
  await expect(store(text('{"approval":"before readback"}'))).rejects.toMatchObject({
    code: 'CUSTODY_UNHEALTHY',
  });
  expect(await rowCounts()).toEqual({ custody: 0, locations: 0 });
  // A clean readback of the empty store makes custody healthy for the cases below.
  await readBackLocalAflTradeArtifactCustody({ client, storeId: STORE_ID });
});

it('stores, reads back and locates an approval record, then replays as a no-op', async () => {
  const bytes = text('{"approval":"owner approved the 2022 capture"}');
  const stored = await store(bytes);
  expect(stored.custody).toBe('recorded');
  expect(stored.reference.mediaType).toBe('application/json');
  expect(stored.storeId).toBe(STORE_ID);
  expect(stored.objectKey).toBe(
    `governance-evidence/local_non_production_filesystem/sha256/${stored.reference.contentSha256.slice(0, 2)}/${stored.reference.contentSha256.slice(2, 4)}/${stored.reference.contentSha256}`
  );
  const custody = await pool.query<{ environment: string; custody_json: { content: unknown } }>(
    `SELECT environment::text AS environment, custody_json FROM outcome_artifact_custody
      WHERE artifact_id=$1`,
    [stored.reference.artifactId]
  );
  expect(custody.rows[0]!.environment).toBe('non_production');
  expect(custody.rows[0]!.custody_json.content).toMatchObject({
    repositoryAssurance: 'local_non_production_filesystem',
    artifactClass: 'raw_source',
    status: 'passed',
  });

  const before = await rowCounts();
  const replay = await store(bytes);
  expect(replay).toMatchObject({ custody: 'already_recorded', objectKey: stored.objectKey });
  expect(replay.reference.artifactId).toBe(stored.reference.artifactId);
  expect(await rowCounts()).toEqual(before);

  // The nightly readback reads the stored bytes back cleanly.
  const run = await readBackLocalAflTradeArtifactCustody({ client, storeId: STORE_ID });
  expect(run).toMatchObject({ failures: 0 });
  expect(run.rowsChecked).toBeGreaterThanOrEqual(1);
});

it('locates a lost custody row when its exact bytes are found again', async () => {
  const bytes = text('{"approval":"recovered from a backup"}');
  const lostId = await insertLostCustody(bytes, 'application/json');
  const stored = await store(bytes);
  expect(stored).toMatchObject({ custody: 'already_recorded' });
  expect(stored.reference.artifactId).toBe(lostId);
  const location = await pool.query(
    `SELECT 1 FROM outcome_artifact_custody_location WHERE artifact_id=$1`,
    [lostId]
  );
  expect(location.rowCount).toBe(1);
});

it('refuses bytes whose existing custody row names another media type', async () => {
  const bytes = text('<p>approval page</p>');
  const lostId = await insertLostCustody(bytes, 'text/html');
  const before = await rowCounts();
  await expect(store(bytes, 'text/plain')).rejects.toThrow(
    `Evidence ${lostId} differs from its custody row.`
  );
  expect(await rowCounts()).toEqual(before);
  // Nothing was written, so the corrected media type locates the row.
  await expect(store(bytes, 'text/html')).resolves.toMatchObject({ custody: 'already_recorded' });
});

it('reuses the stored reference when a run stopped after writing the bytes', async () => {
  const bytes = text('{"approval":"interrupted run"}');
  // A run refused while custody was unhealthy would leave exactly this: bytes, no custody.
  const reference = createAflTradeByteArtifactRef(
    bytes,
    'application/json',
    '2026-10-01T00:00:00.000Z'
  );
  await createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: root,
    repositoryId: 'governance-evidence',
    artifactClass: 'raw_source',
    maximumObjectBytes: MAXIMUM_BYTES,
  }).putIfAbsent(reference, bytes);
  const stored = await store(bytes);
  expect(stored).toMatchObject({ custody: 'recorded' });
  expect(stored.reference).toEqual(reference);
});

it('refuses an unregistered store and an invalid media type before writing', async () => {
  await expect(
    storeLocalAflTradeEvidence(client, {
      storeId: 'missing-store',
      repositoryId: 'governance-evidence',
      artifactClass: 'raw_source',
      bytes: text('{}'),
      mediaType: 'application/json',
      maximumObjectBytes: MAXIMUM_BYTES,
    })
  ).rejects.toThrow('Artifact store missing-store is not registered.');
  await expect(store(text('{}'), 'JSON')).rejects.toThrow(
    'Evidence media type must be a lowercase type/subtype.'
  );
});
