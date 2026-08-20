import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath =
  'prisma/afl-trade-outcomes/migrations/0060_materialization_manifest_prepared_inputs/migration.sql';

function migration(): string {
  return readFileSync(join(process.cwd(), migrationPath), 'utf8');
}

describe('materialization-manifest prepared valuation input v3 migration', () => {
  it('adds v3 through a forward migration while retaining v1 and v2', () => {
    expect(existsSync(join(process.cwd(), migrationPath))).toBe(true);
    const sql = migration();

    expect(sql).toContain('afl-trade-prepared-valuation-input-set/v1');
    expect(sql).toContain('afl-trade-prepared-valuation-input-set/v2');
    expect(sql).toContain('afl-trade-prepared-valuation-input-set/v3');
    expect(sql).toContain('validate_outcome_prepared_valuation_input_set_v3_insert');
  });

  it('authenticates exact retained manifest bytes for each ready v3 trade', () => {
    const sql = migration();

    expect(sql).toContain('outcome_private_evaluation_materialization_manifest');
    expect(sql).toContain('materialization_manifest_id');
    expect(sql).toContain("NEW.\"entry_json\"->'materializationManifestArtifact'");
    expect(sql).toContain('validate_outcome_prepared_valuation_input_v2_artifact');
    expect(sql).toContain('Private evaluation materialization manifests are append-only');
    expect(sql).toContain('SELECT evidence.reference');
    expect(sql).toContain('AS evidence(reference)');
  });

  it('selects one current prepared set per valuation scope through a CAS head', () => {
    const sql = migration();

    expect(sql).toContain('outcome_current_prepared_valuation_input_set');
    expect(sql).toMatch(/PRIMARY KEY \("scope_key"\)/u);
    expect(sql).toContain('expected_revision');
    expect(sql).toContain('revision=revision+1');
    expect(sql).toContain('Prepared valuation input heads require compare-and-swap');
    expect(sql).toContain('target_is_finalized_v3');
    expect(sql.indexOf('target_is_finalized_v3')).toBeLessThan(
      sql.indexOf('SELECT revision INTO current_revision'),
    );
    expect(sql).toContain('outcome_private_evaluation_materialization_selector_idx');
  });
});
