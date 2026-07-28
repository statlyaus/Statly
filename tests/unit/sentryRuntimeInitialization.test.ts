import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Sentry runtime initialization', () => {
  it('keeps Node-only dependencies out of the Edge instrumentation bundle', () => {
    const instrumentation = read('src/instrumentation.ts');

    expect(instrumentation).toContain("process.env.NEXT_RUNTIME === 'nodejs'");
    expect(instrumentation).toContain("import('./sentry.server.config')");
    expect(instrumentation).toContain("process.env.NEXT_RUNTIME === 'edge'");
    expect(instrumentation).toContain("import('./sentry.edge.config')");
    expect(instrumentation).toContain('Sentry.captureRequestError');
    expect(instrumentation).not.toContain("import('@sentry/node')");
  });

  it.each(['src/sentry.server.config.ts', 'src/sentry.edge.config.ts'])(
    'initializes %s through the runtime-aware Next SDK',
    (path) => {
      const source = read(path);

      expect(source).toContain("import * as Sentry from '@sentry/nextjs'");
      expect(source).toContain('Sentry.init({');
      expect(source).toContain("process.env.SENTRY_DISABLED !== 'true'");
      expect(source).not.toContain("from '@sentry/node'");
    }
  );
});
