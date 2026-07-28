import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('local full stack draft worker wiring', () => {
  it('runs the draft queue worker so live pick deadlines can auto-pick', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const fullStackScript = readRepoFile('Scripts/dev/full-local-stack.sh');

    expect(packageJson.scripts['draft-worker:dev']).toContain(
      './src/server/workers/enhancedDraftWorker.ts'
    );
    expect(packageJson.scripts['worker:dev']).not.toContain('webVitalsWorker');
    expect(packageJson.scripts['worker:build']).toBe('tsc -p tsconfig.worker.json');
    expect(packageJson.scripts['worker:start']).toBe(
      'tsx ./src/server/workers/enhancedDraftWorker.ts'
    );
    expect(packageJson.scripts['draft-worker:start']).toBe(
      'tsx ./src/server/workers/enhancedDraftWorker.ts'
    );
    expect(packageJson.scripts['web-vitals-worker:start']).toBe(
      'tsx ./src/server/workers/webVitalsWorker.ts'
    );
    expect(packageJson.dependencies).toHaveProperty('tsx');
    expect(packageJson.devDependencies).not.toHaveProperty('tsx');
    expect(fullStackScript).toContain('npm:draft-worker:dev');
    expect(fullStackScript).toContain('export NEXT_PUBLIC_SOCKET_URL="http://localhost:3002"');
    expect(fullStackScript).toContain('export SOCKETIO_PORT="3002"');
  });

  it('type-checks both production worker entrypoints without emitting incompatible output', () => {
    const workerConfig = JSON.parse(readRepoFile('tsconfig.worker.json')) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };

    expect(workerConfig.compilerOptions.noEmit).toBe(true);
    expect(workerConfig.compilerOptions.module).toBe('ESNext');
    expect(workerConfig.include).toContain('src/server/workers/enhancedDraftWorker.ts');
    expect(workerConfig.include).toContain('src/server/workers/webVitalsWorker.ts');

    for (const workerPath of [
      'src/server/workers/enhancedDraftWorker.ts',
      'src/server/workers/webVitalsWorker.ts',
    ]) {
      expect(readRepoFile(workerPath)).toContain('ScalableRedisConnection.shutdownInstance()');
    }
  });
});
