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
    CREATE TABLE outcome_private_factual_candidate (
      candidate_id text PRIMARY KEY,valuation_scope_key text NOT NULL,
      evidence_scope_key text NOT NULL,evidence_bundle_id text NOT NULL,
      review_decision_id text NOT NULL,normalized_reconciled_custody_sha256 text NOT NULL
    );
    CREATE TABLE outcome_current_private_factual_authority (
      valuation_scope_key text PRIMARY KEY,candidate_id text NOT NULL,revision integer NOT NULL
    );
    CREATE TABLE outcome_current_governed_valuation_model_pair (
      scope_key text PRIMARY KEY,revision integer NOT NULL,qualification_id text NOT NULL,
      player_run_id text NOT NULL,pick_run_id text NOT NULL,
      player_gate3_decision_id text NOT NULL,pick_gate3_decision_id text NOT NULL,
      work_id text NOT NULL
    );
    CREATE TABLE outcome_governed_valuation_model_qualification (
      qualification_id text PRIMARY KEY,scope_key text NOT NULL,outcome text NOT NULL,
      player_run_id text NOT NULL,pick_run_id text NOT NULL,qualification_json jsonb NOT NULL
    );
    CREATE TABLE outcome_governed_valuation_component_run (
      run_id text PRIMARY KEY,role text NOT NULL
    );
    CREATE TABLE outcome_governed_component_validation_evidence (
      run_id text PRIMARY KEY,native_execution_json jsonb NOT NULL
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
    outcome_governed_component_validation_evidence,outcome_governed_valuation_component_run,
    outcome_current_private_factual_authority,outcome_private_factual_candidate,
    outcome_current_valuation_factual_refresh_operation CASCADE`);
  await pool.query(
    `INSERT INTO outcome_current_valuation_factual_refresh_operation
      VALUES ($1,$2,'factual_refresh_complete',$3,1)`,
    [factualOperationId, 'afl-men:2026-trades', candidateId]
  );
  await pool.query(`INSERT INTO outcome_private_factual_candidate VALUES ($1,$2,$3,$4,$5,$6)`, [
    candidateId,
    'afl-men:2026-trades',
    'reviewed-evidence',
    id('private-reviewed-evidence-bundle', '3'),
    id('private-reviewed-evidence-evaluation-decision', '4'),
    digest('5'),
  ]);
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

async function seedQualifiedModelHead(revision = 1) {
  await pool.query(
    `INSERT INTO outcome_governed_valuation_component_run VALUES
      ($1,'player_contribution_and_availability'),
      ($2,'draft_pick_and_future_pick_distribution')`,
    [evidence.playerRunId, evidence.pickRunId]
  );
  await pool.query(
    `INSERT INTO outcome_governed_component_validation_evidence VALUES
      ($1,jsonb_build_object('content',jsonb_build_object('observationSetId',$2::text))),
      ($3,jsonb_build_object('content',jsonb_build_object('observationSetId',$4::text)))`,
    [
      evidence.playerRunId,
      evidence.playerObservationSetId,
      evidence.pickRunId,
      evidence.pickBenchmarkEvidenceId,
    ]
  );
  await pool.query(
    `INSERT INTO outcome_current_governed_valuation_model_pair
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      request().scopeKey,
      revision,
      evidence.qualificationId,
      evidence.playerRunId,
      evidence.pickRunId,
      id('review-decision', 'c'),
      id('review-decision', 'd'),
      id('model-qualification-work', 'b'),
    ]
  );
}

function qualifiedEvidence() {
  return {
    state: 'qualified' as const,
    ...evidence,
    qualificationWorkId: id('model-qualification-work', 'b'),
    playerGate3DecisionId: id('review-decision', 'c'),
    pickGate3DecisionId: id('review-decision', 'd'),
  };
}

function sqlClient(afterModelHeadRead?: () => Promise<void>): AflOutcomeSqlClient {
  return {
    query: (sql, parameters) => pool.query(sql, parameters as unknown[]),
    transaction: async (work) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async (sql, parameters) => {
            const queryResult = await client.query(sql, parameters as unknown[]);
            if (sql.includes('FROM outcome_current_governed_valuation_model_pair')) {
              await afterModelHeadRead?.();
            }
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
    await seedQualifiedModelHead();
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
    await seedQualifiedModelHead();
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

  it('recovers an exact pair advanced before operation custody was retained', async () => {
    await seedQualifiedModelHead();
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationModelEvidenceRepository(sqlClient()),
      captureCurrentModelRevision: async () => 1,
      prepareAndQualify: async () => qualifiedEvidence(),
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });

    await expect(coordinator.refresh(request())).resolves.toMatchObject({
      state: 'qualified',
      expectedModelRevision: 0,
      modelRevision: 1,
    });
  });

  it('rejects fabricated factual metadata and mismatched qualified component ancestry', async () => {
    await seedQualifiedModelHead();
    const repository = new PostgresAflTradeCurrentValuationModelEvidenceRepository(sqlClient());
    const createCoordinator = (prepared: ReturnType<typeof qualifiedEvidence>) =>
      createAflTradeCurrentValuationModelEvidenceCoordinator({
        repository,
        captureCurrentModelRevision: async () => 0,
        prepareAndQualify: async () => prepared,
        clock: { now: () => '2026-08-30T10:00:00.000Z' },
      });

    await expect(
      createCoordinator(qualifiedEvidence()).refresh({
        ...request(),
        privateFactualAuthority: {
          ...request().privateFactualAuthority,
          evidenceBundleId: id('private-reviewed-evidence-bundle', 'f'),
        },
      })
    ).resolves.toMatchObject({ state: 'stale_authority' });
    await expect(
      createCoordinator({
        ...qualifiedEvidence(),
        pickGate3DecisionId: id('review-decision', 'e'),
      }).refresh(request())
    ).resolves.toMatchObject({ state: 'stale_authority' });
    await expect(
      createCoordinator({
        ...qualifiedEvidence(),
        playerObservationSetId: id('player-observation-set', 'f'),
      }).refresh(request())
    ).resolves.toMatchObject({ state: 'stale_authority' });
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
      `INSERT INTO outcome_governed_valuation_model_qualification
        VALUES ($1,$2,'failed',$3,$4,$5::jsonb)`,
      [
        evidence.qualificationId,
        request().scopeKey,
        evidence.playerRunId,
        evidence.pickRunId,
        JSON.stringify({ content: { failureCodes: ['pick_validation_threshold_failed'] } }),
      ]
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
    await pool.query(`INSERT INTO outcome_private_factual_candidate VALUES ($1,$2,$3,$4,$5,$6)`, [
      newerCandidate,
      request().scopeKey,
      'reviewed-evidence',
      id('private-reviewed-evidence-bundle', '3'),
      id('private-reviewed-evidence-evaluation-decision', '4'),
      digest('5'),
    ]);
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

  it('rejects failure codes that disagree with the retained qualification', async () => {
    await pool.query(
      `INSERT INTO outcome_governed_valuation_model_qualification
        VALUES ($1,$2,'failed',$3,$4,$5::jsonb)`,
      [
        evidence.qualificationId,
        request().scopeKey,
        evidence.playerRunId,
        evidence.pickRunId,
        JSON.stringify({ content: { failureCodes: ['player_validation_threshold_failed'] } }),
      ]
    );
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationModelEvidenceRepository(sqlClient()),
      captureCurrentModelRevision: async () => 0,
      prepareAndQualify: async () => ({
        state: 'qualification_failed',
        ...evidence,
        failureCodes: ['pick_validation_threshold_failed'],
      }),
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });

    await expect(coordinator.refresh(request())).rejects.toThrow(
      'Failed current model qualification lacks exact retained evidence.'
    );
  });

  it('serializes the first model-head insert against a revision-zero commit', async () => {
    await pool.query(
      `INSERT INTO outcome_governed_valuation_model_qualification
        VALUES ($1,$2,'failed',$3,$4,$5::jsonb)`,
      [
        evidence.qualificationId,
        request().scopeKey,
        evidence.playerRunId,
        evidence.pickRunId,
        JSON.stringify({ content: { failureCodes: ['pick_validation_threshold_failed'] } }),
      ]
    );
    let advanced = false;
    let advancement: Promise<unknown> | undefined;
    const client = sqlClient(async () => {
      if (advanced) return;
      advanced = true;
      advancement = pool.query(
        `INSERT INTO outcome_current_governed_valuation_model_pair
          VALUES ($1,1,$2,$3,$4,$5,$6,$7)`,
        [
          request().scopeKey,
          id('model-qualification', 'f'),
          id('model-run', 'd'),
          id('model-run', 'e'),
          id('review-decision', 'a'),
          id('review-decision', 'b'),
          id('model-qualification-work', 'f'),
        ]
      );
    });
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationModelEvidenceRepository(client),
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
    });
    await advancement;
  });
});
