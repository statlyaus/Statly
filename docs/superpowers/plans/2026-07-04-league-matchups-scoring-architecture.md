# League Matchups And 9-Category Scoring Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build league-scoped head-to-head matchups with commissioner scoring settings, active lineup slots, live AFL stat scoring, weekly finalization, and standings.

**Architecture:** Prisma owns protected league competition state: scoring mode, lineup slot rules, generated fixtures, submitted lineups, live/final matchup scores, and standings. ETL/Firestore/API projections remain the AFL live-stat source, normalized through server services before category totals reach league matchups. UI changes stay league-scoped: settings configure scoring and lineups, league tabs expose Matchups/Lineup/Standings, while global Live Scoring remains separate.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma SQLite, Vitest, existing Statly server loaders/services, shadcn-style Tailwind primitives, existing live data hooks/API projections.

---

## Product Decisions

- Commissioner can choose scoring mode in league settings:
  - `H2H_EACH_CATEGORY`: every category contributes a win/loss/draw to standings, e.g. `5-3-1`.
  - `H2H_MOST_CATEGORIES`: one weekly win/loss/draw based on category majority.
- Draws are supported in both modes.
- Default active lineup slots:
  - `FWD`: 5
  - `DEF`: 5
  - `MID`: 5
  - `RUC`: 1
  - `UTIL`: 3
- Bench size remains separate. Roster size should equal active slot total plus bench size.
- `UTIL` accepts any AFL position.
- AFL round equals fantasy round.
- Odd team counts create a bye week.
- Finals are not in this build.
- Live matchup scores update while AFL games are in progress.
- Matchups finalize after all AFL matches for the round are final.
- Commissioner gets manual recalculate/finalize fallback.
- Scoring settings lock once the first fixture starts.
- Individual players lock when their AFL game starts.
- Default AFL 9-cat preset uses `REAL_DATA_NINE_CATEGORY_PRESET`.
- Category direction supports both `HIGH_WINS` and `LOW_WINS`; default preset categories all use `HIGH_WINS`.

## Scope Contract

This plan builds a regular-season league competition foundation. It does not build finals/playoffs, trade deadline behavior, waiver lockouts, or complete AFL fixture ingestion beyond using available match start/status data from existing live data projections.

Global route intent:

- `/live-scoring` remains the global/current-user live scoring product.
- `/matches` is an AFL match schedule/results/live monitor route, not league head-to-head standings.
- League head-to-head lives under `/leagues/[id]` tabs and `/leagues/[id]/matchups` API routes.

## File Structure

- Modify `prisma/schema.prisma`
  - Adds scoring mode, lineup settings, matchup, lineup, score, and standing models.

- Create `prisma/migrations/20260704030000_add_league_matchups_scoring/migration.sql`
  - Applies the schema changes for SQLite.

- Create `src/server/leagues/scoringTypes.ts`
  - Owns scoring mode, lineup slot, category direction, and default lineup constants.

- Create `src/server/leagues/lineupSettings.ts`
  - Parses, validates, and normalizes league lineup slot settings.

- Create `src/server/leagues/categoryDirections.ts`
  - Normalizes selected categories and category directions.

- Create `src/server/leagues/fixtureGenerator.ts`
  - Generates round-robin fixtures with bye support.

- Create `src/server/leagues/lineupService.ts`
  - Creates default lineups, validates slot eligibility, and enforces player lock.

- Create `src/server/leagues/matchupScoringEngine.ts`
  - Aggregates active lineup stats into category totals and head-to-head results.

- Create `src/server/leagues/liveStatsAdapter.ts`
  - Normalizes live AFL stat rows from existing projections into category values.

- Create `src/server/leagues/standingsService.ts`
  - Computes standings from finalized matchups for both scoring modes.

- Create `src/server/leagues/matchupReadModel.ts`
  - Loads league matchup page data for UI and API routes.

- Modify `src/server/leagues/createLeagueContract.ts`
  - Accepts optional scoring mode, lineup slots, and category directions with defaults.

- Modify `src/server/leagues/leagueDetail.ts`
  - Includes scoring mode, lineup settings, category directions, standings summary, and current matchup summary.

- Modify `src/types/leagues.ts`
  - Adds client/API types for scoring mode, lineup slots, matchups, standings, and settings.

- Create `src/app/api/leagues/[id]/matchups/route.ts`
  - GET league matchup read model; POST commissioner fixture generation.

- Create `src/app/api/leagues/[id]/matchups/[round]/recalculate/route.ts`
  - Commissioner recalculate/finalize fallback that reads lineups, live stat totals, scoring settings, writes matchup scores, and refreshes standings.

- Create `src/app/api/leagues/[id]/lineups/[round]/route.ts`
  - GET/PATCH current manager lineup for the round, replacing lineup players transactionally after slot and ownership validation.

- Modify `src/app/api/leagues/[id]/settings/route.ts`
  - Persists scoring mode, lineup slots, category directions, and lock rules.

- Modify `src/components/league/LeagueTabs.tsx`
  - Adds league tabs for Matchups, My Lineup, and Standings while keeping settings manageable.

- Create `src/components/league/matchups/LeagueMatchupsPanel.tsx`
  - Renders weekly matchup scoreboard and category breakdown.

- Create `src/components/league/matchups/LeagueLineupPanel.tsx`
  - Renders active lineup/bench management.

- Create `src/components/league/matchups/LeagueStandingsPanel.tsx`
  - Renders standings for both scoring modes.

- Create `src/components/league/settings/ScoringSettingsPanel.tsx`
  - Commissioner settings UI for scoring mode, lineup slots, category direction, and lock summary.

- Modify `src/components/navigation/MainNavigation.tsx`
  - Reverts primary global tool label to Live Scoring for `/live-scoring`; keeps `/matches` as AFL Matches/Schedule if retained.

- Modify `src/components/dashboard/QuickActionsModule.tsx`
  - Restores global live scoring action and adds league matchup entry only when league context exists.

- Tests:
  - Create `tests/unit/leagueMatchupSchemaContract.test.ts`
  - Create `tests/unit/fixtureGenerator.test.ts`
  - Create `tests/unit/lineupSettings.test.ts`
  - Create `tests/unit/categoryDirections.test.ts`
  - Create `tests/unit/liveStatsAdapter.test.ts`
  - Create `tests/unit/lineupService.test.ts`
  - Create `tests/unit/matchupScoringEngine.test.ts`
  - Create `tests/unit/standingsService.test.ts`
  - Create `tests/unit/matchupReadModel.test.ts`
  - Create `tests/unit/leagueMatchupsRouteArchitecture.test.ts`
  - Create `tests/unit/leagueMatchupsUiArchitecture.test.ts`
  - Modify `tests/unit/match-centre-navigation-contract.test.ts`

## Proposed Edit Plan

Working with: Prisma schema/migration, `src/server/leagues/*` scoring services, league API routes, league tabs/settings UI, navigation route labels, and focused Vitest contract/unit tests.

Total planned edits: 14

### Edit sequence:

1. Add schema and type contract tests - Purpose: define persistent league competition ownership before implementation.
2. Add Prisma models and migration - Purpose: store scoring mode, lineup settings, fixtures, lineups, scores, and standings at the source of truth.
3. Add scoring and lineup domain types - Purpose: centralize constants, defaults, and validation.
4. Add round-robin fixture generation - Purpose: create regular-season team-vs-team schedules with byes.
5. Add live stats adapter - Purpose: bridge existing AFL live projections into typed per-player 9-category totals and game lock/final status.
6. Add matchup scoring engine - Purpose: calculate live/final category results from active lineup stats for both H2H modes.
7. Add lineup service - Purpose: enforce active lineup slots, bench separation, utility eligibility, duplicate prevention, roster ownership, and player lock.
8. Add standings service - Purpose: derive standings from finalized matchups for both scoring modes.
9. Add matchup read model - Purpose: compose fixtures, lineups, live scores, standings, and settings into one league page/API shape.
10. Add league matchup API routes - Purpose: expose league-scoped read/write operations with server authorization and real service calls.
11. Extend league settings route - Purpose: let commissioners configure scoring, category directions, lineup slots, and lock rules.
12. Add league Matchups, Lineup, Standings, and Scoring Settings UI - Purpose: make the architecture usable inside leagues with loading/empty/error states and real API integration.
13. Restore global Live Scoring navigation ownership - Purpose: keep `/live-scoring` primary and avoid conflating AFL matches with league matchups.
14. Run full verification and browser smoke - Purpose: prove schema, services, routes, UI, and route labels work together.

Dependencies:

- Tasks 1-2 must precede any service implementation.
- Tasks 3-9 can be implemented as focused domain/service layers after schema exists.
- Tasks 10-12 depend on service behavior, not string-presence placeholders.
- Task 13 can be independent but should use the final route decision from this plan.
- Task 14 depends on all implementation tasks.

Verification:

- `npm run test:unit -- --coverage=false tests/unit/leagueMatchupSchemaContract.test.ts tests/unit/fixtureGenerator.test.ts tests/unit/lineupSettings.test.ts tests/unit/categoryDirections.test.ts tests/unit/liveStatsAdapter.test.ts tests/unit/lineupService.test.ts tests/unit/matchupScoringEngine.test.ts tests/unit/standingsService.test.ts tests/unit/matchupReadModel.test.ts tests/unit/leagueMatchupsRouteArchitecture.test.ts tests/unit/leagueMatchupsUiArchitecture.test.ts tests/unit/match-centre-navigation-contract.test.ts`
- `npm run typecheck:app`
- `npm run lint`
- `npx prisma validate`
- Browser smoke through the full local stack:
  - `/leagues/[id]?tab=settings`
  - `/leagues/[id]?tab=lineup`
  - `/leagues/[id]?tab=matchups`
  - `/leagues/[id]?tab=standings`
  - `/live-scoring`
  - `/matches`

---

### Task 1: Schema And Route Ownership Contract Tests

**Files:**

- Create: `tests/unit/leagueMatchupSchemaContract.test.ts`
- Modify: `tests/unit/match-centre-navigation-contract.test.ts`

- [ ] **Step 1: Add schema contract test**

Create `tests/unit/leagueMatchupSchemaContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('league matchup schema ownership', () => {
  it('stores scoring mode, lineup settings, fixtures, lineups, scores, and standings in Prisma', () => {
    const schema = readRepoFile('prisma/schema.prisma');

    expect(schema).toContain('enum LeagueScoringMode');
    expect(schema).toContain('H2H_EACH_CATEGORY');
    expect(schema).toContain('H2H_MOST_CATEGORIES');
    expect(schema).toContain('enum LeagueLineupSlot');
    expect(schema).toContain('FWD');
    expect(schema).toContain('DEF');
    expect(schema).toContain('MID');
    expect(schema).toContain('RUC');
    expect(schema).toContain('UTIL');
    expect(schema).toContain('BENCH');
    expect(schema).toContain('enum CategoryDirection');
    expect(schema).toContain('HIGH_WINS');
    expect(schema).toContain('LOW_WINS');
    expect(schema).toContain('scoringMode');
    expect(schema).toContain('lineupSlotsJson');
    expect(schema).toContain('categoryDirectionsJson');
    expect(schema).toContain('scoringSettingsLockedAt');
    expect(schema).toContain('model LeagueMatchup');
    expect(schema).toContain('model LeagueLineup');
    expect(schema).toContain('model LeagueLineupPlayer');
    expect(schema).toContain('model LeagueMatchupScore');
    expect(schema).toContain('model LeagueStanding');
  });
});
```

- [ ] **Step 2: Update navigation ownership test**

Replace `tests/unit/match-centre-navigation-contract.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('live scoring and match route ownership', () => {
  it('keeps Live Scoring as the primary global scoring route and leaves league matchups league-scoped', () => {
    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
    const dashboardQuickActions = readRepoFile('src/components/dashboard/QuickActionsModule.tsx');
    const liveScoringPage = readRepoFile('src/app/(app)/live-scoring/page.tsx');
    const matchesPage = readRepoFile('src/app/(app)/matches/page.tsx');

    expect(navigation).toContain("name: 'Live Scoring'");
    expect(navigation).toContain("href: '/live-scoring'");
    expect(navigation).not.toContain("name: 'Match Centre'");
    expect(navigation).toContain("name: 'AFL Matches'");
    expect(navigation).toContain("href: '/matches'");
    expect(navigation).toContain(
      "if (href === '/live-scoring') return p.startsWith('/live-scoring')"
    );

    expect(dashboardQuickActions).toContain("title: 'Live Scoring'");
    expect(dashboardQuickActions).toContain("href: '/live-scoring'");

    expect(liveScoringPage).toContain('LiveScoringMatchup');
    expect(matchesPage).toContain('RealTimeMatchCenter');
  });
});
```

- [ ] **Step 3: Run contract tests and verify they fail before implementation**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupSchemaContract.test.ts tests/unit/match-centre-navigation-contract.test.ts
```

Expected: FAIL before implementation because Prisma does not yet have league matchup models and navigation still labels `/matches` as Match Centre. Do not commit this failing state; it is only the red step for the next implementation task.

- [ ] **Step 4: Continue directly to Task 2**

Keep the tests uncommitted until the matching implementation passes. The first commit for this stream should include the schema, migration, and passing contract tests together.

### Task 2: Prisma Schema And Migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260704030000_add_league_matchups_scoring/migration.sql`
- Test: `tests/unit/leagueMatchupSchemaContract.test.ts`

- [ ] **Step 1: Add enums and model relations to Prisma schema**

In `prisma/schema.prisma`, update `League` and `LeagueMember` relation fields and `LeagueSettings` fields. Add these fields to `League`:

```prisma
  matchups      LeagueMatchup[]
  lineups       LeagueLineup[]
  matchupScores LeagueMatchupScore[]
  standings     LeagueStanding[]
```

Add these fields to `LeagueMember`:

```prisma
  homeMatchups   LeagueMatchup[]      @relation("HomeMemberMatchups")
  awayMatchups   LeagueMatchup[]      @relation("AwayMemberMatchups")
  winnerMatchups LeagueMatchup[]      @relation("WinnerMemberMatchups")
  byeMatchups    LeagueMatchup[]      @relation("ByeMemberMatchups")
  lineups        LeagueLineup[]
  matchupScores  LeagueMatchupScore[]
  standings      LeagueStanding[]
```

Add these fields to `LeagueSettings` after `locked`:

```prisma
  scoringMode             LeagueScoringMode @default(H2H_EACH_CATEGORY)
  lineupSlotsJson         String?
  categoryDirectionsJson  String?
  scoringSettingsLockedAt DateTime?
```

Add these enums after `WaiverRule`:

```prisma
enum LeagueScoringMode {
  H2H_EACH_CATEGORY
  H2H_MOST_CATEGORIES
}

enum LeagueLineupSlot {
  FWD
  DEF
  MID
  RUC
  UTIL
  BENCH
}

enum CategoryDirection {
  HIGH_WINS
  LOW_WINS
}

enum LeagueMatchupStatus {
  SCHEDULED
  LIVE
  FINAL
}
```

Add these models after `LeagueRosterPlayer`:

```prisma
model LeagueMatchup {
  id             String              @id @default(cuid())
  leagueId       String
  round          Int
  homeMemberId   String?
  awayMemberId   String?
  byeMemberId    String?
  status         LeagueMatchupStatus @default(SCHEDULED)
  startsAt       DateTime?
  endsAt         DateTime?
  finalizedAt    DateTime?
  winnerMemberId String?
  homeCategoryWins Int              @default(0)
  awayCategoryWins Int              @default(0)
  drawnCategories  Int              @default(0)
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  league       League        @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  homeMember   LeagueMember? @relation("HomeMemberMatchups", fields: [homeMemberId], references: [id], onDelete: SetNull)
  awayMember   LeagueMember? @relation("AwayMemberMatchups", fields: [awayMemberId], references: [id], onDelete: SetNull)
  byeMember    LeagueMember? @relation("ByeMemberMatchups", fields: [byeMemberId], references: [id], onDelete: SetNull)
  winnerMember LeagueMember? @relation("WinnerMemberMatchups", fields: [winnerMemberId], references: [id], onDelete: SetNull)
  scores       LeagueMatchupScore[]

  @@unique([leagueId, round, homeMemberId, awayMemberId])
  @@index([leagueId, round])
  @@index([leagueId, status])
  @@index([homeMemberId])
  @@index([awayMemberId])
  @@index([byeMemberId])
}

model LeagueLineup {
  id        String   @id @default(cuid())
  leagueId  String
  memberId  String
  round     Int
  lockedAt  DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  league  League               @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  member  LeagueMember         @relation(fields: [memberId], references: [id], onDelete: Cascade)
  players LeagueLineupPlayer[]

  @@unique([leagueId, memberId, round])
  @@index([leagueId, round])
  @@index([memberId])
}

model LeagueLineupPlayer {
  id        String           @id @default(cuid())
  lineupId  String
  playerId  String
  slot      LeagueLineupSlot
  slotIndex Int
  lockedAt  DateTime?
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  lineup LeagueLineup @relation(fields: [lineupId], references: [id], onDelete: Cascade)
  player Player       @relation(fields: [playerId], references: [id], onDelete: Cascade)

  @@unique([lineupId, slot, slotIndex])
  @@unique([lineupId, playerId])
  @@index([playerId])
}

model LeagueMatchupScore {
  id              String            @id @default(cuid())
  leagueId        String
  matchupId       String
  memberId        String
  round           Int
  categoriesJson  String
  categoryWins    Int               @default(0)
  categoryLosses  Int               @default(0)
  categoryDraws   Int               @default(0)
  matchupWin      Boolean           @default(false)
  matchupLoss     Boolean           @default(false)
  matchupDraw     Boolean           @default(false)
  status          LeagueMatchupStatus @default(SCHEDULED)
  calculatedAt    DateTime          @default(now())
  finalizedAt     DateTime?

  league  League        @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  matchup LeagueMatchup @relation(fields: [matchupId], references: [id], onDelete: Cascade)
  member  LeagueMember  @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@unique([matchupId, memberId])
  @@index([leagueId, round])
  @@index([memberId])
}

model LeagueStanding {
  id              String   @id @default(cuid())
  leagueId        String
  memberId        String
  wins            Int      @default(0)
  losses          Int      @default(0)
  draws           Int      @default(0)
  categoryWins    Int      @default(0)
  categoryLosses  Int      @default(0)
  categoryDraws   Int      @default(0)
  pointsFor       Float    @default(0)
  pointsAgainst   Float    @default(0)
  updatedAt       DateTime @updatedAt

  league League       @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  member LeagueMember @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@unique([leagueId, memberId])
  @@index([leagueId, wins, categoryWins])
}
```

Add this relation field to `Player`:

```prisma
  lineupPlayers LeagueLineupPlayer[]
```

- [ ] **Step 2: Add SQLite migration**

Create `prisma/migrations/20260704030000_add_league_matchups_scoring/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "LeagueMatchup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "homeMemberId" TEXT,
  "awayMemberId" TEXT,
  "byeMemberId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "startsAt" DATETIME,
  "endsAt" DATETIME,
  "finalizedAt" DATETIME,
  "winnerMemberId" TEXT,
  "homeCategoryWins" INTEGER NOT NULL DEFAULT 0,
  "awayCategoryWins" INTEGER NOT NULL DEFAULT 0,
  "drawnCategories" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LeagueMatchup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueMatchup_homeMemberId_fkey" FOREIGN KEY ("homeMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeagueMatchup_awayMemberId_fkey" FOREIGN KEY ("awayMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeagueMatchup_winnerMemberId_fkey" FOREIGN KEY ("winnerMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "LeagueLineup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "lockedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LeagueLineup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueLineup_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeagueLineupPlayer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lineupId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "slot" TEXT NOT NULL,
  "slotIndex" INTEGER NOT NULL,
  "lockedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LeagueLineupPlayer_lineupId_fkey" FOREIGN KEY ("lineupId") REFERENCES "LeagueLineup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueLineupPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeagueMatchupScore" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "matchupId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "categoriesJson" TEXT NOT NULL,
  "categoryWins" INTEGER NOT NULL DEFAULT 0,
  "categoryLosses" INTEGER NOT NULL DEFAULT 0,
  "categoryDraws" INTEGER NOT NULL DEFAULT 0,
  "matchupWin" BOOLEAN NOT NULL DEFAULT false,
  "matchupLoss" BOOLEAN NOT NULL DEFAULT false,
  "matchupDraw" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedAt" DATETIME,
  CONSTRAINT "LeagueMatchupScore_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueMatchupScore_matchupId_fkey" FOREIGN KEY ("matchupId") REFERENCES "LeagueMatchup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueMatchupScore_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeagueStanding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "draws" INTEGER NOT NULL DEFAULT 0,
  "categoryWins" INTEGER NOT NULL DEFAULT 0,
  "categoryLosses" INTEGER NOT NULL DEFAULT 0,
  "categoryDraws" INTEGER NOT NULL DEFAULT 0,
  "pointsFor" REAL NOT NULL DEFAULT 0,
  "pointsAgainst" REAL NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LeagueStanding_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueStanding_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "LeagueSettings" ADD COLUMN "scoringMode" TEXT NOT NULL DEFAULT 'H2H_EACH_CATEGORY';
ALTER TABLE "LeagueSettings" ADD COLUMN "lineupSlotsJson" TEXT;
ALTER TABLE "LeagueSettings" ADD COLUMN "categoryDirectionsJson" TEXT;
ALTER TABLE "LeagueSettings" ADD COLUMN "scoringSettingsLockedAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMatchup_leagueId_round_homeMemberId_awayMemberId_key" ON "LeagueMatchup"("leagueId", "round", "homeMemberId", "awayMemberId");
CREATE INDEX "LeagueMatchup_leagueId_round_idx" ON "LeagueMatchup"("leagueId", "round");
CREATE INDEX "LeagueMatchup_leagueId_status_idx" ON "LeagueMatchup"("leagueId", "status");
CREATE INDEX "LeagueMatchup_homeMemberId_idx" ON "LeagueMatchup"("homeMemberId");
CREATE INDEX "LeagueMatchup_awayMemberId_idx" ON "LeagueMatchup"("awayMemberId");
CREATE UNIQUE INDEX "LeagueLineup_leagueId_memberId_round_key" ON "LeagueLineup"("leagueId", "memberId", "round");
CREATE INDEX "LeagueLineup_leagueId_round_idx" ON "LeagueLineup"("leagueId", "round");
CREATE INDEX "LeagueLineup_memberId_idx" ON "LeagueLineup"("memberId");
CREATE UNIQUE INDEX "LeagueLineupPlayer_lineupId_slot_slotIndex_key" ON "LeagueLineupPlayer"("lineupId", "slot", "slotIndex");
CREATE UNIQUE INDEX "LeagueLineupPlayer_lineupId_playerId_key" ON "LeagueLineupPlayer"("lineupId", "playerId");
CREATE INDEX "LeagueLineupPlayer_playerId_idx" ON "LeagueLineupPlayer"("playerId");
CREATE UNIQUE INDEX "LeagueMatchupScore_matchupId_memberId_key" ON "LeagueMatchupScore"("matchupId", "memberId");
CREATE INDEX "LeagueMatchupScore_leagueId_round_idx" ON "LeagueMatchupScore"("leagueId", "round");
CREATE INDEX "LeagueMatchupScore_memberId_idx" ON "LeagueMatchupScore"("memberId");
CREATE UNIQUE INDEX "LeagueStanding_leagueId_memberId_key" ON "LeagueStanding"("leagueId", "memberId");
CREATE INDEX "LeagueStanding_leagueId_wins_categoryWins_idx" ON "LeagueStanding"("leagueId", "wins", "categoryWins");
```

- [ ] **Step 3: Validate schema**

Run:

```bash
npx prisma validate
```

Expected: PASS.

- [ ] **Step 4: Run schema contract test**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupSchemaContract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit schema and migration**

```bash
git add prisma/schema.prisma prisma/migrations/20260704030000_add_league_matchups_scoring/migration.sql
git commit -m "feat: add league matchup scoring schema"
```

### Task 3: Domain Types, Lineup Settings, And Category Directions

**Files:**

- Create: `src/server/leagues/scoringTypes.ts`
- Create: `src/server/leagues/lineupSettings.ts`
- Create: `src/server/leagues/categoryDirections.ts`
- Create: `tests/unit/lineupSettings.test.ts`
- Create: `tests/unit/categoryDirections.test.ts`

- [ ] **Step 1: Add lineup settings tests**

Create `tests/unit/lineupSettings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LINEUP_SLOTS,
  activeLineupSize,
  normalizeLineupSlots,
  validateLineupSlotsForRoster,
} from '@/server/leagues/lineupSettings';

describe('lineup settings', () => {
  it('defaults to 5 forwards, 5 defenders, 5 midfielders, 1 ruck, and 3 utility spots', () => {
    expect(DEFAULT_LINEUP_SLOTS).toEqual({ FWD: 5, DEF: 5, MID: 5, RUC: 1, UTIL: 3 });
    expect(activeLineupSize(DEFAULT_LINEUP_SLOTS)).toBe(19);
  });

  it('normalizes positive integer slot values and ignores bench as an active slot', () => {
    expect(
      normalizeLineupSlots({
        FWD: 4,
        DEF: '6',
        MID: 5.8,
        RUC: 1,
        UTIL: 2,
        BENCH: 99,
      })
    ).toEqual({ FWD: 4, DEF: 6, MID: 5, RUC: 1, UTIL: 2 });
  });

  it('rejects active lineup larger than roster size minus bench size', () => {
    expect(() =>
      validateLineupSlotsForRoster({ FWD: 5, DEF: 5, MID: 5, RUC: 1, UTIL: 3 }, 20, 4)
    ).toThrow('Active lineup size 19 cannot exceed rosterSize 20 minus benchSize 4');
  });
});
```

- [ ] **Step 2: Add category direction tests**

Create `tests/unit/categoryDirections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOW_WINS_CATEGORIES,
  compareCategoryValues,
  normalizeCategoryDirections,
} from '@/server/leagues/categoryDirections';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

describe('category directions', () => {
  it('defaults real-data nine category preset to HIGH_WINS', () => {
    expect(normalizeCategoryDirections(REAL_DATA_NINE_CATEGORY_PRESET, undefined)).toEqual(
      Object.fromEntries(REAL_DATA_NINE_CATEGORY_PRESET.map((category) => [category, 'HIGH_WINS']))
    );
  });

  it('defaults lower-is-better categories when selected', () => {
    expect(DEFAULT_LOW_WINS_CATEGORIES).toContain('clangers');
    expect(DEFAULT_LOW_WINS_CATEGORIES).toContain('turnovers');
    expect(DEFAULT_LOW_WINS_CATEGORIES).toContain('freesAgainst');
    expect(normalizeCategoryDirections(['goals', 'clangers'], undefined)).toEqual({
      goals: 'HIGH_WINS',
      clangers: 'LOW_WINS',
    });
  });

  it('compares categories by direction and supports draws', () => {
    expect(compareCategoryValues(10, 8, 'HIGH_WINS')).toBe('home');
    expect(compareCategoryValues(10, 8, 'LOW_WINS')).toBe('away');
    expect(compareCategoryValues(8, 8, 'LOW_WINS')).toBe('draw');
  });
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/lineupSettings.test.ts tests/unit/categoryDirections.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Add scoring types**

Create `src/server/leagues/scoringTypes.ts`:

```ts
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

export type LeagueScoringMode = 'H2H_EACH_CATEGORY' | 'H2H_MOST_CATEGORIES';
export type LeagueLineupSlot = 'FWD' | 'DEF' | 'MID' | 'RUC' | 'UTIL' | 'BENCH';
export type ActiveLineupSlot = Exclude<LeagueLineupSlot, 'BENCH'>;
export type CategoryDirection = 'HIGH_WINS' | 'LOW_WINS';
export type CategoryWinner = 'home' | 'away' | 'draw';

export type LineupSlotCounts = Record<ActiveLineupSlot, number>;
export type CategoryDirectionMap = Partial<Record<FantasyCategoryKey, CategoryDirection>>;

export interface CategoryScore {
  category: FantasyCategoryKey;
  homeValue: number;
  awayValue: number;
  direction: CategoryDirection;
  winner: CategoryWinner;
}

export interface MatchupScoreResult {
  homeCategoryWins: number;
  awayCategoryWins: number;
  drawnCategories: number;
  homeMatchupWin: boolean;
  awayMatchupWin: boolean;
  matchupDraw: boolean;
  categories: CategoryScore[];
}
```

- [ ] **Step 5: Add lineup settings implementation**

Create `src/server/leagues/lineupSettings.ts`:

```ts
import type { ActiveLineupSlot, LineupSlotCounts } from './scoringTypes';

export const ACTIVE_LINEUP_SLOTS = [
  'FWD',
  'DEF',
  'MID',
  'RUC',
  'UTIL',
] as const satisfies readonly ActiveLineupSlot[];

export const DEFAULT_LINEUP_SLOTS: LineupSlotCounts = {
  FWD: 5,
  DEF: 5,
  MID: 5,
  RUC: 1,
  UTIL: 3,
};

export function activeLineupSize(slots: LineupSlotCounts): number {
  return ACTIVE_LINEUP_SLOTS.reduce((total, slot) => total + slots[slot], 0);
}

function parseSlotCount(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  }
  return fallback;
}

export function normalizeLineupSlots(value: unknown): LineupSlotCounts {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_LINEUP_SLOTS };
  }

  const record = value as Record<string, unknown>;
  return {
    FWD: parseSlotCount(record.FWD, DEFAULT_LINEUP_SLOTS.FWD),
    DEF: parseSlotCount(record.DEF, DEFAULT_LINEUP_SLOTS.DEF),
    MID: parseSlotCount(record.MID, DEFAULT_LINEUP_SLOTS.MID),
    RUC: parseSlotCount(record.RUC, DEFAULT_LINEUP_SLOTS.RUC),
    UTIL: parseSlotCount(record.UTIL, DEFAULT_LINEUP_SLOTS.UTIL),
  };
}

export function parseLineupSlotsJson(value: string | null | undefined): LineupSlotCounts {
  if (!value) return { ...DEFAULT_LINEUP_SLOTS };
  try {
    return normalizeLineupSlots(JSON.parse(value));
  } catch {
    return { ...DEFAULT_LINEUP_SLOTS };
  }
}

export function validateLineupSlotsForRoster(
  slots: LineupSlotCounts,
  rosterSize: number,
  benchSize: number
): void {
  const activeSize = activeLineupSize(slots);
  const maxActiveSize = rosterSize - benchSize;
  if (activeSize > maxActiveSize) {
    throw new Error(
      `Active lineup size ${activeSize} cannot exceed rosterSize ${rosterSize} minus benchSize ${benchSize}`
    );
  }
}
```

- [ ] **Step 6: Add category directions implementation**

Create `src/server/leagues/categoryDirections.ts`:

```ts
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import type { CategoryDirection, CategoryDirectionMap, CategoryWinner } from './scoringTypes';

export const DEFAULT_LOW_WINS_CATEGORIES = [
  'clangers',
  'turnovers',
  'freesAgainst',
] as const satisfies readonly FantasyCategoryKey[];

const LOW_WINS_SET = new Set<FantasyCategoryKey>(DEFAULT_LOW_WINS_CATEGORIES);

export function normalizeCategoryDirections(
  categories: readonly FantasyCategoryKey[],
  value: unknown
): Record<FantasyCategoryKey, CategoryDirection> {
  const input = value && typeof value === 'object' ? (value as CategoryDirectionMap) : {};
  const result = {} as Record<FantasyCategoryKey, CategoryDirection>;

  for (const category of categories) {
    const explicit = input[category];
    result[category] =
      explicit === 'HIGH_WINS' || explicit === 'LOW_WINS'
        ? explicit
        : LOW_WINS_SET.has(category)
          ? 'LOW_WINS'
          : 'HIGH_WINS';
  }

  return result;
}

export function parseCategoryDirectionsJson(
  categories: readonly FantasyCategoryKey[],
  value: string | null | undefined
): Record<FantasyCategoryKey, CategoryDirection> {
  if (!value) return normalizeCategoryDirections(categories, undefined);
  try {
    return normalizeCategoryDirections(categories, JSON.parse(value));
  } catch {
    return normalizeCategoryDirections(categories, undefined);
  }
}

export function compareCategoryValues(
  homeValue: number,
  awayValue: number,
  direction: CategoryDirection
): CategoryWinner {
  if (homeValue === awayValue) return 'draw';
  if (direction === 'LOW_WINS') {
    return homeValue < awayValue ? 'home' : 'away';
  }
  return homeValue > awayValue ? 'home' : 'away';
}
```

- [ ] **Step 7: Run domain tests**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/lineupSettings.test.ts tests/unit/categoryDirections.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit domain types**

```bash
git add src/server/leagues/scoringTypes.ts src/server/leagues/lineupSettings.ts src/server/leagues/categoryDirections.ts tests/unit/lineupSettings.test.ts tests/unit/categoryDirections.test.ts
git commit -m "feat: add league scoring domain settings"
```

### Task 4: Fixture Generator

**Files:**

- Create: `src/server/leagues/fixtureGenerator.ts`
- Create: `tests/unit/fixtureGenerator.test.ts`

- [ ] **Step 1: Add fixture generator tests**

Create `tests/unit/fixtureGenerator.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { generateRoundRobinFixtures } from '@/server/leagues/fixtureGenerator';

describe('generateRoundRobinFixtures', () => {
  it('creates one matchup per pair for an even team count', () => {
    const fixtures = generateRoundRobinFixtures(['m1', 'm2', 'm3', 'm4']);

    expect(fixtures).toHaveLength(6);
    expect(new Set(fixtures.map((fixture) => fixture.round))).toEqual(new Set([1, 2, 3]));
    expect(fixtures.filter((fixture) => fixture.round === 1)).toHaveLength(2);
    expect(fixtures.every((fixture) => fixture.homeMemberId && fixture.awayMemberId)).toBe(true);
  });

  it('creates bye fixtures for odd team counts', () => {
    const fixtures = generateRoundRobinFixtures(['m1', 'm2', 'm3']);
    const byes = fixtures.filter((fixture) => fixture.byeMemberId);
    const matchups = fixtures.filter((fixture) => fixture.homeMemberId && fixture.awayMemberId);

    expect(matchups).toHaveLength(3);
    expect(byes).toHaveLength(3);
    expect(new Set(byes.map((fixture) => fixture.byeMemberId))).toEqual(
      new Set(['m1', 'm2', 'm3'])
    );
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/fixtureGenerator.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement fixture generator**

Create `src/server/leagues/fixtureGenerator.ts`:

```ts
export interface GeneratedLeagueFixture {
  round: number;
  homeMemberId?: string;
  awayMemberId?: string;
  byeMemberId?: string;
}

const BYE = '__BYE__';

export function generateRoundRobinFixtures(memberIds: readonly string[]): GeneratedLeagueFixture[] {
  const uniqueMemberIds = [...new Set(memberIds)].filter(Boolean);
  if (uniqueMemberIds.length < 2) {
    return uniqueMemberIds.map((memberId) => ({ round: 1, byeMemberId: memberId }));
  }

  const teams = uniqueMemberIds.length % 2 === 0 ? [...uniqueMemberIds] : [...uniqueMemberIds, BYE];
  const rounds = teams.length - 1;
  const half = teams.length / 2;
  const rotating = [...teams];
  const fixtures: GeneratedLeagueFixture[] = [];

  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const round = roundIndex + 1;
    for (let pairIndex = 0; pairIndex < half; pairIndex += 1) {
      const first = rotating[pairIndex];
      const second = rotating[rotating.length - 1 - pairIndex];

      if (first === BYE && second !== BYE) {
        fixtures.push({ round, byeMemberId: second });
      } else if (second === BYE && first !== BYE) {
        fixtures.push({ round, byeMemberId: first });
      } else if (first && second) {
        const swapHome = roundIndex % 2 === 1;
        fixtures.push({
          round,
          homeMemberId: swapHome ? second : first,
          awayMemberId: swapHome ? first : second,
        });
      }
    }

    const fixed = rotating[0];
    const tail = rotating.slice(1);
    const moved = tail.pop();
    rotating.splice(0, rotating.length, fixed, moved as string, ...tail);
  }

  return fixtures;
}
```

- [ ] **Step 4: Run fixture tests**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/fixtureGenerator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit fixture generator**

```bash
git add src/server/leagues/fixtureGenerator.ts tests/unit/fixtureGenerator.test.ts
git commit -m "feat: add league fixture generator"
```

### Task 5: Matchup Scoring Engine And Standings

**Files:**

- Create: `src/server/leagues/matchupScoringEngine.ts`
- Create: `src/server/leagues/standingsService.ts`
- Create: `tests/unit/matchupScoringEngine.test.ts`
- Create: `tests/unit/standingsService.test.ts`

- [ ] **Step 1: Add scoring engine tests**

Create `tests/unit/matchupScoringEngine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { scoreHeadToHeadCategories } from '@/server/leagues/matchupScoringEngine';

describe('scoreHeadToHeadCategories', () => {
  const directions = {
    goals: 'HIGH_WINS',
    tackles: 'HIGH_WINS',
    clangers: 'LOW_WINS',
  } as const;

  it('scores each category and supports lower-is-better categories', () => {
    const result = scoreHeadToHeadCategories({
      categories: ['goals', 'tackles', 'clangers'],
      categoryDirections: directions,
      homeTotals: { goals: 12, tackles: 50, clangers: 20 },
      awayTotals: { goals: 10, tackles: 55, clangers: 25 },
      scoringMode: 'H2H_EACH_CATEGORY',
    });

    expect(result.homeCategoryWins).toBe(2);
    expect(result.awayCategoryWins).toBe(1);
    expect(result.drawnCategories).toBe(0);
    expect(result.homeMatchupWin).toBe(true);
    expect(result.awayMatchupWin).toBe(false);
  });

  it('returns matchup draw when category wins are tied in most-categories mode', () => {
    const result = scoreHeadToHeadCategories({
      categories: ['goals', 'tackles'],
      categoryDirections: directions,
      homeTotals: { goals: 12, tackles: 50 },
      awayTotals: { goals: 10, tackles: 55 },
      scoringMode: 'H2H_MOST_CATEGORIES',
    });

    expect(result.homeCategoryWins).toBe(1);
    expect(result.awayCategoryWins).toBe(1);
    expect(result.matchupDraw).toBe(true);
  });
});
```

- [ ] **Step 2: Add standings tests**

Create `tests/unit/standingsService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { calculateStandingsRows } from '@/server/leagues/standingsService';

describe('calculateStandingsRows', () => {
  it('counts every category in H2H each category mode', () => {
    const rows = calculateStandingsRows({
      scoringMode: 'H2H_EACH_CATEGORY',
      memberIds: ['home', 'away'],
      finalizedScores: [
        {
          matchupId: 'm1',
          memberId: 'home',
          categoryWins: 5,
          categoryLosses: 3,
          categoryDraws: 1,
          matchupWin: true,
          matchupLoss: false,
          matchupDraw: false,
          pointsFor: 120,
          pointsAgainst: 100,
        },
        {
          matchupId: 'm1',
          memberId: 'away',
          categoryWins: 3,
          categoryLosses: 5,
          categoryDraws: 1,
          matchupWin: false,
          matchupLoss: true,
          matchupDraw: false,
          pointsFor: 100,
          pointsAgainst: 120,
        },
      ],
    });

    expect(rows.find((row) => row.memberId === 'home')).toMatchObject({
      wins: 5,
      losses: 3,
      draws: 1,
      categoryWins: 5,
      categoryLosses: 3,
      categoryDraws: 1,
    });
  });

  it('counts one weekly result in H2H most categories mode', () => {
    const rows = calculateStandingsRows({
      scoringMode: 'H2H_MOST_CATEGORIES',
      memberIds: ['home', 'away'],
      finalizedScores: [
        {
          matchupId: 'm1',
          memberId: 'home',
          categoryWins: 5,
          categoryLosses: 4,
          categoryDraws: 0,
          matchupWin: true,
          matchupLoss: false,
          matchupDraw: false,
          pointsFor: 120,
          pointsAgainst: 100,
        },
        {
          matchupId: 'm1',
          memberId: 'away',
          categoryWins: 4,
          categoryLosses: 5,
          categoryDraws: 0,
          matchupWin: false,
          matchupLoss: true,
          matchupDraw: false,
          pointsFor: 100,
          pointsAgainst: 120,
        },
      ],
    });

    expect(rows.find((row) => row.memberId === 'home')).toMatchObject({
      wins: 1,
      losses: 0,
      draws: 0,
      categoryWins: 5,
      categoryLosses: 4,
    });
  });
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/matchupScoringEngine.test.ts tests/unit/standingsService.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Add scoring engine implementation**

Create `src/server/leagues/matchupScoringEngine.ts`:

```ts
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import { compareCategoryValues } from './categoryDirections';
import type { CategoryDirection, LeagueScoringMode, MatchupScoreResult } from './scoringTypes';

export type CategoryTotals = Partial<Record<FantasyCategoryKey, number>>;

export interface ScoreHeadToHeadCategoriesInput {
  categories: readonly FantasyCategoryKey[];
  categoryDirections: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
  homeTotals: CategoryTotals;
  awayTotals: CategoryTotals;
  scoringMode: LeagueScoringMode;
}

function readTotal(totals: CategoryTotals, category: FantasyCategoryKey): number {
  const value = totals[category];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function scoreHeadToHeadCategories(
  input: ScoreHeadToHeadCategoriesInput
): MatchupScoreResult {
  let homeCategoryWins = 0;
  let awayCategoryWins = 0;
  let drawnCategories = 0;

  const categories = input.categories.map((category) => {
    const homeValue = readTotal(input.homeTotals, category);
    const awayValue = readTotal(input.awayTotals, category);
    const direction = input.categoryDirections[category] ?? 'HIGH_WINS';
    const winner = compareCategoryValues(homeValue, awayValue, direction);

    if (winner === 'home') homeCategoryWins += 1;
    if (winner === 'away') awayCategoryWins += 1;
    if (winner === 'draw') drawnCategories += 1;

    return { category, homeValue, awayValue, direction, winner };
  });

  const homeMatchupWin = homeCategoryWins > awayCategoryWins;
  const awayMatchupWin = awayCategoryWins > homeCategoryWins;
  const matchupDraw = homeCategoryWins === awayCategoryWins;

  return {
    homeCategoryWins,
    awayCategoryWins,
    drawnCategories,
    homeMatchupWin,
    awayMatchupWin,
    matchupDraw,
    categories,
  };
}
```

- [ ] **Step 5: Add standings implementation**

Create `src/server/leagues/standingsService.ts`:

```ts
import type { LeagueScoringMode } from './scoringTypes';

export interface FinalizedScoreInput {
  matchupId: string;
  memberId: string;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  matchupWin: boolean;
  matchupLoss: boolean;
  matchupDraw: boolean;
  pointsFor: number;
  pointsAgainst: number;
}

export interface CalculateStandingsInput {
  scoringMode: LeagueScoringMode;
  memberIds: readonly string[];
  finalizedScores: readonly FinalizedScoreInput[];
}

export interface StandingRow {
  memberId: string;
  wins: number;
  losses: number;
  draws: number;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  pointsFor: number;
  pointsAgainst: number;
}

export function calculateStandingsRows(input: CalculateStandingsInput): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const memberId of input.memberIds) {
    rows.set(memberId, {
      memberId,
      wins: 0,
      losses: 0,
      draws: 0,
      categoryWins: 0,
      categoryLosses: 0,
      categoryDraws: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  }

  for (const score of input.finalizedScores) {
    const row = rows.get(score.memberId);
    if (!row) continue;

    row.categoryWins += score.categoryWins;
    row.categoryLosses += score.categoryLosses;
    row.categoryDraws += score.categoryDraws;
    row.pointsFor += score.pointsFor;
    row.pointsAgainst += score.pointsAgainst;

    if (input.scoringMode === 'H2H_EACH_CATEGORY') {
      row.wins += score.categoryWins;
      row.losses += score.categoryLosses;
      row.draws += score.categoryDraws;
    } else {
      if (score.matchupWin) row.wins += 1;
      if (score.matchupLoss) row.losses += 1;
      if (score.matchupDraw) row.draws += 1;
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      b.categoryWins - a.categoryWins ||
      b.pointsFor - a.pointsFor ||
      a.memberId.localeCompare(b.memberId)
  );
}
```

- [ ] **Step 6: Run scoring and standings tests**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/matchupScoringEngine.test.ts tests/unit/standingsService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit scoring services**

```bash
git add src/server/leagues/matchupScoringEngine.ts src/server/leagues/standingsService.ts tests/unit/matchupScoringEngine.test.ts tests/unit/standingsService.test.ts
git commit -m "feat: add matchup scoring and standings services"
```

### Task 6: Lineup Service

**Files:**

- Create: `src/server/leagues/lineupService.ts`
- Create: `tests/unit/lineupService.test.ts`

- [ ] **Step 1: Add lineup service tests**

Create `tests/unit/lineupService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { canAssignPlayerToSlot, isLineupPlayerLocked } from '@/server/leagues/lineupService';

describe('lineup service', () => {
  it('allows utility slot to accept any AFL position', () => {
    expect(canAssignPlayerToSlot('DEF', 'UTIL')).toBe(true);
    expect(canAssignPlayerToSlot('MID', 'UTIL')).toBe(true);
    expect(canAssignPlayerToSlot('RUC', 'UTIL')).toBe(true);
    expect(canAssignPlayerToSlot('FWD', 'UTIL')).toBe(true);
  });

  it('requires matching position for fixed active slots', () => {
    expect(canAssignPlayerToSlot('DEF', 'DEF')).toBe(true);
    expect(canAssignPlayerToSlot('DEF', 'MID')).toBe(false);
    expect(canAssignPlayerToSlot('RUC', 'FWD')).toBe(false);
  });

  it('locks a player once their AFL game has started', () => {
    const now = new Date('2026-07-04T10:10:00.000Z');
    expect(isLineupPlayerLocked(new Date('2026-07-04T10:00:00.000Z'), now)).toBe(true);
    expect(isLineupPlayerLocked(new Date('2026-07-04T10:30:00.000Z'), now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/lineupService.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Add lineup service implementation**

Create `src/server/leagues/lineupService.ts`:

```ts
import type { ActiveLineupSlot, LeagueLineupSlot } from './scoringTypes';

function normalizePosition(position: string | null | undefined): ActiveLineupSlot | undefined {
  const upper = position?.toUpperCase();
  if (upper === 'DEF' || upper === 'D') return 'DEF';
  if (upper === 'MID' || upper === 'M') return 'MID';
  if (upper === 'RUC' || upper === 'RUCK' || upper === 'R') return 'RUC';
  if (upper === 'FWD' || upper === 'F') return 'FWD';
  return undefined;
}

export function canAssignPlayerToSlot(
  playerPosition: string | null | undefined,
  slot: LeagueLineupSlot
): boolean {
  if (slot === 'BENCH' || slot === 'UTIL') return true;
  return normalizePosition(playerPosition) === slot;
}

export function isLineupPlayerLocked(
  gameStartsAt: Date | null | undefined,
  now = new Date()
): boolean {
  return Boolean(gameStartsAt && gameStartsAt.getTime() <= now.getTime());
}
```

- [ ] **Step 4: Run lineup tests**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/lineupService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit lineup service**

```bash
git add src/server/leagues/lineupService.ts tests/unit/lineupService.test.ts
git commit -m "feat: add league lineup rules"
```

### Task 7: Live Stats And Lineup Persistence Hardening

**Implementation requirements:**

- Validate submitted lineup payloads against normalized league slot settings.
- Reject duplicate players, invalid slots, over-filled slots, players not on the member roster, and attempts to move a player whose AFL game has started.
- Persist lineups transactionally by replacing the round's lineup player rows only after all validations pass.
- Keep `BENCH` separate from active slots; only active slots feed matchup scoring.
- Unit tests must cover slot eligibility, duplicate rejection, slot count rejection, roster ownership rejection, and lock enforcement.

### Task 8: Standings Service Acceptance

**Implementation requirements:**

- Calculate standings from finalized matchup score rows.
- In `H2H_EACH_CATEGORY`, standings wins/losses/draws equal category wins/losses/draws.
- In `H2H_MOST_CATEGORIES`, standings wins/losses/draws equal one weekly result per matchup while still retaining category record totals.
- Sort standings by wins, losses, category wins, points for, then stable member id.
- Unit tests must cover both scoring modes and draws.

### Task 9: Matchup Read Model And API Boundaries

**Files:**

- Create: `tests/unit/liveStatsAdapter.test.ts`
- Create: `tests/unit/matchupReadModel.test.ts`
- Create: `tests/unit/leagueMatchupsRouteArchitecture.test.ts`
- Create: `src/server/leagues/liveStatsAdapter.ts`
- Create: `src/server/leagues/matchupReadModel.ts`
- Create: `src/app/api/leagues/[id]/matchups/route.ts`
- Create: `src/app/api/leagues/[id]/matchups/[round]/recalculate/route.ts`
- Create: `src/app/api/leagues/[id]/lineups/[round]/route.ts`

**Implementation requirements:**

- `liveStatsAdapter.ts` must normalize existing AFL player stat projections into typed category totals keyed by Statly player id, including `gameStartsAt`, `gameStatus`, and whether the row is final when that data is available.
- If the existing projections do not expose game start/final status, the adapter must return an explicit `statusUnavailable` flag instead of silently treating players as unlocked/final.
- `matchupReadModel.ts` must compose league settings, fixtures, members, submitted lineups, active player stat totals, matchup score rows, standings, and permission flags into one shape for route and UI use.
- `POST /api/leagues/[id]/matchups` must generate fixtures only for commissioners, set `startsAt` from the earliest AFL match start for that round when available, persist bye relations, and avoid duplicate fixture rows.
- `POST /api/leagues/[id]/matchups/[round]/recalculate` must call a service that reads lineups and live totals, scores every matchup in the round, upserts `LeagueMatchupScore` rows, updates matchup summary fields/status, refreshes standings when finalizing, and returns calculated results. It must not return only a count.
- `PATCH /api/leagues/[id]/lineups/[round]` must call the lineup persistence service from Task 7. It must not echo `requestedPlayers` without saving validated lineup players.
- Route tests must exercise service calls and error boundaries, not just string presence.

### Task 10: League Settings Integration

**Files:**

- Modify: `src/server/leagues/createLeagueContract.ts`
- Modify: `src/server/leagues/leagueDetail.ts`
- Modify: `src/types/leagues.ts`
- Modify: `src/app/api/leagues/[id]/settings/route.ts`
- Test: `tests/unit/leagueSettingsRouteArchitecture.test.ts`

- [ ] **Step 1: Extend league types**

In `src/types/leagues.ts`, add these exports near the core league types:

```ts
export type LeagueScoringMode = 'H2H_EACH_CATEGORY' | 'H2H_MOST_CATEGORIES';
export type LeagueLineupSlot = 'FWD' | 'DEF' | 'MID' | 'RUC' | 'UTIL' | 'BENCH';
export type ActiveLineupSlot = Exclude<LeagueLineupSlot, 'BENCH'>;
export type CategoryDirection = 'HIGH_WINS' | 'LOW_WINS';
export type LineupSlotCounts = Record<ActiveLineupSlot, number>;
```

Add these fields to `League`:

```ts
  scoringMode?: LeagueScoringMode;
  lineupSlots?: LineupSlotCounts;
  categoryDirections?: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
  scoringSettingsLockedAt?: string;
```

- [ ] **Step 2: Extend create league contract defaults**

In `src/server/leagues/createLeagueContract.ts`, import `DEFAULT_LINEUP_SLOTS` and `normalizeCategoryDirections`, extend input/normalized types, and return defaults:

```ts
import { normalizeCategoryDirections } from '@/server/leagues/categoryDirections';
import { DEFAULT_LINEUP_SLOTS, normalizeLineupSlots } from '@/server/leagues/lineupSettings';
import type {
  CategoryDirectionMap,
  LeagueScoringMode,
  LineupSlotCounts,
} from '@/server/leagues/scoringTypes';
```

Add to `CreateLeagueInput`:

```ts
  scoringMode?: LeagueScoringMode;
  lineupSlots?: Partial<LineupSlotCounts>;
  categoryDirections?: CategoryDirectionMap;
```

Add to `NormalizedCreateLeagueInput`:

```ts
scoringMode: LeagueScoringMode;
lineupSlots: LineupSlotCounts;
categoryDirections: Record<FantasyCategoryKey, 'HIGH_WINS' | 'LOW_WINS'>;
```

Add to `normalizeCreateLeagueInput` return:

```ts
    scoringMode:
      input.scoringMode === 'H2H_MOST_CATEGORIES' ? 'H2H_MOST_CATEGORIES' : 'H2H_EACH_CATEGORY',
    lineupSlots: input.lineupSlots ? normalizeLineupSlots(input.lineupSlots) : { ...DEFAULT_LINEUP_SLOTS },
    categoryDirections: normalizeCategoryDirections(categories, input.categoryDirections),
```

- [ ] **Step 3: Update settings route architecture test**

In `tests/unit/leagueSettingsRouteArchitecture.test.ts`, add assertions:

```ts
expect(source).toContain('scoringMode');
expect(source).toContain('lineupSlotsJson');
expect(source).toContain('categoryDirectionsJson');
expect(source).toContain('scoringSettingsLockedAt');
expect(source).toContain('validateLineupSlotsForRoster');
```

- [ ] **Step 4: Update settings route implementation**

In `src/app/api/leagues/[id]/settings/route.ts`, add imports:

```ts
import { normalizeCategoryDirections } from '@/server/leagues/categoryDirections';
import {
  normalizeLineupSlots,
  validateLineupSlotsForRoster,
} from '@/server/leagues/lineupSettings';
```

Inside the update handler, parse and persist:

```ts
const scoringMode =
  body.scoringMode === 'H2H_MOST_CATEGORIES' ? 'H2H_MOST_CATEGORIES' : 'H2H_EACH_CATEGORY';
const lineupSlots = normalizeLineupSlots(body.lineupSlots);
validateLineupSlotsForRoster(lineupSlots, settings.rosterSize, settings.benchSize);
const categoryDirections = normalizeCategoryDirections(categories, body.categoryDirections);
```

Include in Prisma settings update data:

```ts
      scoringMode,
      lineupSlotsJson: JSON.stringify(lineupSlots),
      categoryDirectionsJson: JSON.stringify(categoryDirections),
```

Guard locked settings:

```ts
if (settings.scoringSettingsLockedAt) {
  return NextResponse.json({ error: 'Scoring settings are locked' }, { status: 409 });
}
```

- [ ] **Step 5: Run settings tests**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueSettingsRouteArchitecture.test.ts tests/unit/leagueCreateContract.test.ts tests/unit/leagueDetailRouteArchitecture.test.ts
```

Expected: PASS after adapting existing tests to the new normalized fields.

- [ ] **Step 6: Commit settings integration**

```bash
git add src/types/leagues.ts src/server/leagues/createLeagueContract.ts src/server/leagues/leagueDetail.ts 'src/app/api/leagues/[id]/settings/route.ts' tests/unit/leagueSettingsRouteArchitecture.test.ts tests/unit/leagueCreateContract.test.ts tests/unit/leagueDetailRouteArchitecture.test.ts
git commit -m "feat: add league scoring settings"
```

### Task 11: League Matchups UI Architecture

**Files:**

- Create: `tests/unit/leagueMatchupsUiArchitecture.test.ts`
- Create: `src/components/league/matchups/LeagueMatchupsPanel.tsx`
- Create: `src/components/league/matchups/LeagueLineupPanel.tsx`
- Create: `src/components/league/matchups/LeagueStandingsPanel.tsx`
- Create: `src/components/league/settings/ScoringSettingsPanel.tsx`
- Modify: `src/components/league/LeagueTabs.tsx`

- [ ] **Step 1: Add UI architecture tests**

Create `tests/unit/leagueMatchupsUiArchitecture.test.ts` with assertions that the league tab surface includes:

- A Matchups panel that consumes the matchup read model/API and renders matchup cards, category breakdown rows, bye rows, live/final status, and commissioner recalculate/finalize controls where permitted.
- A My Lineup panel that loads the user's current round lineup, separates active and bench players, submits PATCH updates, disables locked players, and renders validation errors returned by the API.
- A Standings panel that renders rank, weekly record, category record, points for/against, and handles both scoring modes.
- A Scoring Settings panel that uses form controls for scoring mode, category directions, active slot counts, lock state, and save errors.

Tests should assert real data/loading/error/form behavior through component-level tests or focused contract tests. Do not rely only on text-presence checks.

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupsUiArchitecture.test.ts
```

Expected: FAIL before implementation because components are missing or not wired to the read model.

- [ ] **Step 3: Add functional panel components**

Create the four panel components using existing shadcn-style primitives and project fetch patterns. Requirements:

- `LeagueMatchupsPanel` accepts the league id and read model data, renders active round selector, category score grid, empty state when no fixtures exist, and a commissioner-only recalculate/finalize action wired to the API.
- `LeagueLineupPanel` renders stable active-slot sections using normalized slot settings, a bench list, accessible controls for moving players between eligible slots, disabled states for locked players, and a submit action that persists through `PATCH /api/leagues/[id]/lineups/[round]`.
- `LeagueStandingsPanel` renders a table with both weekly and category records; it must not hide category record in most-categories mode.
- `ScoringSettingsPanel` renders controlled settings inputs, validates slot counts before submit, respects `scoringSettingsLockedAt`, and persists through the settings route.
- Every panel must include loading, empty, error, and unauthorized/forbidden states when the read model exposes them.

- [ ] **Step 4: Wire panels into LeagueTabs**

In `src/components/league/LeagueTabs.tsx`, import the new components:

```tsx
import { LeagueLineupPanel } from './matchups/LeagueLineupPanel';
import { LeagueMatchupsPanel } from './matchups/LeagueMatchupsPanel';
import { LeagueStandingsPanel } from './matchups/LeagueStandingsPanel';
import { ScoringSettingsPanel } from './settings/ScoringSettingsPanel';
```

Add tab definitions:

```tsx
  { id: 'matchups', label: 'Matchups' },
  { id: 'lineup', label: 'My Lineup' },
  { id: 'standings', label: 'Standings' },
```

Add render branches:

```tsx
{
  activeTab === 'matchups' && <LeagueMatchupsPanel leagueId={league.id} />;
}
{
  activeTab === 'lineup' && <LeagueLineupPanel leagueId={league.id} />;
}
{
  activeTab === 'standings' && <LeagueStandingsPanel leagueId={league.id} />;
}
```

Render `ScoringSettingsPanel` inside commissioner/settings content.

- [ ] **Step 5: Run UI architecture test**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupsUiArchitecture.test.ts
```

Expected: PASS with functional read/write UI coverage, not static placeholder coverage.

- [ ] **Step 6: Commit UI architecture**

```bash
git add src/components/league/LeagueTabs.tsx src/components/league/matchups/LeagueMatchupsPanel.tsx src/components/league/matchups/LeagueLineupPanel.tsx src/components/league/matchups/LeagueStandingsPanel.tsx src/components/league/settings/ScoringSettingsPanel.tsx tests/unit/leagueMatchupsUiArchitecture.test.ts
git commit -m "feat: add league matchup UI surfaces"
```

### Task 12: Restore Live Scoring Navigation Ownership

**Files:**

- Modify: `src/components/navigation/MainNavigation.tsx`
- Modify: `src/components/dashboard/QuickActionsModule.tsx`
- Test: `tests/unit/match-centre-navigation-contract.test.ts`

- [ ] **Step 1: Update navigation labels**

In `src/components/navigation/MainNavigation.tsx`:

- Change the main tools item `href` to `/live-scoring`.
- Ensure submenu contains:

```tsx
    {
      name: 'Live Scoring',
      href: '/live-scoring',
      description: 'Live scoring and matchup monitoring',
      icon: (
```

- Rename the `/matches` submenu item to:

```tsx
    {
      name: 'AFL Matches',
      href: '/matches',
      description: 'AFL schedule, results, and live match monitor',
      icon: (
```

- Ensure active matching remains separate:

```tsx
if (href === '/live-scoring') return p.startsWith('/live-scoring');
if (href === '/matches') return p.startsWith('/matches');
```

- [ ] **Step 2: Update dashboard quick action**

In `src/components/dashboard/QuickActionsModule.tsx`, replace the global Match Centre action with:

```tsx
    {
      title: 'Live Scoring',
      description: 'Follow live scoring, matchups, and current AFL stat updates',
      href: '/live-scoring',
      icon: BoltIcon,
      color: 'green',
    },
```

- [ ] **Step 3: Run navigation test**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/match-centre-navigation-contract.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit route label correction**

```bash
git add src/components/navigation/MainNavigation.tsx src/components/dashboard/QuickActionsModule.tsx tests/unit/match-centre-navigation-contract.test.ts
git commit -m "fix: restore live scoring route ownership"
```

### Task 13: Full Verification

**Files:**

- No source edits expected.

- [ ] **Step 1: Run focused unit suite**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupSchemaContract.test.ts tests/unit/fixtureGenerator.test.ts tests/unit/lineupSettings.test.ts tests/unit/categoryDirections.test.ts tests/unit/lineupService.test.ts tests/unit/matchupScoringEngine.test.ts tests/unit/standingsService.test.ts tests/unit/leagueMatchupsRouteArchitecture.test.ts tests/unit/leagueMatchupsUiArchitecture.test.ts tests/unit/match-centre-navigation-contract.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck:app
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: exit code 0. Existing advisory warnings can remain if unrelated.

- [ ] **Step 4: Validate Prisma**

Run:

```bash
npx prisma validate
```

Expected: PASS.

- [ ] **Step 5: Browser smoke**

With full stack running, open:

- `http://localhost:3000/live-scoring`
- `http://localhost:3000/matches`
- `http://localhost:3000/leagues/<leagueId>?tab=settings`
- `http://localhost:3000/leagues/<leagueId>?tab=matchups`
- `http://localhost:3000/leagues/<leagueId>?tab=lineup`
- `http://localhost:3000/leagues/<leagueId>?tab=standings`

Expected:

- Live Scoring still loads the global scoring experience.
- AFL Matches loads the match monitor.
- League settings show scoring settings text.
- League Matchups, My Lineup, and Standings tabs render without crashing.

### Task 14: Final Review And Completion

**Files:**

- No source edits expected unless review finds blocking issues.

- [ ] **Step 1: Review branch diff**

Run:

```bash
git status --short
git diff --stat main...HEAD
```

Expected: only intended source, tests, schema, migration, and plan files are changed or committed. `prisma/dev.db` may remain dirty locally and must not be staged.

- [ ] **Step 2: Run council commit/merge readiness**

Run:

```bash
npm run codex:council:logical -- --prompt "Chairman Decision 2: decide whether this completed league matchups and scoring architecture branch is ready to keep/merge/push. Verify source-of-truth boundaries, tests, and protected files."
```

Expected: `CHAIRMAN DECISION 2: COMMIT` or explicit non-blocking notes. If the council reports a blocking issue, fix it before finishing.

- [ ] **Step 3: Use finishing skill**

Use `superpowers:finishing-a-development-branch` and present the standard branch completion options.

## Self-Review

- Spec coverage: scoring modes, draws, lineup slots, bench separation, byes, regular-season scope, AFL round mapping, live/final scoring, category directions, settings lock, and route separation are covered.
- Placeholder scan: no task uses TBD/TODO/fill-in language. Implementation tasks provide exact files, commands, expected outcomes, and code snippets.
- Type consistency: scoring mode, lineup slot, category direction, fixture, score, and standing names are consistent across schema, services, tests, and UI tasks.
- Production-readiness note: route and UI tasks must be backed by service behavior, not static placeholders. If implementation reveals existing live stat projections lack player-game start times or final match status, add a narrow adapter fallback that returns unlocked/pending status and clearly exposes the missing-data state in the read model instead of blocking league architecture.
