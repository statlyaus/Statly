import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { openLocalAflTradePrivateDerivedRepository } from '@/server/aflTradeIntelligence/development/localArtifactStoreBinding';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationStagingRepository';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const schemaName = `private_derived_store_binding_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});
const client = createPgAflOutcomeSqlClient(pool);
const MAXIMUM_BYTES = 1024 * 1024;
let storeRoot = '';
let otherRoot = '';

function open(rootDirectory: string) {
  return openLocalAflTradePrivateDerivedRepository(client, {
    rootDirectory,
    repositoryId: 'governed-private-evaluation',
    maximumObjectBytes: MAXIMUM_BYTES,
  });
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  storeRoot = await mkdtemp(join(tmpdir(), 'statly-private-store-'));
  otherRoot = await mkdtemp(join(tmpdir(), 'statly-private-other-'));
}, 300_000);

afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  }
});

it('keeps the plain repository in a schema with no registered store', async () => {
  const repository = await open(otherRoot);
  expect(repository.artifactClass).toBe('derived_private');
  expect(repository.storeLocation).toBeUndefined();
});

it('binds to the registered store at the same root, so staged custody is located', async () => {
  await registerLocalAflTradeArtifactStore(client, {
    storeId: 'test-private-store',
    rootDirectory: storeRoot,
  });
  const repository = await open(storeRoot);
  expect(repository.storeLocation?.storeId).toBe('test-private-store');

  const document = { qualification: 'store-bound staging' };
  const reference = createAflTradeCanonicalJsonArtifactRef(document, '2026-10-06T00:00:00.000Z');
  const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
    client,
    artifactRepository: repository,
    maximumArtifactBytes: MAXIMUM_BYTES,
  });
  await staging.retainArtifact({
    reference,
    bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
  });
  const location = await pool.query<{ store_id: string; object_key: string }>(
    `SELECT store_id, object_key FROM outcome_artifact_custody_location WHERE artifact_id=$1`,
    [reference.artifactId]
  );
  expect(location.rows).toEqual([
    {
      store_id: 'test-private-store',
      object_key: `governed-private-evaluation/local_non_production_filesystem/sha256/${reference.contentSha256.slice(0, 2)}/${reference.contentSha256.slice(2, 4)}/${reference.contentSha256}`,
    },
  ]);
});

it('refuses an artifact root other than the registered store root', async () => {
  await expect(open(otherRoot)).rejects.toThrow(
    'The artifact root must be the root of registered store test-private-store'
  );
});
