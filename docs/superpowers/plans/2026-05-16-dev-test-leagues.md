# Dev Test Leagues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable local/dev seeder that creates 3 AFL fantasy leagues with 12 teams each: the current dev/test user as 1 owner team and 11 bot teams.

**Architecture:** Keep this as dev/test data setup, not product API behavior. Put the reusable Prisma seeding logic in one testable server module, then add a thin script wrapper that can be run from npm. The seeder is idempotent for its named test leagues and uses existing `User`, `League`, `LeagueSettings`, `LeagueMember`, `LeagueBotProfile`, and `WaiverPriority` tables directly.

**Tech Stack:** Next.js App Router repo, TypeScript, Prisma SQLite client, Vitest, existing auth bypass helper, existing `BotPersonality` and `LeagueRole` enums.

---

## File Structure

- Create `src/server/league/devTestLeagueSeeder.ts`
  - Owns all deterministic test-league setup logic.
  - Exports constants for the three league names, bot users, default categories, and the `seedDevTestLeagues` function.
  - Uses Prisma transactions and idempotent upserts.
- Create `src/server/league/devTestLeagueSeeder.test.ts`
  - Unit/integration coverage against a temporary SQLite database using the real Prisma schema.
  - Verifies 3 leagues, 12 members per league, owner slot 1, 11 bot profiles per league, and idempotency.
- Create `Scripts/create-dev-test-leagues.ts`
  - Thin CLI entrypoint for local use.
  - Loads env, resolves the current bypass user, runs the seeder, prints league ids and invite codes.
- Modify `package.json`
  - Add `seed:dev-leagues` script for the CLI.

## Contract And Invariants

- This does not change the Footywire canonical raw-match contract.
- This does not change league API behavior or persisted production semantics.
- Test leagues are identified by stable names with prefix `Statly Dev Test League`.
- The owner user id defaults to `getBypassUserDetails().uid`, so local bypass auth opens the leagues as "me".
- Each league has exactly 12 members after seeding:
  - slot 1: owner, `LeagueRole.OWNER`
  - slots 2-12: bot users, `LeagueRole.MANAGER`
- Each bot member has one enabled `LeagueBotProfile`.
- Running the script twice updates/repairs the same three leagues instead of creating duplicates.
- The script refuses to run when `NODE_ENV === 'production'`.

## PROPOSED EDIT PLAN
Working with: `src/server/league/devTestLeagueSeeder.ts`, `src/server/league/devTestLeagueSeeder.test.ts`, `Scripts/create-dev-test-leagues.ts`, `package.json`
Total planned edits: 4

### Edit sequence:
1. Create `src/server/league/devTestLeagueSeeder.ts` - Purpose: centralize idempotent league, member, bot profile, and waiver priority creation.
2. Create `src/server/league/devTestLeagueSeeder.test.ts` - Purpose: prove the seeder creates exactly the desired shape and is idempotent.
3. Create `Scripts/create-dev-test-leagues.ts` - Purpose: expose the seeder as a local command.
4. Modify `package.json` - Purpose: add `npm run seed:dev-leagues`.

Dependencies:
- Edit 2 depends on Edit 1 exports.
- Edit 3 depends on Edit 1 exports.
- Edit 4 depends on Edit 3 path.

Verification plan:
- `npm test -- src/server/league/devTestLeagueSeeder.test.ts`
- `npm run typecheck:tests`
- `npm run seed:dev-leagues`
- Confirm the command output lists 3 leagues and each reports `members=12 bots=11`.

### Task 1: Add Dev Test League Seeder

**Files:**
- Create: `src/server/league/devTestLeagueSeeder.ts`

- [ ] **Step 1: Write the seeder module**

Create `src/server/league/devTestLeagueSeeder.ts` with this content:

```ts
import { BotPersonality, DraftType, LeagueRole, type Prisma, type PrismaClient } from '@prisma/client';

import { getBypassUserDetails } from '@/lib/authBypass';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { deriveLeagueScheduleSettings } from '@/lib/leagueSeason';
import { nestedUserCredentialCreate, USER_CREDENTIAL_FIREBASE_MANAGED } from '@/lib/userCredentialConstants';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const DEV_TEST_LEAGUE_PREFIX = 'Statly Dev Test League';

export const DEV_TEST_LEAGUE_NAMES = [
  `${DEV_TEST_LEAGUE_PREFIX} 1`,
  `${DEV_TEST_LEAGUE_PREFIX} 2`,
  `${DEV_TEST_LEAGUE_PREFIX} 3`,
] as const;

export const DEV_TEST_CATEGORIES: FantasyCategoryKey[] = [
  'goals',
  'kicks',
  'handballs',
  'marks',
  'tackles',
  'hitouts',
  'clearances',
  'inside50s',
  'contestedPossessions',
];

const BOT_TEAM_NAMES = [
  'Adelaide Anchors',
  'Brisbane Breakers',
  'Carlton Crushers',
  'Collingwood Chasers',
  'Essendon Engines',
  'Fremantle Flyers',
  'Geelong Guards',
  'Gold Coast Giants',
  'GWS Grinders',
  'Hawthorn Hunters',
  'Melbourne Maulers',
] as const;

const BOT_PERSONALITIES = [
  BotPersonality.BALANCED,
  BotPersonality.AGGRESSIVE,
  BotPersonality.OPPORTUNISTIC,
  BotPersonality.CONSERVATIVE,
  BotPersonality.WAIVER_HUNTER,
  BotPersonality.BALANCED,
  BotPersonality.AGGRESSIVE,
  BotPersonality.OPPORTUNISTIC,
  BotPersonality.CONSERVATIVE,
  BotPersonality.WAIVER_HUNTER,
  BotPersonality.BALANCED,
] as const;

type SeedDevTestLeaguesInput = {
  ownerUserId?: string;
  ownerEmail?: string;
  ownerDisplayName?: string;
  prismaClient?: PrismaClient;
};

type SeededLeagueSummary = {
  id: string;
  name: string;
  inviteCode: string;
  members: number;
  bots: number;
};

export type SeedDevTestLeaguesResult = {
  ownerUserId: string;
  leagues: SeededLeagueSummary[];
};

function buildInviteCode(index: number) {
  return `DEV${String(index + 1).padStart(3, '0')}`;
}

function buildBotUserId(leagueIndex: number, botIndex: number) {
  return `statly-dev-league-${leagueIndex + 1}-bot-${String(botIndex + 1).padStart(2, '0')}`;
}

async function ensureUser(
  tx: Prisma.TransactionClient,
  input: { id: string; email: string; displayName: string; timeZone?: string }
) {
  await tx.user.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      timeZone: input.timeZone ?? 'Australia/Melbourne',
      credential: nestedUserCredentialCreate(USER_CREDENTIAL_FIREBASE_MANAGED),
    },
    update: {
      email: input.email,
      displayName: input.displayName,
      timeZone: input.timeZone ?? 'Australia/Melbourne',
    },
  });
}

async function ensureLeague(
  tx: Prisma.TransactionClient,
  input: { index: number; name: string; ownerUserId: string }
) {
  const existing = await tx.league.findFirst({
    where: { name: input.name, ownerId: input.ownerUserId },
    include: { settings: true },
  });

  const scheduleDefaults = deriveLeagueScheduleSettings(12);
  const settingsData = {
    rosterSize: 18,
    benchSize: 4,
    maxTeams: 12,
    pickSeconds: 120,
    allowAutoPick: true,
    enableDraftReminders: true,
    draftType: DraftType.SNAKE,
    startAt: new Date(),
    timeZone: 'Australia/Melbourne',
    locked: false,
    seasonWeeks: scheduleDefaults.seasonWeeks,
    matchupsPerOpponent: scheduleDefaults.matchupsPerOpponent,
    playoffsEnabled: Boolean(scheduleDefaults.playoffs?.enabled),
    playoffTeams: scheduleDefaults.playoffs?.teams ?? 0,
    playoffLegLengthWeeks: scheduleDefaults.playoffs?.legLengthWeeks ?? 1,
    playoffReseedEachRound: Boolean(scheduleDefaults.playoffs?.reseedEachRound),
    playoffIncludeConsolation: Boolean(scheduleDefaults.playoffs?.includeConsolation),
    enableCaptainSystem: false,
    captainMultiplier: 2.0,
    viceCaptainMultiplier: 1.5,
  };

  if (existing) {
    await tx.leagueSettings.update({
      where: { id: existing.settingsId },
      data: settingsData,
    });

    return tx.league.update({
      where: { id: existing.id },
      data: {
        inviteCode: buildInviteCode(input.index),
        type: 'private',
        description: 'Local seeded league for testing a full 12-team competition with bots.',
        status: 'preseason',
        categoriesJson: JSON.stringify(DEV_TEST_CATEGORIES),
        tradeLimit: 10,
        tradeReview: 'none',
        tradeVetoPeriodHours: 24,
        waiverOrderJson: JSON.stringify([]),
        waiverPeriodHours: 24,
        waiverResetPolicy: 'weekly',
      },
    });
  }

  const settings = await tx.leagueSettings.create({ data: settingsData });

  return tx.league.create({
    data: {
      name: input.name,
      inviteCode: buildInviteCode(input.index),
      type: 'private',
      ownerId: input.ownerUserId,
      description: 'Local seeded league for testing a full 12-team competition with bots.',
      status: 'preseason',
      categoriesJson: JSON.stringify(DEV_TEST_CATEGORIES),
      tradeLimit: 10,
      tradeReview: 'none',
      tradeVetoPeriodHours: 24,
      waiverOrderJson: JSON.stringify([]),
      waiverPeriodHours: 24,
      waiverResetPolicy: 'weekly',
      settingsId: settings.id,
    },
  });
}

async function ensureMember(
  tx: Prisma.TransactionClient,
  input: {
    leagueId: string;
    userId: string;
    role: LeagueRole;
    teamName: string;
    draftSlot: number;
  }
) {
  const member = await tx.leagueMember.upsert({
    where: {
      leagueId_userId: {
        leagueId: input.leagueId,
        userId: input.userId,
      },
    },
    create: {
      leagueId: input.leagueId,
      userId: input.userId,
      role: input.role,
      teamName: input.teamName,
      draftSlot: input.draftSlot,
    },
    update: {
      role: input.role,
      teamName: input.teamName,
      draftSlot: input.draftSlot,
    },
  });

  await tx.waiverPriority.upsert({
    where: {
      leagueId_memberId: {
        leagueId: input.leagueId,
        memberId: member.id,
      },
    },
    create: {
      leagueId: input.leagueId,
      memberId: member.id,
      currentPriority: input.draftSlot,
    },
    update: {
      currentPriority: input.draftSlot,
    },
  });

  return member;
}

async function ensureBotProfile(
  tx: Prisma.TransactionClient,
  input: { leagueId: string; memberId: string; personality: BotPersonality }
) {
  await tx.leagueBotProfile.upsert({
    where: { memberId: input.memberId },
    create: {
      leagueId: input.leagueId,
      memberId: input.memberId,
      personality: input.personality,
      enabled: true,
      allowTradeInitiation: true,
      allowTradeResponses: true,
      allowWaiverClaims: true,
      activityLevel: 70,
      tradeAggression: 55,
      tradeRiskTolerance: 50,
      waiverAggression: 60,
      preferredTradeCount: 1,
      minimumActionIntervalMins: 30,
    },
    update: {
      personality: input.personality,
      enabled: true,
      allowTradeInitiation: true,
      allowTradeResponses: true,
      allowWaiverClaims: true,
    },
  });
}

async function seedIntoTransaction(
  tx: Prisma.TransactionClient,
  input: Required<Omit<SeedDevTestLeaguesInput, 'prismaClient'>>
): Promise<SeedDevTestLeaguesResult> {
  await ensureUser(tx, {
    id: input.ownerUserId,
    email: input.ownerEmail,
    displayName: input.ownerDisplayName,
  });

  const summaries: SeededLeagueSummary[] = [];

  for (const [leagueIndex, leagueName] of DEV_TEST_LEAGUE_NAMES.entries()) {
    const league = await ensureLeague(tx, {
      index: leagueIndex,
      name: leagueName,
      ownerUserId: input.ownerUserId,
    });

    await ensureMember(tx, {
      leagueId: league.id,
      userId: input.ownerUserId,
      role: LeagueRole.OWNER,
      teamName: `${input.ownerDisplayName} ${leagueIndex + 1}`,
      draftSlot: 1,
    });

    for (let botIndex = 0; botIndex < BOT_TEAM_NAMES.length; botIndex += 1) {
      const botNumber = String(botIndex + 1).padStart(2, '0');
      const botUserId = buildBotUserId(leagueIndex, botIndex);

      await ensureUser(tx, {
        id: botUserId,
        email: `dev-league-${leagueIndex + 1}-bot-${botNumber}@statly.dev`,
        displayName: `Dev League ${leagueIndex + 1} Bot ${botNumber}`,
      });

      const member = await ensureMember(tx, {
        leagueId: league.id,
        userId: botUserId,
        role: LeagueRole.MANAGER,
        teamName: BOT_TEAM_NAMES[botIndex],
        draftSlot: botIndex + 2,
      });

      await ensureBotProfile(tx, {
        leagueId: league.id,
        memberId: member.id,
        personality: BOT_PERSONALITIES[botIndex],
      });
    }

    const [members, bots] = await Promise.all([
      tx.leagueMember.count({ where: { leagueId: league.id } }),
      tx.leagueBotProfile.count({ where: { leagueId: league.id, enabled: true } }),
    ]);

    summaries.push({
      id: league.id,
      name: league.name,
      inviteCode: league.inviteCode,
      members,
      bots,
    });
  }

  return {
    ownerUserId: input.ownerUserId,
    leagues: summaries,
  };
}

export async function seedDevTestLeagues(
  input: SeedDevTestLeaguesInput = {}
): Promise<SeedDevTestLeaguesResult> {
  const bypassUser = getBypassUserDetails();
  const ownerUserId = input.ownerUserId ?? bypassUser.uid;
  const ownerEmail = input.ownerEmail ?? bypassUser.email;
  const ownerDisplayName = input.ownerDisplayName ?? bypassUser.displayName;
  const prismaClient = input.prismaClient ?? defaultPrisma;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed dev test leagues in production.');
  }

  return prismaClient.$transaction((tx) =>
    seedIntoTransaction(tx, {
      ownerUserId,
      ownerEmail,
      ownerDisplayName,
    })
  );
}
```

- [ ] **Step 2: Run TypeScript syntax check for the new module**

Run:

```bash
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Expected: either PASS, or existing unrelated app type errors. New errors mentioning `src/server/league/devTestLeagueSeeder.ts` must be fixed before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/server/league/devTestLeagueSeeder.ts
git commit -m "feat(league): add dev test league seeder"
```

✅ Completed edit 1 of 4. Ready for next edit?

### Task 2: Add Seeder Coverage

**Files:**
- Create: `src/server/league/devTestLeagueSeeder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/league/devTestLeagueSeeder.test.ts` with this content:

```ts
// @vitest-environment node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DEV_TEST_LEAGUE_NAMES, seedDevTestLeagues } from './devTestLeagueSeeder';

const DB_PATH = path.resolve(process.cwd(), 'dev_test_league_seeder_test.db');
const DATABASE_URL = `file:${DB_PATH}`;

let prisma: PrismaClient;

describe('seedDevTestLeagues', () => {
  beforeAll(() => {
    if (fs.existsSync(DB_PATH)) {
      fs.rmSync(DB_PATH);
    }

    execSync('npx prisma db push --schema prisma/schema.prisma --skip-generate', {
      env: {
        ...process.env,
        DATABASE_URL,
      },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: DATABASE_URL,
        },
      },
    });
  });

  beforeEach(async () => {
    await prisma.leagueBotProfile.deleteMany();
    await prisma.waiverPriority.deleteMany();
    await prisma.leagueMember.deleteMany();
    await prisma.league.deleteMany();
    await prisma.leagueSettings.deleteMany();
    await prisma.userCredential.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (fs.existsSync(DB_PATH)) {
      fs.rmSync(DB_PATH);
    }
  });

  it('creates three full 12-team leagues with one owner and eleven bots each', async () => {
    const result = await seedDevTestLeagues({
      prismaClient: prisma,
      ownerUserId: 'local-owner',
      ownerEmail: 'local-owner@statly.dev',
      ownerDisplayName: 'Local Owner',
    });

    expect(result.ownerUserId).toBe('local-owner');
    expect(result.leagues).toHaveLength(3);
    expect(result.leagues.map((league) => league.name)).toEqual([...DEV_TEST_LEAGUE_NAMES]);

    for (const league of result.leagues) {
      expect(league.members).toBe(12);
      expect(league.bots).toBe(11);

      const members = await prisma.leagueMember.findMany({
        where: { leagueId: league.id },
        orderBy: { draftSlot: 'asc' },
      });

      expect(members).toHaveLength(12);
      expect(members[0]).toMatchObject({
        userId: 'local-owner',
        role: 'OWNER',
        draftSlot: 1,
      });

      expect(members.slice(1).map((member) => member.draftSlot)).toEqual([
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);

      const botProfiles = await prisma.leagueBotProfile.findMany({
        where: { leagueId: league.id, enabled: true },
      });
      expect(botProfiles).toHaveLength(11);

      const waiverPriorities = await prisma.waiverPriority.findMany({
        where: { leagueId: league.id },
      });
      expect(waiverPriorities).toHaveLength(12);
    }
  });

  it('is idempotent for the same owner', async () => {
    const first = await seedDevTestLeagues({
      prismaClient: prisma,
      ownerUserId: 'local-owner',
      ownerEmail: 'local-owner@statly.dev',
      ownerDisplayName: 'Local Owner',
    });

    const second = await seedDevTestLeagues({
      prismaClient: prisma,
      ownerUserId: 'local-owner',
      ownerEmail: 'local-owner@statly.dev',
      ownerDisplayName: 'Local Owner',
    });

    expect(second.leagues.map((league) => league.id)).toEqual(
      first.leagues.map((league) => league.id)
    );
    expect(await prisma.league.count()).toBe(3);
    expect(await prisma.leagueMember.count()).toBe(36);
    expect(await prisma.leagueBotProfile.count()).toBe(33);
  });
});
```

- [ ] **Step 2: Run test to verify it fails before Task 1 exists**

If executing this task before Task 1, run:

```bash
npm test -- src/server/league/devTestLeagueSeeder.test.ts
```

Expected: FAIL because `./devTestLeagueSeeder` does not exist.

If Task 1 is already complete, run the same command and expect PASS.

- [ ] **Step 3: Run test to verify behavior**

Run:

```bash
npm test -- src/server/league/devTestLeagueSeeder.test.ts
```

Expected: PASS with both tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/server/league/devTestLeagueSeeder.test.ts
git commit -m "test(league): cover dev test league seeder"
```

✅ Completed edit 2 of 4. Ready for next edit?

### Task 3: Add CLI Entrypoint

**Files:**
- Create: `Scripts/create-dev-test-leagues.ts`

- [ ] **Step 1: Write the script**

Create `Scripts/create-dev-test-leagues.ts` with this content:

```ts
import '../src/lib/loadEnv';

import { prisma } from '@/lib/prisma';
import { seedDevTestLeagues } from '@/server/league/devTestLeagueSeeder';

async function main() {
  const result = await seedDevTestLeagues();

  console.log(`Seeded dev test leagues for owner: ${result.ownerUserId}`);
  console.table(
    result.leagues.map((league) => ({
      id: league.id,
      name: league.name,
      inviteCode: league.inviteCode,
      members: league.members,
      bots: league.bots,
      url: `http://localhost:3000/leagues/${league.id}`,
    }))
  );
}

main()
  .catch((error) => {
    console.error('Failed to seed dev test leagues.', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Run the script directly**

Run:

```bash
npx tsx Scripts/create-dev-test-leagues.ts
```

Expected: PASS, prints a table with 3 rows and each row has `members` 12 and `bots` 11.

- [ ] **Step 3: Commit**

```bash
git add Scripts/create-dev-test-leagues.ts
git commit -m "feat(league): add dev league seed command"
```

✅ Completed edit 3 of 4. Ready for next edit?

### Task 4: Add npm Script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add package script**

In `package.json`, add this entry near the other seed/bootstrap scripts:

```json
"seed:dev-leagues": "tsx Scripts/create-dev-test-leagues.ts"
```

The relevant script block should include:

```json
{
  "seed:auth": "tsx Scripts/seedAuthUsers.ts",
  "seed:dev-leagues": "tsx Scripts/create-dev-test-leagues.ts",
  "check:etl": "tsx Scripts/check-etl-setup.ts"
}
```

- [ ] **Step 2: Run the npm command**

Run:

```bash
npm run seed:dev-leagues
```

Expected: PASS, prints a table with 3 rows and each row has `members` 12 and `bots` 11.

- [ ] **Step 3: Run focused verification**

Run:

```bash
npm test -- src/server/league/devTestLeagueSeeder.test.ts
npm run typecheck:tests
```

Expected: PASS. If `typecheck:tests` reports existing unrelated repository errors, record those exact errors and confirm there are no errors in `src/server/league/devTestLeagueSeeder.ts`, `src/server/league/devTestLeagueSeeder.test.ts`, or `Scripts/create-dev-test-leagues.ts`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(league): expose dev test league seeder"
```

✅ Completed edit 4 of 4. Ready for final verification?

## Final Verification

- [ ] Run:

```bash
npm test -- src/server/league/devTestLeagueSeeder.test.ts
npm run seed:dev-leagues
```

Expected:
- Test suite passes.
- Seed command prints exactly 3 leagues.
- Each league row reports `members` as `12`.
- Each league row reports `bots` as `11`.
- Opening `http://localhost:3000/leagues/<id>` while logged in as the bypass user shows the owner membership for that league.

- [ ] Run:

```bash
npm run branch:complete
```

Expected: PASS, or document existing unrelated failures.

## Operational Risk

- Low production risk because the command is a local script and refuses production.
- Moderate local-data risk because it writes to the configured Prisma database. The stable league names and invite codes make the operation repeatable and easy to inspect.
- It does not seed rosters. If roster-level testing is needed after this, run existing `tsx Scripts/seedLeagueRosterPlayers.ts --fill-random --leagueId=<leagueId>` for each seeded league or add a follow-up plan to integrate roster seeding.

## Self-Review

- Spec coverage: The plan creates 3 leagues, 12 teams in each, one human owner/team, and 11 bot teams per league.
- Placeholder scan: No task contains TBD, TODO, or an unspecified implementation step.
- Type consistency: The plan consistently uses `seedDevTestLeagues`, `DEV_TEST_LEAGUE_NAMES`, `SeedDevTestLeaguesResult`, `LeagueRole`, and `BotPersonality`.
