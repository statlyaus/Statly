// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath =
  'prisma/afl-trade-outcomes/migrations/0064_automated_model_pair_qualification/migration.sql';

describe('automated model-pair qualification migration', () => {
  it('adds immutable qualification history and one atomic current pair with immediate work', () => {
    expect(existsSync(join(process.cwd(), migrationPath))).toBe(true);
    const sql = readFileSync(join(process.cwd(), migrationPath), 'utf8');

    expect(sql).toContain('CREATE TABLE "outcome_governed_valuation_model_qualification"');
    expect(sql).toContain('CREATE TABLE "outcome_current_governed_valuation_model_pair"');
    expect(sql).toContain('CREATE TABLE "outcome_governed_model_qualification_work"');
    expect(sql).toContain('Governed valuation model qualifications are append-only');
    expect(sql).toContain('Current governed valuation model pairs require a passing qualification');
    expect(sql).toContain('"player_gate3_decision_id"');
    expect(sql).toContain('"pick_gate3_decision_id"');
    expect(sql).toContain('"qualification_id"');
    expect(sql).toContain('expected_revision INTEGER');
  });

  it('allows successor pending records and limits automated Gate authority to non-production Gate 3', () => {
    const sql = readFileSync(join(process.cwd(), migrationPath), 'utf8');

    expect(sql).toContain("'governed-valuation-component-run/v2'");
    expect(sql).toContain("'afl-trade-pick-pav-model-execution/v3'");
    expect(sql).toContain("'automated_qualification_pending'");
    expect(sql).toContain("'automated_validation_record'");
    expect(sql).toContain("'gate_3_model_validity'");
    expect(sql).toContain("'non_production'");
    expect(sql).toContain('validate_outcome_prepared_valuation_input_v2_artifact');
    expect(sql).toContain('outcome_automated_gate_pair_commit_guard');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain('outcome_automated_gate_qualification_run_unique');
    expect(sql).toContain('validate_outcome_governed_model_qualification_work');
    expect(sql).toContain('Governed model qualification work evidence is immutable');
  });
});
