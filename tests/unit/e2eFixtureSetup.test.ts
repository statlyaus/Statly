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

  it('uses canonical player ids and ranks only the full-draft fixture pool', () => {
    const source = read('tests/e2e/helpers/fullDraftSoakFixture.ts');

    expect(source).toContain('buildCanonicalPlayerId(player.name)');
    expect(source).toContain('const candidateIds = await upsertActivePlayerPool(tx)');
    expect(source).toContain('where: { active: true, id: { in: candidateIds } }');
    expect(source).not.toContain('where: { active: true },');
  });

  it('disables performance analytics beacons during Playwright runs', () => {
    const playwrightConfig = read('playwright.config.ts');
    const performanceMonitor = read('src/components/PerformanceMonitor.tsx');

    expect(playwrightConfig).toContain('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS=true');
    expect(performanceMonitor).toContain('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS');
  });
});
