import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';
import { PostgresAflTradePromotionBackedCorpusRepository } from '@/server/aflTradeIntelligence/artifacts/postgresPromotionBackedCorpusRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0264_pick_side_issue_deferral';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });

/**
 * One disposable schema per promotion: the synthetic fixture content-addresses its artifacts and
 * canonical rows, so two promotions in one schema collide. Each schema gets the history deployed
 * just before 0264 and applies the migration itself, as `prisma migrate deploy` will.
 */
interface Workspace {
  pool: Pool;
  migrationSql: string;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

async function workspace(): Promise<Workspace> {
  const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}_${ordinal++}`;
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
    max: 4,
  });
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  const history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  const built: Workspace = {
    pool,
    migrationSql: history.migrationSql,
    dispose: async () => {
      await history.cleanup();
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    },
  };
  workspaces.push(built);
  return built;
}

afterAll(async () => {
  try {
    for (const built of workspaces) await built.dispose();
  } finally {
    await admin.end();
  }
});

const promote = (ws: Workspace, namespace: string, pickSideIssues?: 'deferred' | 'blocking') =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    reciprocalFuturePickYearOffset: 1,
    fixtureNamespace: namespace,
    providerEventId: `2024-${namespace}-alpha`,
    nativePlayerId: `${namespace}-player`,
    ...(pickSideIssues ? { pickSideIssues } : {}),
  });

const count = async (ws: Workspace, sql: string) =>
  (await ws.pool.query<{ n: number }>(`SELECT count(*)::integer AS n FROM ${sql}`)).rows[0]!.n;

const corpusRequest = async (ws: Workspace) => {
  const now = (
    await ws.pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
  ).rows[0]!.at.toISOString();
  return {
    environment: 'test_fixture' as const,
    competition: 'AFLM',
    knowledgeCutoffAt: now,
    createdAt: now,
  };
};

// Pick-side issue deferral (statlyaus/Statly#869). A candidate whose pick side is unresolved cannot
// promote; under the owner's approved reconciliation-scope decision the same candidate records those
// issues as deferred, promotes its transactions and directed assets, writes nothing for the deferred
// pick or the deferred draft, and is kept out of every promotion-backed corpus.
it('applies over an ordinary promotion and keeps it corpus-eligible', async () => {
  const ws = await workspace();
  const plain = await promote(ws, 'plain');
  expect(plain.promotion.pickLineageDeferral).toBeNull();
  await ws.pool.query(ws.migrationSql);
  const candidate = await ws.pool.query<{
    issue_count: number;
    deferred_issue_count: number;
    lineage_deferral_decision_id: string | null;
  }>(
    `SELECT issue_count,deferred_issue_count,lineage_deferral_decision_id
       FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
    [plain.candidate.candidateId]
  );
  expect(candidate.rows).toEqual([
    { issue_count: 0, deferred_issue_count: 0, lineage_deferral_decision_id: null },
  ]);
  // The ordinary promotion is still the complete eligible set; the corpus builds and replays.
  const corpora = new PostgresAflTradePromotionBackedCorpusRepository(
    createPgAflOutcomeSqlClient(ws.pool)
  );
  const request = await corpusRequest(ws);
  const corpus = await corpora.build(request);
  expect(corpus).toMatchObject({ status: 'finalized', promotionCount: 1, idempotentReplay: false });
  await expect(corpora.build(request)).resolves.toEqual({ ...corpus, idempotentReplay: true });
}, 300_000);

it('refuses to review or promote a candidate whose pick-side issues are blocking', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  await expect(promote(ws, 'blocking', 'blocking')).rejects.toThrow(/issue-free/);
  const candidate = await ws.pool.query<{
    status: string;
    issue_count: number;
    deferred_issue_count: number;
    lineage_deferral_decision_id: string | null;
  }>(
    `SELECT status,issue_count,deferred_issue_count,lineage_deferral_decision_id
       FROM outcome_external_reconciliation_candidate`
  );
  // The candidate itself is stored and finalized: three blocking issues, nothing deferred.
  expect(candidate.rows).toEqual([
    {
      status: 'finalized',
      issue_count: 3,
      deferred_issue_count: 0,
      lineage_deferral_decision_id: null,
    },
  ]);
  expect(await count(ws, 'outcome_external_canonical_promotion')).toBe(0);
}, 300_000);

it('promotes a deferred-lineage candidate without the pick side and keeps it out of any corpus', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  const deferred = await promote(ws, 'deferred', 'deferred');
  expect(deferred.deferralDecisionId).toMatch(/^review-decision:[a-f0-9]{64}$/);
  expect(deferred.promotion.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
    deferredIssueCount: 3,
  });
  expect(deferred.candidate.content.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
  });
  expect(deferred.candidate.content.issues.map(({ severity }) => severity)).toEqual([
    'deferred',
    'deferred',
    'deferred',
  ]);

  // The stored candidate: issue_count is the blocking count (zero), the deferral is recorded.
  const candidate = await ws.pool.query<{
    issue_count: number;
    deferred_issue_count: number;
    lineage_deferral_decision_id: string | null;
  }>(
    `SELECT issue_count,deferred_issue_count,lineage_deferral_decision_id
       FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
    [deferred.candidate.candidateId]
  );
  expect(candidate.rows).toEqual([
    {
      issue_count: 0,
      deferred_issue_count: 3,
      lineage_deferral_decision_id: deferred.deferralDecisionId,
    },
  ]);
  const decision = await ws.pool.query<{
    subject_type: string;
    subject_id: string;
    decision: string;
  }>('SELECT subject_type,subject_id,decision FROM outcome_review_decision WHERE decision_id=$1', [
    deferred.deferralDecisionId,
  ]);
  const authority = deferred.candidate.content.sourceAuthority;
  if (authority?.kind !== 'historical_plan_completion') throw new Error('Expected a completion.');
  expect(decision.rows).toEqual([
    {
      subject_type: 'reconciliation_scope',
      subject_id: authority.completionId,
      decision: 'approved',
    },
  ]);

  // The promotion wrote the trade and both directed assets, and nothing on the pick side.
  const promotion = await ws.pool.query<{
    transaction_count: number;
    transfer_count: number;
    draft_selection_count: number;
    draft_player_asset_count: number;
    pick_custody_count: number;
    pick_realization_count: number;
    promotion_record_count: number;
    deferral: unknown;
  }>(
    `SELECT transaction_count,transfer_count,draft_selection_count,draft_player_asset_count,
            pick_custody_count,pick_realization_count,promotion_record_count,
            receipt_json#>'{content,pickLineageDeferral}' AS deferral
       FROM outcome_external_canonical_promotion WHERE promotion_id=$1`,
    [deferred.promotion.promotionId]
  );
  expect(promotion.rows).toEqual([
    {
      transaction_count: 1,
      transfer_count: 2,
      draft_selection_count: 0,
      draft_player_asset_count: 0,
      pick_custody_count: 0,
      pick_realization_count: 0,
      promotion_record_count: 3,
      deferral: { decisionId: deferred.deferralDecisionId, deferredIssueCount: 3 },
    },
  ]);
  const assets = await ws.pool.query<{
    kind: string;
    pick_id: string | null;
    player_id: string | null;
  }>(
    `SELECT asset.kind::text AS kind,asset.pick_id,asset.player_id FROM outcome_event_asset asset
       JOIN outcome_external_canonical_promotion_record record
         ON record.canonical_record_id=asset.asset_version_id AND record.record_kind='transfer'
      WHERE record.promotion_id=$1 ORDER BY asset.kind::text`,
    [deferred.promotion.promotionId]
  );
  expect(assets.rows).toEqual([
    { kind: 'future_pick', pick_id: expect.stringMatching(/^draft-pick:/), player_id: null },
    { kind: 'player', pick_id: null, player_id: deferred.playerId },
  ]);
  expect(await count(ws, 'outcome_pick_custody_observation')).toBe(0);
  expect(await count(ws, 'outcome_pick_realization')).toBe(0);
  expect(await count(ws, "outcome_event_version WHERE kind<>'trade'")).toBe(0);
  expect(await count(ws, 'outcome_draft_selection')).toBe(0);

  // Nothing deferred is published: the corpus scope excludes the promotion, so there is nothing
  // to build on, and the database refuses it as a member outright.
  const corpora = new PostgresAflTradePromotionBackedCorpusRepository(
    createPgAflOutcomeSqlClient(ws.pool)
  );
  await expect(corpora.build(await corpusRequest(ws))).rejects.toMatchObject({
    code: 'NO_PROMOTIONS',
  });
  // The database refuses the promotion as a corpus member and leaves it out of the complete
  // eligible set a corpus must contain (both guards patched by 0264).
  const guard = await ws.pool.query<{ definition: string }>(
    `SELECT pg_get_functiondef('guard_outcome_promotion_backed_corpus_promotion_insert()'::regprocedure) AS definition`
  );
  expect(guard.rows[0]!.definition).toContain(
    "receipt_json#>'{content,pickLineageDeferral}' IS NOT NULL"
  );
  const eligible = await ws.pool.query<{ definition: string }>(
    `SELECT pg_get_functiondef('finalize_outcome_promotion_backed_corpus()'::regprocedure) AS definition`
  );
  expect(eligible.rows[0]!.definition).toContain(
    "receipt_json#>'{content,pickLineageDeferral}' IS NULL"
  );
}, 300_000);
