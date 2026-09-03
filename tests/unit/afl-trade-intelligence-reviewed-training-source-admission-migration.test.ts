import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0100_reviewed_training_source_admission/migration.sql'
  ),
  'utf8'
);

describe('reviewed training source admission migration', () => {
  it('admits only exact current reviewed AFL Tables and scoped AFLCA capture evidence', () => {
    expect(migration).toContain('outcome_reviewed_training_source_admission');
    expect(migration).toContain('admit_outcome_reviewed_training_source_capture');
    expect(migration).toContain('capture."environment" IS DISTINCT FROM \'non_production\'');
    expect(migration).toContain('capture."status" IS DISTINCT FROM \'staged\'');
    expect(migration).toContain('review_set."decision" IS DISTINCT FROM \'approved\'');
    expect(migration).toContain('NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor');
    expect(migration).toContain('capture."provider"=\'afl_tables\'');
    expect(migration).toContain('capture."provider"=\'afl_coaches_association\'');
    expect(migration).toContain('review."subject_type"=\'local_reconciled_player_match_fact\'');
    expect(migration).toContain("review.\"evidence_json\"->>'metricCode'='goals'");
    expect(migration).toContain(
      "review.\"evidence_json\"->>'metricCode' IS DISTINCT FROM 'coaches_votes'"
    );
    expect(migration).toContain("'publicationEligible',false");
    expect(migration).toContain("'productionEligible',false");
  });

  it('keeps capture mutation behind an immutable admission receipt and owner-only function', () => {
    expect(migration).toContain('Reviewed training source admissions are immutable');
    expect(migration).toContain(
      'EXISTS (\n        SELECT 1 FROM "outcome_reviewed_training_source_admission" admission'
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain(
      'ALTER FUNCTION %I.admit_outcome_reviewed_training_source_capture(TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp'
    );
    expect(migration).toContain('REVOKE ALL ON FUNCTION');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION');
  });
});
