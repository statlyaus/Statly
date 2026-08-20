// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath =
  'prisma/afl-trade-outcomes/migrations/0061_governed_valuation_component_runs/migration.sql';

function migration(): string {
  return readFileSync(join(process.cwd(), migrationPath), 'utf8');
}

describe('governed valuation component-run migration', () => {
  it('adds one forward append-only component-run registry', () => {
    expect(existsSync(join(process.cwd(), migrationPath))).toBe(true);
    const sql = migration();

    expect(sql).toContain('CREATE TABLE "outcome_governed_valuation_component_run"');
    expect(sql).toContain('"run_id" TEXT NOT NULL');
    expect(sql).toContain('"native_execution_kind" TEXT NOT NULL');
    expect(sql).toContain('"native_execution_id" TEXT NOT NULL');
    expect(sql).toContain('"artifact_id" TEXT NOT NULL');
    expect(sql).toContain('"manifest_json" JSONB NOT NULL');
    expect(sql).toContain('REFERENCES "outcome_artifact_custody"("artifact_id")');
    expect(sql).toContain('Governed valuation component runs are append-only');
  });

  it('enforces role-specific native execution identities and immutable ancestry', () => {
    const sql = migration();

    expect(sql).toContain("'player_contribution_and_availability'");
    expect(sql).toContain("'draft_pick_and_future_pick_distribution'");
    expect(sql).toContain("'admitted_player_model_run'");
    expect(sql).toContain("'pick_pav_model_execution'");
    expect(sql).toContain("'^model-run:[a-f0-9]{64}$'");
    expect(sql).toContain("'^pick-pav-model-execution:[a-f0-9]{64}$'");
    expect(sql).toContain('UNIQUE ("native_execution_kind", "native_execution_id")');
    expect(sql).toContain('"dataset_admission_gate_ledger_revision" INTEGER NOT NULL');
    expect(sql).toContain('"content_canonical_json" TEXT NOT NULL');
  });
});
