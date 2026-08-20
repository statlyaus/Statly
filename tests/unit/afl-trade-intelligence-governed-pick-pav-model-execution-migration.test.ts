// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath =
  'prisma/afl-trade-outcomes/migrations/0063_governed_pick_pav_model_execution/migration.sql';

describe('governed pick-PAV model execution migration', () => {
  it('adds append-only non-production execution custody without changing fixture evidence', () => {
    expect(existsSync(join(process.cwd(), migrationPath))).toBe(true);
    const sql = readFileSync(join(process.cwd(), migrationPath), 'utf8');

    expect(sql).toContain('CREATE TABLE "outcome_governed_pick_pav_model_execution"');
    expect(sql).toContain('"dataset_admission_id" TEXT NOT NULL');
    expect(sql).toContain('"dataset_admission_gate_ledger_revision" INTEGER NOT NULL');
    expect(sql).toContain('"protocol_id" TEXT NOT NULL');
    expect(sql).toContain('"execution_artifact_id" TEXT NOT NULL');
    expect(sql).toContain('REFERENCES "outcome_valuation_dataset_admission"("admission_id")');
    expect(sql).toContain('REFERENCES "outcome_valuation_model_protocol"("protocol_id")');
    expect(sql).toContain('REFERENCES "outcome_artifact_custody"("artifact_id")');
    expect(sql).toContain('outcome_afl_trade_canonical_json(dataset_row."dataset_json")');
    expect(sql).toContain('outcome_afl_trade_canonical_json(admission_row."admission_json")');
    expect(sql).toContain('outcome_afl_trade_canonical_json(protocol_row."protocol_json")');
    expect(sql).toContain('Governed pick-PAV model executions are append-only');
    expect(sql).toContain("'afl-trade-pick-pav-model-execution/v2'");
    expect(sql).toContain("'gate_3_review_required'");
  });

  it('introduces a native kind that cannot be confused with the legacy fixture execution', () => {
    const sql = readFileSync(join(process.cwd(), migrationPath), 'utf8');

    expect(sql).toContain("'governed_pick_pav_model_execution'");
    expect(sql).toContain("'pick_pav_model_execution'");
    expect(sql).toContain('DROP CONSTRAINT "outcome_governed_valuation_component_run_role_check"');
    expect(sql).toContain('ADD CONSTRAINT "outcome_governed_valuation_component_run_role_check"');
  });
});
