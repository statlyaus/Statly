import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradeEvidenceStoreBinding } from '@/server/aflTradeIntelligence/artifacts/artifactStoreLocation';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresSourceCaptureSuccessorRepository } from '@/server/aflTradeIntelligence/outcomes/postgresSourceCaptureSuccessorRepository';
import {
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  parseAflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { SOURCE_CAPTURE_SUCCESSOR_REVIEWER } from '@/server/aflTradeIntelligence/source/sourceCaptureSuccessor';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

// The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const repository = new PostgresSourceCaptureSuccessorRepository(createPgAflOutcomeSqlClient(pool));
let promoted: Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  // The promotion fixture commits non-production governance evidence as this role.
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schemaName}"
       TO afl_trade_nonproduction_governance_registry_writer`
  );
  // The fixture never locates its capture bytes, so every capture behind its entries is lost.
  promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    draftSessions: true,
  });
}, 300_000);

afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

const instant = async () => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return (
    await pool.query<{ at: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
};

const successorCount = async () =>
  (
    await pool.query<{ n: number }>(
      'SELECT count(*)::integer AS n FROM outcome_source_capture_successor'
    )
  ).rows[0]!.n;

const current = async (successorId: string) =>
  (
    await pool.query<{ current: boolean }>(
      'SELECT outcome_source_capture_successor_current($1,clock_timestamp()) AS current',
      [successorId]
    )
  ).rows[0]!.current;

/**
 * A later capture of the same source as a lost one, with located bytes and a finalized evidence
 * batch restating the lost batch's claims (optionally edited). The synthetic batch skips the
 * capture-lease finalization guard, which only real ingestion can satisfy.
 */
async function recapture(
  store: AflTradeEvidenceStoreBinding,
  lostArtifactId: string,
  editClaims: (
    claims: AflTradeExternalEvidenceContent['claim'][]
  ) => AflTradeExternalEvidenceContent['claim'][] = (claims) => claims
) {
  const createdAt = await instant();
  const bytes = new TextEncoder().encode(`Re-captured ${lostArtifactId} at ${createdAt}.`);
  const reference = createAflTradeByteArtifactRef(bytes, 'text/html', createdAt);
  await pool.query(
    `INSERT INTO outcome_artifact_custody
     (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
     VALUES($1,$2,$3,'text/html',$4,'raw_source','non_production',$5,$5,'{}')`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.byteLength,
      createdAt,
    ]
  );
  await store.putIfAbsent(reference, bytes);
  await pool.query(
    `INSERT INTO outcome_artifact_custody_location(artifact_id,store_id,object_key) VALUES($1,$2,$3)`,
    [reference.artifactId, store.storeId, store.objectKeyFor(reference)]
  );
  const attemptId = `successor-attempt:${reference.contentSha256}`;
  const captureId = createAflTradeContentAddress('source-capture', {
    successor: reference.artifactId,
  });
  await pool.query(
    `INSERT INTO outcome_source_capture_attempt
     (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
     SELECT $2,attempt.environment,attempt.provider,attempt.dataset,attempt.capability_id,'captured',$3,$3,'{}'
       FROM outcome_source_capture capture JOIN outcome_source_capture_attempt attempt USING(attempt_id)
      WHERE capture.source_artifact_id=$1`,
    [lostArtifactId, attemptId, createdAt]
  );
  await pool.query(
    `INSERT INTO outcome_source_capture
     (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,dataset_version,
      access_mechanism,capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json)
     SELECT $2,$3,$4,$5,environment,provider,dataset,dataset_version,access_mechanism,capability_id,
       competition,anchor_season_year,effective_at,$6,'approved',manifest_json
       FROM outcome_source_capture WHERE source_artifact_id=$1`,
    [
      lostArtifactId,
      captureId,
      attemptId,
      reference.artifactId.replace('artifact:', 'source-snapshot:'),
      reference.artifactId,
      createdAt,
    ]
  );
  const lostBatch = parseAflTradeExternalEvidenceBatch(
    (
      await pool.query<{ batch_json: unknown }>(
        `SELECT batch.batch_json FROM outcome_external_evidence_batch batch
           JOIN outcome_source_capture capture USING(capture_id)
          WHERE capture.source_artifact_id=$1 AND batch.status='finalized'`,
        [lostArtifactId]
      )
    ).rows[0]!.batch_json
  );
  const capture = {
    ...lostBatch.content.evidence[0]!.content.capture,
    captureId,
    artifactId: reference.artifactId,
    contentSha256: reference.contentSha256,
    capturedAt: createdAt,
  };
  const claims = editClaims(lostBatch.content.evidence.map((evidence) => evidence.content.claim));
  const batch = createAflTradeExternalEvidenceBatch({
    ...lostBatch.content,
    captureId,
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        ...lostBatch.content.evidence[0]!.content,
        capture,
        sourceRow: { ordinal: index + 1, sourceKey: `successor:${index + 1}` },
        claim,
      })
    ),
    finalizedAt: createdAt,
  });
  const seeding = await pool.connect();
  try {
    await seeding.query('BEGIN');
    await seeding.query(`SET LOCAL session_replication_role='replica'`);
    await seeding.query(
      `INSERT INTO outcome_external_evidence_batch
        (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,
         status,finalized_at,batch_json)
       VALUES ($1,$2,$3,$4,0,$5,$6,'finalized',$7,$8::jsonb)`,
      [
        batch.batchId,
        captureId,
        batch.content.provider,
        batch.content.rowCount,
        batch.content.rowSetSha256,
        sha256AflTradeCanonicalJson([]),
        createdAt,
        canonicalizeAflTradeJson(batch),
      ]
    );
    await seeding.query('COMMIT');
  } catch (error) {
    await seeding.query('ROLLBACK');
    throw error;
  } finally {
    seeding.release();
  }
  return captureId;
}

it('records a successor only when the fresh claims restate every lost claim', async () => {
  const store = await bindTestEvidenceStore(pool);
  const [first, second] = promoted.draftEntries;
  if (!first || !second) throw new Error('Expected two drafted players.');
  const shared = first.entry.evidence.find(({ artifactId }) =>
    second.entry.evidence.some((other) => other.artifactId === artifactId)
  )!;
  const session = first.entry.evidence.find(({ artifactId }) => artifactId !== shared.artifactId)!;
  const before = await successorCount();

  // A fresh page that no longer states one recorded claim refuses, names it and writes nothing.
  const edited = await recapture(store, shared.artifactId, (claims) => claims.slice(1));
  const refused = await repository.register(
    { kind: 'recaptured', lostArtifactId: shared.artifactId, successorCaptureId: edited },
    { apply: true }
  );
  expect(refused.status).toBe('refused');
  expect(refused.status === 'refused' && refused.comparison.missing.length).toBeGreaterThan(0);
  expect(await successorCount()).toBe(before);

  // A faithful recapture: dry run writes nothing, apply records it under the delegated reviewer.
  const faithful = await recapture(store, shared.artifactId);
  const request = {
    kind: 'recaptured' as const,
    lostArtifactId: shared.artifactId,
    successorCaptureId: faithful,
  };
  const dry = await repository.register(request, { apply: false });
  expect(dry.status).toBe('would_record');
  expect(await successorCount()).toBe(before);
  const recorded = await repository.register(request, { apply: true });
  expect(recorded).toMatchObject({ status: 'recorded', comparison: { matches: true } });
  if (recorded.status !== 'recorded') throw new Error('Expected a recorded successor.');
  expect(await current(recorded.successorId)).toBe(true);
  const decision = await pool.query<{ decided_by: string; rationale: string }>(
    `SELECT decided_by,rationale FROM outcome_review_decision WHERE subject_id=$1`,
    [recorded.successorId]
  );
  expect(decision.rows).toEqual([
    {
      decided_by: SOURCE_CAPTURE_SUCCESSOR_REVIEWER,
      rationale: expect.stringContaining('verbatim'),
    },
  ]);

  // Re-running is a no-op; a different successor for the same lost capture is refused.
  await expect(repository.register(request, { apply: true })).resolves.toMatchObject({
    status: 'already_recorded',
    successorId: recorded.successorId,
  });
  const another = await recapture(store, shared.artifactId);
  await expect(
    repository.register({ ...request, successorCaptureId: another }, { apply: true })
  ).rejects.toThrow('different successor');

  // An omission is recorded only on an owner decision reference.
  const omitted = await repository.register(
    {
      kind: 'omitted',
      lostArtifactId: session.artifactId,
      ownerDecisionRef: 'statlyaus/Statly#742 option (b), 2026-10-05',
    },
    { apply: true }
  );
  expect(omitted.status).toBe('recorded');
  if (omitted.status !== 'recorded') throw new Error('Expected a recorded omission.');
  expect(await current(omitted.successorId)).toBe(true);
  expect(await successorCount()).toBe(before + 2);
}, 300_000);
