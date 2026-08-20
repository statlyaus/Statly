import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migrationPath =
  'prisma/afl-trade-outcomes/migrations/0062_authenticated_prepared_v3_ancestry/migration.sql';

describe('authenticated prepared valuation input v3 ancestry migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('hardens v3 through a new forward migration', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "validate_outcome_prepared_valuation_input_set_v3_insert"'
    );
    expect(sql).not.toContain('ALTER TABLE');
    expect(sql).not.toContain('DROP TABLE');
  });

  it('authenticates relational identity and exact factual ancestry', () => {
    expect(sql).toContain('FROM "outcome_release_manifest"');
    expect(sql).toContain('FROM "outcome_valuation_source_qualification_report"');
    expect(sql.match(/FOR KEY SHARE/g)?.length).toBeGreaterThanOrEqual(2);
    for (const field of [
      "content->>'schemaVersion' IS DISTINCT FROM NEW.\"schema_version\"",
      "content->>'environment' IS DISTINCT FROM NEW.\"environment\"::text",
      "content->>'scopeKey' IS DISTINCT FROM NEW.\"scope_key\"",
      "content->>'factualReleaseScopeKey' IS DISTINCT FROM NEW.\"factual_release_scope_key\"",
      "content->>'factualReleaseId' IS DISTINCT FROM NEW.\"factual_release_id\"",
      "content->>'qualificationReportId' IS DISTINCT FROM NEW.\"qualification_report_id\"",
      "content->>'preparedAt'",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("'eligible_for_dataset_admission'");
    expect(sql).toContain("content->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids");
  });

  it('verifies retained parent bytes and temporal custody', () => {
    expect(sql).toContain("content->'factualReleaseArtifact'->>'contentSha256'");
    expect(sql).toContain("content->'releaseMembershipArtifact'->>'contentSha256'");
    expect(sql).toContain("content->'qualificationReportArtifact'->>'contentSha256'");
    expect(sql).toContain(
      '"validate_outcome_prepared_valuation_input_v2_artifact"(\n       content->\'valuationInputBundleArtifact\''
    );
    expect(sql).toContain(
      "(content->'valuationInputBundleArtifact'->>'createdAt')::timestamptz>NEW.\"prepared_at\""
    );
    expect(sql).toContain('EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range');
  });
});
