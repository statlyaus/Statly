import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradeArtifactCustodyClass } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import {
  backfillLocalAflTradeArtifactCustodyLocations,
  registerLocalAflTradeArtifactStore,
} from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { createLocalAflTradeNonProductionArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_artifact_store_location_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});
const client = createPgAflOutcomeSqlClient(outcomesPool);
const MAXIMUM_BYTES = 1024 * 1024;
const CREATED_AT = '2026-10-03T00:00:00.000Z';
let artifactRoot = '';
const fixtureSha = sha256('location-constraints-fixture');
const storeRoot = () => join(artifactRoot, 'store');

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function shaPath(sha: string): string {
  return `sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;
}

const localCustodyJson = {
  content: {
    repositoryAssurance: 'local_non_production_filesystem',
    custodyEnvironment: 'non_production',
    custodyProfileId: null,
    custodyProfile: null,
  },
};

async function insertCustody(input: {
  sha: string;
  mediaType?: string;
  byteLength?: number;
  artifactClass?: AflTradeArtifactCustodyClass;
  environment?: 'test_fixture' | 'non_production';
  custodyJson?: unknown;
}) {
  const environment = input.environment ?? 'non_production';
  await outcomesPool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$8,$9::jsonb)`,
    [
      `artifact:${input.sha}`,
      input.sha,
      `artifact://sha256/${input.sha}`,
      input.mediaType ?? 'application/json',
      input.byteLength ?? 1,
      input.artifactClass ?? 'raw_source',
      environment,
      CREATED_AT,
      JSON.stringify(input.custodyJson ?? (environment === 'test_fixture' ? {} : localCustodyJson)),
    ]
  );
}

async function storeArtifact(input: {
  rootDirectory: string;
  repositoryId: string;
  artifactClass: 'raw_source' | 'capture_metadata';
  text: string;
  mediaType?: string;
}) {
  const bytes = new TextEncoder().encode(input.text);
  const reference = createAflTradeByteArtifactRef(
    bytes,
    input.mediaType ?? 'application/json',
    CREATED_AT
  );
  await createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: input.rootDirectory,
    repositoryId: input.repositoryId,
    artifactClass: input.artifactClass,
    maximumObjectBytes: MAXIMUM_BYTES,
  }).putIfAbsent(reference, bytes);
  return reference;
}

async function locations() {
  const result = await outcomesPool.query<{
    artifact_id: string;
    store_id: string;
    object_key: string;
  }>(
    `SELECT artifact_id, store_id, object_key FROM outcome_artifact_custody_location
      ORDER BY artifact_id`
  );
  return result.rows;
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  artifactRoot = await mkdtemp(join(tmpdir(), 'statly-artifact-store-location-'));
  await mkdir(storeRoot(), { recursive: true });
});

afterAll(async () => {
  await outcomesPool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
  if (artifactRoot !== '') await rm(artifactRoot, { recursive: true, force: true });
});

describe('artifact store registry', () => {
  const insertStore = (storeId: string, environment: string, assurance: string, root: string) =>
    outcomesPool.query(
      `INSERT INTO outcome_artifact_store (store_id,environment,assurance,root_locator)
       VALUES ($1,$2::"OutcomeEnvironment",$3,$4)`,
      [storeId, environment, assurance, root]
    );

  it('admits a local filesystem store only in non-production, once, at an absolute root', async () => {
    await expect(
      insertStore('production-local', 'production', 'local_non_production_filesystem', '/srv/a')
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertStore('relative-local', 'non_production', 'local_non_production_filesystem', 'a/b')
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertStore('dotted-local', 'non_production', 'local_non_production_filesystem', '/srv/../a')
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      registerLocalAflTradeArtifactStore(client, {
        storeId: 'grading-local',
        rootDirectory: storeRoot(),
      })
    ).resolves.toEqual({ status: 'registered' });
    await expect(
      registerLocalAflTradeArtifactStore(client, {
        storeId: 'grading-local',
        rootDirectory: storeRoot(),
      })
    ).resolves.toEqual({ status: 'already_registered' });
    await expect(
      registerLocalAflTradeArtifactStore(client, {
        storeId: 'grading-local',
        rootDirectory: '/srv/b',
      })
    ).rejects.toThrow(/different root/u);
    await expect(
      insertStore('second-local', 'non_production', 'local_non_production_filesystem', '/srv/b')
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertStore(
        'durable-bucket',
        'non_production',
        'durable_object_storage',
        's3://bucket/prefix'
      )
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('keeps a store permanent apart from recording its mirror once', async () => {
    await expect(
      outcomesPool.query(
        `UPDATE outcome_artifact_store SET root_locator='/srv/moved' WHERE store_id='durable-bucket'`
      )
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      outcomesPool.query(
        `UPDATE outcome_artifact_store SET mirror_locator='gs://statly-mirror/durable'
          WHERE store_id='durable-bucket'`
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      outcomesPool.query(
        `UPDATE outcome_artifact_store SET mirror_locator='gs://statly-mirror/other'
          WHERE store_id='durable-bucket'`
      )
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      outcomesPool.query(`DELETE FROM outcome_artifact_store WHERE store_id='durable-bucket'`)
    ).rejects.toMatchObject({ code: '55000' });
  });
});

describe('artifact custody location', () => {
  const sha = sha256('location-constraints');
  const otherSha = sha256('location-constraints-other');

  beforeAll(async () => {
    await insertCustody({ sha });
    await insertCustody({ sha: fixtureSha, environment: 'test_fixture' });
  });

  const insertLocation = (artifactSha: string, objectKey: string) =>
    outcomesPool.query(
      `INSERT INTO outcome_artifact_custody_location (artifact_id,store_id,object_key)
       VALUES ($1,'durable-bucket',$2)`,
      [`artifact:${artifactSha}`, objectKey]
    );

  it('requires the key to end in the artifact own SHA-256 path', async () => {
    await expect(insertLocation(sha, `raw/x/${shaPath(otherSha)}`)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertLocation(sha, `raw/x${shaPath(sha)}`)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertLocation(sha, `raw/../${shaPath(sha)}`)).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('requires the store environment to match the custody environment', async () => {
    await expect(insertLocation(fixtureSha, `raw/${shaPath(fixtureSha)}`)).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('records one append-only location per artifact', async () => {
    await expect(insertLocation(sha, `raw/x/${shaPath(sha)}`)).resolves.toMatchObject({
      rowCount: 1,
    });
    await expect(insertLocation(sha, `raw/y/${shaPath(sha)}`)).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      outcomesPool.query(
        `UPDATE outcome_artifact_custody_location SET object_key=$2 WHERE artifact_id=$1`,
        [`artifact:${sha}`, `raw/y/${shaPath(sha)}`]
      )
    ).rejects.toThrow();
    await expect(
      outcomesPool.query(`DELETE FROM outcome_artifact_custody_location WHERE artifact_id=$1`, [
        `artifact:${sha}`,
      ])
    ).rejects.toThrow();
  });
});

describe('local artifact location backfill', () => {
  it('locates every stored artifact, reports the rest, and writes nothing on a dry run', async () => {
    const raw = await storeArtifact({
      rootDirectory: storeRoot(),
      repositoryId: 'raw-captures',
      artifactClass: 'raw_source',
      text: '{"page":"raw"}',
    });
    const nested = await storeArtifact({
      rootDirectory: join(storeRoot(), 'season-2026'),
      repositoryId: 'metadata',
      artifactClass: 'capture_metadata',
      text: '{"page":"metadata"}',
    });
    const conflicting = await storeArtifact({
      rootDirectory: storeRoot(),
      repositoryId: 'raw-captures',
      artifactClass: 'raw_source',
      text: '<html>conflict</html>',
      mediaType: 'text/html',
    });
    const withoutCustody = await storeArtifact({
      rootDirectory: storeRoot(),
      repositoryId: 'raw-captures',
      artifactClass: 'raw_source',
      text: '{"page":"no-custody"}',
    });
    const lostSha = sha256('lost-evidence');
    const notePath = join('notes', `${sha256('note')}.json`);
    await mkdir(join(storeRoot(), 'notes'), { recursive: true });
    await writeFile(
      join(storeRoot(), notePath),
      JSON.stringify({ status: 'approved_by_repository_owner' })
    );
    await writeFile(join(storeRoot(), 'notes', 'README.txt'), 'not evidence');

    await insertCustody({ sha: raw.contentSha256, byteLength: raw.byteLength });
    await insertCustody({
      sha: nested.contentSha256,
      byteLength: nested.byteLength,
      artifactClass: 'capture_metadata',
    });
    await insertCustody({
      sha: conflicting.contentSha256,
      byteLength: conflicting.byteLength,
      mediaType: 'application/json',
    });
    await insertCustody({
      sha: lostSha,
      artifactClass: 'derived_private',
      custodyJson: { rootDirectory: '/var/folders/xy/T/statly-579-evidence', repositoryId: 'x' },
    });

    await expect(
      backfillLocalAflTradeArtifactCustodyLocations({
        client,
        storeId: 'grading-local',
        rootDirectory: '/srv/elsewhere',
        apply: false,
      })
    ).rejects.toThrow(/registered root/u);

    const before = await locations();
    const dryRun = await backfillLocalAflTradeArtifactCustodyLocations({
      client,
      storeId: 'grading-local',
      rootDirectory: storeRoot(),
      apply: false,
    });
    expect(await locations()).toEqual(before);
    const expectedUnlocated = [
      conflicting.artifactId,
      `artifact:${lostSha}`,
      `artifact:${fixtureSha}`,
    ].sort();
    expect(dryRun).toMatchObject({
      mode: 'dry_run',
      envelopesRead: 4,
      located: 2,
      alreadyLocated: 0,
      notEnvelopes: [notePath],
      invalidEnvelopes: [],
      filesWithoutCustody: [{ artifactId: withoutCustody.artifactId }],
      conflicts: [{ artifactId: conflicting.artifactId, reason: 'media_type_differs' }],
      unlocated: { total: 3, artifactIds: expectedUnlocated },
    });
    expect(dryRun.unlocated.byClassAndCustody).toEqual([
      {
        artifactClass: 'derived_private',
        recordedCustody: '/var/folders/xy/T/statly-579-evidence',
        count: 1,
      },
      { artifactClass: 'raw_source', recordedCustody: 'local_non_production_filesystem', count: 1 },
      { artifactClass: 'raw_source', recordedCustody: 'unrecorded', count: 1 },
    ]);

    const applied = await backfillLocalAflTradeArtifactCustodyLocations({
      client,
      storeId: 'grading-local',
      rootDirectory: storeRoot(),
      apply: true,
    });
    expect(applied).toMatchObject({ mode: 'applied', located: 2, unlocated: { total: 3 } });
    expect((await locations()).filter((row) => row.store_id === 'grading-local')).toEqual(
      [
        {
          artifact_id: raw.artifactId,
          store_id: 'grading-local',
          object_key: `raw-captures/local_non_production_filesystem/${shaPath(raw.contentSha256)}`,
        },
        {
          artifact_id: nested.artifactId,
          store_id: 'grading-local',
          object_key: `season-2026/metadata/local_non_production_filesystem/${shaPath(nested.contentSha256)}`,
        },
      ].sort((left, right) => left.artifact_id.localeCompare(right.artifact_id))
    );

    const rerun = await backfillLocalAflTradeArtifactCustodyLocations({
      client,
      storeId: 'grading-local',
      rootDirectory: storeRoot(),
      apply: true,
    });
    expect(rerun).toMatchObject({ located: 0, alreadyLocated: 2, unlocated: { total: 3 } });
  });

  it('reports an envelope whose bytes no longer match its digest instead of locating it', async () => {
    const tampered = await storeArtifact({
      rootDirectory: storeRoot(),
      repositoryId: 'tampered',
      artifactClass: 'raw_source',
      text: '{"page":"tampered"}',
    });
    await insertCustody({ sha: tampered.contentSha256, byteLength: tampered.byteLength });
    const envelopeDirectory = join(storeRoot(), 'tampered');
    const [envelopeName] = await readdir(envelopeDirectory);
    const envelopePath = join(envelopeDirectory, envelopeName ?? '');
    const envelope = JSON.parse(await readFile(envelopePath, 'utf8'));
    envelope.bytesBase64 = Buffer.from('{"page":"altered!!"}').toString('base64');
    await writeFile(envelopePath, JSON.stringify(envelope));

    const report = await backfillLocalAflTradeArtifactCustodyLocations({
      client,
      storeId: 'grading-local',
      rootDirectory: storeRoot(),
      apply: true,
    });
    expect(report.invalidEnvelopes).toEqual([
      { path: join('tampered', envelopeName ?? ''), reason: 'INTEGRITY_MISMATCH' },
    ]);
    expect(report.unlocated.artifactIds).toContain(tampered.artifactId);
  });

  it('plans against an unregistered store on a dry run but refuses to record locations', async () => {
    await expect(
      backfillLocalAflTradeArtifactCustodyLocations({
        client,
        storeId: 'not-yet-registered',
        rootDirectory: storeRoot(),
        apply: false,
      })
    ).resolves.toMatchObject({ mode: 'dry_run', located: 0 });
    await expect(
      backfillLocalAflTradeArtifactCustodyLocations({
        client,
        storeId: 'not-yet-registered',
        rootDirectory: storeRoot(),
        apply: true,
      })
    ).rejects.toThrow(/must be registered/u);
  });
});
