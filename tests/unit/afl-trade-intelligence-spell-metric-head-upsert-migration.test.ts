import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0099_spell_metric_head_upsert/migration.sql'
  ),
  'utf8'
);

describe('spell-metric head upsert migration', () => {
  it('distinguishes an initial insert from the insert phase of a current-head upsert', () => {
    expect(migration).toContain('FROM "outcome_acquisition_spell_metric_head"');
    expect(migration).toContain('current_head."revision"<>version_row."expected_head_revision"');
    expect(migration).toContain('NEW."revision"<>current_head."revision"+1');
    expect(migration).toContain('NEW."updated_at"<current_head."updated_at"');
    expect(migration).toContain('version_row."expected_head_revision"<>0 OR NEW."revision"<>1');
  });
});
