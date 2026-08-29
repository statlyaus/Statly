import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesReview';

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('private reviewed evidence currentness migration', () => {
  const migrationPath =
    'prisma/afl-trade-outcomes/migrations/0055_private_reviewed_evidence_currentness/migration.sql';

  it('moves exhaustive validation to migration time and protects the admitted review decisions', () => {
    const migration = read(migrationPath);

    expect(migration).toContain('"outcome_private_reviewed_evidence_is_current"()');
    expect(migration).toContain('Private reviewed evidence is not current before optimization');
    expect(migration).toContain('IF has_target_private_evidence');
    expect(migration).toContain('outcome_private_reviewed_evidence_bundle');
    expect(migration).toContain('decision."decided_by" IN (');
    expect(migration).toContain("capture.\"provider\"='afl_tables'");
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "outcome_review_decision"');
    expect(migration).toContain('evidenceSetSha256');
    expect(migration).toContain('aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb');
    expect(migration).toContain('4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca');
  });

  it('defines a bundle-scoped exact currentness check with compact invalidation signals', () => {
    const migration = read(migrationPath);

    expect(migration).toContain('outcome_private_reviewed_evidence_bundle_is_current');
    expect(migration).toContain('target_evidence_bundle_id');
    expect(migration).toContain('sourceCaptures');
    expect(migration).toContain('sourceRightsEvidenceRefs');
    expect(migration).toContain('reviewSets');
    expect(migration).toContain(
      'successor."supersedes_decision_id"=predecessor."decision_id"'
    );
    expect(migration).toContain('historical_decision_count<>146307');
    expect(migration).toContain('official_decision_count<>36');
  });

  it('rotates the historical review identity without rewriting prior migrations', () => {
    const migration = read(
      'prisma/afl-trade-outcomes/migrations/0081_corrected_local_review_lineage/migration.sql'
    );

    expect(LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256).toBe(
      '7ef741add1ae94133c597581f8a2175118058bedd2ffe8a107213630e1b0fd10'
    );
    expect(migration).toContain(LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256);
    expect(migration).toContain('aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb');
    expect(migration).toContain('pg_get_functiondef');
    expect(migration).toContain('outcome_private_reviewed_evidence_is_current()');
    expect(migration).toContain('validate_outcome_private_reviewed_evidence_bundle_insert()');
    expect(migration).toContain('outcome_private_reviewed_evidence_bundle_is_current_v1(text)');
    expect(migration).toContain('Admitted private review-set decisions are append-only');
  });

  it('admits one complete normalized seven-capture bundle without a transitional successor', () => {
    const migration = read(
      'prisma/afl-trade-outcomes/migrations/0082_complete_local_reviewed_evidence/migration.sql'
    );
    const loader = read(
      'src/server/aflTradeIntelligence/development/localReviewedProviderEvidence.ts'
    );

    expect(migration).toContain('pg_get_functiondef');
    expect(migration).toContain('outcome_private_reviewed_evidence_is_current()');
    expect(migration).toContain('validate_outcome_private_reviewed_evidence_bundle_insert()');
    expect(migration).toContain('outcome_private_reviewed_evidence_bundle_is_current_v1(text)');
    expect(migration).toContain('outcome_provider_normalization_run');
    expect(migration).toContain('run."finalized_at" IS NOT NULL');
    expect(migration).toContain('NEW."source_capture_count"=7');
    expect(migration).toContain('NEW."source_rights_count"=3');
    expect(migration).toContain('Private reviewed-evidence health has unexpected capture counts');
    expect(migration).toContain(
      'Private reviewed-evidence insert validation has unexpected counts'
    );
    expect(migration).toContain(
      'Private reviewed-evidence bundle currentness has unexpected counts'
    );
    expect(migration).toContain(
      'DROP TRIGGER "outcome_private_reviewed_evidence_results_successor_insert_guard"'
    );
    expect(loader).toContain('FROM outcome_provider_normalization_run run');
    expect(loader).toContain('run.finalized_at IS NOT NULL');
  });

  it('uses the exact bundle selected by the current reviewed-evaluation head', () => {
    const readiness = read(
      'src/server/aflTradeIntelligence/development/localAflTradeValuationReadiness.ts'
    );

    expect(readiness).toMatch(
      /outcome_private_reviewed_evidence_bundle_is_current\(\s*head\.evidence_bundle_id\s*\)/u
    );
    expect(readiness).not.toContain(
      'outcome_private_reviewed_evidence_is_current() AS evidence_current'
    );
  });

  it('admits workbook identity reviews only under the current authorized private bundle', () => {
    const reviewMigration = read(
      'prisma/afl-trade-outcomes/migrations/0056_local_workbook_player_identity_review/migration.sql'
    );
    const authorityMigration = read(
      'prisma/afl-trade-outcomes/migrations/0057_local_workbook_player_identity_authority/migration.sql'
    );

    expect(reviewMigration).toContain(
      'outcome_local_workbook_player_identity_review_mutation_guard'
    );
    expect(reviewMigration).toContain('Local workbook player identity reviews are append-only');
    expect(authorityMigration).toContain(
      'outcome_private_reviewed_evidence_bundle_is_current(NEW.evidence_bundle_id)'
    );
    expect(authorityMigration).toContain("head.status='authorized'");
    expect(authorityMigration).toContain(
      'afl-trade-private-reviewed-evidence-evaluation-decision/v1'
    );
    expect(authorityMigration).toContain(
      'exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
    );
    expect(authorityMigration).not.toContain("head.status='approved'");
  });

  it('re-authenticates the exact workbook identity bundle before calculating', () => {
    const calculationLoader = read(
      'src/server/aflTradeIntelligence/development/postgresLocalPrivateReviewedTradeCalculation.ts'
    );

    expect(calculationLoader).toMatch(
      /outcome_private_reviewed_evidence_bundle_is_current\(review\.evidence_bundle_id\)/u
    );
    expect(calculationLoader).toContain(
      "head.evidence_bundle_id=review.evidence_bundle_id"
    );
    expect(calculationLoader).toContain('head.valuation_scope_key=$4');
    expect(calculationLoader).toContain('`afl-men:${detail.trade.year}-trades`');
    expect(calculationLoader).toContain("head.status='authorized'");
    expect(calculationLoader).toContain(
      "decision.decision_json->'content'->'publicationProhibited'='true'::jsonb"
    );
  });
});
