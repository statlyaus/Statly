import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const migratedSchema = `afl_cohort_consumer_${process.pid}_${Date.now()}`;
const seamSchema = `${migratedSchema}_seam`;
const pool = new Pool({ connectionString: databaseUrl });
const seam = new Pool({ connectionString: databaseUrl, options: `-c search_path=${seamSchema}` });
const requestId = `private-valuation-dispatch:${'a'.repeat(64)}`;
const scope = 'afl-men:2025-trades';
const authority = {
  candidateId: 'candidate',
  revision: 1,
  evidenceScopeKey: 'private-scope',
  evidenceBundleId: 'bundle',
  reviewDecisionId: 'review',
  normalizedReconciledCustodySha256: 'custody',
};
const evidence = {
  operationId: 'evidence',
  factualOperationId: 'refresh',
  qualificationId: 'qualification',
  playerRunId: 'player',
  pickRunId: 'pick',
  privateFactualAuthority: authority,
  modelRevision: 1,
  playerGate3DecisionId: 'player-gate',
  pickGate3DecisionId: 'pick-gate',
  qualificationWorkId: 'work',
  playerObservationSetId: 'player-observations',
  pickBenchmarkEvidenceId: 'pick-observations',
};

beforeAll(async () => {
  await pool.query(`CREATE SCHEMA "${migratedSchema}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', migratedSchema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await pool.query(`CREATE SCHEMA "${seamSchema}"`);
  // Synthetic upstream records isolate the deployed public SQL consumer. They do
  // not prove genuine admission; the authenticated getter has separate regressions.
  const records: Record<string, Record<string, unknown>[]> = {
    outcome_private_valuation_dispatch_request: [{ request_id: requestId, scope_key: scope }],
    outcome_private_valuation_model_request_binding: [
      {
        request_id: requestId,
        operation_id: 'model',
        factual_output_id: 'factual',
        hpn_calculation_id: 'calculation',
      },
    ],
    outcome_private_valuation_factual_output: [
      {
        request_id: requestId,
        output_id: 'factual',
        factual_release_id: 'player-release',
        output_json: {
          outputId: 'factual',
          content: { schemaVersion: 'afl-trade-private-valuation-factual-output/v2' },
        },
      },
    ],
    outcome_release_manifest: [
      {
        release_id: 'player-release',
        scope_key: 'afl-men:2024-player-source',
        environment: 'non_production',
      },
      { release_id: 'cohort-release', scope_key: scope, environment: 'non_production' },
    ],
    outcome_hpn_pav_calculation: [
      {
        calculation_id: 'calculation',
        status: 'finalized',
        finalized_at: '2026-01-01T00:00:00Z',
        calculation_json: { calculationId: 'calculation' },
      },
    ],
    outcome_private_valuation_model_operation: [
      {
        operation_id: 'model',
        scope_key: scope,
        pair_accepted_at: '2026-01-01T00:00:00Z',
        qualification_outcome: 'qualified',
        qualification_id: 'qualification',
        player_run_id: 'player',
        pick_run_id: 'pick',
      },
    ],
    outcome_current_valuation_model_evidence_operation: [
      {
        operation_id: 'evidence',
        scope_key: scope,
        factual_operation_id: 'refresh',
        result_state: 'qualified',
        factual_candidate_id: 'candidate',
        factual_revision: 1,
        result_json: evidence,
      },
    ],
    outcome_current_valuation_factual_refresh_operation: [
      {
        operation_id: 'refresh',
        scope_key: scope,
        state: 'factual_refresh_complete',
        candidate_id: 'candidate',
        private_factual_revision: 1,
      },
    ],
    outcome_current_valuation_evidence_orchestration_operation: [
      {
        stable_operation_key: requestId,
        scope_key: scope,
        state: 'complete',
        stage: 'private_factual_authority',
        downstream_operation_id: 'refresh',
      },
    ],
    outcome_current_private_factual_authority: [
      { valuation_scope_key: scope, candidate_id: 'candidate', revision: 1 },
    ],
    outcome_private_factual_candidate: [
      {
        candidate_id: 'candidate',
        valuation_scope_key: scope,
        evidence_scope_key: 'private-scope',
        evidence_bundle_id: 'bundle',
        review_decision_id: 'review',
        normalized_reconciled_custody_sha256: 'custody',
        candidate_json: { content: { reviewedEvidenceContentSha256: 'bundle-sha' } },
      },
    ],
    outcome_private_reviewed_evaluation_head: [
      {
        valuation_scope_key: scope,
        evidence_scope_key: 'private-scope',
        evidence_bundle_id: 'bundle',
        decision_id: 'review',
        status: 'authorized',
      },
    ],
    outcome_private_reviewed_evaluation_decision: [
      {
        decision_id: 'review',
        valuation_scope_key: scope,
        evidence_bundle_id: 'bundle',
        status: 'authorized',
      },
    ],
    outcome_private_reviewed_evidence_bundle: [
      {
        evidence_bundle_id: 'bundle',
        evidence_scope_key: 'private-scope',
        bundle_sha256: 'bundle-sha',
      },
    ],
    outcome_current_governed_valuation_model_pair: [
      {
        scope_key: scope,
        revision: 1,
        qualification_id: 'qualification',
        player_run_id: 'player',
        pick_run_id: 'pick',
        player_gate3_decision_id: 'player-gate',
        pick_gate3_decision_id: 'pick-gate',
        work_id: 'work',
      },
    ],
    outcome_governed_valuation_model_qualification: [
      {
        qualification_id: 'qualification',
        scope_key: scope,
        outcome: 'qualified',
        player_run_id: 'player',
        pick_run_id: 'pick',
      },
    ],
    outcome_governed_model_qualification_work: [
      {
        work_id: 'work',
        scope_key: scope,
        qualification_id: 'qualification',
        status: 'completed',
        player_gate3_decision_id: 'player-gate',
        pick_gate3_decision_id: 'pick-gate',
      },
    ],
    outcome_governed_component_validation_evidence: [
      {
        run_id: 'player',
        role: 'player_contribution_and_availability',
        native_execution_json: { content: { observationSetId: 'player-observations' } },
      },
      {
        run_id: 'pick',
        role: 'draft_pick_and_future_pick_distribution',
        native_execution_json: { content: { observationSetId: 'pick-observations' } },
      },
    ],
    outcome_gate_decision: ['player-gate', 'pick-gate'].map((decision_id) => ({
      decision_id,
      gate: 'gate_3_model_validity',
      environment: 'non_production',
      state: 'approved',
      decision_key: decision_id,
    })),
  };
  for (const [table, rows] of Object.entries(records)) {
    await pool.query(
      `CREATE TABLE "${seamSchema}"."${table}" AS SELECT * FROM "${migratedSchema}"."${table}" WITH NO DATA`
    );
    for (const row of rows) {
      await seam.query(
        `INSERT INTO "${table}" SELECT * FROM jsonb_populate_record(NULL::"${table}",$1::jsonb)`,
        [JSON.stringify(row)]
      );
    }
  }
  await seam.query('CREATE TABLE synthetic_cohort_parent (parent_json jsonb, stale boolean)');
  await seam.query(
    `INSERT INTO synthetic_cohort_parent VALUES ('{"cohortReleaseId":"cohort-release"}',false)`
  );
  await seam.query(`CREATE FUNCTION load_outcome_private_valuation_cohort_input(text) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE parent RECORD; BEGIN SELECT * INTO parent FROM synthetic_cohort_parent;
    IF parent.stale THEN RAISE EXCEPTION 'Synthetic cohort parent stale'; END IF;
    RETURN parent.parent_json; END $$`);
  await seam.query(`CREATE FUNCTION outcome_private_prepared_v3_factual_authority_is_current(text,text,text,text,text,integer)
    RETURNS boolean LANGUAGE sql AS $$ SELECT true $$`);
  const definition = await pool.query<{ definition: string }>(
    'SELECT pg_get_functiondef($1::regprocedure) AS definition',
    [`${migratedSchema}.load_outcome_private_prepared_v3_authority(text)`]
  );
  await seam.query(definition.rows[0]!.definition.replaceAll(migratedSchema, seamSchema));
  await seam.query(
    'ALTER FUNCTION load_outcome_private_prepared_v3_authority(text) OWNER TO afl_trade_private_prepared_v3_owner'
  );
  await pool.query(
    `GRANT USAGE ON SCHEMA "${seamSchema}" TO afl_trade_private_prepared_v3_owner,afl_trade_private_evaluation_coordinator`
  );
  await pool.query(
    `GRANT SELECT ON ALL TABLES IN SCHEMA "${seamSchema}" TO afl_trade_private_prepared_v3_owner`
  );
  await seam.query(
    'GRANT EXECUTE ON FUNCTION load_outcome_private_prepared_v3_authority(text) TO afl_trade_private_evaluation_coordinator'
  );
});

afterAll(async () => {
  await seam.end();
  await pool.query(`DROP SCHEMA IF EXISTS "${seamSchema}" CASCADE`);
  await pool.query(`DROP SCHEMA IF EXISTS "${migratedSchema}" CASCADE`);
  await pool.end();
});

async function load() {
  const client = await seam.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
    return (
      await client.query(
        'SELECT factual_release_id,factual_release_scope_key FROM load_outcome_private_prepared_v3_authority($1)',
        [requestId]
      )
    ).rows;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe.sequential('prepared-v3 independent cohort consumer', () => {
  it('selects the authenticated 2025 cohort, not the v2 player observation release', async () => {
    await expect(load()).resolves.toEqual([
      { factual_release_id: 'cohort-release', factual_release_scope_key: scope },
    ]);
  });

  it('fails closed for absent or stale v2 cohort authority', async () => {
    await seam.query('UPDATE synthetic_cohort_parent SET parent_json=NULL');
    await expect(load()).resolves.toEqual([]);
    await seam.query('UPDATE synthetic_cohort_parent SET stale=true');
    await expect(load()).rejects.toThrow('Synthetic cohort parent stale');
    await seam.query(`UPDATE synthetic_cohort_parent SET stale=false,
      parent_json='{"cohortReleaseId":"cohort-release"}'`);
  });

  it('retains the current model-head fence with an independent cohort', async () => {
    await seam.query('UPDATE outcome_current_governed_valuation_model_pair SET revision=2');
    await expect(load()).resolves.toEqual([]);
    await seam.query('UPDATE outcome_current_governed_valuation_model_pair SET revision=1');
    await expect(load()).resolves.toHaveLength(1);
  });

  it('preserves v1 without consulting any new cohort binding', async () => {
    await seam.query('UPDATE synthetic_cohort_parent SET parent_json=NULL,stale=true');
    await seam.query(`UPDATE outcome_private_valuation_factual_output SET output_json=
      jsonb_set(output_json,'{content,schemaVersion}','"afl-trade-private-valuation-factual-output/v1"')`);
    await expect(load()).resolves.toEqual([
      {
        factual_release_id: 'player-release',
        factual_release_scope_key: 'afl-men:2024-player-source',
      },
    ]);
  });
});
