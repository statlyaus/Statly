import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0068_durable_private_evaluation_execution/migration.sql'
  ),
  'utf8'
);

describe('durable private evaluation execution migration', () => {
  it('owns cycles, attempts, leases, heartbeats, fencing, exhaustion, and repair history', () => {
    expect(sql).toContain('outcome_private_evaluation_execution_cycle');
    expect(sql).toContain('outcome_private_evaluation_execution_work');
    expect(sql).toContain('outcome_private_evaluation_execution_attempt');
    expect(sql).toContain('claim_outcome_private_evaluation_work');
    expect(sql).toContain('heartbeat_outcome_private_evaluation_work');
    expect(sql).toContain('complete_outcome_private_evaluation_work');
    expect(sql).toContain('maximum_attempts"=3');
    expect(sql).toContain("'lease_expired'");
    expect(sql).toContain('lease_token_sha256');
    expect(sql).toContain('current_claim_id');
    expect(sql).toContain('repair_sequence');
  });

  it('reuses the existing unique prepared-set/trade index without duplicating it', () => {
    expect(sql).not.toContain('outcome_prepared_valuation_input_entry_targeted_lookup_idx');
  });
});
