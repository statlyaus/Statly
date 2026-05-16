# Dev Fixture E2E System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a long-term dev fixture platform that can apply, verify, list, and safely reset end-to-end product testing scenarios, beginning with 3 complete 12-team AFL fantasy leagues where the current dev user owns one team and 11 bot teams fill each league.

**Architecture:** Implement reusable fixture infrastructure under `src/server/devFixtures/` with a core runner, manifest, safety guards, prerequisite checks, fixture services, scenario registry, readiness verifier, and CLI. Scenarios compose existing domain services first (`LeagueApplicationService`, `botManagerService`, draft provisioning, season bootstrap), and use direct Prisma only for fixture-owned identity records, deterministic lookup, roster ownership rows, and verification reads. This prevents one-off seed drift and gives future trade, waiver, draft, matchup, and browser E2E work a stable foundation.

**Tech Stack:** Next.js App Router repo, TypeScript, Prisma SQLite client, Vitest, existing league/draft/bot/season services, `tsx` CLI scripts, npm scripts.

---

## Scope Check

This is one coherent subsystem: a dev fixture platform plus the first scenario. It deliberately does not add Playwright/browser tests in this task, but it must output stable URLs and optional JSON so browser automation can consume the fixture state later.

This does not change the Footywire canonical raw-match contract. It creates app-facing fixture data by using existing application workflows and local Prisma tables.

## Why The Previous Plan Was Not Enough

- It was still centered on one large `fullLeagueScenario.ts`, which would become a new one-off script as soon as trades, waivers, draft states, or matchup variants were added.
- It had no fixture manifest, so ownership, reset safety, scenario listing, and verification were not explicit.
- It lacked CLI modes. A durable system needs `list`, `apply`, `verify`, and `reset --fixture-owned`.
- It treated missing player data as a late runtime issue instead of a prerequisite with actionable output.
- It mixed reusable concerns: user creation, league setup, roster allocation, bot profiles, draft provisioning, season bootstrap, and verification.
- It relied on broad orchestration mock counts instead of focused service contracts.
- It did not document the resulting developer workflow.

## Target Design

### CLI

```bash
npm run dev:fixtures -- list
npm run dev:fixtures -- apply full-leagues
npm run dev:fixtures -- verify full-leagues
npm run dev:fixtures -- reset full-leagues --fixture-owned
npm run dev:fixtures -- apply full-leagues --json
```

### Scenario 1: `full-leagues`

Creates or repairs:

- 3 private leagues named `Statly Fixture Full League 1..3`
- current dev/bypass user as owner in draft slot 1
- 11 fixture bot users per league in slots 2-12
- 11 enabled bot profiles per league
- deterministic rosters for every member when enough active players exist
- draft provisioning through the existing draft service
- season bootstrap through existing league season materialization
- readiness report with app URLs

### Safety Rules

- Refuse `NODE_ENV=production`.
- Refuse reset unless `--fixture-owned` is present.
- Never delete or mutate non-fixture members.
- If a fixture league contains unexpected non-fixture members, fail with a clear safety error.
- Direct Prisma writes must be isolated in fixture services and only for fixture-owned records or verification reads.

## File Structure

- Create `src/server/devFixtures/core/types.ts`
  - Shared command, scenario, manifest, result, prerequisite, and verification types.
- Create `src/server/devFixtures/core/manifest.ts`
  - Single registry of scenario ids, fixture names, bot id prefixes, and reset ownership rules.
- Create `src/server/devFixtures/core/safety.ts`
  - Production guard, fixture identity checks, unexpected-member guard, reset guard.
- Create `src/server/devFixtures/core/prerequisites.ts`
  - Player data and environment readiness checks.
- Create `src/server/devFixtures/core/report.ts`
  - Text and JSON report formatting.
- Create `src/server/devFixtures/core/runner.ts`
  - Command dispatcher for `list`, `apply`, `verify`, and `reset`.
- Create `src/server/devFixtures/services/fixtureUserService.ts`
  - Ensures owner and bot user records exist.
- Create `src/server/devFixtures/services/fixtureLeagueService.ts`
  - Creates or repairs leagues/members through `LeagueApplicationService`.
- Create `src/server/devFixtures/services/fixtureBotService.ts`
  - Creates bot profiles through `botManagerService`.
- Create `src/server/devFixtures/services/fixtureRosterService.ts`
  - Allocates deterministic rosters from real active players.
- Create `src/server/devFixtures/services/fixtureDraftService.ts`
  - Wraps draft provisioning.
- Create `src/server/devFixtures/services/fixtureSeasonService.ts`
  - Wraps season bootstrap.
- Create `src/server/devFixtures/services/fixtureVerifier.ts`
  - Reads app-facing readiness and reports failures.
- Create `src/server/devFixtures/scenarios/fullLeaguesScenario.ts`
  - Scenario orchestration only, using the services above.
- Create `src/server/devFixtures/scenarios/index.ts`
  - Scenario registry.
- Create `src/server/devFixtures/scripts/runDevFixtures.ts`
  - Typechecked CLI entrypoint.
- Create focused tests beside each core/service/scenario module.
- Modify `package.json`
  - Add `dev:fixtures`.
- Create `docs/DEV_FIXTURES.md`
  - Developer workflow and safety model.

## PROPOSED EDIT PLAN
Working with: `src/server/devFixtures/**`, `package.json`, `docs/DEV_FIXTURES.md`
Total planned edits: 10

### Edit sequence:
1. Core contracts and manifest - Purpose: define the platform boundary and fixture ownership model.
2. Safety and prerequisites - Purpose: prevent production/user-data damage and fail early when player data is missing.
3. Reporting and CLI command parsing - Purpose: stable human and JSON output for future automation.
4. Runner - Purpose: support `list`, `apply`, `verify`, and `reset`.
5. Fixture services - Purpose: keep reusable setup operations small and testable.
6. Full leagues scenario - Purpose: implement the immediate 3-league, 12-team E2E fixture.
7. Verifier - Purpose: prove fixture readiness after creation and as a standalone command.
8. CLI and npm script - Purpose: make the system easy to run.
9. Documentation - Purpose: make the workflow repeatable for humans and agents.
10. Final verification - Purpose: run focused tests, typechecks, fixture command, and branch hygiene.

## Task 1: Core Contracts And Manifest

**Files:**
- Create: `src/server/devFixtures/core/types.ts`
- Create: `src/server/devFixtures/core/manifest.ts`
- Test: `src/server/devFixtures/core/manifest.test.ts`

- [ ] **Step 1: Write failing manifest tests**

```ts
// src/server/devFixtures/core/manifest.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/server/devFixtures/core/manifest.test.ts
```

Expected: FAIL because `manifest.ts` does not exist.

- [ ] **Step 3: Implement types and manifest**

```ts
// src/server/devFixtures/core/types.ts
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
  draftStatus: string;
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

export class DevFixturePrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevFixturePrerequisiteError';
  }
}
```

```ts
// src/server/devFixtures/core/manifest.ts
import type { DevFixtureScenarioId, DevFixtureScenarioManifest } from './types';

export const DEV_FIXTURE_MANIFEST = {
  scenarios: [
    {
      id: 'full-leagues',
      description:
        'Three complete 12-team leagues with owner, bots, rosters, drafts, and season state.',
      leagueNamePrefix: 'Statly Fixture Full League',
      leagueCount: 3,
      teamsPerLeague: 12,
      botTeamsPerLeague: 11,
      botUserIdPrefix: 'statly-fixture-full-league-',
    },
  ] satisfies DevFixtureScenarioManifest[],
};

export function getDevFixtureScenarioManifest(id: DevFixtureScenarioId) {
  const scenario = DEV_FIXTURE_MANIFEST.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown dev fixture scenario: ${id}`);
  }
  return scenario;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/server/devFixtures/core/manifest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/devFixtures/core/types.ts src/server/devFixtures/core/manifest.ts src/server/devFixtures/core/manifest.test.ts
git commit -m "feat(dev-fixtures): define fixture manifest"
```

## Task 2: Safety And Prerequisites

**Files:**
- Create: `src/server/devFixtures/core/safety.ts`
- Create: `src/server/devFixtures/core/prerequisites.ts`
- Test: `src/server/devFixtures/core/safety.test.ts`
- Test: `src/server/devFixtures/core/prerequisites.test.ts`

- [ ] **Step 1: Write failing safety tests**

```ts
// src/server/devFixtures/core/safety.test.ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertCanResetFixture,
  assertDevFixtureSafeToRun,
  assertNoUnexpectedMembers,
  isFixtureBotUserId,
} from './safety';
import { DevFixtureSafetyError } from './types';

describe('dev fixture safety', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses production runs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertDevFixtureSafeToRun()).toThrow(DevFixtureSafetyError);
  });

  it('requires explicit fixture-owned reset confirmation', () => {
    expect(() => assertCanResetFixture({ fixtureOwned: false })).toThrow(
      'Reset requires --fixture-owned'
    );
    expect(() => assertCanResetFixture({ fixtureOwned: true })).not.toThrow();
  });

  it('identifies fixture bot users by manifest prefix', () => {
    expect(isFixtureBotUserId('statly-fixture-full-league-1-bot-01')).toBe(true);
    expect(isFixtureBotUserId('statly-dev-tester')).toBe(false);
  });

  it('rejects unexpected non-fixture members', () => {
    expect(() =>
      assertNoUnexpectedMembers({
        leagueName: 'Statly Fixture Full League 1',
        ownerUserId: 'statly-dev-tester',
        members: [{ userId: 'real-user' }],
      })
    ).toThrow('unexpected non-fixture members');
  });
});
```

- [ ] **Step 2: Write failing prerequisite tests**

```ts
// src/server/devFixtures/core/prerequisites.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { checkFullLeaguePrerequisites } from './prerequisites';

describe('dev fixture prerequisites', () => {
  it('reports active player shortage', async () => {
    const prisma = {
      player: {
        count: vi.fn().mockResolvedValue(100),
      },
    };

    const result = await checkFullLeaguePrerequisites({
      prisma,
      requiredActivePlayers: 264,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(['Need 264 active players for full-leagues; found 100.']);
  });

  it('passes when enough active players exist', async () => {
    const prisma = {
      player: {
        count: vi.fn().mockResolvedValue(300),
      },
    };

    const result = await checkFullLeaguePrerequisites({
      prisma,
      requiredActivePlayers: 264,
    });

    expect(result).toEqual({ ok: true, issues: [] });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- src/server/devFixtures/core/safety.test.ts src/server/devFixtures/core/prerequisites.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement safety and prerequisites**

```ts
// src/server/devFixtures/core/safety.ts
import { getDevFixtureScenarioManifest } from './manifest';
import { DevFixtureSafetyError } from './types';

const fullLeagues = getDevFixtureScenarioManifest('full-leagues');

export function assertDevFixtureSafeToRun() {
  if (process.env.NODE_ENV === 'production') {
    throw new DevFixtureSafetyError('Refusing to run dev fixtures in production.');
  }
}

export function assertCanResetFixture(input: { fixtureOwned: boolean }) {
  if (!input.fixtureOwned) {
    throw new DevFixtureSafetyError('Reset requires --fixture-owned.');
  }
}

export function isFixtureBotUserId(userId: string) {
  return userId.startsWith(fullLeagues.botUserIdPrefix);
}

export function assertNoUnexpectedMembers(input: {
  leagueName: string;
  ownerUserId: string;
  members: Array<{ userId: string }>;
}) {
  const unexpected = input.members.filter(
    (member) => member.userId !== input.ownerUserId && !isFixtureBotUserId(member.userId)
  );

  if (unexpected.length > 0) {
    throw new DevFixtureSafetyError(
      `Fixture league "${input.leagueName}" contains unexpected non-fixture members: ${unexpected
        .map((member) => member.userId)
        .join(', ')}`
    );
  }
}
```

```ts
// src/server/devFixtures/core/prerequisites.ts
type PlayerCountClient = {
  player: {
    count(args: { where: { active: true } }): Promise<number>;
  };
};

export async function checkFullLeaguePrerequisites(input: {
  prisma: PlayerCountClient;
  requiredActivePlayers: number;
}) {
  const activePlayerCount = await input.prisma.player.count({ where: { active: true } });
  if (activePlayerCount < input.requiredActivePlayers) {
    return {
      ok: false,
      issues: [
        `Need ${input.requiredActivePlayers} active players for full-leagues; found ${activePlayerCount}.`,
      ],
    };
  }

  return { ok: true, issues: [] };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- src/server/devFixtures/core/safety.test.ts src/server/devFixtures/core/prerequisites.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/devFixtures/core/safety.ts src/server/devFixtures/core/safety.test.ts src/server/devFixtures/core/prerequisites.ts src/server/devFixtures/core/prerequisites.test.ts
git commit -m "feat(dev-fixtures): add fixture safety checks"
```

## Task 3: Reporting And Runner

**Files:**
- Create: `src/server/devFixtures/core/report.ts`
- Create: `src/server/devFixtures/core/runner.ts`
- Test: `src/server/devFixtures/core/runner.test.ts`

- [ ] **Step 1: Write failing runner/report tests**

```ts
// src/server/devFixtures/core/runner.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { formatDevFixtureReport } from './report';
import { runDevFixtureCommand } from './runner';
import type { DevFixtureScenario } from './types';

function buildScenario(): DevFixtureScenario {
  return {
    id: 'full-leagues',
    apply: vi.fn().mockResolvedValue({
      command: 'apply',
      scenarioId: 'full-leagues',
      ownerUserId: 'owner-1',
      ok: true,
      steps: [{ name: 'apply', status: 'verified', detail: 'done' }],
      leagues: [],
    }),
    verify: vi.fn().mockResolvedValue({
      command: 'verify',
      scenarioId: 'full-leagues',
      ownerUserId: 'owner-1',
      ok: true,
      steps: [],
      leagues: [],
    }),
    reset: vi.fn().mockResolvedValue({
      command: 'reset',
      scenarioId: 'full-leagues',
      ownerUserId: 'owner-1',
      ok: true,
      steps: [],
      leagues: [],
    }),
  };
}

describe('runDevFixtureCommand', () => {
  it('lists scenarios', async () => {
    const result = await runDevFixtureCommand({
      command: 'list',
      scenarios: [buildScenario()],
      fixtureOwned: false,
    });

    expect(result.ok).toBe(true);
    expect(result.steps[0].detail).toContain('full-leagues');
  });

  it('dispatches apply', async () => {
    const scenario = buildScenario();
    const result = await runDevFixtureCommand({
      command: 'apply',
      scenarioId: 'full-leagues',
      scenarios: [scenario],
      fixtureOwned: false,
    });

    expect(scenario.apply).toHaveBeenCalledOnce();
    expect(result.command).toBe('apply');
  });

  it('passes reset confirmation into scenario reset', async () => {
    const scenario = buildScenario();
    await runDevFixtureCommand({
      command: 'reset',
      scenarioId: 'full-leagues',
      scenarios: [scenario],
      fixtureOwned: true,
    });

    expect(scenario.reset).toHaveBeenCalledWith({ fixtureOwned: true });
  });
});

describe('formatDevFixtureReport', () => {
  it('prints readiness and urls', () => {
    const text = formatDevFixtureReport({
      command: 'apply',
      scenarioId: 'full-leagues',
      ownerUserId: 'owner-1',
      ok: true,
      steps: [{ name: 'league', status: 'verified', detail: 'done' }],
      leagues: [
        {
          id: 'league-1',
          name: 'Statly Fixture Full League 1',
          inviteCode: 'ABC123',
          url: 'http://localhost:3000/leagues/league-1',
          memberCount: 12,
          botCount: 11,
          rosteredMemberCount: 12,
          draftStatus: 'created',
          seasonWeeks: 12,
          matchupCount: 66,
          ready: true,
          issues: [],
        },
      ],
    });

    expect(text).toContain('Command: apply');
    expect(text).toContain('Scenario: full-leagues');
    expect(text).toContain('ready=true members=12 bots=11 rostered=12 draft=created weeks=12 matchups=66');
    expect(text).toContain('http://localhost:3000/leagues/league-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/server/devFixtures/core/runner.test.ts
```

Expected: FAIL because `runner.ts` and `report.ts` do not exist.

- [ ] **Step 3: Implement report and runner**

```ts
// src/server/devFixtures/core/report.ts
import type { DevFixtureRunResult } from './types';

export function formatDevFixtureReport(result: DevFixtureRunResult) {
  const lines = [
    `Command: ${result.command}`,
    `Scenario: ${result.scenarioId ?? 'all'}`,
    `Owner: ${result.ownerUserId ?? 'n/a'}`,
    `OK: ${result.ok}`,
    '',
    'Steps:',
    ...result.steps.map((step) => `- ${step.status} ${step.name} - ${step.detail}`),
    '',
    'Leagues:',
    ...result.leagues.flatMap((league) => [
      `- ${league.name} (${league.id}) code=${league.inviteCode}`,
      `  ready=${league.ready} members=${league.memberCount} bots=${league.botCount} rostered=${league.rosteredMemberCount} draft=${league.draftStatus} weeks=${league.seasonWeeks} matchups=${league.matchupCount}`,
      ...(league.issues.length > 0 ? [`  issues=${league.issues.join('; ')}`] : []),
      `  ${league.url}`,
    ]),
  ];

  return lines.join('\n');
}
```

```ts
// src/server/devFixtures/core/runner.ts
import { DEV_FIXTURE_MANIFEST } from './manifest';
import type {
  DevFixtureCommand,
  DevFixtureRunResult,
  DevFixtureScenario,
  DevFixtureScenarioId,
} from './types';

function findScenario(id: DevFixtureScenarioId, scenarios: DevFixtureScenario[]) {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(
      `Unknown dev fixture scenario "${id}". Available scenarios: ${scenarios
        .map((candidate) => candidate.id)
        .join(', ')}`
    );
  }
  return scenario;
}

export async function runDevFixtureCommand(input: {
  command: DevFixtureCommand;
  scenarioId?: DevFixtureScenarioId;
  scenarios: DevFixtureScenario[];
  fixtureOwned: boolean;
}): Promise<DevFixtureRunResult> {
  if (input.command === 'list') {
    return {
      command: 'list',
      ok: true,
      steps: [
        {
          name: 'scenarios',
          status: 'verified',
          detail: DEV_FIXTURE_MANIFEST.scenarios
            .map((scenario) => `${scenario.id}: ${scenario.description}`)
            .join(' | '),
        },
      ],
      leagues: [],
    };
  }

  if (!input.scenarioId) {
    throw new Error(`Scenario id is required for ${input.command}.`);
  }

  const scenario = findScenario(input.scenarioId, input.scenarios);
  if (input.command === 'apply') return scenario.apply();
  if (input.command === 'verify') return scenario.verify();
  return scenario.reset({ fixtureOwned: input.fixtureOwned });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/server/devFixtures/core/runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/devFixtures/core/report.ts src/server/devFixtures/core/runner.ts src/server/devFixtures/core/runner.test.ts
git commit -m "feat(dev-fixtures): add fixture runner"
```

## Task 4: Fixture Services

**Files:**
- Create: `src/server/devFixtures/services/fixtureUserService.ts`
- Create: `src/server/devFixtures/services/fixtureLeagueService.ts`
- Create: `src/server/devFixtures/services/fixtureBotService.ts`
- Create: `src/server/devFixtures/services/fixtureRosterService.ts`
- Create: `src/server/devFixtures/services/fixtureDraftService.ts`
- Create: `src/server/devFixtures/services/fixtureSeasonService.ts`
- Test: focused `.test.ts` files for user, league, roster services

- [ ] **Step 1: Write service tests**

Create focused tests that verify:

```ts
// src/server/devFixtures/services/fixtureRosterService.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { allocateFixtureRosters } from './fixtureRosterService';

describe('allocateFixtureRosters', () => {
  it('allocates deterministic unique player slices by draft slot', async () => {
    const prisma = {
      player: {
        findMany: vi.fn().mockResolvedValue(
          Array.from({ length: 6 }).map((_, index) => ({ id: `player-${index + 1}` }))
        ),
      },
      leagueRoster: { upsert: vi.fn().mockResolvedValue({}) },
      leagueRosterPlayer: { upsert: vi.fn().mockResolvedValue({}) },
    };

    const result = await allocateFixtureRosters({
      prisma,
      leagueId: 'league-1',
      rosterSize: 3,
      members: [
        { id: 'member-1', draftSlot: 1 },
        { id: 'member-2', draftSlot: 2 },
      ],
    });

    expect(result).toEqual({ rosteredMemberCount: 2, playerCount: 6, issues: [] });
    expect(prisma.leagueRosterPlayer.upsert).toHaveBeenCalledTimes(6);
  });

  it('reports a shortage without partial roster writes', async () => {
    const prisma = {
      player: { findMany: vi.fn().mockResolvedValue([{ id: 'player-1' }]) },
      leagueRoster: { upsert: vi.fn() },
      leagueRosterPlayer: { upsert: vi.fn() },
    };

    const result = await allocateFixtureRosters({
      prisma,
      leagueId: 'league-1',
      rosterSize: 3,
      members: [{ id: 'member-1', draftSlot: 1 }],
    });

    expect(result.issues).toEqual(['Need 3 active players for rosters in league-1; found 1.']);
    expect(prisma.leagueRosterPlayer.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement services**

Key service contracts:

```ts
// src/server/devFixtures/services/fixtureRosterService.ts
type RosterPrisma = {
  player: {
    findMany(args: {
      where: { active: true };
      select: { id: true };
      orderBy: Array<{ position: 'asc' } | { name: 'asc' }>;
      take: number;
    }): Promise<Array<{ id: string }>>;
  };
  leagueRoster: {
    upsert(args: {
      where: { leagueId_memberId: { leagueId: string; memberId: string } };
      create: { leagueId: string; memberId: string };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
  leagueRosterPlayer: {
    upsert(args: {
      where: { leagueId_memberId_playerId: { leagueId: string; memberId: string; playerId: string } };
      create: { leagueId: string; memberId: string; playerId: string; sortOrder: number };
      update: { sortOrder: number };
    }): Promise<unknown>;
  };
};

export async function allocateFixtureRosters(input: {
  prisma: RosterPrisma;
  leagueId: string;
  rosterSize: number;
  members: Array<{ id: string; draftSlot: number | null }>;
}) {
  const orderedMembers = [...input.members].sort(
    (left, right) => (left.draftSlot ?? 999) - (right.draftSlot ?? 999)
  );
  const requiredPlayers = orderedMembers.length * input.rosterSize;
  const players = await input.prisma.player.findMany({
    where: { active: true },
    select: { id: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    take: requiredPlayers,
  });

  if (players.length < requiredPlayers) {
    return {
      rosteredMemberCount: 0,
      playerCount: players.length,
      issues: [
        `Need ${requiredPlayers} active players for rosters in ${input.leagueId}; found ${players.length}.`,
      ],
    };
  }

  for (const [memberIndex, member] of orderedMembers.entries()) {
    await input.prisma.leagueRoster.upsert({
      where: { leagueId_memberId: { leagueId: input.leagueId, memberId: member.id } },
      create: { leagueId: input.leagueId, memberId: member.id },
      update: {},
    });

    const memberPlayers = players.slice(
      memberIndex * input.rosterSize,
      memberIndex * input.rosterSize + input.rosterSize
    );

    for (const [sortOrder, player] of memberPlayers.entries()) {
      await input.prisma.leagueRosterPlayer.upsert({
        where: {
          leagueId_memberId_playerId: {
            leagueId: input.leagueId,
            memberId: member.id,
            playerId: player.id,
          },
        },
        create: {
          leagueId: input.leagueId,
          memberId: member.id,
          playerId: player.id,
          sortOrder,
        },
        update: { sortOrder },
      });
    }
  }

  return { rosteredMemberCount: orderedMembers.length, playerCount: players.length, issues: [] };
}
```

For the other services, keep them thin wrappers:

- `fixtureUserService.ensureFixtureUser` uses `prisma.user.upsert`.
- `fixtureLeagueService.ensureFixtureLeague` uses `leagueApplicationService.createLeague` and existing league lookup.
- `fixtureLeagueService.ensureFixtureMembers` uses `joinLeague` and `reorderLeagueDraftSlots`.
- `fixtureBotService.ensureFixtureBotProfiles` uses `botManagerService.upsertProfiles`.
- `fixtureDraftService.provisionFixtureDraft` calls `leagueDraftProvisioningService.syncFromLeagueSettings`.
- `fixtureSeasonService.bootstrapFixtureSeason` calls `bootstrapLeagueSeason`.

- [ ] **Step 3: Run service tests**

```bash
npm test -- src/server/devFixtures/services/fixtureRosterService.test.ts
```

Expected: PASS. Add similarly focused tests for user and league wrappers if implementation touches non-trivial logic.

- [ ] **Step 4: Commit**

```bash
git add src/server/devFixtures/services
git commit -m "feat(dev-fixtures): add reusable fixture services"
```

## Task 5: Readiness Verifier

**Files:**
- Create: `src/server/devFixtures/services/fixtureVerifier.ts`
- Test: `src/server/devFixtures/services/fixtureVerifier.test.ts`

- [ ] **Step 1: Write failing verifier test**

```ts
// src/server/devFixtures/services/fixtureVerifier.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { verifyFixtureLeague } from './fixtureVerifier';

describe('verifyFixtureLeague', () => {
  it('reports readiness issues from app-facing records', async () => {
    const prisma = {
      league: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'league-1',
          name: 'Statly Fixture Full League 1',
          inviteCode: 'ABC123',
          members: [{ userId: 'owner-1' }],
          botProfiles: [],
          rosterPlayers: [],
          drafts: [],
        }),
      },
    };

    const result = await verifyFixtureLeague({
      prisma,
      leagueId: 'league-1',
      baseUrl: 'http://localhost:3000',
      expectedMembers: 12,
      expectedBots: 11,
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toContain('Expected 12 members; found 1.');
    expect(result.issues).toContain('Expected 11 bot profiles; found 0.');
    expect(result.issues).toContain('No draft found.');
  });
});
```

- [ ] **Step 2: Implement verifier**

```ts
// src/server/devFixtures/services/fixtureVerifier.ts
import type { DevFixtureLeagueReadiness } from '../core/types';

type VerifierPrisma = {
  league: {
    findUnique(args: {
      where: { id: string };
      include: {
        members: true;
        botProfiles: true;
        rosterPlayers: true;
        drafts: { take: 1; orderBy: { createdAt: 'desc' } };
      };
    }): Promise<{
      id: string;
      name: string;
      inviteCode: string;
      members: unknown[];
      botProfiles: unknown[];
      rosterPlayers: Array<{ memberId?: string }>;
      drafts: Array<{ status: string }>;
    } | null>;
  };
};

export async function verifyFixtureLeague(input: {
  prisma: VerifierPrisma;
  leagueId: string;
  baseUrl: string;
  expectedMembers: number;
  expectedBots: number;
  seasonWeeks?: number;
  matchupCount?: number;
}): Promise<DevFixtureLeagueReadiness> {
  const league = await input.prisma.league.findUnique({
    where: { id: input.leagueId },
    include: {
      members: true,
      botProfiles: true,
      rosterPlayers: true,
      drafts: { take: 1, orderBy: { createdAt: 'desc' } },
    },
  });

  if (!league) {
    return {
      id: input.leagueId,
      name: 'missing',
      inviteCode: 'missing',
      url: `${input.baseUrl}/leagues/${input.leagueId}`,
      memberCount: 0,
      botCount: 0,
      rosteredMemberCount: 0,
      draftStatus: 'missing',
      seasonWeeks: input.seasonWeeks ?? 0,
      matchupCount: input.matchupCount ?? 0,
      ready: false,
      issues: ['League not found.'],
    };
  }

  const rosteredMemberCount = new Set(league.rosterPlayers.map((row) => row.memberId)).size;
  const draftStatus = league.drafts[0]?.status ?? 'missing';
  const issues = [];

  if (league.members.length !== input.expectedMembers) {
    issues.push(`Expected ${input.expectedMembers} members; found ${league.members.length}.`);
  }
  if (league.botProfiles.length !== input.expectedBots) {
    issues.push(`Expected ${input.expectedBots} bot profiles; found ${league.botProfiles.length}.`);
  }
  if (draftStatus === 'missing') {
    issues.push('No draft found.');
  }

  return {
    id: league.id,
    name: league.name,
    inviteCode: league.inviteCode,
    url: `${input.baseUrl}/leagues/${league.id}`,
    memberCount: league.members.length,
    botCount: league.botProfiles.length,
    rosteredMemberCount,
    draftStatus,
    seasonWeeks: input.seasonWeeks ?? 0,
    matchupCount: input.matchupCount ?? 0,
    ready: issues.length === 0,
    issues,
  };
}
```

- [ ] **Step 3: Run verifier test**

```bash
npm test -- src/server/devFixtures/services/fixtureVerifier.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/devFixtures/services/fixtureVerifier.ts src/server/devFixtures/services/fixtureVerifier.test.ts
git commit -m "feat(dev-fixtures): verify fixture readiness"
```

## Task 6: Full Leagues Scenario

**Files:**
- Create: `src/server/devFixtures/scenarios/fullLeaguesScenario.ts`
- Create: `src/server/devFixtures/scenarios/index.ts`
- Test: `src/server/devFixtures/scenarios/fullLeaguesScenario.test.ts`

- [ ] **Step 1: Write failing scenario test**

```ts
// src/server/devFixtures/scenarios/fullLeaguesScenario.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createFullLeaguesScenario } from './fullLeaguesScenario';

describe('fullLeaguesScenario', () => {
  it('applies three full leagues through fixture services', async () => {
    const services = {
      getOwner: () => ({ uid: 'owner-1', email: 'owner@example.com', displayName: 'Owner' }),
      checkPrerequisites: vi.fn().mockResolvedValue({ ok: true, issues: [] }),
      ensureLeague: vi.fn().mockImplementation(async ({ index }) => ({
        id: `league-${index + 1}`,
        name: `Statly Fixture Full League ${index + 1}`,
        inviteCode: `CODE${index + 1}`,
      })),
      ensureMembers: vi.fn().mockResolvedValue(
        Array.from({ length: 12 }).map((_, index) => ({
          id: `member-${index + 1}`,
          userId: index === 0 ? 'owner-1' : `bot-${index}`,
          draftSlot: index + 1,
        }))
      ),
      ensureBotProfiles: vi.fn().mockResolvedValue(undefined),
      allocateRosters: vi.fn().mockResolvedValue({ rosteredMemberCount: 12, issues: [] }),
      provisionDraft: vi.fn().mockResolvedValue({ status: 'created' }),
      bootstrapSeason: vi.fn().mockResolvedValue({ weekCount: 12, matchupCount: 66 }),
      verifyLeague: vi.fn().mockImplementation(async ({ leagueId }) => ({
        id: leagueId,
        name: leagueId,
        inviteCode: 'CODE',
        url: `http://localhost:3000/leagues/${leagueId}`,
        memberCount: 12,
        botCount: 11,
        rosteredMemberCount: 12,
        draftStatus: 'created',
        seasonWeeks: 12,
        matchupCount: 66,
        ready: true,
        issues: [],
      })),
      resetFixtureOwned: vi.fn().mockResolvedValue({ deletedLeagues: 3 }),
    };

    const scenario = createFullLeaguesScenario(services);
    const result = await scenario.apply();

    expect(result.ok).toBe(true);
    expect(result.leagues).toHaveLength(3);
    expect(services.ensureLeague).toHaveBeenCalledTimes(3);
    expect(services.ensureMembers).toHaveBeenCalledTimes(3);
    expect(services.verifyLeague).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Implement scenario**

```ts
// src/server/devFixtures/scenarios/fullLeaguesScenario.ts
import { getBypassUserDetails } from '@/lib/authBypass';
import { prisma } from '@/lib/prisma';

import { getDevFixtureScenarioManifest } from '../core/manifest';
import { checkFullLeaguePrerequisites } from '../core/prerequisites';
import { assertCanResetFixture, assertDevFixtureSafeToRun } from '../core/safety';
import type { DevFixtureScenario, DevFixtureStepResult } from '../core/types';
import { ensureFixtureBotProfiles } from '../services/fixtureBotService';
import { provisionFixtureDraft } from '../services/fixtureDraftService';
import { ensureFixtureLeague, ensureFixtureMembers, resetFixtureOwnedLeagues } from '../services/fixtureLeagueService';
import { allocateFixtureRosters } from '../services/fixtureRosterService';
import { bootstrapFixtureSeason } from '../services/fixtureSeasonService';
import { verifyFixtureLeague } from '../services/fixtureVerifier';

const manifest = getDevFixtureScenarioManifest('full-leagues');
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const season = Number(process.env.STATLY_FIXTURE_SEASON || new Date().getFullYear());
const rosterSize = 22;

export function createFullLeaguesScenario(services = {
  getOwner: getBypassUserDetails,
  checkPrerequisites: (requiredActivePlayers: number) =>
    checkFullLeaguePrerequisites({ prisma, requiredActivePlayers }),
  ensureLeague: ensureFixtureLeague,
  ensureMembers: ensureFixtureMembers,
  ensureBotProfiles: ensureFixtureBotProfiles,
  allocateRosters: (input: Parameters<typeof allocateFixtureRosters>[0]) =>
    allocateFixtureRosters({ ...input, prisma }),
  provisionDraft: provisionFixtureDraft,
  bootstrapSeason: bootstrapFixtureSeason,
  verifyLeague: (input: Omit<Parameters<typeof verifyFixtureLeague>[0], 'prisma'>) =>
    verifyFixtureLeague({ ...input, prisma }),
  resetFixtureOwned: resetFixtureOwnedLeagues,
}): DevFixtureScenario {
  return {
    id: 'full-leagues',
    async apply() {
      assertDevFixtureSafeToRun();
      const owner = services.getOwner();
      const steps: DevFixtureStepResult[] = [];
      const requiredActivePlayers = manifest.leagueCount * manifest.teamsPerLeague * rosterSize;
      const prerequisite = await services.checkPrerequisites(requiredActivePlayers);
      if (!prerequisite.ok) {
        return {
          command: 'apply',
          scenarioId: 'full-leagues',
          ownerUserId: owner.uid,
          ok: false,
          steps: prerequisite.issues.map((issue) => ({ name: 'prerequisites', status: 'failed', detail: issue })),
          leagues: [],
        };
      }

      const leagues = [];
      for (let index = 0; index < manifest.leagueCount; index += 1) {
        const league = await services.ensureLeague({ index, owner });
        const members = await services.ensureMembers({ league, index, owner });
        await services.ensureBotProfiles({ leagueId: league.id, ownerUserId: owner.uid, members });
        const roster = await services.allocateRosters({ leagueId: league.id, rosterSize, members });
        const draft = await services.provisionDraft({ leagueId: league.id });
        const seasonResult = await services.bootstrapSeason({ leagueId: league.id, season });
        const readiness = await services.verifyLeague({
          leagueId: league.id,
          baseUrl,
          expectedMembers: manifest.teamsPerLeague,
          expectedBots: manifest.botTeamsPerLeague,
          seasonWeeks: seasonResult.weekCount,
          matchupCount: seasonResult.matchupCount,
        });

        steps.push({
          name: league.name,
          status: readiness.ready ? 'verified' : 'failed',
          detail: `draft=${draft.status} rostered=${roster.rosteredMemberCount}`,
        });
        leagues.push(readiness);
      }

      return {
        command: 'apply',
        scenarioId: 'full-leagues',
        ownerUserId: owner.uid,
        ok: leagues.every((league) => league.ready),
        steps,
        leagues,
      };
    },
    async verify() {
      assertDevFixtureSafeToRun();
      const owner = services.getOwner();
      const leagues = [];
      for (let index = 0; index < manifest.leagueCount; index += 1) {
        const league = await services.ensureLeague({ index, owner });
        leagues.push(
          await services.verifyLeague({
            leagueId: league.id,
            baseUrl,
            expectedMembers: manifest.teamsPerLeague,
            expectedBots: manifest.botTeamsPerLeague,
          })
        );
      }
      return {
        command: 'verify',
        scenarioId: 'full-leagues',
        ownerUserId: owner.uid,
        ok: leagues.every((league) => league.ready),
        steps: [],
        leagues,
      };
    },
    async reset(input) {
      assertDevFixtureSafeToRun();
      assertCanResetFixture(input);
      const owner = services.getOwner();
      const reset = await services.resetFixtureOwned({ ownerUserId: owner.uid });
      return {
        command: 'reset',
        scenarioId: 'full-leagues',
        ownerUserId: owner.uid,
        ok: true,
        steps: [{ name: 'reset', status: 'verified', detail: `deletedLeagues=${reset.deletedLeagues}` }],
        leagues: [],
      };
    },
  };
}

export const fullLeaguesScenario = createFullLeaguesScenario();
```

```ts
// src/server/devFixtures/scenarios/index.ts
import { fullLeaguesScenario } from './fullLeaguesScenario';

export const devFixtureScenarios = [fullLeaguesScenario];
```

- [ ] **Step 3: Run scenario test**

```bash
npm test -- src/server/devFixtures/scenarios/fullLeaguesScenario.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/devFixtures/scenarios
git commit -m "feat(dev-fixtures): add full leagues scenario"
```

## Task 7: CLI And npm Script

**Files:**
- Create: `src/server/devFixtures/scripts/runDevFixtures.ts`
- Modify: `package.json`

- [ ] **Step 1: Create CLI**

```ts
// src/server/devFixtures/scripts/runDevFixtures.ts
import '@/lib/loadEnv';

import { prisma } from '@/lib/prisma';

import { formatDevFixtureReport } from '../core/report';
import { runDevFixtureCommand } from '../core/runner';
import type { DevFixtureCommand, DevFixtureOutputFormat, DevFixtureScenarioId } from '../core/types';
import { devFixtureScenarios } from '../scenarios';

function parseArgs(argv: string[]) {
  const command = (argv[0] || 'list') as DevFixtureCommand;
  const scenarioId = argv[1] && !argv[1].startsWith('--') ? (argv[1] as DevFixtureScenarioId) : undefined;
  const fixtureOwned = argv.includes('--fixture-owned');
  const outputFormat: DevFixtureOutputFormat = argv.includes('--json') ? 'json' : 'text';
  return { command, scenarioId, fixtureOwned, outputFormat };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runDevFixtureCommand({
    command: args.command,
    scenarioId: args.scenarioId,
    scenarios: devFixtureScenarios,
    fixtureOwned: args.fixtureOwned,
  });

  if (args.outputFormat === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatDevFixtureReport(result));
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Add npm script**

In `package.json`, add:

```json
"dev:fixtures": "tsx src/server/devFixtures/scripts/runDevFixtures.ts"
```

- [ ] **Step 3: Run commands**

```bash
npm run dev:fixtures -- list
npm run dev:fixtures -- apply full-leagues --json
```

Expected:
- `list` prints `full-leagues`.
- `apply` either succeeds with JSON readiness output or fails with a clear prerequisite issue.

- [ ] **Step 4: Commit**

```bash
git add src/server/devFixtures/scripts/runDevFixtures.ts package.json
git commit -m "chore(dev-fixtures): expose fixture cli"
```

## Task 8: Documentation

**Files:**
- Create: `docs/DEV_FIXTURES.md`

- [ ] **Step 1: Write docs**

```md
# Dev Fixtures

Dev fixtures create repeatable local scenarios for testing Statly workflows end to end.

## Commands

```bash
npm run dev:fixtures -- list
npm run dev:fixtures -- apply full-leagues
npm run dev:fixtures -- verify full-leagues
npm run dev:fixtures -- reset full-leagues --fixture-owned
npm run dev:fixtures -- apply full-leagues --json
```

## full-leagues

Creates three private leagues:

- `Statly Fixture Full League 1`
- `Statly Fixture Full League 2`
- `Statly Fixture Full League 3`

Each league has 12 teams:

- current bypass/dev user in draft slot 1
- 11 fixture bot users in draft slots 2-12
- enabled bot profiles
- deterministic roster ownership from active players
- draft provisioning
- season bootstrap

## Safety

The fixture runner refuses production. Reset requires `--fixture-owned`. The runner must not delete or overwrite non-fixture members. If a fixture league contains unexpected non-fixture members, it fails and prints the offending user ids.

## Prerequisites

The `full-leagues` scenario needs enough active players to fill 36 rosters. If player data is missing, load player data first, then rerun:

```bash
npm run dev:fixtures -- apply full-leagues
```

## Output

Text output is intended for humans. `--json` output is intended for future browser automation and CI-style local checks.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEV_FIXTURES.md
git commit -m "docs(dev-fixtures): document fixture workflow"
```

## Task 9: Final Verification

**Files:**
- Modify only if verification finds issues in touched files.

- [ ] **Step 1: Run focused tests**

```bash
npm test -- src/server/devFixtures
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck:tests
```

Expected: PASS, or existing unrelated failures with no `src/server/devFixtures` errors.

- [ ] **Step 3: Run fixture list**

```bash
npm run dev:fixtures -- list
```

Expected: output includes `full-leagues`.

- [ ] **Step 4: Run fixture apply**

```bash
npm run dev:fixtures -- apply full-leagues
```

Expected:
- success with 3 ready leagues if active player data exists
- or a clear prerequisite failure naming active-player shortage

- [ ] **Step 5: Run branch checks**

```bash
git status --short --branch
git diff --stat
git diff --check
npm run branch:complete
```

Expected:
- no whitespace errors
- no `.firebase-data/` files staged
- only intentional fixture platform files changed

## Parallel Execution Plan

- Worker A owns Tasks 1-3: core types, manifest, safety, prerequisites, report, runner.
- Worker B owns Task 4: fixture services.
- Worker C owns Task 5-6 after Worker A/B land: verifier and full-leagues scenario.
- Worker D owns Task 7-8 after scenario exports exist: CLI, package script, docs.
- Main agent owns Task 9 integration, verification, and branch hygiene.

Workers are not alone in the codebase. They must not revert or stage unrelated changes, especially existing `.firebase-data/` modifications.

## Operational Risks

- Writes to the configured Prisma database. The production guard reduces risk but does not replace local environment awareness.
- Reset is intentionally narrow and gated by `--fixture-owned`.
- Real active player data is required for high-value E2E fixtures. The platform reports missing prerequisites rather than inventing fake player rows.
- Draft provisioning may schedule local draft jobs through the existing queue. That is part of end-to-end testing and must be visible in the report.

## Self-Review

- Spec coverage: Provides infrastructure for end-to-end testing plus the immediate 3 full leagues with owner and 11 bots.
- Shortcoming coverage: Adds manifest, safety, prerequisites, reset mode, JSON output, fixture services, verifier, docs, and future scenario seams.
- Placeholder scan: No task contains TBD, TODO, or an unspecified implementation step.
- Type consistency: Uses `DevFixtureScenarioId`, `DevFixtureRunResult`, `DevFixtureScenario`, `fullLeaguesScenario`, and `runDevFixtureCommand` consistently.
