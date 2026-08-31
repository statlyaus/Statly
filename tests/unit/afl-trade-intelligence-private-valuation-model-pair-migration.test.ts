import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationPath = join(
  root,
  'prisma/afl-trade-outcomes/migrations/0079_dispatch_bound_private_model_pair/migration.sql'
);
const reclaimedPickAdoptionMigrationPath = join(
  root,
  'prisma/afl-trade-outcomes/migrations/0088_reclaimed_dispatch_pick_component_adoption/migration.sql'
);
const schemaPath = join(root, 'prisma/afl-trade-outcomes/schema.prisma');

describe('dispatch-bound private model-pair migration', () => {
  it('adds only request lineage and monotonic operation custody over existing owners', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const schema = readFileSync(schemaPath, 'utf8');

    expect(migration).toContain('outcome_private_valuation_model_operation');
    expect(migration).toContain('outcome_private_valuation_model_request_binding');
    expect(migration.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(migration).toContain('outcome_governed_valuation_component_run');
    expect(migration).toContain('outcome_governed_valuation_model_qualification');
    expect(migration).toContain('outcome_private_valuation_dispatch_attempt');
    expect(migration).not.toMatch(/retry_count|retry_number|model_attempt/);

    expect(schema).toContain('model OutcomePrivateValuationModelOperation');
    expect(schema).toContain('model OutcomePrivateValuationModelRequestBinding');
  });

  it('keeps human authorization intact and admits only the fixed local private policy variant', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('human_operational_authorization_for_one_exact_model_run_intent');
    expect(migration).toContain(
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    );
    expect(migration).toContain('system:weekly-valuation-coordinator');
    expect(migration).toContain("content->>'dispatchLeaseTokenSha256'");
    expect(migration).toContain("content->>'factualOutputId'");
    expect(migration).toContain("content->>'hpnCalculationId'");
    expect(migration).toContain("content->>'executionMode'<>'local'");
    expect(migration).toContain("content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB");
    expect(migration).toContain('NEW."environment"<>\'non_production\'');
    expect(migration.match(/policy_owned:=COALESCE\(/g)).toHaveLength(2);
    expect(migration).toContain(
      "content->>'authorityBoundary' IS DISTINCT FROM\n         'human_operational_authorization_for_one_exact_model_run_intent'"
    );
    expect(migration.match(/attempt\."lease_expires_at">trusted_now/g)).toHaveLength(2);
    expect(migration.match(/NEW\."valid_through"<=attempt\."lease_expires_at"/g)).toHaveLength(2);
    expect(
      migration.match(/PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"\(/g)
    ).toHaveLength(6);
    expect(migration).toContain('outcome_dispatch_bound_pick_execution_claim_fence');
    expect(migration).toContain('outcome_dispatch_bound_component_claim_fence');
    expect(migration).toContain('outcome_dispatch_bound_model_qualification_claim_fence');
    expect(migration).toContain(
      'claim_outcome_private_valuation_dispatch(TEXT,TEXT,INTEGER,TEXT) SET search_path'
    );
    expect(
      migration.match(/OWNER TO afl_trade_private_valuation_scheduler_owner/g)?.length
    ).toBeGreaterThanOrEqual(9);
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION "fence_outcome_dispatch_bound_model_qualification"() FROM PUBLIC'
    );
  });

  it('accepts only exact dispatch-bound components and the declared qualification policy', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('afl-trade-pick-pav-model-execution/v4');
    expect(migration).toContain('Expected governed pick v3 validator was not found');
    expect(migration).toContain(
      'Expected governed pick qualification evidence validator was not found'
    );
    expect(migration).toContain("'privateInput'->>'operationId'");
    expect(migration).toContain("'privateInput'->>'factualOutputId'");
    expect(migration).toContain("'privateInput'->>'hpnCalculationId'");
    expect(migration).toContain("'policy'->>'policyVersion'");
    expect(migration).toContain(
      'operation."player_run_id"=NEW."player_run_id"\n       AND operation."pick_run_id"=NEW."pick_run_id"'
    );
  });

  it('does not mutate public factual or publication pointers', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).not.toMatch(/UPDATE\s+"?outcome_active_release"?/i);
    expect(migration).not.toMatch(/UPDATE\s+"?outcome_current_valuation_publication"?/i);
  });

  it('adopts an exact retained pick component under a separately authenticated live claim', () => {
    const migration = readFileSync(reclaimedPickAdoptionMigrationPath, 'utf8');

    expect(migration).toContain('outcome_private_valuation_dispatch_attempt');
    expect(migration).toContain('retained_attempt."claim_id"');
    expect(migration).toContain('retained_attempt."attempt_number"');
    expect(migration).toContain('retained_attempt."lease_token_sha256"');
    expect(migration).toContain(
      'replace(current_definition,old_claim_match,retained_attempt_match)'
    );
  });
});
