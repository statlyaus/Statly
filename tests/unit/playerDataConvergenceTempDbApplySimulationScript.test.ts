import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('player data convergence temp DB apply simulation script architecture', () => {
  it('uses the temp DB apply simulation runner and does not hard-code protected local state', () => {
    const source = readFileSync(
      'Scripts/player-data-convergence-temp-db-apply-simulation.ts',
      'utf8'
    );

    expect(source).toContain('runPlayerDataConvergenceTempDbApplySimulation');
    expect(source).toContain('process.env.STATLY_VERIFY_DB');
    expect(source).toContain('process.env.DATABASE_URL');
    expect(source).toContain('datasources');
    expect(source).not.toMatch(/prisma\/dev\.db|serviceAccountKey|firebase-admin|Firestore/);
  });

  it('exposes a temp DB apply simulation package script without setup or product writes', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['player-data:temp-db-apply-simulation']).toBe(
      'tsx Scripts/player-data-convergence-temp-db-apply-simulation.ts'
    );
    expect(packageJson.scripts['player-data:temp-db-apply-simulation']).not.toMatch(
      /migrate|seed|firebase|dev\.db/
    );
  });
});
