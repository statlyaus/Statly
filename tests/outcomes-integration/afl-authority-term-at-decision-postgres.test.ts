import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0258_authority_term_at_decision';
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
const EVENT_SIGNATURES = [
  'outcome_acquisition_promoted_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
  'outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
];
const DEPARTURE_SIGNATURE =
  'outcome_canonical_departure_before_identity_current(text,timestamp with time zone)';
// Both reviewer authorities' terms end one hour after the fixture decides; the checks are then read
// at a cutoff two hours later, after the term.
const termEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const afterTerm = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
let cleanup: () => Promise<void> = async () => undefined;
let migrationSql = '';
let promoted: Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;
let spells: PostgresAflTradeAcquisitionSpellRegistrationRepository;
let reviewedSpellId = '';

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
  // Seeded under the deployed rules; the migration is applied part-way through the sequence below.
  promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    authorityValidThrough: termEnd,
  });
  spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    {
      read: async (reference) => {
        const artifact = promoted.retainedArtifacts.get(reference.artifactId);
        if (!artifact) throw new Error('Missing exact retained fixture artifact.');
        return artifact.bytes;
      },
    },
    await bindTestEvidenceStore(pool)
  );
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
  const id = `synthetic-authority-term-review:${subject}`;
  await pool.query(
    `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES($1,$2,$3,'approved','Synthetic authority term regression',$4::jsonb,'synthetic-reviewer',$5)`,
    [id, type, subject, canonicalizeAflTradeJson(content), await instant()]
  );
  return id;
};

const currentAt = async (spellVersionId: string, cutoff: string) =>
  (
    await pool.query<{ current: boolean }>(
      'SELECT outcome_acquisition_spell_registration_current($1,$2::timestamptz) AS current',
      [spellVersionId, cutoff]
    )
  ).rows[0]!.current;

const arrivalCurrentAt = async (cutoff: string) =>
  (
    await pool.query<{ current: boolean }>(
      `SELECT outcome_acquisition_arrival_event_current($1::jsonb,$2,$3,'non_production','AFLM',TRUE,clock_timestamp(),$4::timestamptz) AS current`,
      [JSON.stringify(promoted.entry), promoted.playerId, promoted.clubId, cutoff]
    )
  ).rows[0]!.current;

const functionBody = async (signature: string) =>
  (
    await pool.query<{ body: string }>('SELECT pg_get_functiondef($1::regprocedure) AS body', [
      signature,
    ])
  ).rows[0]!.body;

it("under the deployed rules a reviewed spell stops counting when its reviewers' terms end", async () => {
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'synthetic-authority-term-entry-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  const spell = createAflTradeAcquisitionSpellRegistration({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    departure: null,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: promoted.entry.eventDate,
    continuityEvidence: promoted.entry.evidence,
    createdAt: await instant(),
  });
  await spells.registerReviewedSpell(
    spell,
    await approve('acquisition_spell_registration', spell.spellVersionId, spell),
    scope
  );
  reviewedSpellId = spell.spellVersionId;
  // Decided inside the term: current now, and read-time currency fails once the term has ended.
  expect(await currentAt(reviewedSpellId, await instant())).toBe(true);
  expect(await currentAt(reviewedSpellId, afterTerm)).toBe(false);
  expect(await arrivalCurrentAt(await instant())).toBe(true);
  expect(await arrivalCurrentAt(afterTerm)).toBe(false);
});

it('the migration judges the authority when the reviewer decided, and the spell outlives the term', async () => {
  await pool.query(migrationSql);
  expect(await currentAt(reviewedSpellId, afterTerm)).toBe(true);
  expect(await currentAt(reviewedSpellId, '2099-01-01T00:00:00.000Z')).toBe(true);
  expect(await arrivalCurrentAt(afterTerm)).toBe(true);
  expect(await arrivalCurrentAt('2099-01-01T00:00:00.000Z')).toBe(true);
});

it.each(EVENT_SIGNATURES)(
  '%s tests both terms at decision time and the identity scope by event season',
  async (signature) => {
    const body = await functionBody(signature);
    expect(body).toContain(
      'authority.valid_from<=review.decided_at AND (authority.valid_through IS NULL OR authority.valid_through>review.decided_at)'
    );
    expect(body).toContain(
      'authority.valid_from<=generic.decided_at AND (authority.valid_through IS NULL OR authority.valid_through>generic.decided_at)'
    );
    expect(body).not.toContain('authority.valid_from<=cutoff');
    expect(body).toContain(
      'EXTRACT(YEAR FROM event.event_date)::INTEGER BETWEEN authority.valid_from_season AND authority.valid_through_season'
    );
    // The promoter's scope keeps the candidate anchor: exactly one anchor-season clause remains.
    expect(
      body.split('candidate.anchor_season_year BETWEEN authority.valid_from_season')
    ).toHaveLength(2);
  }
);

it("the departure check tests the promoter's term at decision time", async () => {
  const body = await functionBody(DEPARTURE_SIGNATURE);
  expect(body).toContain(
    'authority.valid_from<=review.decided_at AND (authority.valid_through IS NULL OR authority.valid_through>review.decided_at)'
  );
  expect(body).not.toContain('authority.valid_from<=cutoff');
});
