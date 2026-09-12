import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `acquisition_registration_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const bytes = new TextEncoder().encode(canonicalizeAflTradeJson({ syntheticRuleReview: true }));
const evidence = createAflTradeCanonicalJsonArtifactRef(
  { syntheticRuleReview: true },
  '2026-09-01T00:00:00.000Z'
);
const rule = createAflTradeAcquisitionSpellRegistrationRule({
  environment: 'test_fixture',
  competition: 'AFLM',
  ruleVersion: 'synthetic-entry-v1',
  evidence: [evidence],
  createdAt: '2026-09-02T00:00:00.000Z',
});
const execution = { environment: 'test_fixture' as const, competition: 'AFLM' as const };
const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
  createPgAflOutcomeSqlClient(pool),
  { read: async () => bytes }
);
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await pool.query(
    `INSERT INTO outcome_artifact_custody
    (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
     environment,created_at,verified_at,custody_json)
    VALUES ($1,$2,$3,$4,$5,'derived_private','test_fixture',$6,$6,'{}')`,
    [
      evidence.artifactId,
      evidence.contentSha256,
      evidence.storageUri,
      evidence.mediaType,
      evidence.byteLength,
      evidence.createdAt,
    ]
  );
  await pool.query(
    `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
    VALUES ('synthetic-rule-approval','acquisition_spell_rule',$1,'approved',
      'Synthetic exact rule review',$2::jsonb,'synthetic-reviewer','2026-09-03T00:00:00.000Z')`,
    [rule.ruleId, canonicalizeAflTradeJson(rule)]
  );
}, 120_000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  await admin.end();
});

it('rejects bytes that differ from retained evidence and an execution outside the reviewed scope', async () => {
  const corruptReader = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    createPgAflOutcomeSqlClient(pool),
    { read: async () => new Uint8Array([1, 2, 3]) }
  );
  await expect(
    corruptReader.registerReviewedRule(rule, 'synthetic-rule-approval', execution)
  ).rejects.toThrow('bytes differ');
  await expect(
    repository.registerReviewedRule(rule, 'synthetic-rule-approval', {
      ...execution,
      competition: 'AFLW',
    })
  ).rejects.toThrow('scope differs');
  await expect(
    repository.registerReviewedRule(rule, 'missing-review', execution)
  ).rejects.toThrow();
});

it('rejects a direct SQL registration whose materialized rule version differs from the reviewed content', async () => {
  await expect(
    pool.query(
      `INSERT INTO outcome_acquisition_spell_rule
    (rule_id,rule_version,definition_json,status,created_at,registration_canonical_json,
     registration_approval_decision_id,registered_at)
    VALUES ($1,'forged-version',$2::jsonb,'approved',$3,$4,'synthetic-rule-approval',
      date_trunc('milliseconds',transaction_timestamp()))`,
      [
        rule.ruleId,
        canonicalizeAflTradeJson(rule),
        rule.content.createdAt,
        canonicalizeAflTradeJson(rule.content),
      ]
    )
  ).rejects.toThrow('exact current review');
});

it('rejects a direct SQL registration that backdates its registration time', async () => {
  await expect(
    pool.query(
      `INSERT INTO outcome_acquisition_spell_rule
    (rule_id,rule_version,definition_json,status,created_at,registration_canonical_json,
     registration_approval_decision_id,registered_at)
    VALUES ($1,$2,$3::jsonb,'approved',$4,$5,'synthetic-rule-approval','2026-09-05T00:00:00.000Z')`,
      [
        rule.ruleId,
        rule.content.ruleVersion,
        canonicalizeAflTradeJson(rule),
        rule.content.createdAt,
        canonicalizeAflTradeJson(rule.content),
      ]
    )
  ).rejects.toThrow();
});

it('registers an exactly reviewed rule, replays it, and rejects a revoked approval', async () => {
  await expect(
    repository.registerReviewedRule(rule, 'synthetic-rule-approval', execution)
  ).resolves.toEqual(rule);
  await expect(
    repository.registerReviewedRule(rule, 'synthetic-rule-approval', execution)
  ).resolves.toEqual(rule);
  await pool.query(
    `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
    VALUES ('synthetic-rule-revocation','acquisition_spell_rule',$1,'rejected',
      'synthetic-rule-approval','Synthetic revocation',$2::jsonb,'synthetic-reviewer','2026-09-04T00:00:00.000Z')`,
    [rule.ruleId, canonicalizeAflTradeJson(rule)]
  );
  await expect(
    repository.registerReviewedRule(rule, 'synthetic-rule-approval', execution)
  ).rejects.toThrow();
});

it('waits for an in-flight review revocation and rejects registration after it commits', async () => {
  const concurrentRule = createAflTradeAcquisitionSpellRegistrationRule({
    ...rule.content,
    ruleVersion: 'synthetic-concurrent-revocation-v1',
  });
  await pool.query(
    `INSERT INTO outcome_review_decision
     (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ('synthetic-concurrent-approval','acquisition_spell_rule',$1,'approved',
       'Synthetic concurrency review',$2::jsonb,'synthetic-reviewer','2026-09-03T00:00:00Z')`,
    [concurrentRule.ruleId, canonicalizeAflTradeJson(concurrentRule)]
  );
  const revoker = await pool.connect();
  try {
    await revoker.query('BEGIN');
    const pid = (await revoker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
      .pid;
    await revoker.query(
      `INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
       VALUES ('synthetic-concurrent-revocation','acquisition_spell_rule',$1,'rejected',
         'synthetic-concurrent-approval','Synthetic revocation while registration waits',
         $2::jsonb,'synthetic-reviewer',date_trunc('milliseconds',clock_timestamp()))`,
      [concurrentRule.ruleId, canonicalizeAflTradeJson(concurrentRule)]
    );
    const registration = repository
      .registerReviewedRule(concurrentRule, 'synthetic-concurrent-approval', execution)
      .then(
        () => null,
        (error: unknown) => error
      );
    let blocked = false;
    const deadline = Date.now() + 5_000;
    while (!blocked && Date.now() < deadline) {
      blocked = (
        await pool.query<{ blocked: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',
          [pid]
        )
      ).rows[0]!.blocked;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await revoker.query('COMMIT');
    expect(blocked).toBe(true);
    expect(await registration).toBeInstanceOf(Error);
    expect(
      (
        await pool.query('SELECT rule_id FROM outcome_acquisition_spell_rule WHERE rule_id=$1', [
          concurrentRule.ruleId,
        ])
      ).rowCount
    ).toBe(0);
  } finally {
    await revoker.query('ROLLBACK');
    revoker.release();
  }
});

it('registers a promoted incoming player spell and reloads its exact current evidence', async () => {
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool);
  const spellRule = createAflTradeAcquisitionSpellRegistrationRule({
    ...rule.content,
    ruleVersion: 'synthetic-player-entry-v1',
  });
  await pool.query(
    `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
    VALUES ('synthetic-player-rule-approval','acquisition_spell_rule',$1,'approved',
      'Synthetic exact rule',$2::jsonb,'synthetic-reviewer','2026-09-03T00:00:00.000Z')`,
    [spellRule.ruleId, canonicalizeAflTradeJson(spellRule)]
  );
  const spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    createPgAflOutcomeSqlClient(pool),
    {
      read: async (ref) =>
        ref.artifactId === promoted.sourceArtifact.artifactId ? promoted.sourceBytes : bytes,
    }
  );
  await spells.registerReviewedRule(spellRule, 'synthetic-player-rule-approval', execution);
  const proposalTime = await pool.query<{ instant: Date }>(
    `SELECT date_trunc('milliseconds',clock_timestamp()) AS instant`
  );
  const spell = createAflTradeAcquisitionSpellRegistration({
    ...execution,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    departure: null,
    ruleId: spellRule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2025-09-27',
    continuityEvidence: [evidence],
    createdAt: proposalTime.rows[0]!.instant.toISOString(),
  });
  await pool.query(
    `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
    VALUES ('synthetic-player-spell-approval','acquisition_spell_registration',$1,'approved',
      'Synthetic reviewed continuity through 2025',$2::jsonb,'synthetic-reviewer',date_trunc('milliseconds',clock_timestamp()))`,
    [spell.spellVersionId, canonicalizeAflTradeJson(spell)]
  );
  await expect(
    Promise.all([
      spells.registerReviewedSpell(spell, 'synthetic-player-spell-approval', execution),
      spells.registerReviewedSpell(spell, 'synthetic-player-spell-approval', execution),
    ])
  ).resolves.toEqual([spell, spell]);
  await expect(spells.loadCurrentExact(spell.spellVersionId, execution)).resolves.toEqual(spell);
  await expect(
    spells.loadCurrentExact(spell.spellVersionId, { ...execution, competition: 'AFLW' })
  ).rejects.toThrow('scope differs');
  const corruptRule = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    createPgAflOutcomeSqlClient(pool),
    {
      read: async (ref) =>
        ref.artifactId === promoted.sourceArtifact.artifactId
          ? promoted.sourceBytes
          : new Uint8Array([0]),
    }
  );
  await expect(corruptRule.loadCurrentExact(spell.spellVersionId, execution)).rejects.toThrow(
    'bytes differ'
  );
  await expect(spells.registerReviewedSpell(spell, 'wrong-approval', execution)).rejects.toThrow();
  const invalidProposals = [
    { ...spell.content, playerId: 'synthetic-other-player' },
    { ...spell.content, clubId: 'club-gws' },
    { ...spell.content, entry: { ...spell.content.entry, eventDate: '2024-10-16' } },
    { ...spell.content, entry: { ...spell.content.entry, assetVersionId: 'wrong-player-asset' } },
    { ...spell.content, entry: { ...spell.content.entry, evidence: [evidence] } },
    { ...spell.content, version: 3, supersedesSpellVersionId: spell.spellVersionId },
    { ...spell.content, observedThrough: '2025-09-29' }, // A separate overlapping first episode.
  ];
  for (const [index, content] of invalidProposals.entries()) {
    const invalid = createAflTradeAcquisitionSpellRegistration(content);
    const decisionId = `synthetic-invalid-spell-${index}`;
    await pool.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'acquisition_spell_registration',$2,'approved',
         'Synthetic negative authority case',$3::jsonb,'synthetic-reviewer',date_trunc('milliseconds',clock_timestamp()))`,
      [decisionId, invalid.spellVersionId, canonicalizeAflTradeJson(invalid)]
    );
    await expect(spells.registerReviewedSpell(invalid, decisionId, execution)).rejects.toThrow();
  }
  const correctionTime = await pool.query<{ instant: Date }>(
    `SELECT date_trunc('milliseconds',clock_timestamp()) AS instant`
  );
  const correction = createAflTradeAcquisitionSpellRegistration({
    ...spell.content,
    version: 2,
    supersedesSpellVersionId: spell.spellVersionId,
    observedThrough: '2025-09-28',
    createdAt: correctionTime.rows[0]!.instant.toISOString(),
  });
  await pool.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ('synthetic-corrected-spell','acquisition_spell_registration',$1,'approved',
       'Reviewed synthetic correction',$2::jsonb,'synthetic-reviewer',date_trunc('milliseconds',clock_timestamp()))`,
    [correction.spellVersionId, canonicalizeAflTradeJson(correction)]
  );
  await expect(
    spells.registerReviewedSpell(correction, 'synthetic-corrected-spell', execution)
  ).resolves.toEqual(correction);
  await expect(spells.loadCurrentExact(spell.spellVersionId, execution)).rejects.toThrow(
    'not current'
  );
  await expect(spells.loadCurrentExact(correction.spellVersionId, execution)).resolves.toEqual(
    correction
  );
  await pool.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     SELECT 'synthetic-promoter-authority-revoked',approval.subject_type,approval.subject_id,'rejected',
       approval.decision_id,'Synthetic authority revocation',approval.evidence_json,approval.decided_by,
       date_trunc('milliseconds',clock_timestamp())
     FROM outcome_external_canonical_promotion_review_decision typed
     JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=typed.authority_evidence_id
     JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
     WHERE typed.decision_id=$1`,
    [promoted.approvalDecisionId]
  );
  await expect(spells.loadCurrentExact(correction.spellVersionId, execution)).rejects.toThrow(
    'not current'
  );
  await expect(
    spells.registerReviewedSpell(correction, 'synthetic-corrected-spell', execution)
  ).rejects.toThrow();
});
