import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const migratedSchema = `afl_hpn_consumer_${process.pid}_${Date.now()}`;
const seamSchema = `${migratedSchema}_seam`;
const pool = new Pool({ connectionString: databaseUrl });
const seam = new Pool({ connectionString: databaseUrl, options: `-c search_path=${seamSchema}` });

beforeAll(async () => {
  await pool.query(`CREATE SCHEMA "${migratedSchema}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', migratedSchema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await pool.query(`CREATE SCHEMA "${seamSchema}"`);
  // Exercise the deployed trigger with synthetic upstream records. Admission and getter
  // authentication are separate seams; these rows cannot establish genuine source authority.
  for (const table of [
    'outcome_private_valuation_dispatch_request',
    'outcome_private_valuation_dispatch_attempt',
    'outcome_private_valuation_model_operation',
    'outcome_private_valuation_factual_output',
    'outcome_hpn_pav_calculation',
    'outcome_private_valuation_model_request_binding',
  ]) {
    await pool.query(`CREATE TABLE "${seamSchema}"."${table}" AS
      SELECT * FROM "${migratedSchema}"."${table}" WITH NO DATA`);
  }
  await seam.query('CREATE TABLE synthetic_hpn_parent (parent_json jsonb)');
  await seam.query(`CREATE FUNCTION load_outcome_private_valuation_hpn_factual_input(text,text)
    RETURNS jsonb LANGUAGE sql AS $$ SELECT parent_json FROM synthetic_hpn_parent $$`);
  await seam.query(`CREATE FUNCTION outcome_private_valuation_hpn_substantive_sha256(jsonb)
    RETURNS text LANGUAGE sql AS $$ SELECT 'hpn-values'::text $$`);
  const definition = await pool.query<{ definition: string }>(
    'SELECT pg_get_functiondef($1::regprocedure) AS definition',
    [`${migratedSchema}.validate_outcome_private_valuation_model_request_binding()`]
  );
  await seam.query(
    definition.rows[0]!.definition.replaceAll(`${migratedSchema}.`, `${seamSchema}.`)
  );
  await seam.query(`CREATE TRIGGER model_binding_guard BEFORE INSERT ON
    outcome_private_valuation_model_request_binding FOR EACH ROW
    EXECUTE FUNCTION validate_outcome_private_valuation_model_request_binding()`);
  await pool.query(
    `GRANT USAGE ON SCHEMA "${seamSchema}" TO afl_trade_private_evaluation_coordinator`
  );
  await pool.query(`GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA "${seamSchema}"
    TO afl_trade_private_evaluation_coordinator`);
  await seam.query(`INSERT INTO outcome_private_valuation_dispatch_request
    (request_id,scope_key,status,claim_id,lease_expires_at)
    VALUES ('request','afl-men:2025-trades','claimed','claim',now()+interval '1 hour')`);
  await seam.query(`INSERT INTO outcome_private_valuation_dispatch_attempt
    (claim_id,request_id,attempt_number) VALUES ('claim','request',1)`);
  await seam.query(`INSERT INTO outcome_private_valuation_model_operation
    (operation_id,scope_key,factual_values_sha256,hpn_method_id,hpn_values_sha256,
     player_dataset_id,player_dataset_admission_id)
    VALUES ('operation','afl-men:2025-trades','members','method','hpn-values','dataset','admission')`);
  await seam.query(`INSERT INTO outcome_private_valuation_factual_output
    (output_id,request_id,factual_run_id,player_dataset_id,player_dataset_admission_id,output_json)
    VALUES ('output','request','run','dataset','admission',
    '{"content":{"schemaVersion":"afl-trade-private-valuation-factual-output/v2",
       "candidate":{"memberSetSha256":"members"}}}')`);
  await seam.query(`INSERT INTO outcome_hpn_pav_calculation
    (calculation_id,status,finalized_at,method_id,calculation_json)
    VALUES ('calculation','finalized',now(),'method','{"content":{"factualRunId":"run"}}')`);
});

afterAll(async () => {
  await seam.end();
  await pool.query(`DROP SCHEMA IF EXISTS "${seamSchema}" CASCADE`);
  await pool.query(`DROP SCHEMA IF EXISTS "${migratedSchema}" CASCADE`);
  await pool.end();
});

async function bind() {
  const client = await seam.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
    await client.query(`INSERT INTO outcome_private_valuation_model_request_binding
      (request_id,claim_id,attempt_number,operation_id,factual_output_id,hpn_calculation_id)
      VALUES ('request','claim',1,'operation','output','calculation')`);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe.sequential('HPN model-request consumer authority', () => {
  it('rejects a new v2 binding without independent HPN ancestry', async () => {
    await expect(bind()).rejects.toThrow(
      'Private valuation model input lacks exact live dispatch custody'
    );
  });

  it('accepts only the exact HPN run and player admission for new v2 bindings', async () => {
    await seam.query(`INSERT INTO synthetic_hpn_parent VALUES ('{"hpnFactualRunId":"other-run"}')`);
    await expect(bind()).rejects.toThrow(
      'Private valuation model input lacks exact live dispatch custody'
    );
    await seam.query(`UPDATE synthetic_hpn_parent SET parent_json='{"hpnFactualRunId":"run"}'`);
    await expect(bind()).resolves.toBeUndefined();
    await seam.query(`UPDATE outcome_private_valuation_model_operation
      SET player_dataset_admission_id='different-admission'`);
    await expect(bind()).rejects.toThrow(
      'Private valuation model input lacks exact live dispatch custody'
    );
    await seam.query(
      `UPDATE outcome_private_valuation_model_operation SET player_dataset_admission_id='admission'`
    );
  });

  it('preserves v1 binding without requiring the new v2 HPN parent', async () => {
    await seam.query('DELETE FROM synthetic_hpn_parent');
    await seam.query(`UPDATE outcome_private_valuation_factual_output
      SET output_json=jsonb_set(output_json,'{content,schemaVersion}',
        '"afl-trade-private-valuation-factual-output/v1"')`);
    await expect(bind()).resolves.toBeUndefined();
    await seam.query(`UPDATE outcome_hpn_pav_calculation
      SET calculation_json='{"content":{"factualRunId":"different-run"}}'`);
    await expect(bind()).rejects.toThrow(
      'Private valuation model input lacks exact live dispatch custody'
    );
  });
});
