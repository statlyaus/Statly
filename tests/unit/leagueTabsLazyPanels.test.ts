import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/components/league/LeagueTabs.tsx'), 'utf8');

describe('LeagueTabs deferred panel architecture', () => {
  it('keeps overview immediate and loads feature-owned panels through dynamic boundaries', () => {
    expect(source).toContain("import('./MyTeamRosterManager')");
    expect(source).toContain("import('./LeagueSettingsPanels')");
    expect(source).toContain("import('./matchups/LeagueMatchupsPanel')");
    expect(source).toContain("import('./matchups/LeagueLineupPanel')");
    expect(source).toContain("import('./matchups/LeagueStandingsPanel')");
    expect(source).toContain("import('./trades/LeagueTradeCentrePanel')");
    expect(source).toContain("import('@/components/waivers/LeagueWaiversContainer')");
    expect(source).toContain("import('./DraftManager')");
    expect(source).toContain("activeTab === 'overview'");
    expect(source).not.toMatch(/import\s+DraftManager\s+from/);
    expect(source).not.toMatch(/import\s+LeagueWaiversContainer\s+from/);
    expect(source).not.toContain('ssr: false');
    expect(source).toMatch(/dynamic\(\s*\(\) => import\('\.\/DraftManager'\)/);
    expect(source).toMatch(/dynamic\(\s*\(\) =>\s*import\('\.\/MyTeamRosterManager'\)\.then/);
  });

  it('preloads deferred panels from explicit keyboard, pointer, and select intent', () => {
    expect(source).toContain('const TAB_PANEL_PRELOADERS');
    expect(source).toContain('createIntentPreloader(TAB_PANEL_PRELOADERS');
    expect(source).toContain('onPointerEnter={() => void preloadLeagueTab(tab.id)}');
    expect(source).toContain('onPointerDown={() => void preloadLeagueTab(tab.id)}');
    expect(source).toContain("event.key === 'Enter' || event.key === ' '");
    expect(source).toContain('void preloadLeagueTab(tabId);');
    expect(source).not.toContain('onFocus={() => void preloadLeagueTab');
  });

  it('announces the temporary panel loading state without hiding navigation', () => {
    expect(source).toContain('function LeaguePanelLoading');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-busy="true"');
    expect(source).toContain('min-h-48');
    expect(source).toContain('Loading {label}…');
    expect(source).toContain('<SectionErrorBoundary');
    expect(source).toContain('resetKeys={[activeTab]}');
    expect(source).toContain('Return to overview');
    expect(source).toContain('Reload page');
  });
});
