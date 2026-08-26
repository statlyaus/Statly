import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeCurrentValuationCohortCoordinator,
  createAflTradeCurrentValuationCohortPreparationOperationId,
} from '@/server/aflTradeIntelligence/valuation/currentValuationCohortPreparation';
import {
  createPostgresAflTradeCurrentValuationCohortAuthorityCapture,
  createPostgresAflTradeCurrentValuationCohortCommitter,
} from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortPreparation';
import type { AflTradePreparedValuationInputSet } from '@/server/aflTradeIntelligence/valuation/preparedValuationInputSet';
import { createAflTradeCurrentValuationBundleFixture } from '../testUtils/currentValuationCohortFixture';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = createPgAflOutcomeSqlClient(pool);
const schemaName = `afl_current_cohort_${process.pid}_${Date.now()}`;
const digest = (character: string) => character.repeat(64);
const scopeKey = 'afl-men:automatic-cohort-pg-proof';
const releaseScopeKey = 'public-afl-draft-trade-outcomes';

function artifact(label: string, createdAt = '2026-08-19T08:00:00.000Z') {
  return createAflTradeCanonicalJsonArtifactRef({ label }, createdAt);
}

beforeAll(async () => {
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
  await pool.query(`SET search_path TO "${schemaName}"`);
  await pool.query(`CREATE TABLE outcome_active_release (
    scope_key text PRIMARY KEY, release_id text NOT NULL, revision integer NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_current_governed_valuation_model_pair (
    scope_key text PRIMARY KEY, revision integer NOT NULL, qualification_id text NOT NULL,
    player_run_id text NOT NULL, pick_run_id text NOT NULL, work_id text NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_current_prepared_valuation_input_set (
    scope_key text PRIMARY KEY, prepared_input_set_id text NOT NULL,
    revision integer NOT NULL, activated_at timestamptz NOT NULL
  )`);
  await pool.query(`CREATE TABLE registered_prepared_valuation_input_set (
    prepared_input_set_id text PRIMARY KEY, prepared_json jsonb NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_current_valuation_cohort_operation (
    operation_id text PRIMARY KEY, scope_key text NOT NULL, factual_release_id text NOT NULL,
    factual_release_revision integer NOT NULL, model_qualification_id text NOT NULL,
    model_qualification_work_id text NOT NULL, model_qualification_revision integer NOT NULL,
    expected_prepared_input_revision integer NOT NULL, captured_at timestamptz NOT NULL,
    context_sha256 text NOT NULL, context_canonical_json text NOT NULL, context_json jsonb NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_current_valuation_cohort_operation_result (
    operation_id text PRIMARY KEY, prepared_input_set_id text NOT NULL,
    head_revision integer NOT NULL, completed_at timestamptz NOT NULL
  )`);
  await pool.query(`CREATE OR REPLACE FUNCTION activate_outcome_current_prepared_valuation_input_set(
    target_scope_key text, target_prepared_input_set_id text, expected_revision integer
  ) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF expected_revision = 0 THEN
      INSERT INTO outcome_current_prepared_valuation_input_set
        (scope_key,prepared_input_set_id,revision,activated_at)
      VALUES (target_scope_key,target_prepared_input_set_id,1,transaction_timestamp());
    ELSE
      UPDATE outcome_current_prepared_valuation_input_set
         SET prepared_input_set_id=target_prepared_input_set_id,
             revision=revision+1,activated_at=transaction_timestamp()
       WHERE scope_key=target_scope_key AND revision=expected_revision;
      IF NOT FOUND THEN RAISE EXCEPTION 'stale prepared head'; END IF;
    END IF;
  END $$`);
});

afterAll(async () => {
  await pool.query(`SET search_path TO public`);
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.end();
});

async function seedAuthority() {
  await pool.query(`TRUNCATE outcome_active_release,
    outcome_current_governed_valuation_model_pair,
    outcome_current_prepared_valuation_input_set,
    outcome_current_valuation_cohort_operation_result,
    outcome_current_valuation_cohort_operation,
    registered_prepared_valuation_input_set`);
  await pool.query(
    `INSERT INTO outcome_active_release(scope_key,release_id,revision) VALUES ($1,$2,7)`,
    [releaseScopeKey, `outcome-release:${digest('1')}`]
  );
  await pool.query(
    `INSERT INTO outcome_current_governed_valuation_model_pair
      (scope_key,revision,qualification_id,player_run_id,pick_run_id,work_id)
     VALUES ($1,3,$2,$3,$4,$5)`,
    [
      scopeKey,
      `model-qualification:${digest('2')}`,
      `model-run:${digest('3')}`,
      `model-run:${digest('4')}`,
      `model-qualification-work:${digest('5')}`,
    ]
  );
}

function coordinator() {
  const bundle = createAflTradeCurrentValuationBundleFixture({
    scopeKey,
    playerRunId: `model-run:${digest('3')}`,
    pickRunId: `model-run:${digest('4')}`,
  });
  const captureCurrent = createPostgresAflTradeCurrentValuationCohortAuthorityCapture({
    client,
    factualReleaseScopeKey: releaseScopeKey,
    loadConstructionEvidence: async () => ({
      factualReleaseArtifact: artifact('release'),
      releaseMembershipArtifact: artifact('membership'),
      releaseTradeIds: ['trade-a', 'trade-b'],
      sourceQualificationReportId: `valuation-source-qualification:${digest('6')}`,
      sourceQualificationReportArtifact: artifact('source-qualification'),
      sourceQualificationEvidenceRefs: [artifact('source-evidence')],
      valuationInputBundle: bundle.valuationInputBundle,
      valuationInputBundleId: bundle.valuationInputBundleId,
      valuationInputBundleArtifact: bundle.valuationInputBundleArtifact,
    }),
  });
  const registerPreparedInputSet = async (prepared: AflTradePreparedValuationInputSet) => {
    await pool.query(
      `INSERT INTO registered_prepared_valuation_input_set
        (prepared_input_set_id,prepared_json) VALUES ($1,$2::jsonb)
       ON CONFLICT (prepared_input_set_id) DO NOTHING`,
      [prepared.preparedInputSetId, JSON.stringify(prepared)]
    );
    return prepared;
  };
  return createAflTradeCurrentValuationCohortCoordinator({
    captureCurrent,
    prepareTrade: async ({ tradeId, context }) => ({
      tradeId,
      state: 'blocked',
      blockers: [
        {
          code: 'component_output_unavailable',
          subject: { kind: 'trade', id: tradeId },
          evidenceRefs: [context.valuationInputBundleArtifact],
        },
      ],
    }),
    commitIfCurrent: createPostgresAflTradeCurrentValuationCohortCommitter({
      client,
      registerPreparedInputSet,
    }),
  });
}

describe('automatic current valuation cohort PostgreSQL coordination', () => {
  it('registers and advances once, then restart-safely replays without duplicate evidence', async () => {
    await seedAuthority();
    const operationId = createAflTradeCurrentValuationCohortPreparationOperationId({
      scopeKey,
      factualReleaseId: `outcome-release:${digest('1')}`,
      factualReleaseRevision: 7,
      modelQualificationId: `model-qualification:${digest('2')}`,
      modelQualificationWorkId: `model-qualification-work:${digest('5')}`,
      modelQualificationRevision: 3,
      expectedPreparedInputRevision: 0,
    });

    await expect(coordinator().prepare({ operationId, scopeKey })).resolves.toMatchObject({
      state: 'advanced',
      head: { revision: 1 },
      preparedInputSet: { content: { tradeCount: 2, blockedCount: 2 } },
    });
    await expect(coordinator().prepare({ operationId, scopeKey })).resolves.toMatchObject({
      state: 'already_current',
      head: { revision: 1 },
    });
    await expect(
      pool.query(`SELECT count(*)::int AS count FROM registered_prepared_valuation_input_set`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('fails closed when factual, model-work, or prepared-head authority changes before commit', async () => {
    const bundle = createAflTradeCurrentValuationBundleFixture({
      scopeKey,
      playerRunId: `model-run:${digest('3')}`,
      pickRunId: `model-run:${digest('4')}`,
    });
    const capture = createPostgresAflTradeCurrentValuationCohortAuthorityCapture({
      client,
      factualReleaseScopeKey: releaseScopeKey,
      loadConstructionEvidence: async () => ({
        factualReleaseArtifact: artifact('release'),
        releaseMembershipArtifact: artifact('membership'),
        releaseTradeIds: ['trade-a'],
        sourceQualificationReportId: `valuation-source-qualification:${digest('6')}`,
        sourceQualificationReportArtifact: artifact('source-qualification'),
        sourceQualificationEvidenceRefs: [artifact('source-evidence')],
        valuationInputBundle: bundle.valuationInputBundle,
        valuationInputBundleId: bundle.valuationInputBundleId,
        valuationInputBundleArtifact: bundle.valuationInputBundleArtifact,
      }),
    });
    const operationId = createAflTradeCurrentValuationCohortPreparationOperationId({
      scopeKey,
      factualReleaseId: `outcome-release:${digest('1')}`,
      factualReleaseRevision: 7,
      modelQualificationId: `model-qualification:${digest('2')}`,
      modelQualificationWorkId: `model-qualification-work:${digest('5')}`,
      modelQualificationRevision: 3,
      expectedPreparedInputRevision: 0,
    });
    const commit = createPostgresAflTradeCurrentValuationCohortCommitter({
      client,
      registerPreparedInputSet: async (value) => value,
    });
    async function buildPrepared(context: Awaited<ReturnType<typeof capture>>) {
      let retained: AflTradePreparedValuationInputSet | null = null;
      await createAflTradeCurrentValuationCohortCoordinator({
        captureCurrent: async () => context,
        prepareTrade: async ({ tradeId }) => ({
          tradeId,
          state: 'blocked',
          blockers: [
            {
              code: 'component_output_unavailable',
              subject: { kind: 'trade', id: tradeId },
              evidenceRefs: [context.valuationInputBundleArtifact],
            },
          ],
        }),
        commitIfCurrent: async ({ preparedInputSet }) => {
          retained = preparedInputSet;
          return { state: 'stale_authority', reason: 'capture prepared input only' };
        },
      }).prepare({ operationId, scopeKey });
      if (retained === null) throw new Error('Expected one constructed prepared input set.');
      return retained as AflTradePreparedValuationInputSet;
    }

    await seedAuthority();
    let context = await capture({ operationId, scopeKey });
    let preparedInputSet = await buildPrepared(context);
    await pool.query(
      `UPDATE outcome_active_release SET release_id=$2,revision=8 WHERE scope_key=$1`,
      [releaseScopeKey, `outcome-release:${digest('9')}`]
    );
    await expect(commit({ context, preparedInputSet })).resolves.toMatchObject({
      state: 'stale_authority',
    });

    await seedAuthority();
    context = await capture({ operationId, scopeKey });
    preparedInputSet = await buildPrepared(context);
    await pool.query(
      `UPDATE outcome_current_governed_valuation_model_pair
          SET work_id=$2 WHERE scope_key=$1`,
      [scopeKey, `model-qualification-work:${digest('8')}`]
    );
    await expect(commit({ context, preparedInputSet })).resolves.toMatchObject({
      state: 'stale_authority',
    });

    await seedAuthority();
    context = await capture({ operationId, scopeKey });
    preparedInputSet = await buildPrepared(context);
    await pool.query(
      `INSERT INTO outcome_current_prepared_valuation_input_set
        (scope_key,prepared_input_set_id,revision,activated_at)
       VALUES ($1,$2,1,transaction_timestamp())`,
      [scopeKey, `prepared-valuation-input-set:${digest('a')}`]
    );
    await expect(commit({ context, preparedInputSet })).resolves.toMatchObject({
      state: 'stale_authority',
    });
  });
});
