import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
    expect(migration).toContain("decision.\"decided_by\" IN (");
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

  it('uses bundle-scoped currentness when recording additional private valuation scopes', () => {
    const migration = read(
      'prisma/afl-trade-outcomes/migrations/0062_private_reviewed_decision_compact_currentness/migration.sql'
    );

    expect(migration).toContain(
      'outcome_private_reviewed_evidence_bundle_is_current(NEW.evidence_bundle_id)'
    );
    expect(migration).not.toContain('outcome_private_reviewed_evidence_is_current');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "validate_outcome_private_reviewed_evaluation_decision_insert"'
    );
  });

  it('refreshes stale bundles only after the official review is bound to the canonical player', () => {
    const officialCurrentness = read(
      'prisma/afl-trade-outcomes/migrations/0065_official_review_canonical_player_currentness/migration.sql'
    );
    const bundleRefresh = read(
      'prisma/afl-trade-outcomes/migrations/0066_reviewed_evidence_bundle_refresh/migration.sql'
    );
    const identityVersions = read(
      'prisma/afl-trade-outcomes/migrations/0067_workbook_identity_review_bundle_versions/migration.sql'
    );
    const freshInstallCurrentness = read(
      'prisma/afl-trade-outcomes/migrations/0068_official_review_fresh_install_currentness/migration.sql'
    );

    expect(officialCurrentness).toContain('local-official-afl-review:v2:set:');
    expect(officialCurrentness).toContain("decision.canonical_record_type='local_canonical_player_club'");
    expect(bundleRefresh).toContain(
      'outcome_private_reviewed_evidence_bundle_is_current(predecessor.evidence_bundle_id)'
    );
    expect(bundleRefresh).toContain('predecessor.evidence_bundle_id<>NEW.evidence_bundle_id');
    expect(identityVersions).toContain(
      'UNIQUE ("workbook_sha256","asset_id","evidence_bundle_id")'
    );
    expect(freshInstallCurrentness).toContain('retire-weak-official-identity:');
    expect(freshInstallCurrentness).toContain('marker.supersedes_decision_id IS NULL');
    expect(freshInstallCurrentness).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM outcome_review_decision predecessor/u
    );
  });

  it('uses the exact bundle selected by the current reviewed-evaluation head', () => {
    const readiness = read(
      'src/server/aflTradeIntelligence/development/localAflTradeValuationReadiness.ts'
    );
    const workbookIdentityReview = read(
      'Scripts/dev/review-local-workbook-player-identities.ts'
    );

    expect(readiness).toMatch(
      /outcome_private_reviewed_evidence_bundle_is_current\(\s*head\.evidence_bundle_id\s*\)/u
    );
    expect(readiness).not.toContain(
      'outcome_private_reviewed_evidence_is_current() AS evidence_current'
    );
    expect(workbookIdentityReview).toContain(
      "head.valuation_scope_key='afl-men:2025-trades'"
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
    expect(calculationLoader).toContain("head.status='authorized'");
    expect(calculationLoader).toContain(
      "decision.decision_json->'content'->'publicationProhibited'='true'::jsonb"
    );
    expect(calculationLoader).toContain(
      'A traded pick asset is not the selected player\'s later draft-acquisition asset.'
    );
    expect(calculationLoader).not.toContain("category: 'national_draft' as const");
  });

  it('persists pick-selection confirmation only under the exact current private evidence bundle', () => {
    const migration = read(
      'prisma/afl-trade-outcomes/migrations/0058_local_workbook_pick_selection_confirmation/migration.sql'
    );

    expect(migration).toContain('outcome_local_workbook_pick_selection_confirmation');
    expect(migration).toContain('Local workbook pick-selection confirmations are append-only');
    expect(migration).toContain(
      'outcome_private_reviewed_evidence_bundle_is_current(NEW.evidence_bundle_id)'
    );
    expect(migration).toContain("head.status='authorized'");
    expect(migration).toContain('head.valuation_scope_key=NEW.valuation_scope_key');
    expect(migration).toContain("content->>'valuationScopeKey'");
    expect(migration).toContain("content->>'tradeYear'");
    expect(migration).toContain("content->>'draftYear'");
    expect(migration).toContain("content->>'numericalAuthority'<>'none'");
    expect(migration).toContain('identityDecisionIds');
    expect(migration).toContain('reviewedSeasonIds');
  });

  it('binds promoted player assets directly to their exact current transaction decision', () => {
    for (const path of [
      'prisma/afl-trade-outcomes/migrations/0059_private_workbook_transaction_promotion/migration.sql',
      'prisma/afl-trade-outcomes/migrations/0063_private_workbook_promotion_review_set_guard/migration.sql',
    ]) {
      const migration = read(path);

      expect(migration).toContain(
        'private_decision.decision_id=asset.private_workbook_transaction_decision_id'
      );
      expect(migration).toContain('private_decision.decision_id=NEW.decision_id');
      expect(migration).toContain('private_decision.review_set_id=NEW.review_set_id');
      expect(migration).toContain('current_head.decision_id=private_decision.decision_id');
      expect(migration).toContain("reviewed_asset->>'assetId'=asset.asset_key");
      expect(migration).toContain("reviewed_asset->>'canonicalPlayerId'=asset.player_id");
      expect(migration).toContain(
        "((asset.kind='player')<>(private_decision.decision_id IS NOT NULL))"
      );
    }

    const initialMigration = read(
      'prisma/afl-trade-outcomes/migrations/0059_private_workbook_transaction_promotion/migration.sql'
    );
    expect(initialMigration).toContain('private_workbook_transaction_decision_id');
    expect(initialMigration).toContain(
      'outcome_event_asset_private_workbook_transaction_decision_fkey'
    );
    expect(initialMigration).toMatch(
      /num_nonnulls\([\s\S]*"player_identity_id",[\s\S]*"external_identity_decision_id",[\s\S]*"private_workbook_transaction_decision_id"[\s\S]*\) = 1/u
    );
    expect(initialMigration).toContain(
      "content->>'schemaVersion'='afl-trade-workbook-transaction-review-decision/v2'"
    );
    expect(initialMigration).toContain(
      "content->>'authority'<>'private_workbook_canonical_transaction_review'"
    );
    expect(initialMigration).toContain("reviewed_asset->>'receivingClubId'");
  });
});
