import { getDefaultAflSeason } from '@/lib/aflSeason';

import { getDevFixtureScenarioManifest } from '../core/manifest';
import { checkFullLeaguePrerequisites } from '../core/prerequisites';
import {
  assertFixtureOwnedResetAllowed,
  assertNoUnexpectedMembers,
  getDevFixtureOwnerUserId,
} from '../core/safety';
import type { DevFixtureRunResult, DevFixtureScenario, DevFixtureStepResult } from '../core/types';
import { ensureFixtureBotProfiles } from '../services/fixtureBotService';
import { ensureFixtureDrafts } from '../services/fixtureDraftService';
import { ensureFixtureLeagues, ensureFixtureMembers } from '../services/fixtureLeagueService';
import { resetFixtureLeagues } from '../services/fixtureResetService';
import { ensureFixtureRosters } from '../services/fixtureRosterService';
import { ensureFixtureSeasons } from '../services/fixtureSeasonService';
import { ensureFixtureOwnerUser } from '../services/fixtureUserService';
import { findFixtureLeagueIds, verifyFixtureLeagues } from '../services/fixtureVerifier';

function result(input: {
  command: DevFixtureRunResult['command'];
  ownerUserId: string;
  steps: DevFixtureStepResult[];
  leagues: DevFixtureRunResult['leagues'];
}): DevFixtureRunResult {
  const issues = [
    ...input.steps
      .filter((step) => step.status === 'failed')
      .map((step) => `${step.name}: ${step.detail}`),
    ...input.leagues.flatMap((league) => league.issues.map((issue) => `${league.name}: ${issue}`)),
  ];

  return {
    command: input.command,
    scenarioId: 'full-leagues',
    ownerUserId: input.ownerUserId,
    ok: issues.length === 0,
    steps: input.steps,
    leagues: input.leagues,
    issues,
  };
}

export const fullLeaguesScenario: DevFixtureScenario = {
  id: 'full-leagues',

  async apply() {
    const manifest = getDevFixtureScenarioManifest('full-leagues');
    const ownerUserId = getDevFixtureOwnerUserId();
    const season = getDefaultAflSeason();
    const steps: DevFixtureStepResult[] = [];

    await assertNoUnexpectedMembers({ manifest, ownerUserId });
    await ensureFixtureOwnerUser(ownerUserId);

    const prerequisiteSteps = await checkFullLeaguePrerequisites({ manifest });
    steps.push(...prerequisiteSteps);
    if (prerequisiteSteps.some((step) => step.status === 'failed')) {
      return result({ command: 'apply', ownerUserId, steps, leagues: [] });
    }

    const leagueResult = await ensureFixtureLeagues({ manifest, ownerUserId });
    steps.push(...leagueResult.steps);
    steps.push(...(await ensureFixtureMembers({ manifest, leagueIds: leagueResult.leagueIds })));
    steps.push(
      ...(await ensureFixtureBotProfiles({ leagueIds: leagueResult.leagueIds, ownerUserId }))
    );
    steps.push(...(await ensureFixtureRosters({ manifest, leagueIds: leagueResult.leagueIds })));

    if (!steps.some((step) => step.status === 'failed')) {
      steps.push(...(await ensureFixtureDrafts({ manifest, leagueIds: leagueResult.leagueIds })));
      steps.push(...(await ensureFixtureSeasons({ leagueIds: leagueResult.leagueIds, season })));
    }

    const leagues = await verifyFixtureLeagues({
      manifest,
      leagueIds: leagueResult.leagueIds,
      season,
    });

    return result({ command: 'apply', ownerUserId, steps, leagues });
  },

  async verify() {
    const manifest = getDevFixtureScenarioManifest('full-leagues');
    const ownerUserId = getDevFixtureOwnerUserId();
    const season = getDefaultAflSeason();
    const leagueIds = await findFixtureLeagueIds(manifest);
    const leagues = await verifyFixtureLeagues({ manifest, leagueIds, season });
    const steps: DevFixtureStepResult[] = [
      {
        name: 'fixture readiness',
        status: leagues.every((league) => league.ready) ? 'verified' : 'failed',
        detail: `Verified ${leagues.length} fixture leagues.`,
      },
    ];

    return result({ command: 'verify', ownerUserId, steps, leagues });
  },

  async reset(input) {
    const manifest = getDevFixtureScenarioManifest('full-leagues');
    const ownerUserId = getDevFixtureOwnerUserId();
    assertFixtureOwnedResetAllowed(input);
    await assertNoUnexpectedMembers({ manifest, ownerUserId });
    const steps = await resetFixtureLeagues({ manifest });
    return result({ command: 'reset', ownerUserId, steps, leagues: [] });
  },
};
