import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Disposable PostgreSQL required.');
const schema = `return_episode_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
}, 120_000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it('closes a reviewed departure on the previous day and registers a return as a separate episode', async () => {
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, { lifecycle: true });
  const now = async () =>
    (
      await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
    ).rows[0]!.at.toISOString();
  const review = async (subjectType: string, subjectId: string, proposal: unknown) => {
    const decisionId = `synthetic-review:${subjectId}`;
    await pool.query(
      `INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES($1,$2,$3,'approved','Synthetic reviewed episode',$4::jsonb,'synthetic-reviewer',$5)`,
      [decisionId, subjectType, subjectId, canonicalizeAflTradeJson(proposal), await now()]
    );
    return decisionId;
  };
  const scope = { environment: 'test_fixture' as const, competition: 'AFLM' as const };
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    createPgAflOutcomeSqlClient(pool),
    { read: async () => promoted.sourceBytes }
  );
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'synthetic-return-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await now(),
  });
  await repository.registerReviewedRule(
    rule,
    await review('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  expect(promoted.lifecycleEntries.map((entry) => entry.eventDate)).toEqual([
    '2024-10-15',
    '2024-10-20',
    '2024-10-25',
  ]);
  const first = createAflTradeAcquisitionSpellRegistration({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.lifecycleEntries[0]!,
    departure: promoted.lifecycleEntries[1]!,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2024-10-20',
    continuityEvidence: [promoted.sourceArtifact],
    createdAt: await now(),
  });
  await repository.registerReviewedSpell(
    first,
    await review('acquisition_spell_registration', first.spellVersionId, first),
    scope
  );
  const returned = createAflTradeAcquisitionSpellRegistration({
    ...first.content,
    entry: promoted.lifecycleEntries[2]!,
    departure: null,
    observedThrough: '2025-09-27',
    createdAt: await now(),
  });
  await repository.registerReviewedSpell(
    returned,
    await review('acquisition_spell_registration', returned.spellVersionId, returned),
    scope
  );
  expect(await repository.loadCurrentExact(first.spellVersionId, scope)).toEqual(first);
  expect(await repository.loadCurrentExact(returned.spellVersionId, scope)).toEqual(returned);
  const episodes = (
    await pool.query<{
      spell_id: string;
      start_date: string;
      end_date: string | null;
      supersedes_spell_version_id: string | null;
    }>(`SELECT spell_id,start_date::TEXT,end_date::TEXT,supersedes_spell_version_id
      FROM outcome_acquisition_spell_version ORDER BY start_date`)
  ).rows;
  expect(episodes.map(({ start_date, end_date }) => [start_date, end_date])).toEqual([
    ['2024-10-15', '2024-10-19'],
    ['2024-10-25', null],
  ]);
  expect(new Set(episodes.map((episode) => episode.spell_id)).size).toBe(2);
  expect(episodes.every((episode) => episode.supersedes_spell_version_id === null)).toBe(true);
});
