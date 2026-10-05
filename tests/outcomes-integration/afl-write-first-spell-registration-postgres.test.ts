import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  AflTradeArtifactUnlocatedError,
  type AflTradeEvidenceStoreBinding,
} from '@/server/aflTradeIntelligence/artifacts/artifactStoreLocation';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { readBackLocalAflTradeArtifactCustody } from '@/server/aflTradeIntelligence/development/localArtifactCustodyReadback';
import { bindLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactStoreBinding';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `write_first_registration_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const client = createPgAflOutcomeSqlClient(pool);
const execution = { environment: 'non_production' as const, competition: 'AFLM' as const };
const STORE_ID = 'write-first-test-store';
const REPOSITORY_ID = 'reviewed-registration-evidence';
let storeRoot = '';

const reviewBytes = (label: string) => new TextEncoder().encode(canonicalizeAflTradeJson({ label }));
const reviewRef = (label: string) =>
  createAflTradeCanonicalJsonArtifactRef({ label }, '2026-09-01T00:00:00.000Z');

async function insertCustody(ref: AflTradeArtifactRef): Promise<void> {
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'capture_metadata','non_production',$6,$6,'{}')`,
    [ref.artifactId, ref.contentSha256, ref.storageUri, ref.mediaType, ref.byteLength, ref.createdAt]
  );
}

async function approve(subjectType: string, subjectId: string, record: unknown, id: string) {
  await pool.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,$2,$3,'approved','Synthetic write-first review',$4::jsonb,'synthetic-reviewer',
       date_trunc('milliseconds',clock_timestamp()))`,
    [id, subjectType, subjectId, canonicalizeAflTradeJson(record)]
  );
}

async function reviewedRule(label: string) {
  const ref = reviewRef(label);
  await insertCustody(ref);
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    ...execution,
    ruleVersion: `write-first-${label}`,
    evidence: [ref],
    createdAt: '2026-09-02T00:00:00.000Z',
  });
  await approve('acquisition_spell_rule', rule.ruleId, rule, `approval-${label}`);
  return { ref, rule, approval: `approval-${label}`, bytes: reviewBytes(label) };
}

const binding = () =>
  bindLocalAflTradeArtifactStore(client, {
    storeId: STORE_ID,
    repositoryId: REPOSITORY_ID,
    artifactClass: 'capture_metadata',
    maximumObjectBytes: 1024 * 1024,
  });

// One promoted player serves both spell cases; the fixture's capture ids are not namespaced.
let promotion: Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>> | undefined;
const promotedPlayer = async () =>
  (promotion ??= await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
  }));

const countRows = async (table: string, column: string, value: string) =>
  (await pool.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [value])).rowCount;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  // The non-production promotion fixture records reviewer authority under this role.
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles
      WHERE rolname='afl_trade_nonproduction_governance_registry_writer') THEN
      CREATE ROLE afl_trade_nonproduction_governance_registry_writer NOLOGIN;
    END IF;
  END $$`);
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT ON "${schemaName}".outcome_review_decision,
                     "${schemaName}".outcome_governed_evidence_reference
       TO afl_trade_nonproduction_governance_registry_writer`
  );
  storeRoot = await mkdtemp(join(tmpdir(), 'statly-write-first-store-'));
  await registerLocalAflTradeArtifactStore(client, { storeId: STORE_ID, rootDirectory: storeRoot });
  // Reviewed registration requires a clean custody readback (migration 0250); the store is empty.
  await readBackLocalAflTradeArtifactCustody({ client, storeId: STORE_ID });
}, 120_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  await admin.end();
  if (storeRoot) {
    await chmod(storeRoot, 0o700).catch(() => undefined);
    await rm(storeRoot, { recursive: true, force: true });
  }
});

it('stores and reads back rule evidence before it records the location and the rule', async () => {
  const { ref, rule, approval, bytes } = await reviewedRule('stored-first');
  const store = await binding();
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    { read: async () => bytes },
    store
  );

  await expect(repository.registerReviewedRule(rule, approval, execution)).resolves.toEqual(rule);
  await expect(repository.registerReviewedRule(rule, approval, execution)).resolves.toEqual(rule);

  const location = await pool.query(
    'SELECT store_id, object_key FROM outcome_artifact_custody_location WHERE artifact_id=$1',
    [ref.artifactId]
  );
  expect(location.rows).toEqual([{ store_id: STORE_ID, object_key: store.objectKeyFor(ref) }]);
  expect(store.objectKeyFor(ref)).toBe(
    `${REPOSITORY_ID}/local_non_production_filesystem/sha256/${ref.contentSha256.slice(0, 2)}/${ref.contentSha256.slice(2, 4)}/${ref.contentSha256}`
  );
  const readback = await store.loadExact(ref, ref.byteLength);
  expect(readback?.bytes).toEqual(bytes);
});

it('stores a spell’s entry and continuity evidence before registering the spell', async () => {
  const promoted = await promotedPlayer();
  const { ref, rule, approval, bytes } = await reviewedRule('spell-rule');
  const continuity = reviewRef('spell-continuity');
  await insertCustody(continuity);
  const read = async (reference: AflTradeArtifactRef) => {
    if (reference.artifactId === promoted.sourceArtifact.artifactId) return promoted.sourceBytes;
    if (reference.artifactId === continuity.artifactId) return reviewBytes('spell-continuity');
    if (reference.artifactId === ref.artifactId) return bytes;
    throw new Error(`Unexpected evidence ${reference.artifactId}`);
  };
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    { read },
    await binding()
  );
  await repository.registerReviewedRule(rule, approval, execution);
  const createdAt = (
    await pool.query<{ instant: Date }>(
      `SELECT date_trunc('milliseconds',clock_timestamp()) AS instant`
    )
  ).rows[0]!.instant.toISOString();
  const spell = createAflTradeAcquisitionSpellRegistration({
    ...execution,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    departure: null,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2025-09-27',
    continuityEvidence: [continuity],
    createdAt,
  });
  await approve('acquisition_spell_registration', spell.spellVersionId, spell, 'spell-approval');

  await expect(
    repository.registerReviewedSpell(spell, 'spell-approval', execution)
  ).resolves.toEqual(spell);

  for (const artifactId of [promoted.sourceArtifact.artifactId, continuity.artifactId]) {
    expect(
      await countRows('outcome_artifact_custody_location', 'artifact_id', artifactId)
    ).toBe(1);
  }
});

it('leaves no location and no rule when the store write fails', async () => {
  const { ref, rule, approval, bytes } = await reviewedRule('unwritable');
  const store = await binding();
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    { read: async () => bytes },
    store
  );
  await chmod(join(storeRoot, REPOSITORY_ID), 0o500);
  try {
    await expect(repository.registerReviewedRule(rule, approval, execution)).rejects.toThrow();
  } finally {
    await chmod(join(storeRoot, REPOSITORY_ID), 0o700);
  }
  expect(await countRows('outcome_artifact_custody_location', 'artifact_id', ref.artifactId)).toBe(0);
  expect(await countRows('outcome_acquisition_spell_rule', 'rule_id', rule.ruleId)).toBe(0);
});

it('leaves no location and no rule when the readback differs from the evidence', async () => {
  const { ref, rule, approval, bytes } = await reviewedRule('readback-mismatch');
  const store = await binding();
  const tampered: AflTradeEvidenceStoreBinding = {
    ...store,
    putIfAbsent: (reference, value) => store.putIfAbsent(reference, value),
    objectKeyFor: (reference) => store.objectKeyFor(reference),
    loadExact: async (reference) => ({ reference, bytes: new Uint8Array([1, 2, 3]) }),
  };
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    { read: async () => bytes },
    tampered
  );
  await expect(repository.registerReviewedRule(rule, approval, execution)).rejects.toThrow(
    'read back'
  );
  expect(await countRows('outcome_artifact_custody_location', 'artifact_id', ref.artifactId)).toBe(0);
  expect(await countRows('outcome_acquisition_spell_rule', 'rule_id', rule.ruleId)).toBe(0);
});

it('refuses non-production registration without a registered evidence store', async () => {
  const { rule, approval, bytes } = await reviewedRule('no-store');
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(client, {
    read: async () => bytes,
  });
  await expect(repository.registerReviewedRule(rule, approval, execution)).rejects.toThrow(
    'registered evidence store'
  );
  expect(await countRows('outcome_acquisition_spell_rule', 'rule_id', rule.ruleId)).toBe(0);
});

it('refuses evidence that has no custody row and records nothing', async () => {
  const ref = reviewRef('no-custody');
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    ...execution,
    ruleVersion: 'write-first-no-custody',
    evidence: [ref],
    createdAt: '2026-09-02T00:00:00.000Z',
  });
  await approve('acquisition_spell_rule', rule.ruleId, rule, 'approval-no-custody');
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    { read: async () => reviewBytes('no-custody') },
    await binding()
  );
  await expect(
    repository.registerReviewedRule(rule, 'approval-no-custody', execution)
  ).rejects.toThrow('custody');
  expect(await countRows('outcome_acquisition_spell_rule', 'rule_id', rule.ruleId)).toBe(0);
});

it('refuses a spell that cites a rule whose evidence was never located', async () => {
  const promoted = await promotedPlayer();
  const { ref, rule, approval } = await reviewedRule('legacy-unlocated');
  const continuity = reviewRef('legacy-continuity');
  await insertCustody(continuity);
  // A rule registered before write-first: present and approved, but its evidence has no location.
  await pool.query(
    `INSERT INTO outcome_acquisition_spell_rule
      (rule_id,rule_version,definition_json,status,created_at,registration_canonical_json,
       registration_approval_decision_id,registered_at)
     VALUES ($1,$2,$3::jsonb,'approved',$4,$5,$6,date_trunc('milliseconds',transaction_timestamp()))`,
    [
      rule.ruleId,
      rule.content.ruleVersion,
      canonicalizeAflTradeJson(rule),
      rule.content.createdAt,
      canonicalizeAflTradeJson(rule.content),
      approval,
    ]
  );
  const createdAt = (
    await pool.query<{ instant: Date }>(
      `SELECT date_trunc('milliseconds',clock_timestamp()) AS instant`
    )
  ).rows[0]!.instant.toISOString();
  const spell = createAflTradeAcquisitionSpellRegistration({
    ...execution,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    departure: null,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2025-09-27',
    continuityEvidence: [continuity],
    createdAt,
  });
  await approve('acquisition_spell_registration', spell.spellVersionId, spell, 'unlocated-approval');
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    {
      read: async (reference) => {
        if (reference.artifactId === ref.artifactId) return reviewBytes('legacy-unlocated');
        if (reference.artifactId === continuity.artifactId) return reviewBytes('legacy-continuity');
        return promoted.sourceBytes;
      },
    },
    await binding()
  );

  const failure = await repository
    .registerReviewedSpell(spell, 'unlocated-approval', execution)
    .then(
      () => null,
      (error: unknown) => error
    );
  expect(failure).toBeInstanceOf(AflTradeArtifactUnlocatedError);
  expect((failure as AflTradeArtifactUnlocatedError).artifactIds).toEqual([ref.artifactId]);
  expect(
    await countRows('outcome_acquisition_spell_version', 'spell_version_id', spell.spellVersionId)
  ).toBe(0);
  // The refusal rolls back the whole registration, including the locations it had recorded.
  expect(
    await countRows('outcome_artifact_custody_location', 'artifact_id', continuity.artifactId)
  ).toBe(0);
});
