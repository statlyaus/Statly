import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0073_private_evaluation_generation_v3_lifecycle/migration.sql'
  ),
  'utf8'
);

describe('private evaluation v3 lifecycle migration', () => {
  it('admits v3 without removing v1 or v2 generation compatibility', () => {
    expect(migration).toContain('local-private-trade-evaluation-generation/v1');
    expect(migration).toContain('local-private-trade-evaluation-generation/v2');
    expect(migration).toContain('local-private-trade-evaluation-generation/v3');
    expect(migration).toContain("content->'authorityReview'->>'authoritySnapshotId'");
    expect(migration).toContain("content->>'derivationFingerprint'");
  });

  it('retains append-only content-addressed intents and receipts', () => {
    expect(migration).toContain('CREATE TABLE "outcome_private_evaluation_transition_intent"');
    expect(migration).toContain('CREATE TABLE "outcome_private_evaluation_transition_receipt"');
    expect(migration).toContain('private-evaluation-transition-intent:');
    expect(migration).toContain('private-evaluation-transition-receipt:');
    expect(migration).toContain('Transition intents are append-only');
    expect(migration).toContain('Transition receipts are append-only');
  });

  it('requires a current v3 head to resolve the exact activating receipt', () => {
    expect(migration).toContain('ADD COLUMN "transition_receipt_id" TEXT NULL');
    expect(migration).toContain('outcome_local_private_trade_evaluation_head_receipt_fkey');
    expect(migration).toContain('Private evaluation v3 head requires its exact transition receipt');
  });
});
