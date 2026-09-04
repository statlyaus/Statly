import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  PostgresAflTradePrivateEvaluationCohortExecutionRepository,
  type AflTradePrivateEvaluationExecutionClaim,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateEvaluationCohortExecutionRepository';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_execution_${process.pid}_${Date.now()}`;
const migrationRoleName = `afl_execution_migrator_${process.pid}_${Date.now()}`;
const executionRoleName = 'afl_trade_private_evaluation_coordinator';
const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  options: `-c search_path=${schemaName}`,
});
const client = createPgAflOutcomeSqlClient(pool);
const repository = new PostgresAflTradePrivateEvaluationCohortExecutionRepository(client);
const digest = (character: string) => character.repeat(64);
const authority = {
  scopeKey: 'afl-men:durable-execution',
  preparedInputSetId: `prepared-valuation-input-set:${digest('1')}`,
  preparedInputSetRevision: 4,
  factualReleaseRevision: 3,
  modelQualificationWorkId: `model-qualification-work:${digest('2')}`,
  modelPairRevision: 5,
} as const;
const privateAuthority = {
  scopeKey: 'afl-men:durable-private-execution',
  preparedInputSetId: `prepared-valuation-input-set:${digest('4')}`,
  preparedInputSetRevision: 7,
  preparationOperationId: `valuation-cohort-preparation-operation:${digest('5')}`,
  currentModelEvidenceOperationId: `current-valuation-model-evidence-operation:${digest('6')}`,
  dispatchAuthority: {
    requestId: `private-valuation-dispatch:${digest('7')}`,
    factualOutputId: `private-valuation-factual-output:${digest('8')}`,
    hpnCalculationId: `hpn-pav-season:${digest('9')}`,
    modelOperationId: `private-valuation-model-operation:${digest('a')}`,
  },
  modelQualificationWorkId: `model-qualification-work:${digest('b')}`,
  modelPairRevision: 8,
} as const;

function requiredMigrationFragment(
  migration: string,
  pattern: RegExp,
  description: string
): string {
  const fragment = migration.match(pattern)?.[0];
  if (fragment === undefined) {
    throw new Error(`Migration 0104 is missing its ${description}.`);
  }
  return fragment;
}

beforeAll(async () => {
  await pool.query(`CREATE ROLE "${migrationRoleName}" NOLOGIN CREATEROLE`);
  await pool.query(`GRANT "${migrationRoleName}" TO CURRENT_USER`);
  await pool.query(`DO $roles$ BEGIN
    BEGIN CREATE ROLE afl_trade_private_evaluation_execution_owner NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN CREATE ROLE afl_trade_private_evaluation_coordinator NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END $roles$`);
  await pool.query(
    `GRANT afl_trade_private_evaluation_execution_owner,
      afl_trade_private_evaluation_coordinator TO "${migrationRoleName}" WITH ADMIN OPTION`
  );
  await pool.query(`CREATE SCHEMA "${schemaName}" AUTHORIZATION "${migrationRoleName}"`);
  const migration = await pool.connect();
  await migration.query(`SET ROLE "${migrationRoleName}"`);
  await migration.query(`SET search_path TO "${schemaName}"`);
  const canonicalFunction = readFileSync(
    join(
      process.cwd(),
      'prisma/afl-trade-outcomes/migrations/0037_valuation_publication_custody_index/migration.sql'
    ),
    'utf8'
  ).match(
    /CREATE FUNCTION "outcome_afl_trade_canonical_json"[\s\S]*?\$\$ LANGUAGE plpgsql IMMUTABLE STRICT;/
  )?.[0];
  if (canonicalFunction === undefined)
    throw new Error('Canonical JSON SQL function was not found.');
  await migration.query(canonicalFunction);
  await migration.query(`CREATE TABLE outcome_prepared_valuation_input_set (
    prepared_input_set_id text PRIMARY KEY,scope_key text NOT NULL,
    factual_release_scope_key text NOT NULL,factual_release_id text NOT NULL,
    schema_version text NOT NULL,environment text NOT NULL,finalized_at timestamptz,
    prepared_set_json jsonb
  )`);
  await migration.query(`CREATE TABLE outcome_prepared_valuation_input_entry (
    prepared_input_set_id text NOT NULL REFERENCES outcome_prepared_valuation_input_set,
    ordinal integer NOT NULL,trade_id text NOT NULL,state text NOT NULL,entry_json jsonb,
    PRIMARY KEY(prepared_input_set_id,ordinal),UNIQUE(prepared_input_set_id,trade_id)
  )`);
  await migration.query(`CREATE TABLE outcome_current_prepared_valuation_input_set (
    scope_key text PRIMARY KEY,prepared_input_set_id text NOT NULL,revision integer NOT NULL
  )`);
  await migration.query(`CREATE TABLE outcome_active_release (
    scope_key text PRIMARY KEY,release_id text NOT NULL,revision integer NOT NULL
  )`);
  await migration.query(`CREATE TABLE outcome_governed_model_qualification_work (
    work_id text PRIMARY KEY
  )`);
  await migration.query(`CREATE TABLE outcome_current_governed_valuation_model_pair (
    scope_key text PRIMARY KEY,work_id text NOT NULL,revision integer NOT NULL
  )`);
  await migration.query(`CREATE TABLE outcome_current_valuation_model_evidence_operation (
    operation_id text PRIMARY KEY
  )`);
  await migration.query(`CREATE TABLE outcome_private_valuation_dispatch_request (
    request_id text PRIMARY KEY
  )`);
  await migration.query(`CREATE TABLE outcome_private_valuation_factual_output (
    output_id text PRIMARY KEY
  )`);
  await migration.query(`CREATE TABLE outcome_hpn_pav_calculation (
    calculation_id text PRIMARY KEY
  )`);
  await migration.query(`CREATE TABLE outcome_private_valuation_model_operation (
    operation_id text PRIMARY KEY
  )`);
  await migration.query(`CREATE TABLE outcome_current_valuation_cohort_operation (
    operation_id text PRIMARY KEY,scope_key text NOT NULL,preparation_authority text NOT NULL,
    current_model_evidence_operation_id text,dispatch_request_id text,factual_output_id text,
    hpn_calculation_id text,model_operation_id text,model_qualification_work_id text NOT NULL,
    model_qualification_revision integer NOT NULL
  )`);
  await migration.query(`CREATE TABLE outcome_current_valuation_cohort_operation_result (
    operation_id text PRIMARY KEY REFERENCES outcome_current_valuation_cohort_operation,
    prepared_input_set_id text NOT NULL,head_revision integer NOT NULL
  )`);
  await migration.query(`CREATE TABLE outcome_private_prepared_v3_authority_fixture (
    request_id text PRIMARY KEY,scope_key text NOT NULL,factual_output_id text NOT NULL,
    hpn_calculation_id text NOT NULL,model_operation_id text NOT NULL,
    model_evidence_json jsonb NOT NULL
  )`);
  await migration.query(`CREATE FUNCTION load_outcome_private_prepared_v3_authority(TEXT)
    RETURNS TABLE(scope_key TEXT,factual_output_id TEXT,hpn_calculation_id TEXT,
      model_operation_id TEXT,model_evidence_json JSONB)
    LANGUAGE SQL STABLE SECURITY DEFINER AS $$
      SELECT fixture.scope_key,fixture.factual_output_id,fixture.hpn_calculation_id,
             fixture.model_operation_id,fixture.model_evidence_json
        FROM outcome_private_prepared_v3_authority_fixture fixture
       WHERE fixture.request_id=$1
    $$`);
  await migration.query(
    `ALTER FUNCTION load_outcome_private_prepared_v3_authority(TEXT)
     SET search_path TO "${schemaName}",pg_catalog,pg_temp`
  );
  await migration.query(`CREATE TABLE outcome_private_evaluation_transition_intent (
    transition_intent_id text PRIMARY KEY,operation_id text NOT NULL,
    valuation_scope_key text NOT NULL,trade_id text NOT NULL,action text NOT NULL
  )`);
  await migration.query(`CREATE TABLE outcome_local_private_trade_evaluation_generation (
    generation_id text PRIMARY KEY,valuation_scope_key text NOT NULL,trade_id text NOT NULL,
    transition_intent_id text NOT NULL,generated_at timestamptz NOT NULL
  )`);
  await migration.query(`CREATE TABLE outcome_private_evaluation_transition_receipt (
    transition_intent_id text PRIMARY KEY,operation_id text NOT NULL,
    valuation_scope_key text NOT NULL,trade_id text NOT NULL,action text NOT NULL,
    to_status text NOT NULL,to_generation_id text
  )`);
  await migration.query(
    readFileSync(
      join(
        process.cwd(),
        'prisma/afl-trade-outcomes/migrations/0068_durable_private_evaluation_execution/migration.sql'
      ),
      'utf8'
    )
  );
  const dispatchBoundMigration = readFileSync(
    join(
      process.cwd(),
      'prisma/afl-trade-outcomes/migrations/0104_dispatch_bound_private_evaluation_batch/migration.sql'
    ),
    'utf8'
  );
  await migration.query(
    requiredMigrationFragment(
      dispatchBoundMigration,
      /ALTER TABLE "outcome_private_evaluation_execution_cycle"[\s\S]*?REFERENCES "outcome_private_valuation_model_operation"\("operation_id"\) ON DELETE RESTRICT;/u,
      'execution-cycle authority shape'
    )
  );
  await migration.query(
    requiredMigrationFragment(
      dispatchBoundMigration,
      /CREATE FUNCTION "outcome_private_evaluation_prepared_authority_is_current"\([\s\S]*?\nEND \$\$;/u,
      'private prepared-authority authenticator'
    )
  );
  await migration.query(
    `ALTER FUNCTION outcome_private_evaluation_prepared_authority_is_current(
       TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
     SET search_path TO "${schemaName}",pg_catalog,pg_temp`
  );
  await migration.query(
    requiredMigrationFragment(
      dispatchBoundMigration,
      /CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_execution_cycle"\(\)[\s\S]*?\nEND \$\$;/u,
      'execution-cycle validator'
    )
  );
  await migration.query('RESET ROLE');
  migration.release();
});

afterAll(async () => {
  await pool.query(`SET search_path TO public`);
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.query(`DROP OWNED BY "${migrationRoleName}"`);
  await pool.query(`REVOKE afl_trade_private_evaluation_coordinator FROM "${migrationRoleName}"`);
  await pool.query(
    `REVOKE afl_trade_private_evaluation_execution_owner FROM "${migrationRoleName}"`
  );
  await pool.query(`REVOKE "${migrationRoleName}" FROM CURRENT_USER`);
  await pool.query(`DROP ROLE IF EXISTS "${migrationRoleName}"`);
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE outcome_private_evaluation_execution_attempt,
    outcome_private_evaluation_execution_work,outcome_private_evaluation_execution_cycle,
    outcome_private_evaluation_transition_receipt,outcome_private_evaluation_transition_intent,
    outcome_local_private_trade_evaluation_generation,
    outcome_prepared_valuation_input_entry,outcome_current_prepared_valuation_input_set,
    outcome_prepared_valuation_input_set,outcome_active_release,
    outcome_current_governed_valuation_model_pair,outcome_governed_model_qualification_work,
    outcome_current_valuation_cohort_operation_result,
    outcome_current_valuation_cohort_operation,
    outcome_current_valuation_model_evidence_operation,
    outcome_private_valuation_dispatch_request,outcome_private_valuation_factual_output,
    outcome_hpn_pav_calculation,outcome_private_valuation_model_operation,
    outcome_private_prepared_v3_authority_fixture`);
  await pool.query(
    `INSERT INTO outcome_prepared_valuation_input_set
      (prepared_input_set_id,scope_key,factual_release_scope_key,factual_release_id,
       schema_version,environment,finalized_at)
     VALUES ($1,$2,'public-afl',$3,'afl-trade-prepared-valuation-input-set/v3',
             'non_production',transaction_timestamp())`,
    [authority.preparedInputSetId, authority.scopeKey, `outcome-release:${digest('3')}`]
  );
  await pool.query(
    `INSERT INTO outcome_prepared_valuation_input_entry
      (prepared_input_set_id,ordinal,trade_id,state,entry_json)
     VALUES ($1,1,'trade-a','ready','{}'::jsonb),($1,2,'trade-b','ready','{}'::jsonb)`,
    [authority.preparedInputSetId]
  );
  await pool.query(`INSERT INTO outcome_current_prepared_valuation_input_set VALUES ($1,$2,$3)`, [
    authority.scopeKey,
    authority.preparedInputSetId,
    authority.preparedInputSetRevision,
  ]);
  await pool.query(`INSERT INTO outcome_active_release VALUES ('public-afl',$1,$2)`, [
    `outcome-release:${digest('3')}`,
    authority.factualReleaseRevision,
  ]);
  await pool.query(`INSERT INTO outcome_governed_model_qualification_work VALUES ($1)`, [
    authority.modelQualificationWorkId,
  ]);
  await pool.query(`INSERT INTO outcome_current_governed_valuation_model_pair VALUES ($1,$2,$3)`, [
    authority.scopeKey,
    authority.modelQualificationWorkId,
    authority.modelPairRevision,
  ]);
  await pool.query(
    `INSERT INTO outcome_prepared_valuation_input_set
      (prepared_input_set_id,scope_key,factual_release_scope_key,factual_release_id,
       schema_version,environment,finalized_at,prepared_set_json)
     VALUES ($1,$2,'private-afl',$3,'afl-trade-prepared-valuation-input-set/v3',
             'non_production',transaction_timestamp(),$4::jsonb)`,
    [
      privateAuthority.preparedInputSetId,
      privateAuthority.scopeKey,
      `outcome-release:${digest('c')}`,
      JSON.stringify({
        content: {
          preparationAuthority: 'qualified_current_model_evidence',
          preparationOperationId: privateAuthority.preparationOperationId,
          modelEvidence: {
            operationId: privateAuthority.currentModelEvidenceOperationId,
            qualificationWorkId: privateAuthority.modelQualificationWorkId,
            modelRevision: privateAuthority.modelPairRevision,
          },
          dispatchAuthority: privateAuthority.dispatchAuthority,
        },
      }),
    ]
  );
  await pool.query(
    `INSERT INTO outcome_prepared_valuation_input_entry
      (prepared_input_set_id,ordinal,trade_id,state,entry_json)
     VALUES ($1,1,'trade-private','ready','{}'::jsonb)`,
    [privateAuthority.preparedInputSetId]
  );
  await pool.query(`INSERT INTO outcome_current_prepared_valuation_input_set VALUES ($1,$2,$3)`, [
    privateAuthority.scopeKey,
    privateAuthority.preparedInputSetId,
    privateAuthority.preparedInputSetRevision,
  ]);
  await pool.query(`INSERT INTO outcome_governed_model_qualification_work VALUES ($1)`, [
    privateAuthority.modelQualificationWorkId,
  ]);
  await pool.query(`INSERT INTO outcome_current_governed_valuation_model_pair VALUES ($1,$2,$3)`, [
    privateAuthority.scopeKey,
    privateAuthority.modelQualificationWorkId,
    privateAuthority.modelPairRevision,
  ]);
  await pool.query(`INSERT INTO outcome_current_valuation_model_evidence_operation VALUES ($1)`, [
    privateAuthority.currentModelEvidenceOperationId,
  ]);
  await pool.query(`INSERT INTO outcome_private_valuation_dispatch_request VALUES ($1)`, [
    privateAuthority.dispatchAuthority.requestId,
  ]);
  await pool.query(`INSERT INTO outcome_private_valuation_factual_output VALUES ($1)`, [
    privateAuthority.dispatchAuthority.factualOutputId,
  ]);
  await pool.query(`INSERT INTO outcome_hpn_pav_calculation VALUES ($1)`, [
    privateAuthority.dispatchAuthority.hpnCalculationId,
  ]);
  await pool.query(`INSERT INTO outcome_private_valuation_model_operation VALUES ($1)`, [
    privateAuthority.dispatchAuthority.modelOperationId,
  ]);
  await pool.query(
    `INSERT INTO outcome_current_valuation_cohort_operation
      (operation_id,scope_key,preparation_authority,current_model_evidence_operation_id,
       dispatch_request_id,factual_output_id,hpn_calculation_id,model_operation_id,
       model_qualification_work_id,model_qualification_revision)
     VALUES ($1,$2,'qualified_current_model_evidence',$3,$4,$5,$6,$7,$8,$9)`,
    [
      privateAuthority.preparationOperationId,
      privateAuthority.scopeKey,
      privateAuthority.currentModelEvidenceOperationId,
      privateAuthority.dispatchAuthority.requestId,
      privateAuthority.dispatchAuthority.factualOutputId,
      privateAuthority.dispatchAuthority.hpnCalculationId,
      privateAuthority.dispatchAuthority.modelOperationId,
      privateAuthority.modelQualificationWorkId,
      privateAuthority.modelPairRevision,
    ]
  );
  await pool.query(
    `INSERT INTO outcome_current_valuation_cohort_operation_result
      (operation_id,prepared_input_set_id,head_revision) VALUES ($1,$2,$3)`,
    [
      privateAuthority.preparationOperationId,
      privateAuthority.preparedInputSetId,
      privateAuthority.preparedInputSetRevision,
    ]
  );
  await pool.query(
    `INSERT INTO outcome_private_prepared_v3_authority_fixture
      (request_id,scope_key,factual_output_id,hpn_calculation_id,model_operation_id,
       model_evidence_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      privateAuthority.dispatchAuthority.requestId,
      privateAuthority.scopeKey,
      privateAuthority.dispatchAuthority.factualOutputId,
      privateAuthority.dispatchAuthority.hpnCalculationId,
      privateAuthority.dispatchAuthority.modelOperationId,
      JSON.stringify({
        operationId: privateAuthority.currentModelEvidenceOperationId,
        qualificationWorkId: privateAuthority.modelQualificationWorkId,
        modelRevision: privateAuthority.modelPairRevision,
      }),
    ]
  );
});

async function openCycle() {
  const openedAt = (
    await pool.query<{ trusted_at: Date }>(
      `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
    )
  ).rows[0]!.trusted_at.toISOString();
  return repository.openAutomatic({ authority, readyTradeIds: ['trade-a', 'trade-b'], openedAt });
}

async function expire(claim: AflTradePrivateEvaluationExecutionClaim) {
  await pool.query(`ALTER TABLE outcome_private_evaluation_execution_attempt
    DISABLE TRIGGER outcome_private_evaluation_execution_attempt_validate_update`);
  await pool.query(`ALTER TABLE outcome_private_evaluation_execution_work
    DISABLE TRIGGER outcome_private_evaluation_execution_work_validate_update`);
  await pool.query(
    `UPDATE outcome_private_evaluation_execution_attempt
        SET lease_expires_at=transaction_timestamp()-interval '1 second'
      WHERE claim_id=$1`,
    [claim.claimId]
  );
  await pool.query(
    `UPDATE outcome_private_evaluation_execution_work
        SET lease_expires_at=transaction_timestamp()-interval '1 second'
      WHERE current_claim_id=$1`,
    [claim.claimId]
  );
  await pool.query(`ALTER TABLE outcome_private_evaluation_execution_attempt
    ENABLE TRIGGER outcome_private_evaluation_execution_attempt_validate_update`);
  await pool.query(`ALTER TABLE outcome_private_evaluation_execution_work
    ENABLE TRIGGER outcome_private_evaluation_execution_work_validate_update`);
}

describe('durable private evaluation execution PostgreSQL boundary', () => {
  it('retains private prepared-v3 authority across a repository restart without claim custody', async () => {
    const openedAt = (
      await pool.query<{ trusted_at: Date }>(
        `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
      )
    ).rows[0]!.trusted_at.toISOString();
    const cycle = await repository.openAutomatic({
      authority: privateAuthority,
      readyTradeIds: ['trade-private'],
      openedAt,
    });

    const restartedRepository = new PostgresAflTradePrivateEvaluationCohortExecutionRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    await expect(
      restartedRepository.openAutomatic({
        authority: privateAuthority,
        readyTradeIds: ['trade-private'],
        openedAt,
      })
    ).resolves.toEqual(cycle);

    const retained = await pool.query<{
      preparation_authority: string;
      factual_release_revision: number | null;
      preparation_operation_id: string;
      current_model_evidence_operation_id: string;
      dispatch_request_id: string;
      factual_output_id: string;
      hpn_calculation_id: string;
      model_operation_id: string;
      authority_has_claim: boolean;
    }>(
      `SELECT preparation_authority,factual_release_revision,preparation_operation_id,
              current_model_evidence_operation_id,dispatch_request_id,factual_output_id,
              hpn_calculation_id,model_operation_id,
              cycle_json->'content'->'authority' ? 'claim' AS authority_has_claim
         FROM outcome_private_evaluation_execution_cycle WHERE cycle_id=$1`,
      [cycle.cycleId]
    );
    expect(retained.rows).toEqual([
      {
        preparation_authority: 'qualified_current_model_evidence',
        factual_release_revision: null,
        preparation_operation_id: privateAuthority.preparationOperationId,
        current_model_evidence_operation_id: privateAuthority.currentModelEvidenceOperationId,
        dispatch_request_id: privateAuthority.dispatchAuthority.requestId,
        factual_output_id: privateAuthority.dispatchAuthority.factualOutputId,
        hpn_calculation_id: privateAuthority.dispatchAuthority.hpnCalculationId,
        model_operation_id: privateAuthority.dispatchAuthority.modelOperationId,
        authority_has_claim: false,
      },
    ]);
  });

  it('serializes two workers, renews heartbeat, reclaims expiry, and fences stale completion', async () => {
    const cycle = await openCycle();
    const first = await repository.claim({
      cycleId: cycle.cycleId,
      tradeId: 'trade-a',
      workerId: 'worker-a',
    });
    expect(first).not.toBeNull();
    await expect(
      repository.claim({ cycleId: cycle.cycleId, tradeId: 'trade-a', workerId: 'worker-b' })
    ).resolves.toBeNull();
    await expect(repository.heartbeat(first!)).resolves.toMatch(/Z$/);

    await expire(first!);
    const reclaimed = await repository.claim({
      cycleId: cycle.cycleId,
      tradeId: 'trade-a',
      workerId: 'worker-b',
    });
    expect(reclaimed).toMatchObject({ attemptNumber: 2 });
    await expect(
      repository.complete({
        claim: first!,
        outcome: 'permanent_failure',
        stage: 'stage_automated',
        cause: { code: 'late', message: 'Late worker.', retryable: false },
        result: null,
      })
    ).rejects.toThrow('lease was lost');
  });

  it('never exceeds three persisted attempts and retains the exact exhausted cause', async () => {
    const cycle = await openCycle();
    let claim = await repository.claim({
      cycleId: cycle.cycleId,
      tradeId: 'trade-a',
      workerId: 'worker-a',
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(claim).toMatchObject({ attemptNumber: attempt });
      const status = await repository.complete({
        claim: claim!,
        outcome: 'transient_failure',
        stage: 'stage_automated',
        cause: {
          code: `transient-${attempt}`,
          message: `Transient failure ${attempt}.`,
          retryable: true,
        },
        result: null,
      });
      if (attempt < 3) {
        expect(status).toBe('retry_wait');
        await pool.query(`ALTER TABLE outcome_private_evaluation_execution_work
          DISABLE TRIGGER outcome_private_evaluation_execution_work_validate_update`);
        await pool.query(
          `UPDATE outcome_private_evaluation_execution_work
              SET available_at=transaction_timestamp()-interval '1 second'
            WHERE cycle_id=$1 AND trade_id='trade-a'`,
          [cycle.cycleId]
        );
        await pool.query(`ALTER TABLE outcome_private_evaluation_execution_work
          ENABLE TRIGGER outcome_private_evaluation_execution_work_validate_update`);
        claim = await repository.claim({
          cycleId: cycle.cycleId,
          tradeId: 'trade-a',
          workerId: 'worker-a',
        });
      } else {
        expect(status).toBe('exhausted');
      }
    }
    await expect(repository.loadWork(cycle.cycleId, 'trade-a')).resolves.toMatchObject({
      status: 'exhausted',
      attemptCount: 3,
      terminalStage: 'stage_automated',
      terminalCause: {
        code: 'transient-3',
        message: 'Transient failure 3.',
        retryable: true,
      },
    });
    await expect(
      repository.claim({ cycleId: cycle.cycleId, tradeId: 'trade-a', workerId: 'worker-c' })
    ).resolves.toBeNull();
  });

  it('preserves prior exhausted history when an explicit repair opens a fresh budget', async () => {
    const original = await openCycle();
    const claim = await repository.claim({
      cycleId: original.cycleId,
      tradeId: 'trade-a',
      workerId: 'worker-a',
    });
    await repository.complete({
      claim: claim!,
      outcome: 'permanent_failure',
      stage: 'stage_automated',
      cause: { code: 'repair_me', message: 'Repair required.', retryable: false },
      result: null,
    });
    const completedPeer = await repository.claim({
      cycleId: original.cycleId,
      tradeId: 'trade-b',
      workerId: 'worker-a',
    });
    await repository.complete({
      claim: completedPeer!,
      outcome: 'unavailable',
      stage: null,
      cause: null,
      result: {
        state: 'unavailable',
        blockers: [{ code: 'insufficient_data', message: 'No retained observations.' }],
      },
    });
    const repair = await repository.openRepair({
      authority,
      readyTradeIds: ['trade-a', 'trade-b'],
      repairOperationId: `cohort-execution-repair:${digest('9')}`,
      reason: 'The retained upstream outage was corrected.',
    });
    expect(repair.content).toMatchObject({
      repairSequence: 1,
      openingPrincipalId: 'system:weekly-valuation-coordinator',
      repairOperationId: `cohort-execution-repair:${digest('9')}`,
      repairReason: 'The retained upstream outage was corrected.',
      repairsCycleId: original.cycleId,
    });
    await expect(repository.loadWork(original.cycleId, 'trade-a')).resolves.toMatchObject({
      status: 'exhausted',
      attemptCount: 1,
    });
    await expect(repository.loadWork(repair.cycleId, 'trade-a')).resolves.toMatchObject({
      status: 'pending',
      attemptCount: 0,
    });
    await expect(
      repository.openRepair({
        authority,
        readyTradeIds: ['trade-a', 'trade-b'],
        repairOperationId: `cohort-execution-repair:${digest('9')}`,
        reason: 'The retained upstream outage was corrected.',
      })
    ).resolves.toEqual(repair);

    await pool.query(`ALTER TABLE outcome_private_evaluation_execution_work
      DISABLE TRIGGER outcome_private_evaluation_execution_work_no_delete`);
    await pool.query(
      `DELETE FROM outcome_private_evaluation_execution_work
        WHERE cycle_id=$1 AND trade_id='trade-b'`,
      [repair.cycleId]
    );
    await pool.query(`ALTER TABLE outcome_private_evaluation_execution_work
      ENABLE TRIGGER outcome_private_evaluation_execution_work_no_delete`);
    await expect(repository.loadRepair(`cohort-execution-repair:${digest('9')}`)).rejects.toThrow(
      'work replay conflicts with custody'
    );
  });

  it('rejects repair while any predecessor work remains nonterminal', async () => {
    await openCycle();
    await expect(
      repository.openRepair({
        authority,
        readyTradeIds: ['trade-a', 'trade-b'],
        repairOperationId: `cohort-execution-repair:${digest('8')}`,
        reason: 'Requested before the original cycle completed.',
      })
    ).rejects.toThrow('terminal predecessor');
  });

  it('rejects direct SQL claims and invalid terminal result custody', async () => {
    const cycle = await openCycle();
    const restricted = await pool.connect();
    try {
      await restricted.query('BEGIN');
      await restricted.query(`SET LOCAL ROLE ${executionRoleName}`);
      await expect(
        restricted.query(`CREATE TABLE "${schemaName}".coordinator_shadow(id integer)`)
      ).rejects.toThrow('permission denied for schema');
      await restricted.query('ROLLBACK');

      await restricted.query('BEGIN');
      await restricted.query(`SET LOCAL ROLE ${executionRoleName}`);
      await expect(
        restricted.query(
          `INSERT INTO outcome_private_evaluation_execution_attempt
            (claim_id,cycle_id,trade_id,attempt_number,worker_id,lease_token_sha256,
             claimed_at,lease_expires_at,heartbeat_at)
           SELECT $1,$2,'trade-a',1,'forged-worker',$3,trusted_at,
                  trusted_at+interval '120 seconds',trusted_at
             FROM (SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at) clock`,
          [`cohort-execution-claim:${digest('c')}`, cycle.cycleId, digest('d')]
        )
      ).rejects.toThrow('permission denied');
      await restricted.query('ROLLBACK');

      await restricted.query('BEGIN');
      await restricted.query(`CREATE TEMP TABLE outcome_private_evaluation_execution_work (
        current_claim_id text,status text,lease_token_sha256 text,lease_expires_at timestamptz
      )`);
      await restricted.query(`SET LOCAL ROLE ${executionRoleName}`);
      await expect(
        restricted.query(`SELECT * FROM claim_outcome_private_evaluation_work($1,$2,$3,$4)`, [
          cycle.cycleId,
          'trade-a',
          'restricted-runtime-worker',
          digest('e'),
        ])
      ).resolves.toMatchObject({ rows: [{ attempt_number: 1 }] });
      await restricted.query('ROLLBACK');
    } finally {
      restricted.release();
    }
    await expect(
      pool.query(
        `UPDATE outcome_private_evaluation_execution_work
            SET status='leased',attempt_count=1,current_claim_id=$3,lease_token_sha256=$4,
                lease_expires_at=transaction_timestamp()+interval '120 seconds',
                heartbeat_at=transaction_timestamp()
          WHERE cycle_id=$1 AND trade_id=$2`,
        [cycle.cycleId, 'trade-a', `cohort-execution-claim:${digest('a')}`, digest('b')]
      )
    ).rejects.toThrow('work transition is invalid');

    const claim = await repository.claim({
      cycleId: cycle.cycleId,
      tradeId: 'trade-a',
      workerId: 'worker-a',
    });
    await expect(
      pool.query(
        `SELECT complete_outcome_private_evaluation_work($1,$2,'succeeded',NULL,NULL,NULL)`,
        [claim!.claimId, createHash('sha256').update(claim!.leaseToken).digest('hex')]
      )
    ).rejects.toThrow('completion custody');
  });

  it('records an indexed targeted lookup plan without a wall-clock assertion', async () => {
    const plan = await repository.explainTargetedPreparedTradeLookup(
      authority.preparedInputSetId,
      'trade-a'
    );
    expect(plan.join('\n')).toMatch(/Index Scan|Bitmap Index Scan/);
    expect(plan.join('\n')).toContain('prepared_input_set_id');
  });
});
