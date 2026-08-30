import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeCurrentValuationModelEvidenceCoordinator } from '@/server/aflTradeIntelligence/valuation/currentValuationModelEvidence';
import { PostgresAflTradeCurrentValuationModelEvidenceRepository } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationModelEvidence';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_current_model_evidence_${process.pid}_${Date.now()}`;
const pool = new Pool({
  connectionString: databaseUrl,
  max: 3,
  options: `-c search_path=${schemaName}`,
});
const digest = (value: string) => value.repeat(64);
const id = (prefix: string, value: string) => `${prefix}:${digest(value)}`;
const factualOperationId = id('current-valuation-factual-refresh-operation', '1');
const candidateId = id('private-factual-candidate', '2');

beforeAll(async () => {
  await pool.query(`DO $roles$ BEGIN
    BEGIN CREATE ROLE afl_trade_private_evaluation_coordinator NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    GRANT afl_trade_private_evaluation_coordinator TO CURRENT_USER;
  END $roles$`);
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
  await pool.query(
    `ALTER ROLE afl_trade_private_evaluation_coordinator SET search_path TO "${schemaName}"`
  );
  await pool.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_private_evaluation_coordinator`
  );
  await pool.query(`
    CREATE TABLE outcome_current_valuation_factual_refresh_operation (
      operation_id text PRIMARY KEY,scope_key text NOT NULL,state text NOT NULL,
      candidate_id text,private_factual_revision integer
    );
    CREATE TABLE outcome_private_factual_candidate (candidate_id text PRIMARY KEY);
    CREATE TABLE outcome_current_private_factual_authority (
      valuation_scope_key text PRIMARY KEY,candidate_id text NOT NULL,revision integer NOT NULL
    );
    CREATE TABLE outcome_current_governed_valuation_model_pair (
      scope_key text PRIMARY KEY,revision integer NOT NULL,qualification_id text NOT NULL,
      player_run_id text NOT NULL,pick_run_id text NOT NULL,work_id text NOT NULL
    );
    CREATE TABLE outcome_governed_valuation_model_qualification (
      qualification_id text PRIMARY KEY,scope_key text NOT NULL,outcome text NOT NULL,
      player_run_id text NOT NULL,pick_run_id text NOT NULL
    );
    GRANT SELECT ON ALL TABLES IN SCHEMA "${schemaName}"
      TO afl_trade_private_evaluation_coordinator;
  `);
  await pool.query(
    readFileSync(
      join(
        process.cwd(),
        'prisma/afl-trade-outcomes/migrations/0085_current_valuation_model_evidence/migration.sql'
      ),
      'utf8'
    )
  );
  const privileges = await pool.query<{ can_select: boolean; can_insert: boolean }>(
    `SELECT
       has_table_privilege('afl_trade_private_evaluation_coordinator',
         'outcome_current_valuation_model_evidence_operation','SELECT') AS can_select,
       has_table_privilege('afl_trade_private_evaluation_coordinator',
         'outcome_current_valuation_model_evidence_operation','INSERT') AS can_insert`
  );
  expect(privileges.rows).toEqual([{ can_select: true, can_insert: true }]);
});

beforeEach(async () => {
  await pool.query(`TRUNCATE outcome_current_valuation_model_evidence_operation,
    outcome_current_governed_valuation_model_pair,outcome_governed_valuation_model_qualification,
    outcome_current_private_factual_authority,outcome_private_factual_candidate,
    outcome_current_valuation_factual_refresh_operation CASCADE`);
  await pool.query(
    `INSERT INTO outcome_current_valuation_factual_refresh_operation
      VALUES ($1,$2,'factual_refresh_complete',$3,1)`,
    [factualOperationId, 'afl-men:2026-trades', candidateId]
  );
  await pool.query(`INSERT INTO outcome_private_factual_candidate VALUES ($1)`, [candidateId]);
  await pool.query(`INSERT INTO outcome_current_private_factual_authority VALUES ($1,$2,1)`, [
    'afl-men:2026-trades',
    candidateId,
  ]);
});

afterAll(async () => {
  await pool.query(`ALTER ROLE afl_trade_private_evaluation_coordinator RESET search_path`);
  await pool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  await pool.end();
});

function request() {
  return {
    scopeKey: 'afl-men:2026-trades',
    factualOperationId,
    privateFactualAuthority: {
      valuationScopeKey: 'afl-men:2026-trades',
      candidateId,
      evidenceScopeKey: 'reviewed-evidence',
      evidenceBundleId: id('private-reviewed-evidence-bundle', '3'),
      reviewDecisionId: id('private-reviewed-evidence-evaluation-decision', '4'),
      normalizedReconciledCustodySha256: digest('5'),
      revision: 1,
    },
  } as const;
}

const evidence = {
  playerObservationSetId: id('player-observation-set', '6'),
  pickBenchmarkEvidenceId: id('pick-pav-observation-set', '7'),
  playerRunId: id('model-run', '8'),
  pickRunId: id('model-run', '9'),
  qualificationId: id('model-qualification', 'a'),
} as const;

function sqlClient(): AflOutcomeSqlClient {
  return {
    query: (sql, parameters) => pool.query(sql, parameters as unknown[]),
    transaction: async (work) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async (sql, parameters) => {
            const queryResult = await client.query(sql, parameters as unknown[]);
            if (sql.startsWith('SET LOCAL ROLE')) {
              await client.query(`SET LOCAL search_path TO "${schemaName}"`);
              const authority = await client.query<{
                current_role: string;
                current_schema: string;
                can_select: boolean;
              }>(
                `SELECT current_role,current_schema(),
                   has_table_privilege(current_user,
                     'outcome_current_valuation_model_evidence_operation','SELECT') AS can_select`
              );
              expect(authority.rows).toEqual([
                {
                  current_role: 'afl_trade_private_evaluation_coordinator',
                  current_schema: schemaName,
                  can_select: true,
                },
              ]);
            }
            return queryResult;
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  } as AflOutcomeSqlClient;
}

describe.sequential('current valuation model evidence in PostgreSQL', () => {
  it('commits and replays one exact passing pair', async () => {
    await pool.query(
      `INSERT INTO outcome_current_governed_valuation_model_pair VALUES ($1,1,$2,$3,$4,$5)`,
      [
        request().scopeKey,
        evidence.qualificationId,
        evidence.playerRunId,
        evidence.pickRunId,
        id('model-qualification-work', 'b'),
      ]
    );
    let executions = 0;
    const client = sqlClient();
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationModelEvidenceRepository(client),
      captureCurrentModelRevision: async () => 0,
      prepareAndQualify: async () => {
        executions += 1;
        return {
          state: 'qualified',
          ...evidence,
          qualificationWorkId: id('model-qualification-work', 'b'),
          playerGate3DecisionId: id('review-decision', 'c'),
          pickGate3DecisionId: id('review-decision', 'd'),
        } as const;
      },
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });
    const first = await coordinator.refresh(request());
    const restartedCoordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationModelEvidenceRepository(client),
      captureCurrentModelRevision: async () => 1,
      prepareAndQualify: async () => {
        executions += 1;
        throw new Error('Restart replay must not execute another model pair.');
      },
      clock: { now: () => '2026-08-30T10:01:00.000Z' },
    });
    await expect(restartedCoordinator.refresh(request())).resolves.toEqual(first);
    expect(executions).toBe(1);
    await expect(
      pool.query(
        `UPDATE outcome_current_valuation_model_evidence_operation
          SET result_state='qualification_failed'`
      )
    ).rejects.toThrow('Current valuation model evidence custody is append-only');
  });

  it('returns one retained result to concurrent callers of the same operation', async () => {
    await pool.query(
      `INSERT INTO outcome_current_governed_valuation_model_pair VALUES ($1,1,$2,$3,$4,$5)`,
      [
        request().scopeKey,
        evidence.qualificationId,
        evidence.playerRunId,
        evidence.pickRunId,
        id('model-qualification-work', 'b'),
      ]
    );
    let arrivals = 0;
    let release!: () => void;
    const bothPrepared = new Promise<void>((resolve) => {
      release = resolve;
    });
    const createCoordinator = () =>
      createAflTradeCurrentValuationModelEvidenceCoordinator({
        repository: new PostgresAflTradeCurrentValuationModelEvidenceRepository(sqlClient()),
        captureCurrentModelRevision: async () => 0,
        prepareAndQualify: async () => {
          arrivals += 1;
          if (arrivals === 2) release();
          await bothPrepared;
          return {
            state: 'qualified',
            ...evidence,
            qualificationWorkId: id('model-qualification-work', 'b'),
            playerGate3DecisionId: id('review-decision', 'c'),
            pickGate3DecisionId: id('review-decision', 'd'),
          } as const;
        },
        clock: { now: () => '2026-08-30T10:00:00.123456Z' },
      });

    const [first, second] = await Promise.all([
      createCoordinator().refresh(request()),
      createCoordinator().refresh(request()),
    ]);

    expect(second).toEqual(first);
    await expect(
      pool.query(
        `SELECT count(*)::integer AS count
         FROM outcome_current_valuation_model_evidence_operation`
      )
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('rejects an existing factual operation with unrelated candidate ancestry', async () => {
    const unrelatedOperation = id('current-valuation-factual-refresh-operation', 'e');
    await pool.query(
      `INSERT INTO outcome_current_valuation_factual_refresh_operation
        VALUES ($1,$2,'factual_refresh_complete',$3,1)`,
      [unrelatedOperation, request().scopeKey, id('private-factual-candidate', 'f')]
    );
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationModelEvidenceRepository(sqlClient()),
      captureCurrentModelRevision: async () => 0,
      prepareAndQualify: async () => ({
        state: 'qualification_failed',
        ...evidence,
        failureCodes: ['factual_ancestry_mismatched'],
      }),
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });

    await expect(
      coordinator.refresh({ ...request(), factualOperationId: unrelatedOperation })
    ).resolves.toMatchObject({ state: 'stale_authority' });
    await expect(
      pool.query(
        `SELECT count(*)::integer AS count
         FROM outcome_current_valuation_model_evidence_operation`
      )
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('retains an exact failed pair without moving current authority and rejects stale factual CAS', async () => {
    await pool.query(
      `INSERT INTO outcome_governed_valuation_model_qualification VALUES ($1,$2,'failed',$3,$4)`,
      [evidence.qualificationId, request().scopeKey, evidence.playerRunId, evidence.pickRunId]
    );
    const client = sqlClient();
    const repository = new PostgresAflTradeCurrentValuationModelEvidenceRepository(client);
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository,
      captureCurrentModelRevision: async () => 0,
      prepareAndQualify: async () => ({
        state: 'qualification_failed',
        ...evidence,
        failureCodes: ['pick_validation_threshold_failed'],
      }),
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });
    await expect(coordinator.refresh(request())).resolves.toMatchObject({
      state: 'qualification_failed',
      modelRevision: 0,
    });
    const newerCandidate = id('private-factual-candidate', 'f');
    const newerOperation = id('current-valuation-factual-refresh-operation', 'e');
    await pool.query(`INSERT INTO outcome_private_factual_candidate VALUES ($1)`, [newerCandidate]);
    await pool.query(
      `INSERT INTO outcome_current_valuation_factual_refresh_operation
        VALUES ($1,$2,'factual_refresh_complete',$3,2)`,
      [newerOperation, request().scopeKey, newerCandidate]
    );
    await pool.query(
      `UPDATE outcome_current_private_factual_authority SET candidate_id=$1,revision=2`,
      [newerCandidate]
    );
    const fresh = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository,
      captureCurrentModelRevision: async () => 0,
      prepareAndQualify: async () => ({
        state: 'qualification_failed',
        ...evidence,
        qualificationId: id('model-qualification', 'e'),
        failureCodes: ['player_validation_threshold_failed'],
      }),
      clock: { now: () => '2026-08-30T10:00:01.000Z' },
    });
    await expect(
      fresh.refresh({ ...request(), factualOperationId: newerOperation })
    ).resolves.toMatchObject({ state: 'stale_authority' });
  });
});
