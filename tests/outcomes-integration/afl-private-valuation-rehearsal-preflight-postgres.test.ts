import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inspectExact2025AflPrivateValuationRehearsalPreflight } from '@/server/aflTradeIntelligence/development/localPrivateValuationRehearsalPreflight';
import { installLocalAflTradeOutcomesRuntimeIdentity } from '@/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { inspectLocalAflPrivateValuationCommand } from '../../Scripts/dev/inspect-local-afl-private-valuation';

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
  await pool.query(`CREATE TABLE outcome_private_valuation_cohort_binding (
    request_id text PRIMARY KEY,lineage_admission_id text NOT NULL,binding_json jsonb NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_event (
    event_id text PRIMARY KEY,competition text NOT NULL,season_year integer NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_event_version (
    event_version_id text PRIMARY KEY,event_id text NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_acquisition_spell_version (
    spell_version_id text PRIMARY KEY,start_event_version_id text NOT NULL,status text NOT NULL,
    registration_canonical_json text,registration_approval_decision_id text,
    registered_at timestamptz,supersedes_spell_version_id text
  )`);
  await pool.query(`CREATE TABLE outcome_hpn_pav_input_set (
    input_set_id text PRIMARY KEY,environment text NOT NULL,competition text NOT NULL,
    season_year integer NOT NULL,status text NOT NULL,finalized_at timestamptz,
    corroborating_player_row_count integer NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_hpn_pav_calculation (
    calculation_id text PRIMARY KEY,input_set_id text NOT NULL,environment text NOT NULL,
    competition text NOT NULL,season_year integer NOT NULL,status text NOT NULL,
    finalized_at timestamptz
  )`);
  await pool.query(`CREATE FUNCTION validate_outcome_private_evaluation_batch_complete(text,text)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT TRUE $$`);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.end();
});

describe('exact 2025 private valuation rehearsal preflight on PostgreSQL', () => {
  it('reads a linked retained chain without claiming source absence or rehearsal readiness', async () => {
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
    await pool.query(
      `INSERT INTO outcome_private_valuation_cohort_binding VALUES
       ('request-1','admission-1',$1::jsonb)`,
      [JSON.stringify({ cohortScopeKey: scopeKey, cohortTradeIds: ['trade-1', 'trade-2'] })]
    );
    await pool.query(`INSERT INTO outcome_event VALUES ('event-1','AFLM',2025)`);
    await pool.query(`INSERT INTO outcome_event_version VALUES ('event-version-1','event-1')`);
    await pool.query(
      `INSERT INTO outcome_acquisition_spell_version VALUES
       ('spell-version-1','event-version-1','approved','{}','decision-1',now(),NULL)`
    );
    await pool.query(
      `INSERT INTO outcome_hpn_pav_input_set VALUES
       ('input-1','non_production','AFLM',2025,'finalized',now(),4200)`
    );
    await pool.query(
      `INSERT INTO outcome_hpn_pav_calculation VALUES
       ('calculation-1','input-1','non_production','AFLM',2025,'finalized',now())`
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
    expect(report.blockerCodes).toEqual([]);
    expect(report.state).toBe('inconclusive');
    expect(report.retainedSourceInventory).toEqual({
      cohortCandidates: { admissionCount: 1, tradeCount: 2 },
      measurementEvidence: {
        currentRegisteredAcquisitionSpellCount: 1,
        finalizedHpnInputSetCount: 1,
        finalizedHpnCalculationCount: 1,
        maxFinalizedHpnCorroboratingPlayerRowCount: 4200,
      },
    });
    expect(report.sourceAuthority).toEqual({
      genuineDraftTrade: 'not_inspected',
      genuineHpnCorroboration: 'not_inspected',
    });

    const runtimeNonce = 'c'.repeat(64);
    await installLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce, process.pid);
    const connection = new URL(databaseUrl);
    connection.search = '';
    const inspect = () =>
      inspectLocalAflPrivateValuationCommand({
        env: {
          AFL_OUTCOMES_DATABASE_URL: connection.toString(),
          STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: runtimeNonce,
        },
        writeOutput: () => undefined,
        createPool: (configuration) =>
          new Pool({
            ...configuration,
            options: `${configuration.options} -c search_path=${schemaName}`,
          }),
      });
    const first = await inspect();
    const replay = await inspect();
    expect(first.inventory).toEqual(report);
    expect(replay).toEqual(first);
    expect(first.rehearsalExecuted).toBe(false);
  });
});
