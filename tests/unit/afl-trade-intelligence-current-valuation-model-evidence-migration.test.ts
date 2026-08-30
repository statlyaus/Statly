import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0085_current_valuation_model_evidence/migration.sql'
  ),
  'utf8'
);

describe('current valuation model evidence migration', () => {
  it('retains one private result behind exact factual ancestry without public grants', () => {
    expect(migration).toContain(
      'CREATE TABLE "outcome_current_valuation_model_evidence_operation"'
    );
    expect(migration).toContain('"factual_operation_id" TEXT NOT NULL');
    expect(migration).toContain('"factual_candidate_id" TEXT NOT NULL');
    expect(migration).toContain('"expected_model_revision" INTEGER NOT NULL');
    expect(migration).toContain("CHECK (\"result_state\" IN ('qualified','qualification_failed'))");
    expect(migration).toContain(
      'GRANT SELECT,INSERT ON TABLE "outcome_current_valuation_model_evidence_operation"\n  TO "afl_trade_private_evaluation_coordinator";'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "outcome_current_valuation_model_evidence_no_update_delete"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "outcome_current_governed_model_pair_scope_lock"'
    );
    expect(migration).toContain(
      '"outcome_current_governed_valuation_model_pair",\n  "outcome_governed_valuation_model_qualification",'
    );
    expect(migration).toContain('"outcome_governed_component_validation_evidence"');
    expect(migration).not.toMatch(/GRANT[^;]+TO\s+(?:"?PUBLIC"?)/isu);
    expect(migration).not.toContain('outcome_active_release');
    expect(migration).not.toContain('outcome_current_valuation_publication');
  });
});
