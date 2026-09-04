import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0094_scoped_aflca_match_mapping_authority/migration.sql'
  ),
  'utf8'
);
const staging = readFileSync(
  resolve(
    process.cwd(),
    'src/server/aflTradeIntelligence/development/localScopedAflcaCoachesVotesStaging.ts'
  ),
  'utf8'
);

describe('scoped AFLCA match-mapping migration', () => {
  it('authenticates immutable product-owner reviews and exact paired downstream references', () => {
    expect(migration).toContain('NEW."subject_type"=\'local_scoped_aflca_match_mapping\'');
    expect(migration).toContain('NEW."decided_by"<>\'statly-product-owner\'');
    expect(migration).toContain('NEW."evidence_json"->\'source\'=NEW."evidence_json"->\'target\'');
    expect(migration).toContain('"outcome_afl_trade_canonical_json"(NEW."evidence_json"),\'UTF8\'');
    expect(migration).toContain('Scoped AFLCA match mapping references must be paired');
    expect(migration).toContain('Scoped AFLCA match decision lacks its exact approved mapping');
    expect(migration).toContain('Scoped AFLCA match mapping reviews are append-only');
  });

  it('reloads an idempotent match review and compares its complete retained content', () => {
    expect(staging).toContain('A retained scoped AFLCA match mapping differs from its review.');
    expect(staging).toContain('canonicalizeAflTradeJson(row.evidence_json) !== evidenceJson');
    expect(staging).toContain('row.rationale !== mapping.reviewContent.rationale');
  });
});
