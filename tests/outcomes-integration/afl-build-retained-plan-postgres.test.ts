import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  planRetainedPlanSuccessor,
  RetainedPlanRefusal,
} from '@/server/aflTradeIntelligence/development/localRetainedPlanSuccessor';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { prepareAflTradeHistoricalReconciliation } from '@/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { buildRetainedPlan, loadRetainedPlanInputs } from '../../Scripts/build-retained-plan';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
// Own file, so its Gate ledger starts empty: every fixture backdates its decision by ten seconds.
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `build_retained_plan_${process.pid}_${Date.now()}`;
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

it('builds a successor retained plan from a candidate, swapping one capture and adding one', async () => {
  const year = await createRetainedExternalCaptureFixture(sql);
  const official = await createRetainedExternalCaptureFixture(sql, true);
  // A re-capture of the same year page (different bytes), a new page, and a third year capture.
  const recapture = await createRetainedExternalCaptureFixture(sql, false, 'test_fixture', 2);
  const order = await createRetainedExternalCaptureFixture(
    sql,
    false,
    'test_fixture',
    1,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    { draftOrder: true }
  );
  const third = await createRetainedExternalCaptureFixture(sql, false, 'test_fixture', 3);
  const fixtures = [year, official, recapture, order, third];
  const reader = {
    read: async (reference: AflTradeArtifactRef) => {
      for (const fixture of fixtures) {
        for (const repository of [fixture.raw, fixture.metadata]) {
          const retained = await repository.loadExact(reference, 2097152);
          if (retained) return retained.bytes;
        }
      }
      throw new Error('Synthetic retained bytes absent.');
    },
  };

  const plannedAt = (
    await pool.query<{ at: string }>(
      `SELECT to_char(
         date_trunc('milliseconds',GREATEST(clock_timestamp(),max(finalized_at)))+interval '1 millisecond',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM outcome_external_evidence_batch WHERE batch_id=ANY($1::text[])`,
      [[year.target.evidenceBatchId, official.target.evidenceBatchId]]
    )
  ).rows[0]!.at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const original = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt,
    scopeEvidence: [...year.scopeEvidence, ...official.scopeEvidence],
    targets: [year.target, official.target],
  });
  await new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(original, reader);
  const completion = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
    sql
  ).completeRetainedPlan(original.planId);
  const { candidateId } = await prepareAflTradeHistoricalReconciliation(
    { completionId: completion.completionId },
    {
      source: new PostgresAflTradeExternalHistoricalReconciliationSource(sql),
      identityReviewRepository: new PostgresAflTradeExternalIdentityReviewRepository(sql),
      candidateRepository: new PostgresAflTradeExternalReconciliationRepository(sql),
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 5));

  const request = {
    candidateId,
    captureIds: [recapture.target.captureId, order.target.captureId],
    scopeEvidenceIds: [order.scopeEvidence[0]!.artifactId],
  };
  const dryRun = await buildRetainedPlan(sql, { ...request, apply: false }, reader);
  expect(dryRun).toMatchObject({
    status: 'planned',
    predecessorPlanId: original.planId,
    targetCount: 3,
    kept: 1,
    replaced: [
      {
        capabilityId: 'draftguru-national-year-page',
        anchorSeasonYear: 2024,
        sourceUrl: 'https://www.draftguru.com.au/years/2024',
        previousCaptureId: year.target.captureId,
        captureId: recapture.target.captureId,
      },
    ],
    added: [
      {
        capabilityId: 'official-afl-indicative-draft-order',
        previousCaptureId: null,
        captureId: order.target.captureId,
      },
    ],
    completionId: null,
  });
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM outcome_external_historical_capture_plan'
      )
    ).rows[0]!.count
  ).toBe(1);

  const applied = await buildRetainedPlan(sql, { ...request, apply: true }, reader);
  if (applied.status !== 'completed') throw new Error(`Expected a completion: ${applied.status}`);
  const stored = await pool.query<{ capture_id: string; capability_id: string }>(
    `SELECT target_json->'content'->>'captureId' AS capture_id, capability_id
       FROM outcome_external_historical_capture_target WHERE plan_id=$1 ORDER BY ordinal`,
    [applied.planId]
  );
  expect(stored.rows.map((row) => row.capture_id)).toEqual([
    recapture.target.captureId,
    official.target.captureId,
    order.target.captureId,
  ]);
  const completed = await pool.query<{ plan_id: string; target_count: number }>(
    `SELECT plan_id, target_count FROM outcome_external_historical_capture_completion
      WHERE completion_id=$1`,
    [applied.completionId]
  );
  expect(completed.rows).toEqual([{ plan_id: applied.planId, target_count: 3 }]);

  await expect(
    buildRetainedPlan(
      sql,
      { candidateId, captureIds: [official.target.captureId], scopeEvidenceIds: [], apply: false },
      reader
    )
  ).resolves.toMatchObject({ status: 'refused', reason: expect.stringMatching(/already in/) });

  // The stored third capture of the 2024 year page against a plan holding two of them.
  const inputs = await loadRetainedPlanInputs(sql, {
    candidateId,
    captureIds: [third.target.captureId],
    scopeEvidenceIds: [],
  });
  const ambiguous = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt: inputs.plannedAt,
    scopeEvidence: original.content.scopeEvidence,
    targets: [year.target, recapture.target],
  });
  expect(() => planRetainedPlanSuccessor({ ...inputs, predecessor: ambiguous })).toThrow(
    /matches more than one target/
  );
  // A plan instant before the third capture's batch finalized.
  expect(() =>
    planRetainedPlanSuccessor({ ...inputs, plannedAt: third.target.request.capturedAt })
  ).toThrow(RetainedPlanRefusal);
  expect(() =>
    planRetainedPlanSuccessor({ ...inputs, plannedAt: third.target.request.capturedAt })
  ).toThrow(/created after plannedAt/);
});
