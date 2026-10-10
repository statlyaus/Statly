import { reconcileAflTradeExternalEvidence } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { Pool } from 'pg';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `retained_capture_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
}, 120000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
it('completes genuine-shaped retained capture through public owners with no scheduler or trade index', async () => {
  const fixture = await createRetainedExternalCaptureFixture(sql);
  const official = await createRetainedExternalCaptureFixture(sql, true);
  const plannedAt = (
    await pool.query<{ at: string }>(
      `SELECT to_char(
         date_trunc('milliseconds',GREATEST(clock_timestamp(),max(finalized_at)))+interval '1 millisecond',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM outcome_external_evidence_batch WHERE batch_id=ANY($1::text[])`,
      [[fixture.target.evidenceBatchId, official.target.evidenceBatchId]]
    )
  ).rows[0]!.at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt,
    scopeEvidence: [...fixture.scopeEvidence, ...official.scopeEvidence].sort((left, right) =>
      left.artifactId.localeCompare(right.artifactId)
    ),
    targets: [fixture.target, official.target],
  });
  const repository = new PostgresAflTradeExternalDiscoveryRepository(sql);
  const reader = {
    read: async (reference: typeof fixture.target.sourceArtifact) => {
      const retained =
        (await fixture.raw.loadExact(reference, 2097152)) ??
        (await fixture.metadata.loadExact(reference, 2097152)) ??
        (await official.raw.loadExact(reference, 2097152)) ??
        (await official.metadata.loadExact(reference, 2097152));
      if (!retained) throw new Error('Synthetic retained bytes absent.');
      return retained.bytes;
    },
  };
  expect((await repository.persistRetainedPlan(plan, reader)).idempotentReplay).toBe(false);
  expect((await repository.persistRetainedPlan(plan, reader)).idempotentReplay).toBe(true);
  const completions = new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(sql);
  const completed = await completions.completeRetainedPlan(plan.planId);
  expect(completed).toMatchObject({
    targetCount: 2,
    sourceBatchCount: 2,
    idempotentReplay: false,
    publicationEligible: false,
  });
  expect(await completions.completeRetainedPlan(plan.planId)).toEqual({
    ...completed,
    idempotentReplay: true,
  });
  const source = await new PostgresAflTradeExternalHistoricalReconciliationSource(sql).load(
    completed.completionId
  );
  expect(source.sourceBatches.map((b) => b.batchId)).toEqual([
    fixture.target.evidenceBatchId,
    official.target.evidenceBatchId,
  ]);
  expect(source.sourceBatches[1]!.content.evidence[0]!.content.claim).toMatchObject({
    kind: 'draft_session',
    eventDate: '2024-11-20',
    sessionOrdinal: 1,
  });
  expect(source.sourceBatches[0]!.content.evidence[0]!.content.claim).toMatchObject({
    kind: 'draft_selection',
    selectionNumber: 1,
    player: { nativeId: 'synthetic-player' },
  });
  expect(
    (await pool.query('SELECT count(*)::int AS count FROM outcome_external_capture_occurrence'))
      .rows[0]!.count
  ).toBe(0);
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM outcome_external_trade_discovery_inventory'
      )
    ).rows[0]!.count
  ).toBe(0);
  await expect(
    repository.persistRetainedPlan(plan, { read: async () => new Uint8Array([0]) })
  ).rejects.toThrow();
  const swapped = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt: new Date().toISOString(),
    scopeEvidence: fixture.scopeEvidence,
    targets: [{ ...fixture.target, evidenceBatchId: official.target.evidenceBatchId }],
  });
  await expect(repository.persistRetainedPlan(swapped, reader)).rejects.toThrow('exact current');
  const changedRequest = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt: new Date().toISOString(),
    scopeEvidence: fixture.scopeEvidence,
    targets: [
      {
        ...fixture.target,
        request: { ...fixture.target.request, parserVersion: 'unreviewed-parser/v2' },
      },
    ],
  });
  await expect(repository.persistRetainedPlan(changedRequest, reader)).rejects.toThrow(
    'exact current'
  );
  const batchReviewAt = new Date().toISOString();
  const batchReviewId = createAflTradeContentAddress('review-decision', {
    syntheticBatchReview: plan.planId,
  });
  const batchRoot = sha256AflTradeCanonicalJson(source.sourceBatches.map((b) => b.batchId).sort());
  await pool.query(
    `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
    VALUES($1,'external_reconciliation_batch_set',$2,'approved','Synthetic reviewed batch set',$3::jsonb,'synthetic-owner',$4)`,
    [
      batchReviewId,
      batchRoot,
      JSON.stringify({ sourceBatchIds: source.sourceBatches.map((b) => b.batchId).sort() }),
      batchReviewAt,
    ]
  );
  const reconciliation = new PostgresAflTradeExternalReconciliationRepository(sql);
  const alternateInput = {
    environment: 'test_fixture' as const,
    competition: 'AFLM',
    anchorSeasonYear: 2024,
    sourceBatches: source.sourceBatches,
    identityResolutions: [],
    sourceAuthority: {
      schemaVersion: 'afl-trade-external-reconciliation-source-authority/v1',
      kind: 'reviewed_batch_set',
      reviewDecisionId: batchReviewId,
      reviewDecisionSha256: batchReviewId.slice('review-decision:'.length),
      candidateSourceBatchSetSha256: batchRoot,
      decidedAt: batchReviewAt,
    },
  };
  const alternate = reconcileAflTradeExternalEvidence({
    ...alternateInput,
    reconciledAt: new Date().toISOString(),
  });
  await expect(
    reconciliation.persistCandidate({ candidate: alternate, identityResolutions: [] })
  ).resolves.toMatchObject({ status: 'finalized' });
  expect(
    (
      await pool.query(
        'SELECT outcome_external_candidate_retained_sources_current($1,clock_timestamp()) AS current',
        [alternate.candidateId]
      )
    ).rows[0].current
  ).toBe(true);
  const withdrawalAt = new Date().toISOString();
  const proposalContent = {
    ...fixture.proposal.content,
    version: 2,
    proposedAt: withdrawalAt,
    proposal: 'Withdraw synthetic retained use',
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    ...fixture.decision.content,
    proposalId: proposal.proposalId,
    version: 2,
    state: 'withdrawn',
    decidedAt: withdrawalAt,
    effectiveAt: withdrawalAt,
    revalidateAt: null,
    supersedesDecisionId: fixture.decision.decisionId,
    withdrawalActions: ['Stop synthetic source use'],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  let signalCommit!: () => void;
  let releaseCommit!: () => void;
  const commitReached = new Promise<void>((resolve) => {
    signalCommit = resolve;
  });
  const allowCommit = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const withdrawalClient = createPgAflOutcomeSqlClient({
    query: (statement, parameters) =>
      pool.query(statement, parameters ? [...parameters] : undefined),
    connect: async () => {
      const connection = await pool.connect();
      return {
        release: () => connection.release(),
        query: async (statement, parameters) => {
          if (statement === 'COMMIT') {
            signalCommit();
            await allowCommit;
          }
          return connection.query(statement, parameters ? [...parameters] : undefined);
        },
      };
    },
  });
  const withdrawal = createPostgresAflTradeGateDecisionLedgerRepository(withdrawalClient).append({
    expectedRevision: (await fixture.ledger.load()).revision,
    sourceRights: fixture.rights,
    proposal,
    decision,
  });
  // The public Gate writer has inserted withdrawal and holds the ledger lock before commit.
  await Promise.race([
    commitReached,
    withdrawal.then(() => {
      throw new Error('Withdrawal bypassed commit barrier');
    }),
  ]);
  const replays = [
    repository.persistRetainedPlan(plan, reader),
    completions.completeRetainedPlan(plan.planId),
    new PostgresAflTradeExternalHistoricalReconciliationSource(sql).load(completed.completionId),
  ].map(async (work) => {
    try {
      await work;
      return null;
    } catch (error) {
      return error;
    }
  });
  try {
    await expect
      .poll(
        async () =>
          Number(
            (
              await pool.query(`SELECT count(*) AS count FROM pg_stat_activity
      WHERE pid<>pg_backend_pid() AND wait_event_type='Lock'
        AND query LIKE '%SELECT singleton_id FROM outcome_gate_ledger_head%'`)
            ).rows[0].count
          ),
        { timeout: 5000 }
      )
      .toBe(3);
  } finally {
    releaseCommit();
  }
  await withdrawal;
  for (const error of await Promise.all(replays)) expect(error).toBeInstanceOf(Error);
  expect(
    (
      await pool.query(
        'SELECT outcome_external_candidate_retained_sources_current($1,clock_timestamp()) AS current',
        [alternate.candidateId]
      )
    ).rows[0].current
  ).toBe(false);
  await expect(
    reconciliation.persistCandidate({ candidate: alternate, identityResolutions: [] })
  ).rejects.toThrow();
  const afterWithdrawal = reconcileAflTradeExternalEvidence({
    ...alternateInput,
    reconciledAt: new Date().toISOString(),
  });
  await expect(
    reconciliation.persistCandidate({ candidate: afterWithdrawal, identityResolutions: [] })
  ).rejects.toThrow();

  expect(
    (
      await pool.query(
        'SELECT completion_id FROM outcome_external_historical_capture_completion WHERE completion_id=$1',
        [completed.completionId]
      )
    ).rows
  ).toEqual([{ completion_id: completed.completionId }]);
});
