import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0102_admitted_player_factual_output/migration.sql'
  ),
  'utf8'
);

describe('admitted-player factual output migration', () => {
  it('retains an exact multi-capture dataset-bound output without fabricating a factual run', () => {
    expect(migration).toContain('afl-trade-private-valuation-factual-output/v2');
    expect(migration).toContain('player_dataset_id');
    expect(migration).toContain('player_dataset_admission_id');
    expect(migration).toContain("NEW.\"output_json\"->'content'->'sourceCaptures'");
    expect(migration).toContain('outcome_valuation_dataset_admission');
    expect(migration).toContain('outcome_release_spell_metric_member');
    expect(migration).toContain('outcome_record_state_commitment');
    expect(migration).toContain('outcome_active_release');
    expect(migration).toContain(`state_row."state" IS DISTINCT FROM 'approved'`);
    expect(migration).toContain(`active_row."activated_at" IS NOT NULL`);
    expect(migration).toContain(`NEW."factual_run_id" IS NOT NULL`);
  });

  it('keeps the legacy single-run output validator and live-claim retention fence', () => {
    expect(migration).toContain('afl-trade-private-valuation-factual-output/v1');
    expect(migration).toContain(
      'Private valuation factual output lost its live dispatch claim fence'
    );
    expect(migration).toContain(`OR NEW."source_admission_id" IS NOT NULL`);
    expect(migration).toContain('expected_output_id');
  });
});
