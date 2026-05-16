import type { DevFixtureScenarioId, DevFixtureScenarioManifest } from './types';

export const DEV_FIXTURE_MANIFEST = {
  scenarios: [
    {
      id: 'full-leagues',
      description: 'Three complete 12-team AFL fantasy leagues for local workflow testing.',
      leagueNamePrefix: 'Statly Fixture Full League',
      leagueCount: 3,
      teamsPerLeague: 12,
      botTeamsPerLeague: 11,
      botUserIdPrefix: 'statly-fixture-full-league-',
      rosterSize: 18,
      benchSize: 4,
      categories: ['goals', 'kicks', 'handballs', 'marks', 'tackles', 'hitouts'],
    },
  ],
} as const satisfies { scenarios: DevFixtureScenarioManifest[] };

export function getDevFixtureScenarioManifest(
  id: DevFixtureScenarioId
): DevFixtureScenarioManifest {
  const scenario = DEV_FIXTURE_MANIFEST.scenarios.find((entry) => entry.id === id);
  if (!scenario) {
    throw new Error(`Unknown dev fixture scenario: ${id}`);
  }
  return scenario;
}

export function isDevFixtureScenarioId(value: string): value is DevFixtureScenarioId {
  return DEV_FIXTURE_MANIFEST.scenarios.some((entry) => entry.id === value);
}
