import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Sentry browser initialization', () => {
  it('does not run browser SDK initialization during SSR module evaluation', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/sentry-init.ts'), 'utf8');
    const browserGuardIndex = source.indexOf("if (typeof window !== 'undefined')");
    const initIndex = source.indexOf('Sentry.init({');

    expect(browserGuardIndex).toBeGreaterThanOrEqual(0);
    expect(initIndex).toBeGreaterThan(browserGuardIndex);
  });
});
