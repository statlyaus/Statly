import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
  createAflTradeArrivalSpell,
  createAflTradeArrivalSpellRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import {
  createAflTradeExternalCanonicalIdentityTargetSnapshot,
  createAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewContracts';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0254_identity_successor_chains';
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
let migrationSql = '';
let promoted: Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;
let spells: PostgresAflTradeAcquisitionSpellRegistrationRepository;
const identities = new PostgresAflTradeExternalIdentityReviewRepository(client);

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
    draftSessions: true,
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
  const id = `synthetic-identity-chain-review:${subject}`;
  await pool.query(
    `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES($1,$2,$3,'approved','Synthetic identity successor chain regression',$4::jsonb,'synthetic-reviewer',$5)`,
    [id, type, subject, canonicalizeAflTradeJson(content), await instant()]
  );
  return id;
};

const currentness = async (spellVersionId: string) =>
  (
    await pool.query<{ current: boolean }>(
      'SELECT outcome_acquisition_spell_registration_current($1,clock_timestamp()) AS current',
      [spellVersionId]
    )
  ).rows[0]!.current;

const chainHead = async (decisionId: string) =>
  (
    await pool.query<{ head: string | null }>(
      'SELECT outcome_external_identity_current_decision($1) AS head',
      [decisionId]
    )
  ).rows[0]!.head;

const functionBody = async (signature: string) =>
  (
    await pool.query<{ body: string }>('SELECT pg_get_functiondef($1::regprocedure) AS body', [
      signature,
    ])
  ).rows[0]!.body;

/** The next revision of the fixture player's identity subject, persisted through the repository. */
async function supersedeIdentity(input: {
  decision: 'approved' | 'rejected';
  canonicalId?: string;
  recordedLabel?: string;
}) {
  const { reviewPackage, decision: previous } = promoted.identityReview;
  const head = (
    await pool.query<{ decision_id: string; revision: number }>(
      'SELECT decision_id,revision FROM outcome_external_identity_resolution_head WHERE subject_id=$1',
      [previous.content.subject.subjectId]
    )
  ).rows[0]!;
  const decision = createAflTradeExternalIdentityReviewDecision({
    ...previous.content,
    revision: Number(head.revision) + 1,
    supersedesDecisionId: head.decision_id,
    decision: input.decision,
    canonicalTarget:
      input.decision === 'approved'
        ? createAflTradeExternalCanonicalIdentityTargetSnapshot({
            entityKind: 'player',
            canonicalId: input.canonicalId ?? promoted.playerId,
            recordedLabel: input.recordedLabel ?? previous.content.canonicalTarget!.recordedLabel,
          })
        : null,
    rationale: `Synthetic identity re-review (${input.decision})`,
    decidedAt: await instant(),
  });
  await identities.persistDecision({ reviewPackage, decision });
  return decision.decisionId;
}

let reviewedSpellId = '';
let arrivalSpellId = '';
let sameTargetDecisionId = '';

it('a same-player re-review breaks a reviewed spell under the deployed rules', async () => {
  const entryRule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'synthetic-identity-chain-entry-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    entryRule,
    await approve('acquisition_spell_rule', entryRule.ruleId, entryRule),
    scope
  );
  const reviewedSpell = createAflTradeAcquisitionSpellRegistration({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    departure: null,
    ruleId: entryRule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: promoted.entry.eventDate,
    continuityEvidence: promoted.entry.evidence,
    createdAt: await instant(),
  });
  await spells.registerReviewedSpell(
    reviewedSpell,
    await approve('acquisition_spell_registration', reviewedSpell.spellVersionId, reviewedSpell),
    scope
  );
  reviewedSpellId = reviewedSpell.spellVersionId;
  expect(await currentness(reviewedSpellId)).toBe(true);

  // The 2026-10-06 regression: the same player re-confirmed, nothing else changed.
  sameTargetDecisionId = await supersedeIdentity({ decision: 'approved' });
  expect(sameTargetDecisionId).not.toBe(promoted.identityDecisionId);
  expect(await currentness(reviewedSpellId)).toBe(false);
});

it('the migration follows the same-target chain to the head and the spell is current again', async () => {
  await pool.query(migrationSql);
  expect(await chainHead(promoted.identityDecisionId)).toBe(sameTargetDecisionId);
  expect(await chainHead(sameTargetDecisionId)).toBe(sameTargetDecisionId);
  expect(await chainHead('review-decision:unknown')).toBeNull();
  expect(await currentness(reviewedSpellId)).toBe(true);
});

it('an arrival-only spell registers against the superseded promotion-time decision', async () => {
  const arrivalRule = createAflTradeArrivalSpellRule({
    ...scope,
    ruleVersion: 'synthetic-identity-chain-arrival-v4',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    arrivalRule,
    await approve('acquisition_spell_rule', arrivalRule.ruleId, arrivalRule),
    scope
  );
  const arrival = createAflTradeArrivalSpell({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    ruleId: arrivalRule.ruleId,
    version: 2,
    supersedesSpellVersionId: reviewedSpellId,
    createdAt: await instant(),
  });
  await spells.registerReviewedSpell(
    arrival,
    await approve('acquisition_spell_registration', arrival.spellVersionId, arrival),
    scope
  );
  arrivalSpellId = arrival.spellVersionId;
  expect(await currentness(arrivalSpellId)).toBe(true);
  expect(await currentness(reviewedSpellId)).toBe(false);
});

it('a re-review that changes the player breaks the chain and the spell', async () => {
  await pool.query(
    "INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')",
    ['synthetic-identity-chain-other', 'Synthetic Other Player']
  );
  const changed = await supersedeIdentity({
    decision: 'approved',
    canonicalId: 'synthetic-identity-chain-other',
    recordedLabel: 'Synthetic Other Player',
  });
  expect(await chainHead(changed)).toBe(changed);
  expect(await chainHead(promoted.identityDecisionId)).toBeNull();
  expect(await chainHead(sameTargetDecisionId)).toBeNull();
  expect(await currentness(arrivalSpellId)).toBe(false);
});

it('a change back to the player, then a rejection, never restores the chain', async () => {
  // Away and back: the different-target hop stays in the chain and keeps it broken (as 0128 does
  // for identity assignments).
  const back = await supersedeIdentity({ decision: 'approved' });
  expect(await chainHead(back)).toBe(back);
  expect(await chainHead(promoted.identityDecisionId)).toBeNull();
  expect(await currentness(arrivalSpellId)).toBe(false);
  // A rejected head has no chain even from itself.
  const rejected = await supersedeIdentity({ decision: 'rejected' });
  expect(await chainHead(rejected)).toBeNull();
  expect(await chainHead(back)).toBeNull();
  expect(await currentness(arrivalSpellId)).toBe(false);
});

it.each([
  ['validate_outcome_external_canonical_identity_decision()', 1],
  ['validate_outcome_release_event_version_membership()', 2],
  ['validate_outcome_release_membership()', 2],
  ['authenticate_outcome_special_entitlement_lifecycle(jsonb,text)', 1],
  ['authenticate_outcome_special_entitlement_revision_lifecycle(jsonb,text,jsonb)', 1],
])('%s reads the recorded identity decision through its chain', async (signature, uses) => {
  const body = await functionBody(signature);
  expect(
    body.split('outcome_external_identity_current_decision"(').length -
      1 +
      (body.split('outcome_external_identity_current_decision(').length - 1)
  ).toBe(uses);
  expect(body).not.toMatch(
    /review\.?"?decision_id"? ?= ?(asset|selection|NEW)\.?"?external_identity_decision_id"?[;\n]/u
  );
});

it('the promoted-event and arrival-event functions keep the recorded decision’s authority', async () => {
  for (const name of [
    'outcome_acquisition_promoted_event_current',
    'outcome_acquisition_arrival_event_current',
  ]) {
    const body = await functionBody(
      `${name}(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)`
    );
    expect(body).toContain(
      'identity_head.decision_id=outcome_external_identity_current_decision(decision.decision_id)'
    );
    expect(body).toContain('WHERE authority.authority_evidence_id=decision.authority_evidence_id');
    expect(body).toContain('successor.supersedes_decision_id=head_review.decision_id');
    expect(body).not.toContain('successor.supersedes_decision_id=generic.decision_id');
  }
});
