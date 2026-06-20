import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('player data convergence temp DB runner script architecture', () => {
  it('uses the temp DB runner and does not hard-code protected local state', () => {
    const source = readFileSync('Scripts/player-data-convergence-temp-db-runner.ts', 'utf8');

    expect(source).toContain('runPlayerDataConvergenceTempDbPreview');
    expect(source).toContain('process.env.STATLY_VERIFY_DB');
    expect(source).toContain('process.env.DATABASE_URL');
    expect(source).not.toMatch(/prisma\/dev\.db|serviceAccountKey|firebase-admin|Firestore/);
  });

  it('keeps product writes outside the package-script runner name', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['player-data:temp-db-runner']).toBe(
      'tsx Scripts/player-data-convergence-temp-db-runner.ts'
    );
    expect(packageJson.scripts['player-data:temp-db-runner']).not.toMatch(
      /migrate|seed|firebase|dev\.db/
    );
  });
});
