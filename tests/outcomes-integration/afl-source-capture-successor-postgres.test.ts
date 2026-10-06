import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradeEvidenceStoreBinding } from '@/server/aflTradeIntelligence/artifacts/artifactStoreLocation';
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

const MIGRATION = '0252_source_capture_successors';
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
let cleanup: () => Promise<void> = async () => undefined;
let promoted: Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  const history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  cleanup = history.cleanup;
  // The promotion fixture commits non-production governance evidence as this role. Suites that seed
  // through the fitzRoy rehearsal fixture first get these grants from it (ensureRole); this one
  // grants the same after the history exists.
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schemaName}"
       TO afl_trade_nonproduction_governance_registry_writer`
  );
  // Seeded under the deployed rules, then the migration edits the deployed definitions in place.
  // The fixture creates its own synthetic player and clubs: nothing in this schema predates it.
  promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    draftSessions: true,
  });
  await pool.query(history.migrationSql);
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
  const id = `synthetic-successor-review:${subject}`;
  await pool.query(
    `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES($1,$2,$3,'approved','Synthetic source capture successor regression',$4::jsonb,'synthetic-reviewer',$5)`,
    [id, type, subject, canonicalizeAflTradeJson(content), await instant()]
  );
  return id;
};

const located = async (artifactId: string) =>
  (
    await pool.query('SELECT 1 FROM outcome_artifact_custody_location WHERE artifact_id=$1', [
      artifactId,
    ])
  ).rowCount === 1;

const currentness = async (spellVersionId: string) =>
  (
    await pool.query<{ current: boolean }>(
      'SELECT outcome_acquisition_spell_registration_current($1,clock_timestamp()) AS current',
      [spellVersionId]
    )
  ).rows[0]!.current;

/**
 * A later capture of the same source as a lost one: new located bytes, a new attempt and an approved
 * capture row copied from the lost capture, optionally at another URL.
 */
async function recapture(
  store: AflTradeEvidenceStoreBinding,
  lostArtifactId: string,
  sourceUrl?: string
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
       competition,anchor_season_year,effective_at,$6,'approved',
       CASE WHEN $7::text IS NULL THEN manifest_json ELSE jsonb_set(manifest_json,'{sourceUrl}',to_jsonb($7::text)) END
       FROM outcome_source_capture WHERE source_artifact_id=$1`,
    [
      lostArtifactId,
      captureId,
      attemptId,
      reference.artifactId.replace('artifact:', 'source-snapshot:'),
      reference.artifactId,
      createdAt,
      sourceUrl ?? null,
    ]
  );
  return { reference, bytes, captureId };
}

async function successorRecord(
  input:
    | { kind: 'recaptured'; lostArtifactId: string; captureId: string; artifactId: string }
    | { kind: 'omitted'; lostArtifactId: string }
) {
  const record = {
    schemaVersion: 'afl-trade-source-capture-successor/v1',
    kind: input.kind,
    lostArtifactId: input.lostArtifactId,
    successorCaptureId: input.kind === 'recaptured' ? input.captureId : null,
    successorArtifactId: input.kind === 'recaptured' ? input.artifactId : null,
    createdAt: await instant(),
  };
  return { successorId: createAflTradeContentAddress('source-capture-successor', record), record };
}

async function insertSuccessor(
  { successorId, record }: Awaited<ReturnType<typeof successorRecord>>,
  approvalDecisionId: string
) {
  await pool.query(
    `INSERT INTO outcome_source_capture_successor
     (successor_id,lost_artifact_id,kind,successor_capture_id,successor_artifact_id,record_json,approval_decision_id)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      successorId,
      record.lostArtifactId,
      record.kind,
      record.successorCaptureId,
      record.successorArtifactId,
      canonicalizeAflTradeJson(record),
      approvalDecisionId,
    ]
  );
}

const byArtifactId = <T extends { artifactId: string }>(items: readonly T[]) =>
  [...items].sort((left, right) => left.artifactId.localeCompare(right.artifactId));

async function clubOf(assetVersionId: string) {
  return (
    await pool.query<{ club_id: string }>(
      'SELECT to_club_id AS club_id FROM outcome_event_asset WHERE asset_version_id=$1',
      [assetVersionId]
    )
  ).rows[0]!.club_id;
}

// Reviewed spells whose entry evidence was lost are re-made as arrivals citing successors: a later
// capture of the same source, or, where the owner approved it, an omission of an edited page.
it('admits arrival entries that cite approved successors of lost captures, and nothing else', async () => {
  const store = await bindTestEvidenceStore(pool);
  const reviewedSpells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    {
      read: async (reference) => {
        const artifact = retained.get(reference.artifactId);
        if (!artifact) throw new Error('Missing exact retained fixture artifact.');
        return artifact;
      },
    },
    store
  );
  const retained = new Map(
    [...promoted.retainedArtifacts.values()].map(({ reference, bytes }) => [
      reference.artifactId,
      bytes,
    ])
  );
  const [first, second] = promoted.draftEntries;
  if (!first || !second) throw new Error('Expected two drafted players.');
  // Each drafted player's entry cites the shared selection page and the session page of their night.
  expect(first.entry.evidence).toHaveLength(2);
  expect(second.entry.evidence).toHaveLength(2);
  const shared = first.entry.evidence.find(({ artifactId }) =>
    second.entry.evidence.some((other) => other.artifactId === artifactId)
  )!;
  const firstSession = first.entry.evidence.find(
    ({ artifactId }) => artifactId !== shared.artifactId
  )!;
  const secondSession = second.entry.evidence.find(
    ({ artifactId }) => artifactId !== shared.artifactId
  )!;
  for (const { artifactId } of [shared, firstSession, secondSession]) {
    expect(await located(artifactId)).toBe(false);
  }

  const rule = createAflTradeArrivalSpellRule({
    ...scope,
    ruleVersion: 'synthetic-successor-arrival-v4',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await reviewedSpells.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );

  const sharedCapture = await recapture(store, shared.artifactId);
  const firstCapture = await recapture(store, firstSession.artifactId);
  for (const { reference, bytes } of [sharedCapture, firstCapture]) {
    retained.set(reference.artifactId, bytes);
  }
  const arrivalFor = async (
    entry: (typeof promoted.draftEntries)[number],
    evidence: readonly { artifactId: string }[]
  ) =>
    createAflTradeArrivalSpell({
      ...scope,
      playerId: entry.player_id,
      clubId: await clubOf(entry.asset_version_id),
      entry: { ...entry.entry, evidence: byArtifactId(evidence) as typeof entry.entry.evidence },
      ruleId: rule.ruleId,
      version: 1,
      supersedesSpellVersionId: null,
      createdAt: await instant(),
    });
  const register = async (arrival: Awaited<ReturnType<typeof arrivalFor>>) => {
    // New custody rows can leave the last readback stale; refresh it so a refusal is the entry's.
    await bindTestEvidenceStore(pool);
    return reviewedSpells.registerReviewedSpell(
      arrival,
      await approve('acquisition_spell_registration', arrival.spellVersionId, arrival),
      scope
    );
  };
  const refused = 'Acquisition spell registration requires exact current review';

  // Fresh captures are not the promotion's evidence until a successor says so.
  await expect(
    register(await arrivalFor(first, [sharedCapture.reference, firstCapture.reference]))
  ).rejects.toThrow(refused);

  const sharedSuccessor = await successorRecord({
    kind: 'recaptured',
    lostArtifactId: shared.artifactId,
    captureId: sharedCapture.captureId,
    artifactId: sharedCapture.reference.artifactId,
  });
  // A successor needs its own exact approval: a missing one, or one approving other content.
  await expect(insertSuccessor(sharedSuccessor, 'missing-approval')).rejects.toThrow();
  const misapproved = await successorRecord({
    kind: 'recaptured',
    lostArtifactId: shared.artifactId,
    captureId: sharedCapture.captureId,
    artifactId: sharedCapture.reference.artifactId,
  });
  await expect(
    insertSuccessor(
      misapproved,
      await approve('source_capture_successor', misapproved.successorId, {
        ...misapproved.record,
        kind: 'omitted',
      })
    )
  ).rejects.toThrow('requires an exact current approval');
  await insertSuccessor(
    sharedSuccessor,
    await approve('source_capture_successor', sharedSuccessor.successorId, sharedSuccessor.record)
  );

  // One successor per lost capture.
  const duplicate = await successorRecord({ kind: 'omitted', lostArtifactId: shared.artifactId });
  await expect(
    insertSuccessor(
      duplicate,
      await approve('source_capture_successor', duplicate.successorId, duplicate.record)
    )
  ).rejects.toThrow();

  // A capture of another URL never succeeds a lost one.
  const elsewhere = await recapture(
    store,
    firstSession.artifactId,
    'https://www.afl.com.au/news/1'
  );
  const misdirected = await successorRecord({
    kind: 'recaptured',
    lostArtifactId: firstSession.artifactId,
    captureId: elsewhere.captureId,
    artifactId: elsewhere.reference.artifactId,
  });
  await expect(
    insertSuccessor(
      misdirected,
      await approve('source_capture_successor', misdirected.successorId, misdirected.record)
    )
  ).rejects.toThrow('later approved capture of the same source');

  // Half the entry has a successor: still refused.
  await expect(
    register(await arrivalFor(first, [sharedCapture.reference, firstCapture.reference]))
  ).rejects.toThrow(refused);

  const firstSuccessor = await successorRecord({
    kind: 'recaptured',
    lostArtifactId: firstSession.artifactId,
    captureId: firstCapture.captureId,
    artifactId: firstCapture.reference.artifactId,
  });
  await insertSuccessor(
    firstSuccessor,
    await approve('source_capture_successor', firstSuccessor.successorId, firstSuccessor.record)
  );
  // Leaving a recaptured page out is not an omission.
  await expect(register(await arrivalFor(first, [sharedCapture.reference]))).rejects.toThrow(
    refused
  );
  const firstArrival = await arrivalFor(first, [sharedCapture.reference, firstCapture.reference]);
  await register(firstArrival);
  expect(await currentness(firstArrival.spellVersionId)).toBe(true);

  // The owner-approved omission of an edited page: the entry cites the selection successor alone.
  await expect(register(await arrivalFor(second, [sharedCapture.reference]))).rejects.toThrow(
    refused
  );
  const omission = await successorRecord({
    kind: 'omitted',
    lostArtifactId: secondSession.artifactId,
  });
  await insertSuccessor(
    omission,
    await approve('source_capture_successor', omission.successorId, omission.record)
  );
  const secondArrival = await arrivalFor(second, [sharedCapture.reference]);
  await register(secondArrival);
  expect(await currentness(secondArrival.spellVersionId)).toBe(true);

  // A successor may only stand in for bytes that are actually lost.
  const locatedOriginal = await successorRecord({
    kind: 'omitted',
    lostArtifactId: promoted.sourceArtifact.artifactId,
  });
  expect(await located(promoted.sourceArtifact.artifactId)).toBe(true);
  await expect(
    insertSuccessor(
      locatedOriginal,
      await approve('source_capture_successor', locatedOriginal.successorId, locatedOriginal.record)
    )
  ).rejects.toThrow('whose bytes are lost');

  // Successors are append-only.
  await expect(
    pool.query(`UPDATE outcome_source_capture_successor SET kind='omitted' WHERE successor_id=$1`, [
      firstSuccessor.successorId,
    ])
  ).rejects.toThrow();
  await expect(
    pool.query('DELETE FROM outcome_source_capture_successor WHERE successor_id=$1', [
      omission.successorId,
    ])
  ).rejects.toThrow();
}, 300_000);
