import { prisma } from '@/lib/prisma';

import type { DevFixtureScenarioManifest } from './types';
import { DevFixtureSafetyError } from './types';

export function assertNotProduction() {
  if (process.env.NODE_ENV === 'production') {
    throw new DevFixtureSafetyError('Refusing to run dev fixtures in production.');
  }
}

export function assertFixtureOwnedResetAllowed(input: { fixtureOwned: boolean }) {
  if (!input.fixtureOwned) {
    throw new DevFixtureSafetyError('Reset requires --fixture-owned.');
  }
}

export function getDevFixtureOwnerUserId() {
  return (
    process.env.BYPASS_UID ||
    process.env.NEXT_PUBLIC_BYPASS_UID ||
    process.env.DEV_FIXTURE_OWNER_USER_ID ||
    'statly-dev-tester'
  );
}

export function isFixtureBotUserId(manifest: DevFixtureScenarioManifest, userId: string) {
  return userId.startsWith(manifest.botUserIdPrefix);
}

export async function assertNoUnexpectedMembers(input: {
  manifest: DevFixtureScenarioManifest;
  ownerUserId: string;
}) {
  const leagues = await prisma.league.findMany({
    where: {
      name: {
        startsWith: input.manifest.leagueNamePrefix,
      },
    },
    include: {
      members: {
        select: {
          userId: true,
          teamName: true,
        },
      },
    },
  });

  const unexpected = leagues.flatMap((league) =>
    league.members
      .filter(
        (member) =>
          member.userId !== input.ownerUserId &&
          !isFixtureBotUserId(input.manifest, member.userId)
      )
      .map((member) => `${league.name}: ${member.teamName} (${member.userId})`)
  );

  if (unexpected.length > 0) {
    throw new DevFixtureSafetyError(
      `Fixture league contains unexpected non-fixture members: ${unexpected.join(', ')}`
    );
  }
}
