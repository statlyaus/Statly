import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repositoryRoot = process.cwd();
const tsxCli = require.resolve('tsx/cli');

describe('League Social standalone server imports', () => {
  it('loads socket and worker social dependencies outside Next.js', () => {
    const result = spawnSync(
      process.execPath,
      [
        tsxCli,
        '-r',
        'dotenv/config',
        '-e',
        "Promise.all([import('./src/server/leagues/social/socialPublisher.ts'), import('./src/server/leagues/social/socialSystemEvents.ts')])",
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ?? 'statly-test',
        },
        timeout: 15_000,
      }
    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(0);
  });
});
