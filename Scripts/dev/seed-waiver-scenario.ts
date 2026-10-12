#!/usr/bin/env tsx
/**
 * A drafted two-team FAAB league for walking through waivers by hand on the local stack:
 * bidding, processing, the FAAB balance and the league Activity channel.
 *
 *   npm run dev:seed:waivers               # (re)create the scenario
 *   npm run dev:seed:waivers -- --make-due # make its pending claims due, so "Process" picks them up
 *
 * Runs only against the Firebase Auth emulator and a loopback PostgreSQL (the SSH tunnel to the dev
 * database counts as loopback). Both managers sign in with the local development phrase, the same one
 * the dev tester uses; see docs/development/testing.md.
 */

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GOOGLE_CLOUD_PROJECT ??= 'statly-4cbed';
process.env.GCLOUD_PROJECT ??= process.env.GOOGLE_CLOUD_PROJECT;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= process.env.GOOGLE_CLOUD_PROJECT;

const LEAGUE_ID = 'waiver-test-league';
const SETTINGS_ID = 'waiver-test-settings';
const DRAFT_ID = 'waiver-test-draft';
const RIVAL = { id: 'statly-dev-rival', email: 'rival@statly.dev', name: 'Statly Dev Rival' };
const FAAB_BUDGET = 100;
// Six drafted players (three each, snake order) and two left free to bid on.
const PLAYERS = [
  ['waiver-test-player-1', 'Drafted Defender', 'DEF'],
  ['waiver-test-player-2', 'Drafted Midfielder', 'MID'],
  ['waiver-test-player-3', 'Drafted Forward', 'FWD'],
  ['waiver-test-player-4', 'Drafted Ruck', 'RUC'],
  ['waiver-test-player-5', 'Drafted Wing', 'MID'],
  ['waiver-test-player-6', 'Drafted Flanker', 'DEF'],
  ['waiver-test-player-7', 'Free Agent Alpha', 'MID'],
  ['waiver-test-player-8', 'Free Agent Bravo', 'FWD'],
] as const;

function assertLocalTargets(): void {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const database = url.pathname.replace(/^\//, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || /prod/i.test(database)) {
    throw new Error(
      `Refusing to seed ${url.hostname}/${database}: the waiver scenario is for a loopback development database only`
    );
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Refusing to seed without the Firebase Auth emulator');
  }
}

async function main() {
  assertLocalTargets();
  const { prisma } = await import('../../src/lib/prisma');

  if (process.argv.includes('--make-due')) {
    const { count } = await prisma.teamAction.updateMany({
      where: { leagueId: LEAGUE_ID, actionType: 'WAIVER_CLAIM', status: 'PENDING' },
      data: { processingAt: new Date(Date.now() - 1000) },
    });
    console.log(`[waiver-scenario] ${count} pending claim(s) are now due for processing`);
    await prisma.$disconnect();
    return;
  }

  const { adminAuth } = await import('../../src/lib/firebaseAdmin');
  const { DEVELOPMENT_AUTH_EMAIL, DEVELOPMENT_AUTH_USER_ID, resolveLocalDevelopmentAuthPhrase } =
    await import('../../src/lib/devAuth');
  const { REAL_DATA_NINE_CATEGORY_PRESET } = await import('../../src/types/fantasyCategories');
  const commissionerId = DEVELOPMENT_AUTH_USER_ID;

  // The rival signs in like the dev tester; the dev tester itself comes from dev:seed:local.
  const rivalAuth = {
    email: RIVAL.email,
    password: resolveLocalDevelopmentAuthPhrase(),
    displayName: RIVAL.name,
    emailVerified: true,
    disabled: false,
  };
  await adminAuth
    .updateUser(RIVAL.id, rivalAuth)
    .catch(() => adminAuth.createUser({ uid: RIVAL.id, ...rivalAuth }));
  for (const user of [
    { id: commissionerId, email: DEVELOPMENT_AUTH_EMAIL, name: 'Statly Dev Tester' },
    RIVAL,
  ]) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: {
        id: user.id,
        email: user.email,
        passwordHash: 'local_emulator_user',
        displayName: user.name,
        timeZone: 'Australia/Melbourne',
      },
    });
  }

  // Start clean: rows without foreign keys first, then members, drafts and picks, then the league.
  const league = { leagueId: LEAGUE_ID };
  await prisma.$transaction([
    prisma.teamAction.deleteMany({ where: league }),
    prisma.waiverPriority.deleteMany({ where: league }),
    prisma.leagueRoster.deleteMany({ where: league }),
    prisma.pick.deleteMany({ where: { draftId: DRAFT_ID } }),
    prisma.draftOrder.deleteMany({ where: { draftId: DRAFT_ID } }),
    prisma.draft.deleteMany({ where: league }),
    prisma.leagueMember.deleteMany({ where: league }),
    prisma.league.deleteMany({ where: { id: LEAGUE_ID } }),
    prisma.leagueSettings.deleteMany({ where: { id: SETTINGS_ID } }),
  ]);

  for (const [id, name, position] of PLAYERS) {
    await prisma.player.upsert({
      where: { id },
      update: { name, position, active: true },
      create: { id, name, club: 'Statly Test', position, active: true },
    });
  }

  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS_ID,
      rosterSize: 4,
      benchSize: 0,
      maxTeams: 2,
      pickSeconds: 60,
      draftType: 'SNAKE',
      pickOrder: 'MANUAL',
      waiverRule: 'WEEKLY',
      faabBudget: FAAB_BUDGET,
      timeZone: 'Australia/Melbourne',
      locked: true,
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE_ID,
      name: 'Waiver Test League',
      inviteCode: 'WAIVTEST',
      ownerId: commissionerId,
      settingsId: SETTINGS_ID,
      categoriesJson: JSON.stringify([...REAL_DATA_NINE_CATEGORY_PRESET]),
    },
  });
  const members = [
    {
      id: 'waiver-test-commissioner',
      userId: commissionerId,
      role: 'OWNER' as const,
      teamName: 'Dev Tester FC',
    },
    {
      id: 'waiver-test-rival',
      userId: RIVAL.id,
      role: 'MANAGER' as const,
      teamName: 'Rival Rovers',
    },
  ];
  await prisma.leagueMember.createMany({
    data: members.map((member, index) => ({
      ...member,
      leagueId: LEAGUE_ID,
      draftSlot: index + 1,
    })),
  });

  // A completed snake draft of three rounds: picks go A, B, B, A, A, B.
  await prisma.draft.create({
    data: {
      id: DRAFT_ID,
      leagueId: LEAGUE_ID,
      status: 'COMPLETED',
      currentPick: 7,
      totalPicks: 6,
      round: 3,
      direction: 'FORWARD',
      lobbyStatus: 'CLOSED',
    },
  });
  await prisma.draftOrder.createMany({
    data: members.map((member, index) => ({
      draftId: DRAFT_ID,
      memberId: member.id,
      slot: index + 1,
    })),
  });
  const pickOrder = [0, 1, 1, 0, 0, 1];
  for (const [index, memberIndex] of pickOrder.entries()) {
    const memberId = members[memberIndex].id;
    const playerId = PLAYERS[index][0];
    const pick = await prisma.pick.create({
      data: {
        draftId: DRAFT_ID,
        overall: index + 1,
        round: Math.floor(index / 2) + 1,
        slot: memberIndex + 1,
        memberId,
        playerId,
      },
    });
    await prisma.leagueRosterPlayer.create({
      data: {
        leagueId: LEAGUE_ID,
        memberId,
        playerId,
        draftId: DRAFT_ID,
        pickId: pick.id,
        acquiredBy: 'DRAFT',
      },
    });
  }
  await prisma.leagueRoster.createMany({
    data: members.map((member, memberIndex) => ({
      leagueId: LEAGUE_ID,
      memberId: member.id,
      playerIds: JSON.stringify(
        pickOrder.flatMap((owner, index) => (owner === memberIndex ? [PLAYERS[index][0]] : []))
      ),
    })),
  });
  // Waiver order is the reverse of the final draft pick: the rival picked last, so goes first.
  await prisma.waiverPriority.createMany({
    data: [
      { leagueId: LEAGUE_ID, memberId: 'waiver-test-rival', priority: 1 },
      { leagueId: LEAGUE_ID, memberId: 'waiver-test-commissioner', priority: 2 },
    ],
  });

  console.log(
    [
      '[waiver-scenario] Waiver Test League is ready: FAAB budget $100 each, one open roster spot each.',
      `  Commissioner: ${DEVELOPMENT_AUTH_EMAIL}  (Dev Tester FC, waiver priority 2)`,
      `  Rival:        ${RIVAL.email}  (Rival Rovers, waiver priority 1)`,
      '  Both sign in with the local development phrase. Free players: Free Agent Alpha, Free Agent Bravo.',
      '  Bid as both, run `npm run dev:seed:waivers -- --make-due`, then process waivers as commissioner.',
    ].join('\n')
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('[waiver-scenario] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
