import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0094_local_genuine_external_identity_authority/migration.sql'
  ),
  'utf8'
);

describe('local genuine external identity authority migration', () => {
  it('keeps the historical review guard and admits only the exact private local variant', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "require_outcome_external_identity_typed_decision"()'
    );
    expect(migration).toContain("NEW.subject_type <> 'external_provider_identity'");
    expect(migration).toContain(
      "NEW.evidence_json->>'boundary' = 'local-genuine-player-cross-source-identity/v2'"
    );
    expect(migration).toContain("NEW.evidence_json->>'environment' <> 'non_production'");
    expect(migration).toContain("NEW.evidence_json->>'provider' <> 'draftguru'");
    expect(migration).toContain("NEW.decided_by <> 'statly-product-owner'");
    expect(migration).toContain(
      "NEW.canonical_record_id IS DISTINCT FROM NEW.evidence_json->>'canonicalId'"
    );
    expect(migration).toContain("NEW.evidence_json#>>'{corroboration,provider}' <> 'afl_tables'");
    expect(migration).toContain("NEW.evidence_json#>>'{corroboration,nativeId}' IS NULL");
    expect(migration).toContain("NEW.evidence_json#>>'{corroboration,receivingClub}' IS NULL");
    expect(migration).toContain("NEW.evidence_json#>>'{corroboration,receivingSeason}' IS NULL");
    expect(migration).toContain('FROM outcome_external_identity_review_decision typed');
  });
});
