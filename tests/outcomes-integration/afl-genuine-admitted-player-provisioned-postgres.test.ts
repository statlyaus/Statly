import { resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { createLocalAflTradeGenuineAdmittedPlayerExecutor } from '@/server/aflTradeIntelligence/development/localGenuineAdmittedPlayerContribution';
import { runLocalAflTradeGenuineAdmittedPlayerRequest } from '@/server/aflTradeIntelligence/development/localGenuineAdmittedPlayerRequest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresGovernedValuationComponentRunRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationComponentRunRepository';

const configuration = {
  databaseUrl: process.env.AFL_GENUINE_ADMITTED_PLAYER_DATABASE_URL?.trim(),
  requestId: process.env.AFL_GENUINE_ADMITTED_PLAYER_REQUEST_ID?.trim(),
  claimId: process.env.AFL_GENUINE_ADMITTED_PLAYER_CLAIM_ID?.trim(),
  leaseToken: process.env.AFL_GENUINE_ADMITTED_PLAYER_LEASE_TOKEN?.trim(),
  artifactRoot: process.env.AFL_GENUINE_ADMITTED_PLAYER_ARTIFACT_ROOT?.trim(),
};
const configuredValues = Object.values(configuration).filter(
  (value): value is string => value !== undefined && value.length > 0
);
if (configuredValues.length > 0 && configuredValues.length !== Object.keys(configuration).length) {
  throw new Error('The genuine admitted-player tracer configuration is incomplete.');
}
const configured = configuredValues.length === Object.keys(configuration).length;
const databaseUrl =
  configuration.databaseUrl ??
  'postgresql://postgres:postgres@127.0.0.1:55432/statly_outcomes_test?sslmode=disable';
const artifactRoot = configuration.artifactRoot ?? '.statly-local/afl-trade-artifacts';

describe
  .runIf(configured)
  .sequential('provisioned genuine admitted-player PostgreSQL tracer', () => {
    const database = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(database.hostname) ||
      database.pathname !== '/statly_outcomes_test'
    ) {
      throw new Error(
        'The genuine admitted-player tracer requires disposable loopback PostgreSQL.'
      );
    }
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const sql = createPgAflOutcomeSqlClient(pool);
    const artifacts = createLocalAflTradePrivateDerivedArtifactRepository({
      rootDirectory: resolve(artifactRoot),
      repositoryId: 'genuine-admitted-player-provisioned-tracer',
      maximumObjectBytes: 4 * 1024 * 1024,
    });
    const executor = createLocalAflTradeGenuineAdmittedPlayerExecutor({
      sql,
      artifactRepository: artifacts,
      maximumArtifactBytes: 4 * 1024 * 1024,
      gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
      componentRepository: new PostgresGovernedValuationComponentRunRepository({
        client: sql,
        artifactRepository: artifacts,
        maximumArtifactBytes: 4 * 1024 * 1024,
      }),
      seed: 574,
    });
    const claim = {
      claimId: configuration.claimId!,
      leaseToken: configuration.leaseToken!,
    };
    let operationId = '';

    beforeAll(async () => {
      const migration = await pool.query<{ completed: boolean }>(
        `SELECT EXISTS (
         SELECT 1 FROM _prisma_migrations
            WHERE left(migration_name,5)='0090_' AND finished_at IS NOT NULL
         ) AS completed`
      );
      expect(migration.rows[0]?.completed).toBe(true);
      const binding = await pool.query<{ operation_id: string }>(
        `SELECT operation_id FROM outcome_private_valuation_model_request_binding
          WHERE request_id=$1`,
        [configuration.requestId]
      );
      expect(binding.rows).toHaveLength(1);
      operationId = binding.rows[0]!.operation_id;
      const existing = await pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM outcome_valuation_model_run run
           JOIN outcome_valuation_model_run_intent intent ON intent.intent_id=run.intent_id
           JOIN outcome_valuation_model_run_operational_authorization authority
             ON authority.intent_id=intent.intent_id
          WHERE authority.receipt_json->'content'->>'dispatchRequestId'=$1
            AND authority.receipt_json->'content'->>'substantiveOperationId'=$2`,
        [configuration.requestId, operationId]
      );
      expect(existing.rows[0]?.count).toBe(0);
    });

    afterAll(async () => {
      await pool.end();
    });

    it('executes once and replays the retained accepted component without retraining', async () => {
      const request = {
        sql,
        executor,
        requestId: configuration.requestId!,
        claim,
      };
      const completed = await runLocalAflTradeGenuineAdmittedPlayerRequest(request);
      expect(completed).toMatchObject({ state: 'completed' });
      if (completed.state !== 'completed') throw new Error(completed.reason);
      const exactRun = await pool.query<{
        run_id: string;
        native_execution_id: string;
        dispatch_request_id: string;
        operation_id: string;
      }>(
        `SELECT component.run_id,component.native_execution_id,
                authority.receipt_json->'content'->>'dispatchRequestId' AS dispatch_request_id,
                authority.receipt_json->'content'->>'substantiveOperationId' AS operation_id
           FROM outcome_governed_valuation_component_run component
           JOIN outcome_valuation_model_run run ON run.run_id=component.native_execution_id
           JOIN outcome_valuation_model_run_intent intent ON intent.intent_id=run.intent_id
           JOIN outcome_valuation_model_run_operational_authorization authority
             ON authority.intent_id=intent.intent_id
          WHERE component.run_id=$1
            AND component.role='player_contribution_and_availability'`,
        [completed.runId]
      );
      expect(exactRun.rows).toEqual([
        {
          run_id: completed.runId,
          native_execution_id: expect.stringMatching(/^model-run:[a-f0-9]{64}$/),
          dispatch_request_id: configuration.requestId,
          operation_id: operationId,
        },
      ]);
      const nativeExecutionId = exactRun.rows[0]!.native_execution_id;
      expect(nativeExecutionId).not.toBe(completed.runId);

      const replay = await runLocalAflTradeGenuineAdmittedPlayerRequest(request);
      expect(replay).toEqual(completed);

      const afterReplay = await pool.query<{ native_runs: number; components: number }>(
        `SELECT
           (SELECT count(*)::integer
              FROM outcome_valuation_model_run run
              JOIN outcome_valuation_model_run_intent intent ON intent.intent_id=run.intent_id
             JOIN outcome_valuation_model_run_operational_authorization authority
                ON authority.intent_id=intent.intent_id
             WHERE run.run_id=$4
               AND authority.receipt_json->'content'->>'dispatchRequestId'=$1
               AND authority.receipt_json->'content'->>'substantiveOperationId'=$2) AS native_runs,
           (SELECT count(*)::integer FROM outcome_governed_valuation_component_run
             WHERE run_id=$3) AS components`,
        [configuration.requestId, operationId, completed.runId, nativeExecutionId]
      );
      expect(afterReplay.rows).toEqual([{ native_runs: 1, components: 1 }]);
    });
  });
