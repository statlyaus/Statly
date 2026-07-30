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
    expect(source).toContain('upsertCanonicalPlayer(tx');
  });

  it('uses canonical player ids and ranks only the full-draft fixture pool', () => {
    const source = read('tests/e2e/helpers/fullDraftSoakFixture.ts');

    expect(source).toContain('buildCanonicalPlayerId(`${player.name}|${club}`)');
    expect(source).toContain('provider: PLAYER_STATS_2025_PROVIDER');
    expect(source).toContain('const candidateIds = await upsertActivePlayerPool(prisma)');
    expect(source.indexOf('upsertActivePlayerPool(prisma)')).toBeLessThan(
      source.indexOf('prisma.$transaction')
    );
    expect(source).toContain('where: { active: true, id: { in: candidateIds } }');
    expect(source).not.toContain('where: { active: true },');
  });

  it('keeps performance beacons off in ordinary development and enables them for tracing', () => {
    const playwrightConfig = read('playwright.config.ts');
    const performanceMonitor = read('src/components/PerformanceMonitor.tsx');
    const packageJson = read('package.json');

    expect(playwrightConfig).toContain('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS=true');
    expect(performanceMonitor).toContain('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS');
    expect(performanceMonitor).toContain("process.env.NODE_ENV === 'production'");
    expect(performanceMonitor).toContain(
      "NEXT_PUBLIC_ENABLE_DEVELOPMENT_PERFORMANCE_ANALYTICS === 'true'"
    );
    expect(packageJson).toContain(
      'NEXT_PUBLIC_ENABLE_DEVELOPMENT_PERFORMANCE_ANALYTICS=true next dev'
    );
  });
});
