import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inspectExact2025AflPrivateValuationRehearsalPreflight } from '@/server/aflTradeIntelligence/development/localPrivateValuationRehearsalPreflight';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_rehearsal_preflight_${process.pid}_${Date.now()}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });

beforeAll(async () => {
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
  await pool.query(`CREATE TABLE outcome_current_private_factual_authority (
    valuation_scope_key text PRIMARY KEY,candidate_id text NOT NULL,revision integer NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_current_governed_valuation_model_pair (
    scope_key text PRIMARY KEY,revision integer NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_current_valuation_model_evidence_operation (
    operation_id text PRIMARY KEY,scope_key text NOT NULL,result_state text NOT NULL,
    result_json jsonb NOT NULL,factual_candidate_id text NOT NULL,factual_revision integer NOT NULL,
    completed_at timestamptz NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_prepared_valuation_input_set (
    prepared_input_set_id text PRIMARY KEY,scope_key text NOT NULL,schema_version text NOT NULL,
    finalized_at timestamptz,prepared_set_json jsonb NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_current_prepared_valuation_input_set (
    scope_key text PRIMARY KEY,prepared_input_set_id text NOT NULL,revision integer NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_private_evaluation_batch (
    batch_id text PRIMARY KEY,scope_key text NOT NULL,prepared_input_set_id text NOT NULL,
    prepared_input_set_revision integer NOT NULL,trade_count integer NOT NULL,
    ready_count integer NOT NULL,unavailable_count integer NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_current_private_evaluation_batch (
    scope_key text PRIMARY KEY,batch_id text NOT NULL,revision integer NOT NULL
  )`);
  await pool.query(`CREATE FUNCTION validate_outcome_private_evaluation_batch_complete(text,text)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT TRUE $$`);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.end();
});

describe('exact 2025 private valuation rehearsal preflight on PostgreSQL', () => {
  it('reads a fully linked retained chain while preserving the genuine-source blockers', async () => {
    const scopeKey = 'afl-men:2025-trades';
    await pool.query(
      `INSERT INTO outcome_current_private_factual_authority VALUES ($1,'candidate-1',2)`,
      [scopeKey]
    );
    await pool.query(`INSERT INTO outcome_current_governed_valuation_model_pair VALUES ($1,4)`, [
      scopeKey,
    ]);
    await pool.query(
      `INSERT INTO outcome_current_valuation_model_evidence_operation
       VALUES ('model-evidence-1',$1,'qualified',$2::jsonb,'candidate-1',2,now())`,
      [scopeKey, JSON.stringify({ modelRevision: 4 })]
    );
    await pool.query(
      `INSERT INTO outcome_prepared_valuation_input_set
       VALUES ('prepared-1',$1,'afl-trade-prepared-valuation-input-set/v3',now(),$2::jsonb)`,
      [
        scopeKey,
        JSON.stringify({
          content: {
            preparationAuthority: 'qualified_current_model_evidence',
            modelEvidence: { operationId: 'model-evidence-1', modelRevision: 4 },
          },
        }),
      ]
    );
    await pool.query(
      `INSERT INTO outcome_current_prepared_valuation_input_set VALUES ($1,'prepared-1',3)`,
      [scopeKey]
    );
    await pool.query(
      `INSERT INTO outcome_private_evaluation_batch
       VALUES ('batch-1',$1,'prepared-1',3,12,11,1)`,
      [scopeKey]
    );
    await pool.query(
      `INSERT INTO outcome_current_private_evaluation_batch VALUES ($1,'batch-1',5)`,
      [scopeKey]
    );

    const report = await inspectExact2025AflPrivateValuationRehearsalPreflight(pool);

    expect(report.retainedAuthority).toEqual({
      privateFactualHead: { present: true, revision: 2 },
      qualifiedModelEvidence: { present: true, revision: 4 },
      preparedV3: { present: true, revision: 3 },
      exhaustivePrivateBatch: {
        present: true,
        revision: 5,
        tradeCount: 12,
        readyCount: 11,
        unavailableCount: 1,
      },
    });
    expect(report.blockerCodes).toEqual([
      'genuine_draft_trade_authority_not_locally_admitted',
      'genuine_hpn_corroborating_authority_not_locally_admitted',
    ]);
  });
});
