import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league settings UI architecture', () => {
  const leagueTabsSource = () =>
    readFileSync(join(process.cwd(), 'src/components/league/LeagueTabs.tsx'), 'utf8');
  const settingsPanelsSource = () =>
    readFileSync(join(process.cwd(), 'src/components/league/LeagueSettingsPanels.tsx'), 'utf8');
  const panelUtilsSource = () =>
    readFileSync(join(process.cwd(), 'src/components/league/leagueTabPanelUtils.ts'), 'utf8');

  it('wires the league settings tab to the canonical league settings route', () => {
    const tabsSource = leagueTabsSource();
    const settingsSource = settingsPanelsSource();

    expect(tabsSource).toContain('<LeagueSettingsPanel');
    expect(tabsSource).toContain("id: 'league-settings'");
    expect(tabsSource).toContain("isAdmin ? 'League Settings' : 'Competition Rules'");
    expect(tabsSource).toContain('memberCount={members.length}');
    expect(tabsSource).toContain('currentUserId={currentUserId}');
    expect(settingsSource).toContain(
      "import { authenticatedFetch } from '@/lib/authenticatedFetch'"
    );
    expect(settingsSource).toContain('authenticatedFetch(');
    expect(settingsSource).toContain('`/api/leagues/${league.id}/settings`');
    expect(settingsSource).toContain("method: 'PUT'");
    expect(settingsSource).toContain('body: JSON.stringify(settings)');
  });

  it('renders the canonical fantasy settings groups instead of the old fake trade form', () => {
    const settingsSource = settingsPanelsSource();
    const utilsSource = panelUtilsSource();
    const scoringSettingsSource = readFileSync(
      join(process.cwd(), 'src/components/league/settings/ScoringSettingsPanel.tsx'),
      'utf8'
    );
    const competitionSettingsSource = readFileSync(
      join(process.cwd(), 'src/components/league/settings/CompetitionSettingsPanel.tsx'),
      'utf8'
    );

    expect(utilsSource).toContain('REAL_DATA_NINE_CATEGORY_PRESET');
    expect(settingsSource).toContain('<ScoringSettingsPanel');
    expect(scoringSettingsSource).toContain('Scoring Settings');
    expect(scoringSettingsSource).toContain('H2H Each Category');
    expect(scoringSettingsSource).toContain('H2H Most Categories');
    expect(scoringSettingsSource).not.toContain('Fixture generation');
    expect(competitionSettingsSource).toContain('Fixture generation');
    expect(competitionSettingsSource).toContain('Automatic by league teams');
    expect(competitionSettingsSource).toContain('Manual commissioner setup');
    expect(scoringSettingsSource).toContain('lineupSlots');
    expect(scoringSettingsSource).toContain('categoryDirections');
    expect(settingsSource).toContain('Draft Settings');
    expect(settingsSource).toContain('Roster Settings');
    expect(settingsSource).toContain('Auto-Pick And Waivers');
    expect(settingsSource).not.toContain('league.tradeSettings.tradeLimit');
    expect(settingsSource).not.toContain('Save Changes');
  });

  it('keeps commissioner editing behind the existing league membership role check', () => {
    const tabsSource = leagueTabsSource();
    const settingsSource = settingsPanelsSource();

    expect(tabsSource).toContain(
      'const isLeagueOwner = Boolean(currentUserId) && currentUserId === league.ownerId;'
    );
    expect(tabsSource).toContain(
      "isLeagueOwner || currentMember?.role === 'owner' || currentMember?.role === 'manager';"
    );
    expect(settingsSource).toContain('<fieldset disabled={!isAdmin || isSaving}');
    expect(settingsSource).toContain('if (!isAdmin) return;');
    expect(settingsSource).toContain('Save league settings');
  });

  it('keeps member-owned team settings available to ordinary league members', () => {
    const tabsSource = leagueTabsSource();
    const settingsSource = settingsPanelsSource();

    expect(tabsSource).toContain('<TeamSettingsPanel');
    expect(tabsSource).toContain("{ id: 'team-settings', name: 'Team Settings' }");
    expect(tabsSource).toContain("value === 'settings'");
    expect(tabsSource).toContain(
      "return canAccessCompetitionRules ? 'league-settings' : 'team-settings'"
    );
    expect(settingsSource).toContain('Team Settings');
    expect(settingsSource).toContain('Team details');
    expect(settingsSource).toContain('Team name');
    expect(settingsSource).toContain('Team identity');
    expect(settingsSource).toContain('Team symbol URL');
    expect(settingsSource).toContain('Upload team symbol');
    expect(settingsSource).toContain('Trade offers');
    expect(settingsSource).toContain('Waiver updates');
    expect(settingsSource).toContain('Draft reminders');
    expect(settingsSource).toContain('Scoring alerts');
    expect(settingsSource).toContain('Zoom');
    expect(settingsSource).toContain('Horizontal centre');
    expect(settingsSource).toContain('Vertical centre');
    expect(settingsSource).toContain('lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]');
    expect(settingsSource).toContain('aspect-square w-full max-w-sm');
    expect(settingsSource).toContain('mix-blend-difference');
    expect(settingsSource).toContain('teamLogoPositionX');
    expect(settingsSource).toContain('teamLogoPositionY');
    expect(settingsSource).toContain('teamLogoZoom');
    expect(settingsSource).toContain('notificationSettings');
    expect(settingsSource).toContain('`/api/leagues/${league.id}/members/me`');
    expect(settingsSource).toContain("method: 'PATCH'");
    expect(settingsSource.indexOf('function TeamSettingsPanel')).toBeLessThan(
      settingsSource.indexOf('function LeagueSettingsPanel')
    );
    expect(
      settingsSource.slice(settingsSource.indexOf('function LeagueSettingsPanel')).includes('Team identity')
    ).toBe(false);
  });
});
