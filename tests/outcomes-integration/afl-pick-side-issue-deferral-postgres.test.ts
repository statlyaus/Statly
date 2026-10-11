import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeExternalCanonicalPromotionProposal,
  deriveAflTradeExternalCanonicalPromotionProposal,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { parseAflTradeExternalEvidenceBatch } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { prepareAflTradeHistoricalReconciliation } from '@/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import {
  loadAflTradeExternalIdentityReviewQueue,
  recordAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewService';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { PostgresAflTradePromotedDraftSelectionReader } from '@/server/aflTradeIntelligence/source/postgresPromotedDraftSelectionReader';
import { PostgresAflTradeReconciliationScopeDecisionRepository } from '@/server/aflTradeIntelligence/source/postgresReconciliationScopeDecisionRepository';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { PostgresAflTradePromotionBackedCorpusRepository } from '@/server/aflTradeIntelligence/artifacts/postgresPromotionBackedCorpusRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0269_deferral_session_claims_written_drafts_only';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });

/**
 * One disposable schema per promotion: the synthetic fixture content-addresses its artifacts and
 * canonical rows, so two promotions in one schema collide unless their namespaces differ. Each schema
 * gets the history deployed just before 0269 (so 0264's deferral and the 0265 to 0268 records are
 * in place) and applies 0269 itself, as `prisma migrate deploy` will.
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

const promote = (
  ws: Workspace,
  namespace: string,
  pickSideIssues?: 'deferred' | 'blocking',
  originalClubUnresolved = false,
  yearPageDraftAlreadyPromoted = false,
  reuseSeededTargets = false,
  transactionAlreadyPromoted = false,
  deferredCustody = false
) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    reciprocalFuturePickYearOffset: 1,
    fixtureNamespace: namespace,
    // An already-promoted trade is the seed's trade: same provider event and player.
    providerEventId: transactionAlreadyPromoted ? '2024-seed-alpha' : `2024-${namespace}-alpha`,
    nativePlayerId: transactionAlreadyPromoted ? 'seed-player' : `${namespace}-player`,
    ...(transactionAlreadyPromoted ? { transactionAlreadyPromoted: true } : {}),
    ...(deferredCustody ? { deferredCustody: true } : {}),
    ...(pickSideIssues ? { pickSideIssues } : {}),
    ...(originalClubUnresolved ? { reciprocalFuturePickOriginalClubUnresolved: true } : {}),
    ...(yearPageDraftAlreadyPromoted ? { yearPageDraftAlreadyPromoted: true } : {}),
    // A second promotion in a schema reuses the synthetic player and clubs the first one inserted.
    ...(reuseSeededTargets
      ? {
          existingTargets: {
            playerId: 'synthetic-acquisition-player',
            playerName: 'Synthetic Player',
            fromClubId: 'club-gws',
            fromClubName: 'GWS',
            toClubId: 'club-western-bulldogs',
            toClubName: 'Western Bulldogs',
          },
        }
      : {}),
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

// Candidate four's four blocking subjects are `transfer:future-pick:…:original-club` identities: the
// concession labels Draftguru prints as the original club of a traded pick, which the owner rejected
// as club identities. That identity is pick-side: under the deferral the pick transfer is still
// written as a directed asset with no origin, and no custody row exists for the pick.
it('defers a pick transfer whose original club is unresolved and promotes it without custody', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  const deferred = await promote(ws, 'origin', 'deferred', true);
  expect(deferred.promotion.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
    deferredIssueCount: 4,
  });
  const issues = await ws.pool.query<{ code: string; subject_key: string; severity: string }>(
    `SELECT code,subject_key,issue_json->>'severity' AS severity
       FROM outcome_external_reconciliation_issue WHERE candidate_id=$1 ORDER BY subject_key`,
    [deferred.candidate.candidateId]
  );
  expect(issues.rows.map(({ severity }) => severity)).toEqual(Array(4).fill('deferred'));
  expect(issues.rows.map(({ code, subject_key }) => ({ code, subject_key }))).toEqual([
    { code: 'lineage_unresolved', subject_key: expect.stringMatching(/^lineage:/) },
    { code: 'identity_unresolved', subject_key: expect.stringMatching(/^selection:.*:club$/) },
    { code: 'identity_unresolved', subject_key: expect.stringMatching(/^selection:.*:player$/) },
    {
      code: 'identity_unresolved',
      subject_key: 'transfer:synthetic-reciprocal-future-pick:original-club',
    },
  ]);
  const candidate = await ws.pool.query<{ issue_count: number; deferred_issue_count: number }>(
    `SELECT issue_count,deferred_issue_count FROM outcome_external_reconciliation_candidate
      WHERE candidate_id=$1`,
    [deferred.candidate.candidateId]
  );
  expect(candidate.rows).toEqual([{ issue_count: 0, deferred_issue_count: 4 }]);

  // The promotion wrote the trade and both directed assets; the pick exists with no origin and
  // gets no custody observation and no realization.
  const promotion = await ws.pool.query<{
    transfer_count: number;
    pick_custody_count: number;
    pick_realization_count: number;
    draft_selection_count: number;
  }>(
    `SELECT transfer_count,pick_custody_count,pick_realization_count,draft_selection_count
       FROM outcome_external_canonical_promotion WHERE promotion_id=$1`,
    [deferred.promotion.promotionId]
  );
  expect(promotion.rows).toEqual([
    {
      transfer_count: 2,
      pick_custody_count: 0,
      pick_realization_count: 0,
      draft_selection_count: 0,
    },
  ]);
  const pick = await ws.pool.query<{ pick_id: string; original_club_id: string | null }>(
    `SELECT pick.pick_id,pick.original_club_id FROM outcome_draft_pick pick
       JOIN outcome_event_asset asset ON asset.pick_id=pick.pick_id
       JOIN outcome_external_canonical_promotion_record record
         ON record.canonical_record_id=asset.asset_version_id AND record.record_kind='transfer'
      WHERE record.promotion_id=$1`,
    [deferred.promotion.promotionId]
  );
  expect(pick.rows).toEqual([
    { pick_id: expect.stringMatching(/^draft-pick:[a-f0-9]{64}$/), original_club_id: null },
  ]);
  expect(await count(ws, 'outcome_pick_custody_observation')).toBe(0);
  expect(await count(ws, 'outcome_pick_realization')).toBe(0);
  // The deferred set the database derives for the promotion validators holds that pick.
  const derived = await ws.pool.query<{ pick_id: string }>(
    'SELECT pick_id FROM outcome_external_candidate_deferred_picks($1)',
    [deferred.candidate.candidateId]
  );
  expect(derived.rows).toEqual([{ pick_id: pick.rows[0]!.pick_id }]);
}, 300_000);

it('keeps an unresolved original club blocking without the deferral', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  await expect(promote(ws, 'origin-blocking', 'blocking', true)).rejects.toThrow(/issue-free/);
  const candidate = await ws.pool.query<{ issue_count: number; deferred_issue_count: number }>(
    'SELECT issue_count,deferred_issue_count FROM outcome_external_reconciliation_candidate'
  );
  expect(candidate.rows).toEqual([{ issue_count: 4, deferred_issue_count: 0 }]);
  expect(await count(ws, 'outcome_external_canonical_promotion')).toBe(0);
}, 300_000);

// A deferred candidate carrying a draft that an earlier session-keyed promotion already made current
// canonical leaves that draft alone (migration 0265): no second, session-less draft root, no duplicate
// selections or player assets. The 2024 national draft is promoted first under session roots; the
// deferred candidate then holds its selection 2, records the draft, and writes only the trade.
it('leaves an already-promoted draft to its promotion and writes only the trade', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  const seeded = await createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    draftSessions: true,
    fixtureNamespace: 'seed',
    providerEventId: '2024-seed-alpha',
    nativePlayerId: 'seed-player',
  });
  expect(seeded.promotion.draftSelectionCount).toBe(2);
  const draftState = async () => ({
    roots: (
      await ws.pool.query<{ stable_key: string }>(
        `SELECT stable_key FROM outcome_event WHERE stable_key LIKE 'external-draft:%' ORDER BY stable_key`
      )
    ).rows.map(({ stable_key }) => stable_key),
    versions: await count(ws, "outcome_event_version WHERE kind<>'trade'"),
    selections: await count(ws, 'outcome_draft_selection'),
    playerAssets: await count(
      ws,
      "outcome_event_asset WHERE kind='player' AND asset_key LIKE 'selected-player:%'"
    ),
  });
  const before = await draftState();
  expect(before.roots).toEqual([
    'external-draft:AFLM:2024:national:session:1',
    'external-draft:AFLM:2024:national:session:2',
  ]);
  expect(before.selections).toBe(2);

  const deferred = await promote(ws, 'skip', 'deferred', false, true, true);
  expect(deferred.candidate.content.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
    promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
  });
  // The selection is resolved through the seeded resolutions, so the only deferred issue is the
  // reciprocal pick's lineage; the draft is excluded by the record, not by a deferred identity.
  expect(
    deferred.candidate.content.issues.map(({ code, severity }) => ({ code, severity }))
  ).toEqual([{ code: 'lineage_unresolved', severity: 'deferred' }]);
  expect(deferred.candidate.content.draftSelections).toEqual([
    expect.objectContaining({
      draftYear: 2024,
      draftType: 'national',
      selectionNumber: 2,
      status: 'single_source',
    }),
  ]);
  expect(deferred.promotion.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
    deferredIssueCount: 1,
    promotedDraftCount: 1,
  });
  expect(deferred.promotion).toMatchObject({
    transactionCount: 1,
    transferCount: 2,
    draftSelectionCount: 0,
    draftPlayerAssetCount: 0,
    pickCustodyCount: 0,
    pickRealizationCount: 0,
  });
  // Nothing of the draft was written: same roots, versions, selections and player assets.
  expect(await draftState()).toEqual(before);
  const stored = await ws.pool.query<{ promoted: unknown; promotable: number; deferral: unknown }>(
    `SELECT candidate_json#>'{content,pickLineageDeferral,promotedDrafts}' AS promoted,
            (SELECT count(*)::integer FROM outcome_external_candidate_promotable_selections($1)) AS promotable,
            (SELECT receipt_json#>'{content,pickLineageDeferral}' FROM outcome_external_canonical_promotion
              WHERE candidate_id=$1) AS deferral
       FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
    [deferred.candidate.candidateId]
  );
  expect(stored.rows).toEqual([
    {
      promoted: [{ draftYear: 2024, draftType: 'national' }],
      promotable: 0,
      deferral: {
        decisionId: deferred.deferralDecisionId,
        deferredIssueCount: 1,
        promotedDraftCount: 1,
      },
    },
  ]);
  // The reader the prepare command uses sees both seeded selections as current canonical.
  const current = await ws.pool.query<{ selection_id: string }>(
    "SELECT selection_id FROM outcome_current_canonical_draft_selection_ids('AFLM') ORDER BY selection_id"
  );
  expect(current.rows.map(({ selection_id }) => selection_id).sort()).toEqual(
    seeded.candidate.content.draftSelections.map(({ selectionId }) => selectionId).sort()
  );
}, 300_000);

it('refuses a candidate that records a draft nobody promoted', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  // No seeded draft sessions: the year page's identities have no current resolution, so the fixture
  // cannot even build the candidate; the database guard is exercised directly on the same shape.
  await expect(promote(ws, 'unpromoted', 'deferred', false, true)).rejects.toThrow(
    /no current resolution/
  );
  const guard = await ws.pool.query<{ current: boolean }>(
    `SELECT outcome_external_candidate_promoted_drafts_current($1::jsonb) AS current`,
    [
      JSON.stringify({
        content: {
          competition: 'AFLM',
          draftSelections: [
            { selectionId: 'external-draft-selection:x', draftYear: 2024, draftType: 'national' },
          ],
          pickLineageDeferral: {
            decisionId: `review-decision:${'d'.repeat(64)}`,
            promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
          },
        },
      }),
    ]
  );
  expect(guard.rows).toEqual([{ current: false }]);
  const absent = await ws.pool.query<{ current: boolean }>(
    `SELECT outcome_external_candidate_promoted_drafts_current($1::jsonb) AS current`,
    [JSON.stringify({ content: { competition: 'AFLM', draftSelections: [] } })]
  );
  expect(absent.rows).toEqual([{ current: true }]);
}, 300_000);

// Asset-scoped supersession (0256, migration 0266). A follow-up promotion re-versions a draft night
// for a few players; the scoped successor supersedes the origin only for the selections it cites or
// re-lists, so the untouched selections stay current canonical and the draft still counts as
// promoted. A successor that re-lists a selection retires it, and the draft no longer counts.
it('counts a draft as promoted under a scoped successor and not under a re-listing', async () => {
  const ws = await workspace();
  const seeded = await createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    draftSessions: true,
    fixtureNamespace: 'seed',
    providerEventId: '2024-seed-alpha',
    nativePlayerId: 'seed-player',
  });
  const seededIds = seeded.candidate.content.draftSelections
    .map(({ selectionId }) => selectionId)
    .sort();
  const secondId = seeded.candidate.content.draftSelections.find(
    ({ selectionNumber }) => selectionNumber === 2
  )!.selectionId;
  const currentIds = async () =>
    (
      await ws.pool.query<{ selection_id: string }>(
        "SELECT selection_id FROM outcome_current_canonical_draft_selection_ids('AFLM') ORDER BY selection_id"
      )
    ).rows.map(({ selection_id }) => selection_id);
  const session = async (selectionNumber: number) =>
    (
      await ws.pool.query<{ event_version_id: string; player_id: string }>(
        `SELECT selection.event_version_id,selection.player_id FROM outcome_draft_selection selection
          WHERE selection.selection_number=$1`,
        [selectionNumber]
      )
    ).rows[0]!;
  const second = await session(2);
  const other = await session(1);
  let ordinal = 0;
  /** A later version of session 2's event, the way a scoped follow-up promotion re-versions a night. */
  const supersede = async (previousVersionId: string, suffix: string) => {
    const eventVersionId = `event-version:synthetic-scoped-${suffix}`;
    const rowId = `${eventVersionId}:event-row`;
    await ws.pool.query(
      `INSERT INTO outcome_import_row
         (import_row_id,import_run_id,source_locator,source_ordinal,record_kind,row_sha256,parse_status,raw_payload,recorded_at)
       SELECT $1,import_row.import_run_id,import_row.source_locator||'#'||$2,1000000+$3,
              import_row.record_kind,encode(sha256(convert_to($1,'UTF8')),'hex'),import_row.parse_status,import_row.raw_payload,clock_timestamp()
         FROM outcome_event_version version
         JOIN outcome_import_row import_row ON import_row.import_row_id=version.source_import_row_id
        WHERE version.event_version_id=$4`,
      [rowId, suffix, ++ordinal, previousVersionId]
    );
    await ws.pool.query(
      `INSERT INTO outcome_event_version
         (event_version_id,event_id,version,kind,acquisition_mechanism,event_date,official_name,status,
          source_import_row_id,supersedes_version_id,recorded_at,date_precision)
       SELECT $1,event_id,version+1,kind,acquisition_mechanism,event_date,official_name,'approved',
              $2,event_version_id,clock_timestamp(),date_precision
         FROM outcome_event_version WHERE event_version_id=$3`,
      [eventVersionId, rowId, previousVersionId]
    );
    return eventVersionId;
  };
  /** A selection on a later version, copied from a player's own promoted selection under a number. */
  const addSelection = async (eventVersionId: string, player: string, selectionNumber: number) =>
    ws.pool.query(
      `INSERT INTO outcome_draft_selection
       SELECT * FROM jsonb_populate_record(NULL::outcome_draft_selection,
         (SELECT to_jsonb(selection) || jsonb_build_object(
            'selection_id','synthetic-scoped-selection:'||$2::text||':'||$1::text,'event_version_id',$2::text,
            'selection_number',$1::int,'pick_id',NULL,'source_import_row_id',$2::text||':event-row')
            FROM outcome_draft_selection selection
            WHERE selection.player_id=$3 ORDER BY selection.selection_number LIMIT 1))`,
      [selectionNumber, eventVersionId, player]
    );

  // 0266 (in the deployed history) judges supersession per selection: a scoped successor carrying
  // another number leaves selection 2 current, before and after this migration.
  const scoped = await supersede(second.event_version_id, 'scoped');
  await addSelection(scoped, other.player_id, 3);
  expect(await currentIds()).toEqual(seededIds);
  await ws.pool.query(ws.migrationSql);
  expect(await currentIds()).toEqual(seededIds);
  // The deferred candidate holding selection 2 still records the draft and promotes nothing of it.
  const deferred = await promote(ws, 'skip', 'deferred', false, true, true);
  expect(deferred.candidate.content.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
    promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
  });
  expect(deferred.promotion).toMatchObject({ draftSelectionCount: 0, pickRealizationCount: 0 });
  const stillCurrent = await ws.pool.query<{ current: boolean }>(
    `SELECT outcome_external_candidate_promoted_drafts_current(candidate_json) AS current
       FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
    [deferred.candidate.candidateId]
  );
  expect(stillCurrent.rows).toEqual([{ current: true }]);

  // A successor that re-lists selection 2 retires it: the draft no longer counts as promoted.
  const relisting = await supersede(scoped, 'relisting');
  await addSelection(relisting, second.player_id, 2);
  expect(await currentIds()).toEqual(seededIds.filter((id) => id !== secondId));
  const retired = await ws.pool.query<{ current: boolean }>(
    `SELECT outcome_external_candidate_promoted_drafts_current(candidate_json) AS current
       FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
    [deferred.candidate.candidateId]
  );
  expect(retired.rows).toEqual([{ current: false }]);
}, 300_000);

// A deferred candidate carrying a trade that an earlier promotion already made current canonical,
// with every transfer a promoted asset on it, leaves that trade alone (migration 0267): no new trade
// version, no asset, no custody, no realization. The seed promotes the trade; the deferred candidate
// then holds the same trade plus a second one it writes.
it('leaves an already-promoted trade to its promotion and writes only the other trade', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  const seeded = await promote(ws, 'seed');
  const seedTransaction = seeded.candidate.content.transactions[0]!;
  expect(seeded.promotion).toMatchObject({ transactionCount: 1, transferCount: 2 });
  const tradeState = async () => ({
    versions: await count(
      ws,
      `outcome_event_version WHERE event_id='${seedTransaction.transactionId}'`
    ),
    assets: await count(
      ws,
      `outcome_event_asset asset JOIN outcome_event_version version USING(event_version_id)
        WHERE version.event_id='${seedTransaction.transactionId}'`
    ),
  });
  const before = await tradeState();
  expect(before).toEqual({ versions: 1, assets: 2 });
  const current = await ws.pool.query<{ transaction_id: string; transfer_ids: string[] }>(
    "SELECT transaction_id,transfer_ids FROM outcome_current_canonical_transactions('AFLM')"
  );
  expect(current.rows).toEqual([
    {
      transaction_id: seedTransaction.transactionId,
      transfer_ids: [...seedTransaction.transferIds].sort(),
    },
  ]);

  const deferred = await promote(ws, 'again', 'deferred', false, false, true, true);
  expect(deferred.candidate.content.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
    promotedTransactions: [seedTransaction.transactionId],
  });
  expect(deferred.candidate.content.transactions.length).toBe(2);
  expect(deferred.promotion.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
    deferredIssueCount: 3,
    promotedTransactionCount: 1,
    promotedTransactionIds: [seedTransaction.transactionId],
  });
  expect(deferred.promotion).toMatchObject({
    transactionCount: 1,
    transferCount: 1,
    draftSelectionCount: 0,
    pickCustodyCount: 0,
    pickRealizationCount: 0,
  });
  // The seeded trade is untouched: same version, same assets; only the second trade was written.
  expect(await tradeState()).toEqual(before);
  const written = await ws.pool.query<{ source_record_id: string; record_kind: string }>(
    `SELECT source_record_id,record_kind FROM outcome_external_canonical_promotion_record
      WHERE promotion_id=$1 ORDER BY record_kind`,
    [deferred.promotion.promotionId]
  );
  expect(written.rows.map(({ record_kind }) => record_kind)).toEqual(['transaction', 'transfer']);
  expect(written.rows.map(({ source_record_id }) => source_record_id)).not.toContain(
    seedTransaction.transactionId
  );
  const stored = await ws.pool.query<{ promotable: number; current: boolean; deferral: unknown }>(
    `SELECT (SELECT count(*)::integer FROM outcome_external_candidate_promotable_transactions($1)) AS promotable,
            outcome_external_candidate_promoted_transactions_current(candidate_json) AS current,
            (SELECT receipt_json#>'{content,pickLineageDeferral}' FROM outcome_external_canonical_promotion
              WHERE candidate_id=$1) AS deferral
       FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
    [deferred.candidate.candidateId]
  );
  expect(stored.rows).toEqual([
    {
      promotable: 1,
      current: true,
      deferral: {
        decisionId: deferred.deferralDecisionId,
        deferredIssueCount: 3,
        promotedTransactionCount: 1,
        promotedTransactionIds: [seedTransaction.transactionId],
      },
    },
  ]);
}, 300_000);

it('refuses a candidate that records a trade nobody promoted', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  await expect(
    promote(ws, 'unpromoted-trade', 'deferred', false, false, false, true)
  ).rejects.toThrow(/current canonical with every transfer promoted/);
  expect(await count(ws, 'outcome_external_reconciliation_candidate')).toBe(0);
}, 300_000);

// A custody observation without a usable status under the deferral (migration 0268): recorded as
// deferred custody on the candidate, counted on the receipt, written as nothing. Without the
// deferral the candidate blocks as before.
it('leaves an unresolved custody observation unwritten under the deferral and counts it', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  const deferred = await promote(ws, 'custody', 'deferred', false, false, false, false, true);
  const custodyId = deferred.candidate.content.pickCustody[0]!.custodyId;
  expect(deferred.candidate.content.pickCustody.map(({ status }) => status)).toEqual([
    'unresolved',
  ]);
  expect(deferred.candidate.content.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
    deferredCustodyIds: [custodyId],
  });
  expect(deferred.promotion.pickLineageDeferral).toEqual({
    decisionId: deferred.deferralDecisionId,
    deferredIssueCount: 3,
    deferredCustodyCount: 1,
  });
  expect(deferred.promotion).toMatchObject({
    transactionCount: 1,
    transferCount: 2,
    pickCustodyCount: 0,
    pickRealizationCount: 0,
  });
  expect(await count(ws, 'outcome_pick_custody_observation')).toBe(0);
  const stored = await ws.pool.query<{ unusable: number; valid: boolean; deferral: unknown }>(
    `SELECT outcome_external_candidate_unusable_record_count($1) AS unusable,
            outcome_external_candidate_deferred_custody_valid(candidate_json) AS valid,
            (SELECT receipt_json#>'{content,pickLineageDeferral}' FROM outcome_external_canonical_promotion
              WHERE candidate_id=$1) AS deferral
       FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
    [deferred.candidate.candidateId]
  );
  expect(stored.rows).toEqual([
    {
      unusable: 0,
      valid: true,
      deferral: {
        decisionId: deferred.deferralDecisionId,
        deferredIssueCount: 3,
        deferredCustodyCount: 1,
      },
    },
  ]);
  // The guard refuses a recorded id that is not an unusable candidate custody row.
  const guard = await ws.pool.query<{ valid: boolean }>(
    `SELECT outcome_external_candidate_deferred_custody_valid($1::jsonb) AS valid`,
    [
      JSON.stringify({
        content: {
          pickCustody: [{ custodyId, status: 'single_source' }],
          pickLineageDeferral: {
            decisionId: deferred.deferralDecisionId,
            deferredCustodyIds: [custodyId],
          },
        },
      }),
    ]
  );
  expect(guard.rows).toEqual([{ valid: false }]);
}, 300_000);

it('keeps an unresolved custody observation blocking without the deferral', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  await expect(
    promote(ws, 'custody-blocking', 'blocking', false, false, false, false, true)
  ).rejects.toThrow(/issue-free/);
  const candidate = await ws.pool.query<{ issue_count: number; unusable: number }>(
    `SELECT issue_count,outcome_external_candidate_unusable_record_count(candidate_id) AS unusable
       FROM outcome_external_reconciliation_candidate`
  );
  // Three blocking issues, and the unresolved custody row still counts as unusable.
  expect(candidate.rows.length).toBe(1);
  expect(candidate.rows[0]).toMatchObject({ issue_count: 3 });
  expect(candidate.rows[0]!.unusable).toBeGreaterThan(0);
  expect(await count(ws, 'outcome_external_canonical_promotion')).toBe(0);
}, 300_000);

// Retained draft_session claims under the deferral (migration 0269). The genuine candidate's sources
// hold the official completed-session captures of drafts it leaves to their earlier promotions; the
// 0264 deferral branch refused any such claim. Built on the retained-capture chain, the real
// preparation path: a draft page, its official session page and a pick trade.
it('reviews and promotes a deferred candidate whose retained session claims belong to an already-promoted draft, and still refuses one that would write that draft', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  const sql = createPgAflOutcomeSqlClient(ws.pool);
  const instant = async () =>
    (
      await ws.pool.query<{ at: string }>(
        `SELECT to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
      )
    ).rows[0]!.at;
  const draft = await createRetainedExternalCaptureFixture(sql, false, 'test_fixture', 27);
  const official = await createRetainedExternalCaptureFixture(sql, true);
  const trade = await createRetainedExternalCaptureFixture(
    sql,
    false,
    'test_fixture',
    27,
    false,
    true
  );
  const fixtures = [draft, official, trade];
  const reader = {
    read: async (ref: Parameters<typeof draft.raw.loadExact>[0]) => {
      for (const repo of fixtures.flatMap((f) => [f.raw, f.metadata])) {
        const value = await repo.loadExact(ref, 2097152);
        if (value) return value.bytes;
      }
      throw new Error('Missing retained fixture bytes');
    },
  };
  const completions = new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(sql);
  const plans = new PostgresAflTradeExternalDiscoveryRepository(sql);
  const complete = async (members: (typeof draft)[]) => {
    const plannedAt = (
      await ws.pool.query<{ at: string }>(
        `SELECT to_char(
           date_trunc('milliseconds',GREATEST(clock_timestamp(),max(finalized_at)))+interval '1 millisecond',
           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
         FROM outcome_external_evidence_batch WHERE batch_id=ANY($1::text[])`,
        [members.map((m) => m.target.evidenceBatchId)]
      )
    ).rows[0]!.at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const plan = createAflTradeRetainedExternalCapturePlan({
      environment: 'test_fixture',
      competition: 'AFLM',
      plannedAt,
      scopeEvidence: members
        .flatMap((m) => m.scopeEvidence)
        .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
      targets: members.map((m) => m.target).sort((a, b) => a.captureId.localeCompare(b.captureId)),
    });
    await plans.persistRetainedPlan(plan, reader);
    return completions.completeRetainedPlan(plan.planId);
  };
  const source = new PostgresAflTradeExternalHistoricalReconciliationSource(sql);
  const reviewRepository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
  const candidateRepository = new PostgresAflTradeExternalReconciliationRepository(sql);
  const reviews = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql);
  const promotions = new PostgresAflTradeExternalCanonicalPromotionRepository(sql);
  const actor = 'synthetic-session-claims-reviewer';
  async function authority(role: string, provider: string, capabilityId: string) {
    const at = await instant();
    const document = {
      evidenceKind: 'reviewer_authority_evidence',
      environment: 'test_fixture',
      principalRef: actor,
      role,
      provider,
      capabilityId,
      scopeKey: 'public-afl-draft-trade-outcomes',
      competition: 'AFLM',
      validFromSeason: 2024,
      validThroughSeason: 2024,
    };
    const referenceId = createAflTradeContentAddress('reviewer-authority-evidence', document);
    const digest = sha256AflTradeCanonicalJson(document);
    const ref = createAflTradeCanonicalJsonArtifactRef(document, at);
    await draft.metadata.putIfAbsent(
      ref,
      new TextEncoder().encode(canonicalizeAflTradeJson(document))
    );
    const approval = createAflTradeContentAddress('governed-evidence-approval-decision', {
      referenceId,
    });
    await sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO outcome_artifact_custody(artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json) VALUES($1,$2,$3,$4,$5,'capture_metadata','test_fixture',$6,$6,'{}')`,
        [ref.artifactId, ref.contentSha256, ref.storageUri, ref.mediaType, ref.byteLength, at]
      );
      await tx.query(
        `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at) VALUES($1,'governed_evidence_reference',$2,'approved','Synthetic scoped technical authority',$3::jsonb,$4,$5)`,
        [approval, referenceId, canonicalizeAflTradeJson({ referenceSha256: digest }), actor, at]
      );
      await tx.query(
        `INSERT INTO outcome_governed_evidence_reference(reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json) VALUES($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,$6::text,($6::text)::jsonb)`,
        [referenceId, digest, ref.artifactId, approval, at, canonicalizeAflTradeJson(document)]
      );
      await tx.query(
        `INSERT INTO outcome_operational_principal_authority(authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through) VALUES($1,$2,$3,'public-afl-draft-trade-outcomes',$4,$5,'AFLM',2024,2024,$6,NULL)`,
        [referenceId, actor, role, provider, capabilityId, at]
      );
    });
    return referenceId;
  }
  const identityAuthority = await authority(
    'afl_trade_external_identity_reviewer',
    'draftguru',
    'external_identity_resolution'
  );
  const promoterAuthority = await authority(
    'afl_trade_canonical_promoter',
    'multi_source',
    'external_candidate_promotion'
  );
  const reviewIdentities = async (completionId: string) => {
    const queue = await loadAflTradeExternalIdentityReviewQueue(
      { completionId },
      { source, reviewRepository }
    );
    const decidedAt = await instant();
    for (const [index, item] of queue.items.entries()) {
      const canonicalId = `synthetic-${item.entityKind}-${index}`;
      await ws.pool.query(
        item.entityKind === 'player'
          ? `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')`
          : `INSERT INTO outcome_club(club_id,current_name,status) VALUES($1,$2,'approved')`,
        [canonicalId, item.observedNames[0]]
      );
      await recordAflTradeExternalIdentityReviewDecision(
        {
          completionId,
          subjectId: item.subjectId,
          decision: 'approved',
          canonicalId,
          rationale: 'Synthetic exact native identity',
          authorityEvidenceId: identityAuthority,
          decidedBy: actor,
          decidedAt,
        },
        { source, reviewRepository }
      );
    }
  };
  const approve = async (candidateId: string, proposal: unknown) => {
    const candidate = await reviews.loadCandidate(candidateId);
    const typed = proposal as Parameters<typeof reviews.persistDecision>[0]['proposal'];
    const decision = createAflTradeExternalCanonicalPromotionReviewDecision({
      candidateId,
      proposalId: typed.proposalId,
      proposalSha256: typed.proposalId.split(':')[1]!,
      proposal: typed,
      revision: 1,
      supersedesDecisionId: null,
      decision: 'approved',
      rationale: 'Synthetic review',
      authorityEvidenceId: promoterAuthority,
      decidedBy: actor,
      decidedAt: await instant(),
    });
    await reviews.persistDecision({ candidate, proposal: typed, decision });
    return decision.decisionId;
  };

  // The deferred completion: draft page, official session page and the pick trade.
  const deferredCompletion = await complete([draft, official, trade]);
  await reviewIdentities(deferredCompletion.completionId);
  const approvalBytes = canonicalizeAflTradeJson({
    approval: 'pick-side deferral',
    completionId: deferredCompletion.completionId,
  });
  const approvalSha = createHash('sha256').update(approvalBytes).digest('hex');
  const decidedAt = await instant();
  await ws.pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,'application/json',$4,'derived_private','test_fixture',$5,$5,'{}'::jsonb)`,
    [
      `artifact:${approvalSha}`,
      approvalSha,
      `artifact://sha256/${approvalSha}`,
      Buffer.byteLength(approvalBytes),
      decidedAt,
    ]
  );
  const scope = await new PostgresAflTradeReconciliationScopeDecisionRepository(sql).recordApproval(
    {
      schemaVersion: 'afl-trade-reconciliation-scope-decision/v1',
      completionId: deferredCompletion.completionId,
      scope: 'pick_lineage_deferral',
      approvalArtifactId: `artifact:${approvalSha}`,
      rationale: 'Synthetic owner approval: defer the pick side until reviewed lineage lands.',
      decidedBy: 'synthetic-owner',
      decidedAt,
    }
  );
  const prepareDeferred = () =>
    prepareAflTradeHistoricalReconciliation(
      {
        completionId: deferredCompletion.completionId,
        pickLineageDeferral: { decisionId: scope.decisionId },
      },
      {
        source,
        identityReviewRepository: reviewRepository,
        candidateRepository,
        scopeDecisionRepository: new PostgresAflTradeReconciliationScopeDecisionRepository(sql),
        promotedSelectionRepository: new PostgresAflTradePromotedDraftSelectionReader(sql),
      }
    );
  const sessionClaim = async (completionId: string) => {
    const batches = (await source.load(completionId)).sourceBatches.map(
      parseAflTradeExternalEvidenceBatch
    );
    const session = batches
      .flatMap((b) => b.content.evidence)
      .find((e) => e.content.claim.kind === 'draft_session')!;
    const claim = session.content.claim;
    if (claim.kind !== 'draft_session') throw new Error('Session missing');
    return { evidenceId: session.evidenceId, claim };
  };

  // 1. Before the draft is promoted the deferred candidate would write it: its retained session
  //    claim still refuses the metadata-only proposal.
  const writing = await prepareDeferred();
  const writingCandidate = await reviews.loadCandidate(writing.candidateId);
  expect(writingCandidate.content.pickLineageDeferral).toEqual({ decisionId: scope.decisionId });
  expect(writingCandidate.content.issues.map(({ code, severity }) => ({ code, severity }))).toEqual(
    [{ code: 'lineage_unresolved', severity: 'deferred' }]
  );
  expect(writingCandidate.content.draftSelections).toHaveLength(27);
  const session = await sessionClaim(deferredCompletion.completionId);
  const tradeDates = writingCandidate.content.transactions.map(({ transactionId }) => ({
    transactionId,
    occurredOn: '2024-10-16',
  }));
  const writingProposal = deriveAflTradeExternalCanonicalPromotionProposal({
    candidate: writingCandidate,
    proposedAt: await instant(),
    draftEvents: [
      {
        draftYear: 2024,
        draftType: 'national',
        eventDate: session.claim.eventDate,
        officialName: session.claim.officialName,
      },
    ],
    transactionDates: tradeDates,
  });
  await expect(approve(writing.candidateId, writingProposal)).rejects.toThrow(
    /retained draft session/
  );

  // 2. The draft is promoted under its session root from a completion without the trade.
  const draftCompletion = await complete([draft, official]);
  const plain = await prepareAflTradeHistoricalReconciliation(
    { completionId: draftCompletion.completionId },
    { source, identityReviewRepository: reviewRepository, candidateRepository }
  );
  const plainCandidate = await reviews.loadCandidate(plain.candidateId);
  expect(plainCandidate.content.issues).toEqual([]);
  const { kind: _kind, selectionNumbers: _numbers, ...date } = session.claim;
  const sessionProposal = createAflTradeExternalCanonicalPromotionProposal({
    schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v2',
    candidateId: plainCandidate.candidateId,
    candidateSha256: plainCandidate.candidateId.split(':')[1]!,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2024,
    draftEventCoverage: [
      {
        ...date,
        expectedSelectionCount: 27,
        selectionIds: plainCandidate.content.draftSelections.map((s) => s.selectionId).sort(),
        evidenceIds: [session.evidenceId],
        status: 'complete',
      },
    ],
    transactionDateCoverage: [],
    proposedAt: await instant(),
    publicationEligible: false,
  });
  const promoted = await promotions.promote({
    candidateId: plainCandidate.candidateId,
    approvalDecisionId: await approve(plainCandidate.candidateId, sessionProposal),
  });
  expect(promoted).toMatchObject({ draftSelectionCount: 27, pickLineageDeferral: null });
  const draftVersions = () => count(ws, "outcome_event_version WHERE kind<>'trade'");
  expect(await draftVersions()).toBe(1);

  // 3. Re-prepared, the deferred candidate leaves the draft to that promotion; its retained session
  //    claim no longer refuses, and the promotion writes only the trade.
  const leaving = await prepareDeferred();
  const leavingCandidate = await reviews.loadCandidate(leaving.candidateId);
  expect(leavingCandidate.content.pickLineageDeferral).toEqual({
    decisionId: scope.decisionId,
    promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
  });
  const leavingProposal = deriveAflTradeExternalCanonicalPromotionProposal({
    candidate: leavingCandidate,
    proposedAt: await instant(),
    draftEvents: [],
    transactionDates: tradeDates,
  });
  expect(leavingProposal.content.draftEventCoverage).toEqual([]);
  const exact = await ws.pool.query<{ exact: boolean }>(
    'SELECT outcome_external_draft_sessions_exact($1,$2::jsonb) AS exact',
    [leaving.candidateId, canonicalizeAflTradeJson(leavingProposal.content)]
  );
  expect(exact.rows).toEqual([{ exact: true }]);
  const result = await promotions.promote({
    candidateId: leaving.candidateId,
    approvalDecisionId: await approve(leaving.candidateId, leavingProposal),
  });
  expect(result).toMatchObject({
    transactionCount: 1,
    transferCount: 1,
    draftSelectionCount: 0,
    pickCustodyCount: 0,
    pickRealizationCount: 0,
    pickLineageDeferral: {
      decisionId: scope.decisionId,
      deferredIssueCount: 1,
      promotedDraftCount: 1,
    },
  });
  expect(await draftVersions()).toBe(1);
}, 600_000);
