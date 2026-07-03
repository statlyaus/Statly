import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league settings UI architecture', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'src/components/league/LeagueTabs.tsx'), 'utf8');

  it('wires the league settings tab to the canonical league settings route', () => {
    const leagueTabsSource = source();

    expect(leagueTabsSource).toContain('<LeagueSettingsPanel');
    expect(leagueTabsSource).toContain('memberCount={members.length}');
    expect(leagueTabsSource).toContain('currentUserId={currentUserId}');
    expect(leagueTabsSource).toContain(
      "import { authenticatedFetch } from '@/lib/authenticatedFetch'"
    );
    expect(leagueTabsSource).toContain('authenticatedFetch(');
    expect(leagueTabsSource).toContain('`/api/leagues/${league.id}/settings`');
    expect(leagueTabsSource).toContain("method: 'PUT'");
    expect(leagueTabsSource).toContain('body: JSON.stringify(settings)');
  });

  it('renders the canonical fantasy settings groups instead of the old fake trade form', () => {
    const leagueTabsSource = source();

    expect(leagueTabsSource).toContain('REAL_DATA_NINE_CATEGORY_PRESET');
    expect(leagueTabsSource).toContain('CATEGORY_PRESET.map');
    expect(leagueTabsSource).toContain('Scoring Categories');
    expect(leagueTabsSource).toContain('Draft Settings');
    expect(leagueTabsSource).toContain('Roster Settings');
    expect(leagueTabsSource).toContain('Auto-Pick And Waivers');
    expect(leagueTabsSource).not.toContain('league.tradeSettings.tradeLimit');
    expect(leagueTabsSource).not.toContain('Save Changes');
  });

  it('keeps commissioner editing behind the existing league membership role check', () => {
    const leagueTabsSource = source();

    expect(leagueTabsSource).toContain(
      "const isAdmin = currentMember?.role === 'owner' || currentMember?.role === 'manager'"
    );
    expect(leagueTabsSource).toContain('<fieldset disabled={!isAdmin || isSaving}');
    expect(leagueTabsSource).toContain('if (!isAdmin) return;');
    expect(leagueTabsSource).toContain('Save league settings');
  });

  it('keeps team identity editing available to ordinary league members', () => {
    const leagueTabsSource = source();

    expect(leagueTabsSource).toContain('Team identity');
    expect(leagueTabsSource).toContain('Team symbol URL');
    expect(leagueTabsSource).toContain('Upload team symbol');
    expect(leagueTabsSource).toContain('Horizontal centre');
    expect(leagueTabsSource).toContain('Vertical centre');
    expect(leagueTabsSource).toContain('aspect-square w-44');
    expect(leagueTabsSource).toContain('lg:w-56');
    expect(leagueTabsSource).toContain('mix-blend-difference');
    expect(leagueTabsSource).toContain('teamLogoPositionX');
    expect(leagueTabsSource).toContain('teamLogoPositionY');
    expect(leagueTabsSource).toContain('`/api/leagues/${league.id}/members/me`');
    expect(leagueTabsSource).toContain("method: 'PATCH'");
    expect(leagueTabsSource.indexOf('Team identity')).toBeLessThan(
      leagueTabsSource.indexOf('<fieldset disabled={!isAdmin || isSaving}')
    );
  });
});
