import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0101_scoped_provider_reviewer_authority/migration.sql'
  ),
  'utf8'
);

describe('scoped provider reviewer authority migration', () => {
  it('admits bounded private scope keys without weakening identity-review authority', () => {
    expect(migration).toContain('length("scope_key") BETWEEN 1 AND 400');
    expect(migration).toContain('"scope_key" = btrim("scope_key")');
    expect(migration).toContain(`("role" = 'afl_trade_identity_reviewer'`);
    expect(migration).toContain("'afl_trade_canonical_promoter'");
    expect(migration).toContain("'afl_trade_external_identity_reviewer'");
    expect(migration).toContain("'afl_trade_model_run_operator'");
    expect(migration).toContain("'afl_trade_private_evaluation_operator'");
    expect(migration).toContain("\"competition\" IN ('AFLM','AFLW')");
    expect(migration).toContain('"valid_through_season" BETWEEN "valid_from_season" AND 2200');
    expect(migration).toContain('"scope_key" = \'public-afl-draft-trade-outcomes\'');
  });
});
