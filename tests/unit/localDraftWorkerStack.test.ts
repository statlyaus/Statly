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
    };
    const fullStackScript = readRepoFile('Scripts/dev/full-local-stack.sh');

    expect(packageJson.scripts['draft-worker:dev']).toContain(
      './src/server/workers/enhancedDraftWorker.ts'
    );
    expect(packageJson.scripts['worker:dev']).not.toContain('webVitalsWorker');
    expect(fullStackScript).toContain('npm:draft-worker:dev');
    expect(fullStackScript).toContain('export NEXT_PUBLIC_SOCKET_URL="http://localhost:3002"');
    expect(fullStackScript).toContain('export SOCKETIO_PORT="3002"');
  });
});
