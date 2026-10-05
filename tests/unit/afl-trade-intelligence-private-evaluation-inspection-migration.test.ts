import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath =
  'prisma/afl-trade-outcomes/migrations/0070_private_evaluation_inspection_receipts/migration.sql';

describe('private evaluation inspection receipt migration', () => {
  it('retains authenticated authority snapshots and inspection receipts append-only', () => {
    const migration = readFileSync(join(process.cwd(), migrationPath), 'utf8');

    expect(migration).toContain('outcome_private_evaluation_authority_snapshot');
    expect(migration).toContain('outcome_private_evaluation_inspection_receipt');
    expect(migration).toContain('private-evaluation-authority-snapshot:');
    expect(migration).toContain('private-evaluation-inspection:');
    expect(migration).toContain("'private-evaluation-authority-snapshot/v1'");
    expect(migration).toContain("'private-evaluation-inspection/v1'");
    expect(migration).toContain('publication_prohibited');
    expect(migration).toContain('expected_head_revision');
    expect(migration).toContain('blocker_fingerprint');
    expect(migration).toContain('Inspection receipts are append-only');
    expect(migration).toContain('Authority snapshots are append-only');
    expect(migration).not.toContain('ON DELETE CASCADE');
  });

  it('keeps Prisma schema ownership aligned with the PostgreSQL receipt tables', () => {
    const schema = readFileSync(
      join(process.cwd(), 'prisma/afl-trade-outcomes/schema.prisma'),
      'utf8'
    );

    expect(schema).toContain('model OutcomePrivateEvaluationAuthoritySnapshot');
    expect(schema).toContain('@@map("outcome_private_evaluation_authority_snapshot")');
    expect(schema).toContain('model OutcomePrivateEvaluationInspectionReceipt');
    expect(schema).toContain('@@map("outcome_private_evaluation_inspection_receipt")');
  });
});
