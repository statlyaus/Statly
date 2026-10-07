import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeArrivalSpell,
  createAflTradeArrivalSpellRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0257_successor_native_capture';
// The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
const ARRIVAL_SIGNATURE =
  'outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)';
let cleanup: () => Promise<void> = async () => undefined;
let migrationSql = '';
let promoted: Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  const history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  cleanup = history.cleanup;
  migrationSql = history.migrationSql;
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schemaName}"
       TO afl_trade_nonproduction_governance_registry_writer`
  );
  // Seeded under the deployed rules; the migration is applied part-way through the test.
  promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
  });
}, 300_000);

afterAll(async () => {
  await cleanup();
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

const approve = async (type: string, subject: string, content: unknown) => {
  const id = `synthetic-native-successor-review:${subject}`;
  await pool.query(
    `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES($1,$2,$3,'approved','Synthetic native successor capture regression',$4::jsonb,'synthetic-reviewer',$5)`,
    [id, type, subject, canonicalizeAflTradeJson(content), await instant()]
  );
  return id;
};

const arrivalCurrent = async (evidence: readonly { artifactId: string }[]) =>
  (
    await pool.query<{ current: boolean }>(
      `SELECT outcome_acquisition_arrival_event_current($1::jsonb,$2,$3,'non_production','AFLM',TRUE,clock_timestamp(),clock_timestamp()) AS current`,
      [JSON.stringify({ ...promoted.entry, evidence }), promoted.playerId, promoted.clubId]
    )
  ).rows[0]!.current;

const functionBody = async () =>
  (
    await pool.query<{ body: string }>('SELECT pg_get_functiondef($1::regprocedure) AS body', [
      ARRIVAL_SIGNATURE,
    ])
  ).rows[0]!.body;

/**
 * An older approved capture of the same source as the fixture's, with no bytes anywhere: the lost
 * capture that the fixture's own capture will be recorded as succeeding.
 */
async function lostTwinOf(nativeArtifactId: string) {
  const createdAt = await instant();
  const bytes = new TextEncoder().encode(`Lost twin of ${nativeArtifactId} at ${createdAt}.`);
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
  const attemptId = `lost-twin-attempt:${reference.contentSha256}`;
  const captureId = createAflTradeContentAddress('source-capture', {
    lostTwin: reference.artifactId,
  });
  await pool.query(
    `INSERT INTO outcome_source_capture_attempt
     (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
     SELECT $2,attempt.environment,attempt.provider,attempt.dataset,attempt.capability_id,'captured',
            attempt.started_at-interval '1 day',attempt.completed_at-interval '1 day','{}'
       FROM outcome_source_capture capture JOIN outcome_source_capture_attempt attempt USING(attempt_id)
      WHERE capture.source_artifact_id=$1`,
    [nativeArtifactId, attemptId]
  );
  await pool.query(
    `INSERT INTO outcome_source_capture
     (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,dataset_version,
      access_mechanism,capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json)
     SELECT $2,$3,$4,$5,environment,provider,dataset,dataset_version,access_mechanism,capability_id,
       competition,anchor_season_year,effective_at-interval '1 day',captured_at-interval '1 day','approved',manifest_json
       FROM outcome_source_capture WHERE source_artifact_id=$1`,
    [
      nativeArtifactId,
      captureId,
      attemptId,
      reference.artifactId.replace('artifact:', 'source-snapshot:'),
      reference.artifactId,
    ]
  );
  return reference;
}

// The 2020 Cameron trade promotion captured the 2020 Official AFL draft page itself, and that capture
// was later recorded as the successor of the lost 2020 capture. An arrival on the Cameron asset must
// cite the promotion's own capture, which 0252 mapped to the lost original the candidate never had.
it('an arrival entry may cite a capture that is also the recorded successor of a lost capture', async () => {
  const store = await bindTestEvidenceStore(pool);
  const spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    {
      read: async (reference) => {
        const artifact = promoted.retainedArtifacts.get(reference.artifactId);
        if (!artifact) throw new Error('Missing exact retained fixture artifact.');
        return artifact.bytes;
      },
    },
    store
  );
  const native = promoted.sourceArtifact;
  expect(promoted.entry.evidence.map(({ artifactId }) => artifactId)).toEqual([native.artifactId]);
  const nativeCapture = await pool.query<{ capture_id: string }>(
    `SELECT capture_id FROM outcome_source_capture WHERE source_artifact_id=$1 AND status='approved'`,
    [native.artifactId]
  );
  expect(nativeCapture.rows).toHaveLength(1);

  const rule = createAflTradeArrivalSpellRule({
    ...scope,
    ruleVersion: 'synthetic-native-successor-arrival-v4',
    evidence: [native],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );

  // The promotion's own capture is located (a successor must be), then recorded as the successor of
  // an older capture of the same source whose bytes are lost.
  await store.putIfAbsent(native, promoted.retainedArtifacts.get(native.artifactId)!.bytes);
  await pool.query(
    `INSERT INTO outcome_artifact_custody_location(artifact_id,store_id,object_key) VALUES($1,$2,$3)
     ON CONFLICT DO NOTHING`,
    [native.artifactId, store.storeId, store.objectKeyFor(native)]
  );
  const lost = await lostTwinOf(native.artifactId);
  const record = {
    schemaVersion: 'afl-trade-source-capture-successor/v1',
    kind: 'recaptured',
    lostArtifactId: lost.artifactId,
    successorCaptureId: nativeCapture.rows[0]!.capture_id,
    successorArtifactId: native.artifactId,
    createdAt: await instant(),
  };
  const successorId = createAflTradeContentAddress('source-capture-successor', record);
  await pool.query(
    `INSERT INTO outcome_source_capture_successor
     (successor_id,lost_artifact_id,kind,successor_capture_id,successor_artifact_id,record_json,approval_decision_id)
     VALUES($1,$2,'recaptured',$3,$4,$5::jsonb,$6)`,
    [
      successorId,
      lost.artifactId,
      record.successorCaptureId,
      native.artifactId,
      canonicalizeAflTradeJson(record),
      await approve('source_capture_successor', successorId, record),
    ]
  );

  // Under 0252 the cited capture stands only for the lost one, which this candidate never captured.
  expect(await arrivalCurrent([native])).toBe(false);
  const arrivalSpell = async () =>
    createAflTradeArrivalSpell({
      ...scope,
      playerId: promoted.playerId,
      clubId: promoted.clubId,
      entry: promoted.entry,
      ruleId: rule.ruleId,
      version: 1,
      supersedesSpellVersionId: null,
      createdAt: await instant(),
    });
  const arrival = await arrivalSpell();
  await bindTestEvidenceStore(pool);
  await expect(
    spells.registerReviewedSpell(
      arrival,
      await approve('acquisition_spell_registration', arrival.spellVersionId, arrival),
      scope
    )
  ).rejects.toThrow('Acquisition spell registration requires exact current review');

  await pool.query(migrationSql);
  const body = await functionBody();
  expect(body).toContain(
    "capture.source_artifact_id IN (ref->>'artifactId',outcome_source_capture_cited_original(ref->>'artifactId',proposal_at,cutoff))"
  );
  expect(body).not.toContain(
    "capture.source_artifact_id=outcome_source_capture_cited_original(ref->>'artifactId',proposal_at,cutoff)"
  );
  expect(body).not.toContain(
    "WHERE outcome_source_capture_cited_original(ref->>'artifactId',proposal_at,cutoff)=capture.source_artifact_id)"
  );

  // The cited capture now also counts as itself. The lost twin still matches nothing: this candidate
  // never captured it.
  expect(await arrivalCurrent([native])).toBe(true);
  expect(await arrivalCurrent([lost])).toBe(false);
  expect(await arrivalCurrent([native, lost])).toBe(false);
  const registered = await arrivalSpell();
  await bindTestEvidenceStore(pool);
  await spells.registerReviewedSpell(
    registered,
    await approve('acquisition_spell_registration', registered.spellVersionId, registered),
    scope
  );
  expect(
    (
      await pool.query<{ current: boolean }>(
        'SELECT outcome_acquisition_spell_registration_current($1,clock_timestamp()) AS current',
        [registered.spellVersionId]
      )
    ).rows[0]!.current
  ).toBe(true);
}, 120_000);
