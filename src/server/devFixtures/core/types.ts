export type DevFixtureCommand = 'list' | 'apply' | 'verify' | 'reset';

export type DevFixtureScenarioId = 'full-leagues';

export type DevFixtureOutputFormat = 'text' | 'json';

export type DevFixtureScenarioManifest = {
  id: DevFixtureScenarioId;
  description: string;
  leagueNamePrefix: string;
  leagueCount: number;
  teamsPerLeague: number;
  botTeamsPerLeague: number;
  botUserIdPrefix: string;
  rosterSize: number;
  benchSize: number;
  categories: string[];
};

export type DevFixtureCliOptions = {
  command: DevFixtureCommand;
  scenarioId?: DevFixtureScenarioId;
  outputFormat: DevFixtureOutputFormat;
  fixtureOwned: boolean;
};

export type DevFixtureStepStatus = 'created' | 'updated' | 'verified' | 'skipped' | 'failed';

export type DevFixtureStepResult = {
  name: string;
  status: DevFixtureStepStatus;
  detail: string;
};

export type DevFixtureLeagueReadiness = {
  id: string;
  name: string;
  inviteCode: string;
  url: string;
  memberCount: number;
  botCount: number;
  rosteredMemberCount: number;
  rosterPlayerCount: number;
  draftStatus: string | null;
  seasonWeeks: number;
  matchupCount: number;
  ready: boolean;
  issues: string[];
};

export type DevFixtureRunResult = {
  command: DevFixtureCommand;
  scenarioId?: DevFixtureScenarioId;
  ownerUserId?: string;
  ok: boolean;
  steps: DevFixtureStepResult[];
  leagues: DevFixtureLeagueReadiness[];
  issues: string[];
};

export type DevFixtureScenario = {
  id: DevFixtureScenarioId;
  apply(): Promise<DevFixtureRunResult>;
  verify(): Promise<DevFixtureRunResult>;
  reset(input: { fixtureOwned: boolean }): Promise<DevFixtureRunResult>;
};

export class DevFixtureSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevFixtureSafetyError';
  }
}
