import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('e2e fixture setup', () => {
  it('does not delete shared player records during global setup', () => {
    const source = read('tests/e2e/global.setup.ts');

    expect(source).not.toContain('player.deleteMany');
    expect(source).toContain('tx.player.upsert');
  });

  it('disables performance analytics beacons during Playwright runs', () => {
    const playwrightConfig = read('playwright.config.ts');
    const performanceMonitor = read('src/components/PerformanceMonitor.tsx');

    expect(playwrightConfig).toContain('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS=true');
    expect(performanceMonitor).toContain('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS');
  });
});
