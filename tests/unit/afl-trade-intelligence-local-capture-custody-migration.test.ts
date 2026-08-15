import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('local non-production capture custody migration', () => {
  it('admits profileless local capture custody only in non-production', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'prisma',
        'afl-trade-outcomes',
        'migrations',
        '0046_local_nonproduction_capture_custody',
        'migration.sql'
      ),
      'utf8'
    );

    expect(migration).toContain('DROP CONSTRAINT "outcome_artifact_profile_environment_check"');
    expect(migration).toContain('local_non_production_filesystem');
    expect(migration).toContain('"environment" = \'non_production\'');
    expect(migration).toContain('"custody_profile_id" IS NULL');
    expect(migration).toContain('"environment" = \'production\'');
    expect(migration).toContain('"custody_profile_id" IS NOT NULL');
    expect(migration).not.toMatch(
      /"environment" = 'production'[^;]+"custody_profile_id" IS NULL/is
    );
  });
});
