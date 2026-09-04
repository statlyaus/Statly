import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0104_dispatch_bound_private_evaluation_batch/migration.sql'
  ),
  'utf8'
);
const atomicBatchMigration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0066_atomic_private_evaluation_batches/migration.sql'
  ),
  'utf8'
);

describe('dispatch-bound private evaluation batch migration', () => {
  it('adds claim-independent private custody without changing retained public rows', () => {
    expect(migration).toContain('ALTER TABLE "outcome_private_evaluation_cohort_capture"');
    expect(migration).toContain('ALTER TABLE "outcome_private_evaluation_execution_cycle"');
    expect(migration).toContain('"preparation_authority" TEXT NOT NULL DEFAULT');
    expect(migration).toContain("'authenticated_calculation_evidence_snapshot'");
    expect(migration).toContain("'qualified_current_model_evidence'");
    expect(migration).toContain('"preparation_operation_id" TEXT');
    expect(migration).toContain('"current_model_evidence_operation_id" TEXT');
    expect(migration).toContain('"dispatch_request_id" TEXT');
    expect(migration).not.toMatch(/ADD COLUMN\s+"(?:claim_id|lease_token_sha256)"/u);
  });

  it('binds private capture, cycle, batch, and generation ancestry to prepared-v3 authority', () => {
    for (const authority of [
      'outcome_current_valuation_cohort_operation',
      'outcome_current_valuation_cohort_operation_result',
      'outcome_current_valuation_model_evidence_operation',
      'outcome_private_valuation_dispatch_request',
      'outcome_private_valuation_factual_output',
      'outcome_hpn_pav_calculation',
      'outcome_private_valuation_model_operation',
      'outcome_private_evaluation_cohort_capture',
      'outcome_private_evaluation_cohort_batch',
      'outcome_private_evaluation_batch',
      'outcome_private_evaluation_batch_entry',
    ]) {
      expect(migration).toContain(`"${authority}"`);
    }
    expect(atomicBatchMigration).toContain(
      'FROM "outcome_local_private_trade_evaluation_generation"'
    );
    expect(atomicBatchMigration).toContain(
      '"validate_outcome_automated_ready_calculation_authority"('
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_cohort_capture"'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_execution_cycle"'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch"'
    );
    for (const typedField of [
      "jsonb_typeof(content->'preparedInputSetRevision') IS DISTINCT FROM 'number'",
      "jsonb_typeof(content->'expectedBatchRevision') IS DISTINCT FROM 'number'",
      "jsonb_typeof(content->'repairSequence') IS DISTINCT FROM 'number'",
      "jsonb_typeof(content->'maximumAttemptsPerTrade') IS DISTINCT FROM 'number'",
      "jsonb_typeof(blocker->'code')<>'string'",
    ]) {
      expect(migration).toContain(typedField);
    }

    const calculationAuthorityValidator = migration.match(
      /CREATE FUNCTION "validate_outcome_automated_ready_calculation_authority"\([\s\S]+?END \$\$;/u
    )?.[0];
    expect(calculationAuthorityValidator).toBeDefined();
    expect(migration).toContain(
      'ALTER FUNCTION "validate_outcome_automated_ready_calculation_authority"(JSONB,TEXT,TEXT)\n  RENAME TO "validate_outcome_automated_ready_calculation_authority_pre_0104";'
    );
    expect(migration).not.toContain(
      'CREATE FUNCTION "validate_outcome_automated_ready_calculation_authority_pre_0104"'
    );
    expect(calculationAuthorityValidator).toMatch(
      /IF prepared_document#>>'\{content,preparationAuthority\}'=\s*'authenticated_calculation_evidence_snapshot' THEN\s*RETURN "validate_outcome_automated_ready_calculation_authority_pre_0104"\(/u
    );
    expect(calculationAuthorityValidator).toContain(`player_gate."gate"='gate_3_model_validity'`);
    expect(calculationAuthorityValidator).toContain(`pick_gate."gate"='gate_3_model_validity'`);
    expect(calculationAuthorityValidator).not.toContain(
      `player_gate."gate"='gate_3_model_approval'`
    );
    expect(migration).toMatch(
      /ALTER FUNCTION "validate_outcome_automated_ready_calculation_authority"\(JSONB,TEXT,TEXT\)\s+SECURITY DEFINER;/u
    );
    expect(migration).toMatch(
      /ALTER FUNCTION "validate_outcome_automated_ready_calculation_authority"\(JSONB,TEXT,TEXT\)\s+OWNER TO afl_trade_private_evaluation_batch_head_owner;/u
    );
    expect(migration).toContain(
      'validate_outcome_automated_ready_calculation_authority(JSONB,TEXT,TEXT) SET search_path'
    );
    expect(calculationAuthorityValidator).toContain(
      `successor."supersedes_decision_id"=player_gate."decision_id"`
    );
    expect(calculationAuthorityValidator).toContain(
      `successor."supersedes_decision_id"=pick_gate."decision_id"`
    );
    expect(calculationAuthorityValidator).toContain(
      "prepared_document#>>'{content,preparationAuthority}'"
    );
    for (const exactPrivateField of [
      "authority->>'preparationOperationId'",
      "authority->>'currentModelEvidenceOperationId'",
      "authority->'dispatchAuthority'",
      "prepared_document#>>'{content,preparationOperationId}'",
      "prepared_document#>>'{content,modelEvidence,operationId}'",
      "prepared_document#>'{content,dispatchAuthority}'",
      'prepared_entry."entry_json"->\'materializationManifestArtifact\'',
      "prepared_document#>>'{content,valuationInputBundleId}'",
      "prepared_document#>'{content,valuationInputBundleArtifact}'",
      'load_outcome_private_prepared_v3_authority',
    ]) {
      expect(calculationAuthorityValidator).toContain(exactPrivateField);
    }
  });

  it('keeps claimless activation public-only and exposes one fenced private wrapper', () => {
    expect(migration).toContain(
      'CREATE ROLE afl_trade_private_evaluation_batch_head_owner NOLOGIN'
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION "advance_outcome_current_private_evaluation_batch"[\s\S]+?current_user IS DISTINCT FROM 'afl_trade_private_evaluation_batch_head_owner'/u
    );
    expect(migration).toMatch(
      /CREATE FUNCTION "advance_outcome_current_private_evaluation_batch_from_dispatch_claim"\([\s\S]+?LANGUAGE plpgsql SECURITY DEFINER/u
    );
    expect(migration).toMatch(
      /ALTER FUNCTION "advance_outcome_current_private_evaluation_batch_from_dispatch_claim"\([\s\S]+?OWNER TO afl_trade_private_evaluation_batch_head_owner/u
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION "advance_outcome_current_private_evaluation_batch_from_dispatch_claim"\([\s\S]+?FROM PUBLIC/u
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION "advance_outcome_current_private_evaluation_batch_from_dispatch_claim"\([\s\S]+?TO afl_trade_private_evaluation_coordinator/u
    );
    expect(migration).toMatch(
      /GRANT SELECT,INSERT ON TABLE[\s\S]+?"outcome_private_evaluation_batch"[\s\S]+?TO afl_trade_private_evaluation_coordinator/u
    );
    expect(migration).not.toMatch(
      /GRANT (?:UPDATE|DELETE)[^;]+TO afl_trade_private_evaluation_coordinator/u
    );
    expect(migration).toMatch(
      /CREATE FUNCTION "load_outcome_private_evaluation_cohort_capture"\(\s*target_operation_id TEXT\s*\)[\s\S]+?FOR KEY SHARE/u
    );
    expect(migration).toMatch(
      /ALTER FUNCTION "load_outcome_private_evaluation_cohort_capture"\(TEXT\)[\s\S]+?OWNER TO afl_trade_private_evaluation_batch_head_owner/u
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION "load_outcome_private_evaluation_cohort_capture"\(TEXT\) FROM PUBLIC/u
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION "load_outcome_private_evaluation_cohort_capture"\(TEXT\)[\s\S]+?TO afl_trade_private_evaluation_coordinator/u
    );
  });

  it('checks the exact live claim both before and after the atomic CAS', () => {
    const fencedFunction = migration.match(
      /CREATE FUNCTION "advance_outcome_current_private_evaluation_batch_from_dispatch_claim"\([\s\S]+?END;\n\$\$;/u
    )?.[0];
    expect(fencedFunction).toBeDefined();
    expect(
      fencedFunction!.match(/load_outcome_private_valuation_dispatch_request_for_claim/g)
    ).toHaveLength(2);
    const cas = fencedFunction!.indexOf(
      'advance_outcome_current_private_evaluation_batch_from_capture'
    );
    const checks = [
      ...fencedFunction!.matchAll(/load_outcome_private_valuation_dispatch_request_for_claim/g),
    ].map(({ index }) => index!);
    expect(checks[0]).toBeLessThan(cas);
    expect(checks[1]).toBeGreaterThan(cas);
  });

  it('runs locking insert validators through the no-login owner without coordinator updates', () => {
    for (const validator of [
      'validate_outcome_private_evaluation_cohort_capture',
      'validate_outcome_private_evaluation_cohort_failure',
      'validate_outcome_private_evaluation_cohort_batch',
      'validate_outcome_private_evaluation_batch',
      'validate_outcome_private_evaluation_batch_entry',
    ]) {
      expect(migration).toContain(`ALTER FUNCTION "${validator}"() SECURITY DEFINER`);
      expect(migration).toMatch(
        new RegExp(
          `ALTER FUNCTION "${validator}"\\(\\)\\s+OWNER TO afl_trade_private_evaluation_batch_head_owner`,
          'u'
        )
      );
      expect(migration).toMatch(
        new RegExp(
          `ALTER FUNCTION %I\\.${validator}\\(\\) SET search_path TO %I,pg_catalog,pg_temp`,
          'u'
        )
      );
      expect(migration).toContain(`REVOKE ALL ON FUNCTION "${validator}"() FROM PUBLIC`);
    }
    expect(migration).toMatch(
      /GRANT UPDATE ON TABLE[\s\S]+?"outcome_current_prepared_valuation_input_set"[\s\S]+?"outcome_private_evaluation_cohort_capture"[\s\S]+?"outcome_private_evaluation_batch"[\s\S]+?TO afl_trade_private_evaluation_batch_head_owner/u
    );
    expect(migration).not.toMatch(
      /GRANT (?:UPDATE|DELETE)[^;]+TO afl_trade_private_evaluation_coordinator/u
    );
  });
});
