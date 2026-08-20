import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0059_authenticated_prepared_valuation_inputs/migration.sql'
  ),
  'utf8'
);

describe('authenticated prepared valuation input v2 migration', () => {
  it('extends 0048 through a forward version-specific migration', () => {
    expect(sql).toContain('afl-trade-prepared-valuation-input-set/v1');
    expect(sql).toContain('afl-trade-prepared-valuation-input-set/v2');
    expect(sql).toMatch(/WHEN \(NEW\."schema_version"='afl-trade-prepared-valuation-input-set\/v1'\)/);
    expect(sql).toContain('validate_outcome_prepared_valuation_input_set_v2_insert');
  });

  it('admits exact ready and blocked classifications only for v2', () => {
    expect(sql).toMatch(/"state" IN \('ready','blocked'\)/);
    expect(sql).toContain('"trade_count" = "ready_count" + "blocked_count"');
    expect(sql).toContain("content->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids");
    expect(sql).toContain('authenticated_calculation_evidence_snapshot');
  });

  it('authenticates every retained v2 artifact against immutable custody', () => {
    expect(sql).toContain('validate_outcome_prepared_valuation_input_v2_artifact');
    expect(sql).toContain("content->'valuationInputBundleArtifact'");
    expect(sql).toContain("NEW.\"entry_json\"->'calculationInputArtifact'");
    expect(sql).toContain("NEW.\"entry_json\"->'inputTraceArtifact'");
    expect(sql).toContain("blocker->'evidenceRefs'");
    expect(sql).toContain('outcome_artifact_custody');
  });
});
