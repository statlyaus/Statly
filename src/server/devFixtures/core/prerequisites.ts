import { prisma } from '@/lib/prisma';

import type { DevFixtureScenarioManifest, DevFixtureStepResult } from './types';

export async function checkFullLeaguePrerequisites(input: {
  manifest: DevFixtureScenarioManifest;
}): Promise<DevFixtureStepResult[]> {
  const requiredActivePlayers =
    input.manifest.teamsPerLeague * (input.manifest.rosterSize + input.manifest.benchSize);
  const activePlayerCount = await prisma.player.count({
    where: {
      active: true,
    },
  });

  if (activePlayerCount < requiredActivePlayers) {
    return [
      {
        name: 'active players',
        status: 'failed',
        detail: `Need ${requiredActivePlayers} active players for ${input.manifest.id}; found ${activePlayerCount}.`,
      },
    ];
  }

  return [
    {
      name: 'active players',
      status: 'verified',
      detail: `Found ${activePlayerCount} active players.`,
    },
  ];
}
