import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0103_private_prepared_v3_from_current_model_evidence/migration.sql'
  ),
  'utf8'
);

describe('private prepared-v3 current-model-evidence migration', () => {
  it('adds one private discriminant without replacing the public prepared path', () => {
    expect(migration).toContain('ALTER COLUMN "qualification_report_id" DROP NOT NULL');
    expect(migration).toContain(
      'NEW."preparation_authority"=\'authenticated_calculation_evidence_snapshot\''
    );
    expect(migration).toContain('NEW."preparation_authority"=\'qualified_current_model_evidence\'');
    expect(migration).toContain(
      'EXECUTE FUNCTION "validate_outcome_current_valuation_cohort_operation"()'
    );
    expect(migration).toContain(
      "'source_policy_preflight_only','authenticated_calculation_evidence_snapshot'"
    );
  });

  it('authenticates exact current evidence, dispatch inputs, reviewed custody, and model ancestry', () => {
    for (const authority of [
      'outcome_current_valuation_model_evidence_operation',
      'outcome_current_valuation_factual_refresh_operation',
      'outcome_current_private_factual_authority',
      'outcome_private_reviewed_evaluation_head',
      'outcome_private_reviewed_evaluation_decision',
      'outcome_private_reviewed_evidence_bundle',
      'outcome_private_valuation_model_request_binding',
      'outcome_private_valuation_factual_output',
      'outcome_hpn_pav_calculation',
      'outcome_private_valuation_model_operation',
      'outcome_governed_component_validation_evidence',
      'outcome_governed_model_qualification_work',
      'outcome_current_governed_valuation_model_pair',
    ]) {
      expect(migration).toContain(`"${authority}"`);
    }
    expect(migration).toContain('CREATE FUNCTION "load_outcome_private_prepared_v3_authority"');
    expect(migration).toContain('LANGUAGE plpgsql VOLATILE SECURITY DEFINER');
    expect(migration).toContain("'governed-model-pair:'||locked_candidate.authority_scope_key");
    expect(migration).toContain('\'afl-trade-gate:\'||gate."gate"');
    expect(migration).toContain("'outcome-capture-scope:'||lock_capture_id");
    expect(migration).toContain('"outcome_private_reviewed_evidence_bundle_is_current"(');
    expect(migration).toContain('"outcome_private_factual_custody_for_bundle"(');
    expect(migration).toContain('"outcome_afl_trade_canonical_json"(live_custody)');
    expect(migration).toContain('CREATE ROLE afl_trade_private_prepared_v3_owner NOLOGIN');
    expect(migration).toContain('OWNER TO afl_trade_current_valuation_refresh_owner');
    expect(migration).toContain('OWNER TO afl_trade_private_prepared_v3_owner');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION "load_outcome_private_prepared_v3_authority"(TEXT)'
    );
    expect(migration).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[^;]+outcome_private_reviewed[^;]+TO\s+"afl_trade_private_evaluation_coordinator"/isu
    );
    for (const crossScopeGuard of [
      'NEW."scope_key" IS DISTINCT FROM authority.scope_key',
      'NEW."scope_key" IS DISTINCT FROM NEW."context_json"->>\'scopeKey\'',
      'NEW."factual_release_id" IS DISTINCT FROM authority.factual_release_id',
      'NEW."factual_release_id" IS DISTINCT FROM',
      'release_row."scope_key" IS DISTINCT FROM authority.factual_release_scope_key',
    ]) {
      expect(migration).toContain(crossScopeGuard);
    }
    const reviewedHeadLock = migration.indexOf(
      'PERFORM 1 FROM "outcome_private_reviewed_evaluation_head"'
    );
    const captureLock = migration.indexOf("'outcome-capture-scope:'||lock_capture_id");
    const factualHeadLock = migration.indexOf(
      'PERFORM 1 FROM "outcome_current_private_factual_authority"'
    );
    const playerGateLock = migration.indexOf('INTO player_gate_lock_key');
    const pickGateLock = migration.indexOf('INTO pick_gate_lock_key');
    const modelLock = migration.indexOf(
      "'governed-model-pair:'||locked_candidate.authority_scope_key"
    );
    expect(reviewedHeadLock).toBeLessThan(captureLock);
    expect(captureLock).toBeLessThan(factualHeadLock);
    expect(playerGateLock).toBeLessThan(pickGateLock);
    expect(pickGateLock).toBeLessThan(modelLock);
  });

  it('retains immutable operation/result and current-head CAS while excluding later-ticket state', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "outcome_current_cohort_private_replay_key"');
    expect(migration).toMatch(
      /"dispatch_request_id","current_model_evidence_operation_id",\s*"expected_prepared_input_revision","valuation_input_bundle_id"/u
    );
    expect(migration).toContain('NEW."valuation_input_bundle_id" IS DISTINCT FROM');
    expect(migration).toContain('activate_outcome_current_prepared_valuation_input_set');
    expect(migration).toContain('CREATE ROLE afl_trade_private_prepared_input_head_owner NOLOGIN');
    expect(migration).toContain(
      'CREATE FUNCTION "load_outcome_private_current_prepared_valuation_input_head"'
    );
    expect(migration).toMatch(
      /CREATE FUNCTION "load_outcome_private_current_prepared_valuation_input_head"\([\s\S]+?SECURITY DEFINER[\s\S]+?FOR UPDATE;/u
    );
    expect(migration).toMatch(
      /ALTER FUNCTION "activate_outcome_private_current_prepared_valuation_input_set"\(TEXT,TEXT,INTEGER\)[\s\S]+?OWNER TO afl_trade_private_prepared_input_head_owner/u
    );
    expect(migration).toMatch(
      /CREATE FUNCTION "activate_outcome_private_current_prepared_valuation_input_set"\([\s\S]+?SECURITY DEFINER/u
    );
    expect(migration).toMatch(
      /ALTER FUNCTION %I\.activate_outcome_private_current_prepared_valuation_input_set\(TEXT,TEXT,INTEGER\) SET search_path/u
    );
    expect(migration).toMatch(
      /CREATE FUNCTION "activate_outcome_private_current_prepared_valuation_input_set"\([\s\S]+?"prepared_set_json"->'content'->>'preparationAuthority'=\s*'qualified_current_model_evidence'/u
    );
    expect(migration).not.toMatch(
      /ALTER FUNCTION (?:"|%I\.)activate_outcome_current_prepared_valuation_input_set/u
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION "activate_outcome_private_current_prepared_valuation_input_set"\(TEXT,TEXT,INTEGER\)\s+FROM PUBLIC/u
    );
    expect(migration).toMatch(
      /GRANT SELECT ON TABLE "outcome_current_prepared_valuation_input_set"\s+TO "afl_trade_private_evaluation_coordinator"/u
    );
    expect(migration).not.toMatch(
      /GRANT\s+(?:[^;]*\b(?:INSERT|UPDATE|DELETE)\b[^;]*)\s+ON(?: TABLE)?[^;]*"outcome_current_prepared_valuation_input_set"[^;]*TO "afl_trade_private_evaluation_coordinator"/isu
    );
    expect(migration).not.toContain('outcome_private_evaluation_cohort_capture');
    expect(migration).not.toContain('outcome_private_evaluation_execution_cycle');
    expect(migration).not.toContain('outcome_private_evaluation_batch');
    expect(migration).not.toContain('outcome_private_evaluation_runner');
  });
});
