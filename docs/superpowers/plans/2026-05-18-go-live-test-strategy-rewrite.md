# Go-Live Test Strategy Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Statly's comprehensive site test strategy into a go-live readiness testing plan that is complete against the actual codebase, risk-based, operationally useful, and enforceable over the long term.

**Architecture:** Keep the authoritative strategy in `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`. Replace the current broad checklist with a launch-readiness model: goal assessment, shortcomings, release gates, coverage matrix, operational evidence, and long-term maintenance rules. Use the current source inventory as evidence, but do not add test code in this plan.

**Tech Stack:** Markdown, Prettier, Vitest, Testing Library, Next.js App Router, Firestore/Firebase, Prisma, Socket.IO, Redis/BullMQ, Inngest, existing npm scripts.

---

## File Structure

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`
  - Responsibility: authoritative go-live test strategy, coverage model, release gates, and test roadmap.
- Read only: `package.json`
  - Responsibility: existing verification commands and test tooling.
- Read only: `vitest.config.ts`
  - Responsibility: current test runner configuration.
- Read only: `src/testUtils/README.md`
  - Responsibility: existing test utility conventions.
- Read only: `middleware.ts`
  - Responsibility: protected route, API CORS, and dev-token behavior that must be represented in the strategy.
- Read only: `next.config.mjs`
  - Responsibility: CSP, security headers, image/connection policy, and production header behavior.
- Read only: `src/app/api/**/route.ts`
  - Responsibility: route coverage inventory and mutation-risk classification.
- Read only: `src/app/**/page.tsx`
  - Responsibility: page/workflow coverage inventory.
- Read only: `src/components/**`
  - Responsibility: UI surface and accessibility coverage inventory.
- Read only: `src/hooks/**`
  - Responsibility: client state, realtime, localStorage, and lifecycle coverage inventory.
- Read only: `src/server/**`
  - Responsibility: worker, Socket.IO, fixture, draft, read-model, and operational test coverage inventory.

## Current Evidence To Preserve

The rewrite must keep these verified facts:

- `vitest.config.ts` configures Vitest with jsdom and includes `src/**/*.{test,spec}.*` and `tests/**/*.{test,spec}.*`.
- `package.json` has `npm test`, `npm run typecheck`, `npm run lint`, `npm run guard:routes`, `npm run guard:design`, `npm run branch:complete`, and `npm run prepush`.
- No Playwright or Cypress config is currently checked in.
- The codebase has broad API surface area: about 115 API route files were found during inventory.
- A large number of API routes do not have colocated `route.test.ts` files.
- There are many App Router pages and few direct page-level tests.
- There are many hooks and only a small number of hook tests.
- Existing tests already cover important areas such as Footywire canonical contract, player read models, league matchup, draft services, trade routes, rankings, player APIs, and selected UI/accessibility surfaces.
- Existing local `.firebase-data/*` changes are unrelated and must not be staged or modified.

## Task 1: Reframe The Strategy Around Go-Live Readiness

**Files:**

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Read the current strategy header and goal**

Run:

```bash
sed -n '1,80p' docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: The file starts with `# Comprehensive Site Test Strategy` and a broad goal about durable tests.

- [ ] **Step 2: Replace the title and goal section**

Replace the opening through the current `## Current Baseline` heading with this content:

```markdown
# Go-Live Site Test Strategy

## Goal

Prove that Statly is ready to go live as an AFL fantasy product, and keep proving it after launch.

This strategy is not a generic coverage checklist. It is a release-readiness system. It defines the tests, evidence, and operating gates required to answer five launch-critical questions:

- Can a real user complete the core fantasy workflows without support?
- Can protected data and high-impact mutations be trusted?
- Does canonical Footywire data remain the single semantic source of truth through projections and UI surfaces?
- Can realtime, scheduled, and background systems fail safely and recover predictably?
- Can the team detect, diagnose, and roll back production issues quickly?

Go-live readiness is achieved only when product workflows, data contracts, security posture, operational jobs, and observability all have deterministic verification. A large number of passing tests is not enough if the highest-risk paths are untested.

## Current Baseline
```

- [ ] **Step 3: Run Prettier check for the edited file**

Run:

```bash
npx prettier --check docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: This may fail while the rewrite is in progress. If it fails only because the file is mid-edit, continue.

- [ ] **Step 4: Review the changed opening**

Run:

```bash
sed -n '1,90p' docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: The document now clearly frames the goal as go-live readiness, not generic testing.

## Task 2: Add Goal Assessment And Shortcomings

**Files:**

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Insert a shortcomings section after Current Baseline**

Add this section immediately after the baseline facts and before `## Testing Architecture`:

```markdown
## Assessment Of The Previous Strategy

The previous strategy was directionally useful but not sufficient for go-live readiness.

It covered major product categories such as players, leagues, drafts, trades, waivers, APIs, and canonical data. However, it did not fully account for the codebase's real operational surface area or define enough release evidence to decide whether Statly can safely launch.

Shortcomings to correct:

- Route coverage was described broadly, but the actual API surface includes many more high-impact routes than the document named.
- Middleware, CORS, CSP, security headers, and protected route behavior were not first-class test areas.
- Socket.IO, realtime hooks, SSE-like streams, timers, reconnects, Redis locks, and metrics were under-specified.
- Dashboard modules, injury flows, scheduling, user preferences, watchlists, profile APIs, exports, and data deletion were missing or only implied.
- Dev/test mutation routes and fixture reset paths were not treated as operational risks.
- Commissioner, bot, member-management, and league-admin flows were not separated from generic admin coverage.
- Hook, context, localStorage, cookie, and client lifecycle behavior was not given its own coverage model.
- The plan did not define a go-live browser/device matrix, seeded data strategy, staging evidence, rollback checks, observability checks, or post-launch smoke cadence.
- The plan did not define a route coverage matrix or a rule for deciding which untested routes must block launch.

The rewritten strategy must correct these gaps without creating an unmaintainable demand for exhaustive tests on every file. Coverage should be risk-based, deterministic, and tied to release decisions.
```

- [ ] **Step 2: Verify the section appears in the right place**

Run:

```bash
rg -n "Assessment Of The Previous Strategy|Testing Architecture" docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: `Assessment Of The Previous Strategy` appears before `Testing Architecture`.

- [ ] **Step 3: Commit the goal and assessment if working in a clean branch**

Run:

```bash
git diff -- docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
git status --short --branch
```

Expected: Only `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md` is part of the intentional strategy rewrite. Do not stage `.firebase-data/*`.

Suggested commit if committing this checkpoint:

```bash
git add docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
git commit -m "docs(testing): frame go-live readiness strategy"
```

## Task 3: Replace The Testing Architecture With Release Gates

**Files:**

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Replace `## Testing Architecture` through the end of `### Browser E2E Tests`**

Use this content:

````markdown
## Go-Live Release Gates

Statly's go-live testing should be organized around release gates. Each gate answers a launch-critical question and has clear pass criteria.

### Gate 0: Baseline Health

Question: is the branch stable enough to evaluate?

Required commands:

```bash
npm run typecheck
npm run lint
npm run guard:routes
npm run guard:design
npm test
```
````

Pass criteria:

- all commands pass or every failure is documented as pre-existing and explicitly accepted
- no unrelated local artifacts are staged
- no test depends on production services
- no skipped or quarantined test hides a launch-blocking workflow

### Gate 1: Canonical Data And Projection Trust

Question: can product data be trusted from source ingestion through user-facing read models?

Required evidence:

- Footywire canonical raw-match contract tests pass
- ingestion consumes canonical contract fields directly
- read-model rebuild tests prove canonical stats, presence semantics, match identity, and provenance survive projection
- reconciliation detects `dropped_before_raw` and `dropped_in_projection`
- targeted import and rebuild paths are bounded to the affected season, round, match, or player slice

Launch blockers:

- a repaired scope still depends on a permanent legacy semantic reader
- missing, zero, and absent values are ambiguous
- provenance is dropped before projection
- import success can leave serving projections stale

### Gate 2: Security And Mutation Safety

Question: can protected data and high-impact mutations be trusted?

Required evidence:

- protected API routes reject unauthenticated users
- commissioner/admin routes reject regular users
- cron, import, fixture, worker, and repair routes have explicit authorization rules
- middleware behavior is tested for CORS preflight, dev-token injection, and protected redirects
- production headers enforce CSP and security policy as intended
- dev/test mutation routes are disabled or explicitly guarded outside local development

Launch blockers:

- any production route allows unauthenticated mutation of league, roster, draft, trade, waiver, player, import, or fixture data
- dev-only routes can run in shared or production environments
- hardcoded user or draft routes remain reachable without a documented local-only purpose and protection

### Gate 3: Core Product Workflow Completion

Question: can a real AFL fantasy user complete the product's core jobs?

Required evidence:

- public visitor can understand the product and reach auth flows
- authenticated user can access the app shell and selected league context
- user can view players, rankings, stats, matchups, and player detail
- user can create or join a league
- user can view and manage roster state
- user can create, review, accept, and reject trades where permitted
- user can submit, cancel, and process waivers where permitted
- user can create, join, and participate in a draft
- commissioner can perform league administration tasks where permitted

Launch blockers:

- any critical workflow only works with mock data not available in staging
- a user can complete a mutation but the UI does not reflect the new state
- loading, empty, error, or permission states block task completion

### Gate 4: Realtime And Background Reliability

Question: do realtime and asynchronous systems fail safely?

Required evidence:

- Socket.IO auth, connection, reconnect, and disconnect behavior is tested
- draft timers and queue jobs have deterministic tests
- realtime events do not duplicate picks, trades, waivers, or activity records
- Redis/BullMQ unavailable states degrade predictably
- Inngest and worker entrypoints have smoke or service-level tests
- cron jobs are authorized and idempotent

Launch blockers:

- reconnect can duplicate a mutation
- timer leadership can run concurrently without a guard
- background jobs can mutate production data without authorization or scoped input

### Gate 5: Accessibility, Responsiveness, And Design-System Quality

Question: can users operate the product across supported devices and input modes?

Required evidence:

- forms have labels, error text, and accessible descriptions
- icon-only controls have accessible names
- dialogs, tabs, selects, popovers, and navigation are keyboard usable
- tables preserve native semantics and useful column headers
- mobile layouts support core roster, player, trade, waiver, and draft workflows
- touched UI uses semantic tokens and preserves dark mode
- `npm run guard:design` passes

Launch blockers:

- a core workflow requires mouse-only interaction
- mobile layout hides or overlaps required controls
- form errors are not available to assistive technology

### Gate 6: Observability And Recovery

Question: can production issues be detected and recovered?

Required evidence:

- health, metrics, CSP report, analytics, worker, and socket endpoints have route or smoke coverage
- performance metric ingestion sanitizes URLs and rate limits correctly
- rollback-sensitive flows have documented recovery checks
- import/rebuild operations are auditable
- post-launch smoke tests can be run against staging or production safely

Launch blockers:

- high-impact jobs have no observable success/failure signal
- performance or CSP endpoints can leak sensitive data
- no safe smoke path exists for production after deploy

## Test Layers

Use the lowest reliable layer that proves the behavior.

### Unit Tests

Use for pure domain behavior: canonical stats, scoring, scheduling algorithms, draft reducers, trade value calculations, waiver ordering, identity matching, route helpers, read-model transforms, and utility functions.

### Component Tests

Use for local UI behavior: forms, tables, filters, tabs, dialogs, draft controls, trade panels, waiver panels, league switchers, dashboard modules, loading states, empty states, error states, and accessibility contracts.

### Route And Service Integration Tests

Use for App Router handlers, pages API handlers, auth boundaries, Firestore/Prisma persistence, import/rebuild flows, cron routes, worker coordination, and mutation contracts.

### Browser E2E Tests

Use only for complete workflows that cannot be trusted through lower layers. The repo does not currently include Playwright or Cypress config. The recommended long-term addition is Playwright after approval as a new dev dependency.

````

- [ ] **Step 2: Verify release gates replaced the old architecture**

Run:

```bash
rg -n "Go-Live Release Gates|Gate 0|Gate 6|Browser E2E Tests" docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
````

Expected: All listed headings appear.

- [ ] **Step 3: Check Markdown formatting state**

Run:

```bash
npx prettier --check docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: May still fail if later tasks are not complete. Continue unless the file has a syntax issue that makes it unreadable.

## Task 4: Expand Product Workflow Coverage

**Files:**

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Replace the current `## Product Workflow Coverage` section through `### APIs, Cron, Admin, And Workers`**

Use this content:

```markdown
## Product Workflow Coverage

Every workflow below must have tests for the relevant happy path, loading state, empty state, error state, permission state, and stale-data state. Browser E2E should cover only the launch-critical journey; component and route tests should cover the rest.

### Public Site, Legal, And App Shell

Cover:

- `/`
- `/fantasy`
- `/help`
- `/privacy`
- `/terms`
- `/data-deletion`
- global navigation
- app shell navigation
- loading boundaries
- error boundaries

Required assertions:

- pages render primary content without crashing
- navigation exposes accessible links and active state
- protected links route unauthenticated users correctly
- legal and deletion pages provide clear user-facing instructions
- mobile navigation remains keyboard usable
- loading states do not collapse layout
- error boundaries show recoverable messaging

### Auth And Session Flows

Cover:

- `/login`
- `/register`
- `/forgot-password`
- `AuthContext`
- `/api/auth/health`
- `/api/auth/session`
- session cookie behavior
- bypass-auth behavior

Required assertions:

- login validates email and password
- register validates required fields and error messages
- forgot password handles success and failure
- auth-only routes block unauthenticated users
- session endpoints do not expose sensitive data
- bypass auth is explicit and disabled for production-like checks

### Dashboard And Home Modules

Cover:

- `/dashboard`
- dashboard injury modules
- leaderboard module
- live draft module
- live scoring module
- league management module
- quick actions module
- recent activity module
- stats overview module
- team analytics module
- weekend summary module

Required assertions:

- each module renders with populated, empty, loading, and error data
- quick actions point to valid routes for the current auth and league state
- stale data is visibly distinguishable from live data
- dashboard modules do not require production services in tests
- dense dashboard layouts remain usable on mobile

### Player Discovery, Rankings, Stats, And Match Data

Cover:

- `/players`
- `/players/[id]`
- `/player-rankings`
- `/rankings`
- `/stats`
- `/leaderboard`
- `/matches`
- `/matches/[round]`
- `/api/players`
- `/api/players/search`
- `/api/players/by-ids`
- `/api/players/[id]`
- `/api/players/[id]/stats`
- `/api/players/[id]/matches`
- `/api/player-stats`
- `/api/player-stats/aggregate`
- `/api/rankings`
- `/api/matches`
- `/api/matches/enhanced`

Required assertions:

- player rows merge global and league metadata correctly
- filters preserve position, club, league ownership, and availability semantics
- sorting is stable for fantasy points and stat columns
- canonical stat labels and values match read-model data
- player detail handles missing stats without crashing
- match data handles postponed, missing, or partial rounds
- tables preserve native table semantics and useful headers

### League Workflows

Cover:

- `/leagues`
- `/leagues/new`
- `/leagues/join`
- `/leagues/[id]`
- `/leagues/[id]/teams/[userId]`
- league switcher
- roster ownership
- matchup views
- live scoring matchup views
- league season state

Required assertions:

- league list shows joined leagues and empty state
- create league validates name, scoring, roster, waiver, and draft settings
- join league validates invite code and error states
- league dashboard renders standings, roster, matchup, waivers, trades, and actions from fixtures
- selected league state does not leak between users
- team roster preserves owned, free-agent, bench, and unavailable states
- unauthorized users cannot mutate or view protected league data

### Commissioner, Bots, And League Administration

Cover:

- `/commissioner`
- commissioner tools
- `/api/leagues/[id]/members`
- `/api/leagues/[id]/bots/run`
- `/api/leagues/[id]/bots/traits`
- `/api/leagues/[id]/draft-settings`
- `/api/leagues/[id]/draft`
- `/api/leagues/[id]/link-draft`
- `/api/leagues/[id]/sync-draft-results`
- `/api/leagues/[id]/season/bootstrap`

Required assertions:

- commissioner-only actions reject regular members
- member updates preserve league invariants
- bot generation is deterministic under fixtures
- draft settings validate schedule, roster, order, and member-count constraints
- draft link and sync operations are idempotent
- season bootstrap is scoped and cannot overwrite unrelated leagues

### Draft Workflows

Cover:

- `/drafts`
- `/drafts/create`
- `/drafts/[id]`
- `/drafts/history`
- `/drafts/settings`
- `/draft`
- `/draft/clubs`
- `/draft/clubs/[clubSlug]`
- `/draft/trades`
- `/draft/trades/[tradeId]`
- `/api/drafts`
- `/api/drafts/list`
- `/api/drafts/history`
- `/api/drafts/[id]`
- `/api/drafts/[id]/available-players`
- `/api/drafts/[id]/lobby`
- `/api/drafts/[id]/participants`
- `/api/drafts/[id]/pause`
- `/api/drafts/[id]/pick`
- `/api/drafts/[id]/picks`
- `/api/drafts/[id]/players`
- `/api/drafts/[id]/pre-queue`
- `/api/drafts/[id]/queue`
- `/api/drafts/[id]/resume`
- `/api/drafts/[id]/schedule`
- `/api/drafts/[id]/start`
- `/api/drafts/[id]/auto-pick`
- `/api/drafts/[id]/watchlist`

Required assertions:

- draft creation validates required settings and timezone-aware schedule
- draft reducer enforces pick order, pause, resume, auto-pick, and completed state
- current pick, queue, drafted players, and connection status are visible
- pick mutation derives user identity server-side where required
- reconnect does not duplicate picks or queue updates
- watchlist changes are user-scoped
- draft history renders completed drafts and empty state
- draft trade explorer and detail views show club trade data consistently

### Trades And Waivers

Cover:

- `/tradecentre`
- `/leagues/[id]/trades`
- `/waivers`
- `/leagues/[id]/waivers`
- `/api/trades`
- `/api/trades/[id]`
- `/api/trades/[id]/[action]`
- `/api/trades/list`
- `/api/trades/review`
- legacy `/api/listTrades`
- legacy `/api/tradeReview`
- `/api/leagues/[id]/waivers`
- `/api/leagues/[id]/waivers/cancel`
- `/api/leagues/[id]/waivers/process`
- `/api/leagues/[id]/waivers/settings`
- `/api/leagues/[id]/waivers/submit`

Required assertions:

- trade creation validates selected teams and players
- trade review computes balanced and unbalanced results deterministically
- trade inbox groups incoming, outgoing, and completed trades
- accept, reject, veto, and admin actions require correct authorization
- waiver claim validates budget, roster limits, priority, and duplicate claims
- waiver processing is idempotent and ordered
- legacy trade APIs preserve response contracts until removed

### Injuries, Live Data, And External Sources

Cover:

- `/api/injuries`
- `/api/ingest-injuries`
- `/api/live-data`
- `/api/live-player-stats`
- `/api/live-player-stats/enriched`
- `/api/etl/live-matches`
- `/api/etl/live-player-stats`
- injury dashboard modules
- injury hooks
- live stats hooks

Required assertions:

- Footywire injury scrape failures degrade safely
- injury response adapters preserve expected fields
- player-name matching is deterministic
- live stat routes require required query parameters
- live stat responses preserve canonical stat naming where applicable
- stale live data is visible in UI
- external source failures do not crash dashboard or player pages

### Scheduling

Cover:

- `/scheduling`
- `/api/scheduling/generate`
- `/api/scheduling/presets`
- `src/lib/scheduling/*`

Required assertions:

- round-robin generation is deterministic
- odd team counts and byes are handled explicitly
- playoff presets preserve seed and matchup rules
- invalid team counts return helpful errors
- generated schedules avoid impossible repeat or self-matchup states unless explicitly configured

### User Preferences, Watchlists, And Account Data

Cover:

- `/api/user/profile/[userId]`
- `/api/user/teams`
- `/api/user/watchlists`
- `/api/user/draft-settings`
- `/api/user/leagues`
- `/api/user/leagues/[id]/settings`
- `useTeamSwitcher`
- `useUserProfile`
- `useUserLeagues`
- `useLocalStorage`
- watchlist components

Required assertions:

- preferences are user-scoped
- selected league/team does not leak across users
- localStorage parse failures recover safely
- cookie preferences are read consistently by server pages
- watchlist changes persist, remove, and reload correctly
- unauthorized users cannot read another user's account data

### Exports, Reports, Metrics, And Observability

Cover:

- `/api/export/players`
- `/api/draft-trades/export`
- `/api/draft-trades/[tradeId]/export`
- `/api/csp-report`
- `/api/analytics/performance`
- `/api/metrics`
- `/api/health`
- `/api/ping`
- `/api/redis/Health`
- `/api/admin/workers`
- `/api/admin/queue`
- Socket.IO `/health`
- Socket.IO `/metrics`

Required assertions:

- CSV exports escape values and set correct headers
- export filters cannot bypass authorization
- CSP reports are accepted without leaking sensitive data
- performance metrics sanitize URLs by stripping query and hash
- performance metrics rate limit and deduplicate
- health endpoints reveal enough for operations without exposing secrets
- worker and queue routes are admin-protected

### Dev Fixtures And Local Mutation Safety

Cover:

- `src/server/devFixtures/**`
- `/api/dev/test-user`
- `/api/create-test-draft`
- `/api/add-test-data`
- `/api/test-lobby`
- hardcoded draft roster routes under `/api/draft/cmeilycnf00047gue6xhkh7xzl/**`

Required assertions:

- fixture reset refuses production-like environments
- generated users, leagues, rosters, drafts, and seasons are deterministic
- fixture verifier catches incomplete setup
- dev-only API routes are unavailable or explicitly guarded outside local development
- hardcoded user or draft routes are removed, blocked, or documented as local-only with tests

### Middleware, Headers, And Platform Security

Cover:

- `middleware.ts`
- `next.config.mjs`
- API CORS preflight
- protected app route redirects
- CSP and reporting headers
- Firebase, Socket.IO, emulator, and custom connect-src values

Required assertions:

- API `OPTIONS` requests return expected CORS headers
- development bearer tokens inject `x-auth-user` only outside production
- protected `/dashboard`, `/app`, and `/league` prefixes redirect without session
- production uses `Content-Security-Policy`
- non-production uses `Content-Security-Policy-Report-Only`
- security headers are present for all routes

### Hooks, Contexts, Stores, And Client Lifecycle

Cover:

- `LeagueContext`
- `TeamContext`
- `DraftContext`
- `SocketContext`
- `useAdvancedLiveScoring`
- `useAdvancedDraftAnalytics`
- `useRealtimeTradesWaivers`
- `useRealtimeDraft`
- `useDraftPerformance`
- `useAutoRefresh`
- `useDebounce`
- `useNotification`
- Zustand stores

Required assertions:

- effects clean up timers, sockets, and event listeners
- aborted requests do not update unmounted components
- reconnect events do not duplicate client state
- localStorage and cookie-backed state recovers from invalid values
- notification and activity events dispatch once per source event
- performance hooks avoid network calls when disabled
```

- [ ] **Step 2: Verify key newly added sections exist**

Run:

```bash
rg -n "Dashboard And Home Modules|Middleware, Headers, And Platform Security|Dev Fixtures And Local Mutation Safety|Hooks, Contexts, Stores, And Client Lifecycle|Injuries, Live Data, And External Sources" docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: All five headings appear.

## Task 5: Add Route Coverage Matrix Requirements

**Files:**

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Insert route coverage matrix section before `## Fixture Strategy`**

Use this content:

```markdown
## Route Coverage Matrix

Before go-live, maintain a route coverage matrix generated from the repository inventory.

For every route handler, record:

- path
- method or methods
- mutation level: none, low, medium, high
- auth requirement: public, authenticated, member, commissioner, admin, cron, local-only
- backing system: Firestore, Prisma, Redis, BullMQ, Socket.IO, external source, none
- existing test file
- required go-live evidence
- launch status: required, deferred with reason, or remove before launch

Launch-blocking route families:

- auth/session
- league creation, join, settings, members, roster, matchup, and season state
- draft create, start, pick, queue, pause, resume, schedule, watchlist, and sync
- trade create, review, accept, reject, veto, and legacy compatibility
- waiver submit, cancel, process, settings, and list
- admin, cron, repair, import, worker, fixture, and queue mutation routes
- user profile, teams, leagues, watchlists, and preferences
- canonical ETL, live data, player stats, rankings, and read-model routes
- metrics, CSP reports, health, socket status, and observability routes

Deferred route coverage is acceptable only when:

- the route is not reachable in production, or
- the route is read-only and covered by a higher-level workflow, or
- the route is scheduled for removal before go-live, or
- the risk is documented and explicitly accepted.

Hardcoded user-specific or draft-specific routes must not silently ship. They must be removed or tested as local-only blocked paths.
```

- [ ] **Step 2: Create the inventory command snippet in the same section**

Add this code block under the route matrix rules:

````markdown
Inventory command:

```bash
find src/app/api src/pages/api -type f \( -name 'route.ts' -o -name '*.ts' \) | sort
```
````

Missing colocated App Router route tests can be inspected with:

```bash
python3 - <<'PY'
from pathlib import Path
for p in sorted(Path('src/app/api').rglob('route.ts')):
    if not p.with_name('route.test.ts').exists():
        print(p)
PY
```

````

- [ ] **Step 3: Verify the route matrix section**

Run:

```bash
rg -n "Route Coverage Matrix|Launch-blocking route families|Hardcoded user-specific" docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
````

Expected: All phrases appear.

## Task 6: Expand Fixture, Auth, Data, And Environment Strategy

**Files:**

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Replace `## Fixture Strategy`, `## Auth Strategy`, and `## Data And Emulator Strategy`**

Use this content:

```markdown
## Fixture Strategy

Go-live tests need deterministic, production-like data without depending on production services.

Canonical fixture families:

- `playerFixture`
- `clubFixture`
- `leagueFixture`
- `leagueMemberFixture`
- `teamFixture`
- `rosterFixture`
- `tradeFixture`
- `waiverFixture`
- `draftFixture`
- `draftPickFixture`
- `draftQueueFixture`
- `watchlistFixture`
- `injuryFixture`
- `liveMatchFixture`
- `canonicalRawMatchFixture`
- `playerReadModelFixture`
- `matchupFixture`
- `performanceMetricFixture`

Fixture rules:

- represent real AFL fantasy concepts
- keep defaults minimal
- create named variants for edge cases
- avoid large kitchen-sink fixtures
- keep canonical Footywire fixtures close to contract tests
- avoid duplicating semantic meaning across fixture layers
- include at least one realistic league with members, rosters, trades, waivers, draft state, matchup state, and player read models
- include stale, empty, and partial-data variants for dashboard and live-data surfaces

Fixture safety rules:

- fixture reset commands must refuse production-like environments
- fixture routes must be local-only or admin-protected
- seeded identities must be synthetic and documented
- fixture data must not require real user emails, secrets, or production Firebase state

## Auth Strategy

Tests should use explicit auth modes:

- unauthenticated
- authenticated regular user
- league member
- league commissioner
- admin
- cron caller
- local fixture operator
- bypass-auth local or development mode
- production-like no-bypass mode

Required auth checks:

- every protected route has at least one negative authorization test
- every mutation route verifies the actor can mutate the target resource
- every admin or commissioner route rejects regular users
- every local-only route proves it is blocked outside local development
- bypass-auth behavior is tested separately from production-like behavior
- user-scoped routes prove one user cannot read or mutate another user's data

## Data, Emulator, And Staging Strategy

Use pure tests where possible.

Use Firestore emulator, Prisma test databases, Redis fakes, or route mocks only when verifying:

- persistence shape
- query behavior
- transactional behavior
- rebuild behavior
- import behavior
- projection behavior
- queue or worker coordination
- realtime event publication

Use staging or production-like environments only for final smoke and release evidence:

- no destructive tests against production
- no fixture reset against production
- no mutation route smoke without a dedicated test league or synthetic account
- no external-source scrape smoke unless rate limits and source behavior are understood

Every staging smoke must state:

- test account
- test league or draft id
- allowed mutations
- cleanup expectation
- rollback signal
- monitoring dashboard or log to inspect
```

- [ ] **Step 2: Verify replacement**

Run:

```bash
rg -n "Fixture safety rules|Required auth checks|Data, Emulator, And Staging Strategy" docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: All phrases appear.

## Task 7: Add Browser, Performance, Accessibility, And Go-Live Matrices

**Files:**

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Insert this section before `## CI Test Tiers`**

Use this content:

````markdown
## Browser, Device, And Accessibility Matrix

Before go-live, validate the smallest meaningful device matrix:

- desktop Chromium at a common laptop viewport
- desktop Safari or WebKit-equivalent
- mobile Safari or WebKit-equivalent
- mobile Chromium-equivalent
- reduced-motion mode
- keyboard-only navigation
- dark mode for app shell and one dense table workflow

Critical workflows to validate in browser:

- public navigation to auth
- login or authenticated app-shell entry
- league selection
- player search and filtering
- roster view
- trade review
- waiver submit
- draft room current pick and queue
- dashboard overview
- unauthorized admin route rejection

Accessibility requirements:

- no unlabeled icon-only controls in critical workflows
- visible focus treatment for all interactive controls
- form errors connected through accessible descriptions
- dialogs trap and restore focus where applicable
- tables expose headers and row/column meaning
- live or async updates use appropriate visible state, and `aria-live` only where useful

## Performance And Reliability Matrix

Before go-live, verify:

- app shell initial load does not block on optional dashboard modules
- dense tables remain responsive with production-like player counts
- player search/filter interactions avoid avoidable layout shift
- draft room remains usable during reconnect
- live scoring and matchup views show stale state instead of crashing
- performance metric ingestion rate limits and deduplicates
- Socket.IO health and metrics endpoints are observable
- Redis/BullMQ unavailable states degrade predictably for non-critical features

Performance tests should be targeted. Do not add brittle timing assertions to unit tests. Use route, component, browser, and observability checks where each gives reliable signal.

## Go-Live Evidence Checklist

For a release candidate, collect:

- commit SHA
- environment
- test account identifiers
- seeded league, draft, and matchup identifiers
- commands run
- pass/fail summary
- known accepted risks
- rollback plan
- post-deploy smoke plan

Required command evidence:

```bash
npm run typecheck
npm run lint
npm run guard:routes
npm run guard:design
npm test
npm run branch:complete
```
````

Recommended release evidence when practical:

```bash
npm run prepush
```

Future evidence after browser E2E is added:

```bash
npm run test:e2e
```

Future evidence after deterministic data-slice commands exist:

```bash
npm run test:data-contract
npm run test:go-live-smoke
```

Do not add these future scripts to `package.json` until they are implemented.

````

- [ ] **Step 2: Verify matrices exist**

Run:

```bash
rg -n "Browser, Device, And Accessibility Matrix|Performance And Reliability Matrix|Go-Live Evidence Checklist" docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
````

Expected: All headings appear.

## Task 8: Rewrite CI Tiers, Anti-Patterns, Roadmap, And Definition Of Done

**Files:**

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Replace `## CI Test Tiers` through the end of the file**

Use this content:

````markdown
## CI Test Tiers

### Fast PR Tier

Run on every PR:

```bash
npm run typecheck
npm run lint
npm run guard:routes
npm run guard:design
npm test
```
````

Purpose:

- protect type safety
- protect lint and accessibility rules
- protect route runtime conventions
- protect design-system drift
- protect existing unit, component, route, and integration tests

### Pre-Push And Release Tier

Run before push or release when practical:

```bash
npm run prepush
```

Purpose:

- run the repository's hard local quality gate
- include env checks, route guards, dependency guards, tests, and format checks

### Future Browser E2E Tier

Add after Playwright or equivalent browser tooling is approved:

```bash
npm run test:e2e
```

Purpose:

- verify launch-critical user journeys in a real browser
- check desktop/mobile behavior and critical accessibility interactions
- avoid duplicating component-level coverage

### Future Deep Data Tier

Add only after deterministic, safe data-slice scripts exist.

Responsibilities:

- import a targeted Footywire fixture or season slice
- rebuild player read models for that targeted slice
- verify read models for that targeted slice
- reconcile `dropped_before_raw` and `dropped_in_projection`
- verify warehouse mirror parity where relevant

Do not invent script names without implementing the scripts and their safety model.

## What Not To Test

Avoid:

- snapshots of large pages
- tests that assert long Tailwind class strings except for intentional design guards
- tests that mock the exact function being tested
- route tests that only check `200`
- tests tied to implementation order instead of user-visible behavior
- exhaustive E2E coverage of every route
- duplicated assertions across unit, component, route, and E2E layers
- real production service calls
- broad fixture dumps that obscure the behavior under test
- brittle timing assertions for realtime behavior
- unactionable smoke tests that do not state what failure means

## TDD Operating Rule

For every new behavior or bug fix:

1. Write the narrow failing test.
2. Run it and confirm the failure is meaningful.
3. Implement the smallest passing change.
4. Run the narrow test.
5. Run the nearest relevant suite.
6. Refactor only while green.

For existing untested behavior, first write characterization tests around the current intended behavior. Then change behavior with a failing test.

## Implementation Roadmap

### Phase 1: Baseline And Inventory

- Run existing quality commands.
- Record current failures.
- Build the route coverage matrix.
- Build the page/workflow coverage matrix.
- Build the hook/context/state coverage matrix.
- Classify every untested route by launch risk.
- Identify duplicate, brittle, or low-value tests.
- Decide whether Playwright should be added now or deferred.

### Phase 2: Launch Blocker Coverage

- Add or repair tests for unauthenticated mutation paths.
- Add middleware and security header tests.
- Add dev fixture and local-only route safety tests.
- Add route tests for admin, cron, import, repair, worker, queue, draft mutation, trade mutation, waiver mutation, user data, and league administration paths.
- Remove or block hardcoded user-specific API routes before production.

### Phase 3: Canonical Data And Projection Trust

- Expand canonical Footywire contract tests.
- Expand ingestion and read-model convergence tests.
- Add targeted reconciliation tests for `dropped_before_raw` and `dropped_in_projection`.
- Verify import success triggers required rebuild or rematerialization.
- Add deterministic data-slice verification commands only when their safety model is implemented.

### Phase 4: Core Product Workflow Coverage

- Add component and route coverage for dashboard, players, rankings, leagues, rosters, matchups, trades, waivers, draft room, live scoring, injuries, scheduling, watchlists, and account preferences.
- Cover happy, empty, loading, error, permission, and stale-data states.
- Add hook/context/state tests for realtime and client lifecycle behavior.

### Phase 5: Browser Go-Live Smoke Suite

- Add approved browser E2E tooling.
- Seed deterministic local or staging data.
- Cover the smallest set of complete critical journeys.
- Validate the browser/device/accessibility matrix.
- Keep E2E stable and high-signal.

### Phase 6: Operational Readiness

- Verify health, metrics, CSP report, analytics, worker, queue, and socket endpoints.
- Define staging smoke accounts and cleanup rules.
- Define rollback checks for import, rebuild, draft, trade, waiver, and fixture operations.
- Record go-live evidence for each release candidate.

### Phase 7: Maintenance

- Track test runtime and flake rate.
- Remove redundant or brittle tests when stronger lower-level tests exist.
- Keep the route coverage matrix current when routes are added or removed.
- Review launch blockers before each major release.
- Promote recurring production incidents into regression tests.

## Definition Of Done

A go-live test-plan item is complete only when:

- the protected launch risk is named
- the relevant test layer is chosen intentionally
- fixtures are deterministic and production-safe
- auth mode is explicit
- the test fails before implementation when behavior is new or changed
- the test asserts behavior, not incidental implementation
- accessibility and responsive behavior are covered where relevant
- canonical data changes prove raw-to-projection convergence
- mutation routes prove authorization, validation, persistence, and resulting UI or read-model state
- realtime paths prove reconnect and duplicate-event behavior
- operational paths prove observability and safe failure
- the test can run in CI, local emulators, or a documented staging smoke environment without relying on production state
- the suite remains understandable and maintainable

## Go-Live Exit Criteria

Statly is test-ready for go-live when:

- all Gate 0 commands pass
- every launch-blocking route family has required route or workflow coverage
- core user workflows pass in component/route tests and the approved browser smoke suite
- canonical Footywire data can be verified from raw persistence through read models
- no dev-only mutation route is reachable in production-like environments
- realtime draft, trade, waiver, and live scoring paths have duplicate-event and reconnect coverage
- health, metrics, CSP, performance, worker, queue, and socket observability paths are verified
- staging smoke evidence is recorded with test accounts and cleanup expectations
- accepted risks are documented with owner, reason, and expiry

## Post-Launch Smoke Cadence

After launch, run a safe smoke set after each deploy:

- public home and auth reachability
- authenticated app shell
- selected league dashboard
- player search
- roster view
- read-only trade and waiver views
- draft room read-only load where a test draft exists
- health and metrics checks
- error log and CSP report review

Production smoke tests must avoid destructive mutations unless they use a dedicated synthetic league and a documented cleanup path.

````

- [ ] **Step 2: Verify final sections**

Run:

```bash
rg -n "Go-Live Exit Criteria|Post-Launch Smoke Cadence|Phase 7: Maintenance|Launch Blocker Coverage" docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
````

Expected: All phrases appear.

## Task 9: Format, Review, And Verify

**Files:**

- Modify: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Format the rewritten strategy**

Run:

```bash
npx prettier --write docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: Prettier rewrites the file or reports it is unchanged.

- [ ] **Step 2: Check formatting**

Run:

```bash
npx prettier --check docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 3: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 4: Run branch completion check**

Run:

```bash
npm run branch:complete
```

Expected: command exits `0`. It may report unrelated `.firebase-data/*` local changes; do not stage them.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat
git diff -- docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md | sed -n '1,260p'
git status --short --branch
```

Expected:

- strategy document is the intentional changed doc
- unrelated `.firebase-data/*` changes remain unstaged and untouched
- no secrets, generated artifacts, or local database exports are added

## Task 10: Self-Review

**Files:**

- Review: `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

- [ ] **Step 1: Verify spec coverage**

Confirm the rewritten strategy covers:

- go-live readiness goal
- shortcomings against that goal
- route coverage matrix
- middleware and security headers
- canonical Footywire data convergence
- auth and mutation safety
- dashboard modules
- player, rankings, stats, and match data
- leagues, commissioner, bots, and administration
- drafts
- trades and waivers
- injuries and external sources
- scheduling
- user preferences, watchlists, and account data
- exports, reports, metrics, and observability
- dev fixtures and local mutation safety
- realtime, Socket.IO, workers, cron, queue, and Inngest-adjacent behavior
- hooks, contexts, stores, and client lifecycle
- browser/device/accessibility matrix
- performance and reliability matrix
- CI tiers
- go-live evidence checklist
- exit criteria
- post-launch smoke cadence

- [ ] **Step 2: Placeholder scan**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
needles = [
    'TB' + 'D',
    'TO' + 'DO',
    'implement ' + 'later',
    'fill in ' + 'details',
    'appropriate error ' + 'handling',
    'similar to ' + 'Task',
    'etc' + '.',
]
text = Path('docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md').read_text()
for line_no, line in enumerate(text.splitlines(), start=1):
    if any(needle in line for needle in needles):
        print(f'{line_no}:{line}')
PY
```

Expected: no matches. If matches appear, replace them with concrete wording.

- [ ] **Step 3: Command accuracy scan**

Run:

```bash
rg -n "npm run test:e2e|npm run test:data-contract|npm run test:go-live-smoke" docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md
```

Expected: these commands appear only as future commands with explicit warning not to add or run them until implemented.

- [ ] **Step 4: Final verification summary**

Prepare a concise summary:

```text
Changed docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md into a go-live readiness strategy.
Verification: Prettier check passed, git diff --check passed, npm run branch:complete passed.
Known unrelated worktree changes: .firebase-data/* remained untouched.
```

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-go-live-test-strategy-rewrite.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
