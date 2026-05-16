// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DEV_FIXTURE_MANIFEST, getDevFixtureScenarioManifest } from './manifest';

describe('dev fixture manifest', () => {
  it('defines the full-leagues scenario ownership contract', () => {
    const scenario = getDevFixtureScenarioManifest('full-leagues');

    expect(scenario.id).toBe('full-leagues');
    expect(scenario.leagueNamePrefix).toBe('Statly Fixture Full League');
    expect(scenario.leagueCount).toBe(3);
    expect(scenario.teamsPerLeague).toBe(12);
    expect(scenario.botTeamsPerLeague).toBe(11);
    expect(scenario.botUserIdPrefix).toBe('statly-fixture-full-league-');
  });

  it('keeps scenario ids unique', () => {
    const ids = DEV_FIXTURE_MANIFEST.scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
