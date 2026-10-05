import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { recordAflTradeEvidenceLocations } from '@/server/aflTradeIntelligence/artifacts/artifactStoreLocation';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { readBackLocalAflTradeArtifactCustody } from '@/server/aflTradeIntelligence/development/localArtifactCustodyReadback';
import { bindLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactStoreBinding';
import { createAflTradeAcquisitionSpellRegistrationRule } from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `custody_readback_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const client = createPgAflOutcomeSqlClient(pool);
const STORE_ID = 'readback-test-store';
let storeRoot = '';

const healthy = async () =>
  (
    await pool.query<{ healthy: boolean }>(
      `SELECT outcome_artifact_custody_healthy('non_production') AS healthy`
    )
  ).rows[0]!.healthy;

/** Stores bytes for one custody row of the given class and records its location. */
async function retained(label: string, artifactClass: 'raw_source' | 'capture_metadata') {
  const ref = createAflTradeCanonicalJsonArtifactRef({ label }, '2026-09-01T00:00:00.000Z');
  const bytes = new TextEncoder().encode(canonicalizeAflTradeJson({ label }));
  const store = await bindLocalAflTradeArtifactStore(client, {
    storeId: STORE_ID,
    repositoryId: `readback-${artifactClass.replace('_', '-')}`,
    artifactClass,
    maximumObjectBytes: 1024 * 1024,
  });
  await store.putIfAbsent(ref, bytes);
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,$6::"OutcomeArtifactClass",'non_production',$7,$7,'{}')`,
    [
      ref.artifactId,
      ref.contentSha256,
      ref.storageUri,
      ref.mediaType,
      ref.byteLength,
      artifactClass,
      ref.createdAt,
    ]
  );
  await client.transaction((transaction) =>
    recordAflTradeEvidenceLocations(transaction, store, [ref])
  );
  // The local store keeps each object as an envelope named by the SHA-256 of its repository key.
  const [repository, ...rest] = store.objectKeyFor(ref).split('/');
  const envelope = `${createHash('sha256').update(rest.join('/')).digest('hex')}.json`;
  return { ref, path: join(storeRoot, repository!, envelope) };
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  storeRoot = await mkdtemp(join(tmpdir(), 'statly-readback-store-'));
  await registerLocalAflTradeArtifactStore(client, { storeId: STORE_ID, rootDirectory: storeRoot });
}, 120_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  await admin.end();
  if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
});

it('reads located custody back, records each run, and gates reviewed registration on health', async () => {
  // No run yet: custody is not healthy. A clean run that finished more than 48 hours ago is stale.
  expect(await healthy()).toBe(false);
  await pool.query(
    `INSERT INTO outcome_artifact_readback_run
      (run_id,environment,store_id,started_at,finished_at,rows_checked,failures,
       failing_artifact_ids,checked_by_class,sample_policy)
     VALUES ('artifact-readback-run:stale-clean-run','non_production',$1,
       clock_timestamp()-interval '50 hours',clock_timestamp()-interval '49 hours',0,0,'[]','{}','{}')`,
    [STORE_ID]
  );
  expect(await healthy()).toBe(false);

  const raw = [await retained('raw-a', 'raw_source'), await retained('raw-b', 'raw_source')];
  const metadata = [
    await retained('meta-a', 'capture_metadata'),
    await retained('meta-b', 'capture_metadata'),
    await retained('meta-c', 'capture_metadata'),
  ];
  // Unlocated custody (bytes recorded as lost) is outside the run.
  const lost = createAflTradeCanonicalJsonArtifactRef(
    { label: 'lost' },
    '2026-09-01T00:00:00.000Z'
  );
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',$6,$6,'{}')`,
    [
      lost.artifactId,
      lost.contentSha256,
      lost.storageUri,
      lost.mediaType,
      lost.byteLength,
      lost.createdAt,
    ]
  );

  // A full readback checks every located row, then custody is healthy.
  const full = await readBackLocalAflTradeArtifactCustody({
    client,
    storeId: STORE_ID,
    otherClassFraction: 1,
  });
  expect(full).toMatchObject({
    environment: 'non_production',
    storeId: STORE_ID,
    rowsChecked: 5,
    failures: 0,
    failingArtifactIds: [],
    checkedByClass: { raw_source: 2, capture_metadata: 3 },
    samplePolicy: { fullClasses: ['raw_source'], otherClassFraction: 1 },
  });
  expect(await healthy()).toBe(true);

  // A zero sample still reads every raw_source row.
  const rawOnly = await readBackLocalAflTradeArtifactCustody({
    client,
    storeId: STORE_ID,
    otherClassFraction: 0,
  });
  expect(rawOnly).toMatchObject({ rowsChecked: 2, failures: 0, checkedByClass: { raw_source: 2 } });

  // A changed byte fails the run and makes custody unhealthy.
  const original = await readFile(raw[1]!.path);
  await chmod(raw[1]!.path, 0o600);
  await writeFile(
    raw[1]!.path,
    original.toString('utf8').replace(/"bytesBase64":"[^"]*"/u, '"bytesBase64":"dGFtcGVyZWQ="')
  );
  const failed = await readBackLocalAflTradeArtifactCustody({
    client,
    storeId: STORE_ID,
    otherClassFraction: 1,
  });
  expect(failed).toMatchObject({
    rowsChecked: 5,
    failures: 1,
    failingArtifactIds: [raw[1]!.ref.artifactId],
  });
  expect(await healthy()).toBe(false);

  // Reviewed registration refuses while custody is unhealthy, before it records anything.
  const evidence = metadata[0]!.ref as AflTradeArtifactRef;
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    environment: 'non_production',
    competition: 'AFLM',
    ruleVersion: 'readback-gated',
    evidence: [evidence],
    createdAt: '2026-09-02T00:00:00.000Z',
  });
  await pool.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ('approval-readback','acquisition_spell_rule',$1,'approved','Synthetic review',$2::jsonb,
       'synthetic-reviewer',date_trunc('milliseconds',clock_timestamp()))`,
    [rule.ruleId, canonicalizeAflTradeJson(rule)]
  );
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    { read: async () => new TextEncoder().encode(canonicalizeAflTradeJson({ label: 'meta-a' })) },
    await bindLocalAflTradeArtifactStore(client, {
      storeId: STORE_ID,
      repositoryId: 'readback-capture-metadata',
      artifactClass: 'capture_metadata',
      maximumObjectBytes: 1024 * 1024,
    })
  );
  const execution = { environment: 'non_production' as const, competition: 'AFLM' as const };
  await expect(
    repository.registerReviewedRule(rule, 'approval-readback', execution)
  ).rejects.toMatchObject({ code: 'CUSTODY_UNHEALTHY' });
  expect(
    (
      await pool.query('SELECT 1 FROM outcome_acquisition_spell_rule WHERE rule_id=$1', [
        rule.ruleId,
      ])
    ).rowCount
  ).toBe(0);

  // Repaired bytes and a clean run restore health, and the same registration then succeeds.
  await writeFile(raw[1]!.path, original);
  expect(
    await readBackLocalAflTradeArtifactCustody({ client, storeId: STORE_ID, otherClassFraction: 1 })
  ).toMatchObject({ failures: 0 });
  expect(await healthy()).toBe(true);
  await expect(
    repository.registerReviewedRule(rule, 'approval-readback', execution)
  ).resolves.toEqual(rule);

  // Runs are append-only, and a failure count must match its listed artifacts.
  await expect(
    pool.query(`UPDATE outcome_artifact_readback_run SET failures=0 WHERE run_id=$1`, [
      failed.runId,
    ])
  ).rejects.toThrow();
  await expect(
    pool.query(`DELETE FROM outcome_artifact_readback_run WHERE run_id=$1`, [failed.runId])
  ).rejects.toThrow();
  await expect(
    pool.query(
      `INSERT INTO outcome_artifact_readback_run
        (run_id,environment,store_id,started_at,finished_at,rows_checked,failures,
         failing_artifact_ids,checked_by_class,sample_policy)
       VALUES ('artifact-readback-run:miscounted','non_production',$1,clock_timestamp(),
         clock_timestamp(),3,1,'[]','{}','{}')`,
      [STORE_ID]
    )
  ).rejects.toThrow();
});
