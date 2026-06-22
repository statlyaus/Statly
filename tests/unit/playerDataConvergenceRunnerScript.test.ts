import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('player data convergence runner script architecture', () => {
  it('orchestrates the approved temp DB stages without hard-coding protected state', () => {
    const source = readFileSync('Scripts/player-data-convergence-runner.ts', 'utf8');

    expect(source).toContain('buildPlayerDataConvergenceTrackedDryRunReport');
    expect(source).toContain('runPlayerDataConvergenceTempDbPreview');
    expect(source).toContain('runPlayerDataConvergenceTempDbApplySimulation');
    expect(source).toContain('summarizePlayerDataConvergenceRunner');
    expect(source).toContain('process.env.STATLY_VERIFY_DB');
    expect(source).toContain('process.env.DATABASE_URL');
    expect(source).toContain('datasources');
    expect(source).not.toMatch(/prisma\/dev\.db|serviceAccountKey|firebase-admin|Firestore/);
  });

  it('exposes a runner package script without migration, seed, firebase, or apply flags', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['player-data:runner']).toBe(
      'tsx Scripts/player-data-convergence-runner.ts'
    );
    expect(packageJson.scripts['player-data:runner']).not.toMatch(
      /--apply|migrate|seed|firebase|dev\.db/
    );
  });
});
