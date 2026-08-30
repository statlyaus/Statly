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
      'GRANT SELECT,INSERT ON TABLE "outcome_current_valuation_model_evidence_operation"'
    );
    expect(migration).not.toContain('GRANT SELECT ON TABLE');
    expect(migration).not.toContain('outcome_active_release');
    expect(migration).not.toContain('outcome_current_valuation_publication');
  });
});
