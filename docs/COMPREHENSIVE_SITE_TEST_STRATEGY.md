# Go-Live Site Test Strategy

## Goal

Prove that Statly is ready to go live as an AFL fantasy product, and keep proving it after launch.

This strategy is not a generic coverage checklist. It is a release-readiness system for answering launch-critical questions:

- Can real users complete core fantasy workflows without support?
- Can protected data and high-impact mutations be trusted?
- Does canonical Footywire data remain the single semantic source of truth through projections and UI surfaces?
- Can realtime, scheduled, and background systems fail safely and recover predictably?
- Can the team detect, diagnose, and roll back production issues quickly?

Go-live readiness is achieved only when product workflows, data contracts, security posture, operational jobs, and observability all have deterministic verification. A large number of passing tests is not enough if the highest-risk paths are untested.

## Current Baseline

The repository currently has:

- Vitest configured in `vitest.config.ts`
- Testing Library and `@testing-library/jest-dom` configured through `src/testUtils/setupTests.ts`
- unit, component, route, integration, Firestore, and domain tests spread across `src/` and `tests/`
- no checked-in Playwright or Cypress configuration
- about 115 API route files in `src/app/api` and `src/pages/api`
- many API routes without colocated `route.test.ts` files
- many App Router pages and few direct page-level tests
- many hooks and only a small number of hook tests

Existing commands that matter:

```bash
npm test
npm run typecheck
npm run lint
npm run guard:routes
npm run guard:design
npm run branch:complete
npm run prepush
```

Before adding broad coverage, establish the current health baseline:

```bash
npm test
npm run typecheck
npm run lint
npm run guard:routes
npm run guard:design
```

Document any existing failures before expanding the suite. New tests should not be used to hide an unstable baseline.

## Assessment Of The Previous Strategy

The previous strategy was directionally useful but not sufficient for go-live readiness.

It covered major product categories such as players, leagues, drafts, trades, waivers, APIs, and canonical data. However, it did not fully account for the codebase's real operational surface area or define enough release evidence to decide whether Statly can safely launch.

Shortcomings corrected by this rewrite:

- Route coverage was described broadly, but the actual API surface includes many more high-impact routes than the document named.
- Middleware, CORS, CSP, security headers, and protected route behavior were not first-class test areas.
- Socket.IO, realtime hooks, SSE-like streams, timers, reconnects, Redis locks, and metrics were under-specified.
- Dashboard modules, injury flows, scheduling, user preferences, watchlists, profile APIs, exports, and data deletion were missing or only implied.
- Dev/test mutation routes and fixture reset paths were not treated as operational risks.
- Commissioner, bot, member-management, and league-admin flows were not separated from generic admin coverage.
- Hook, context, localStorage, cookie, and client lifecycle behavior was not given its own coverage model.
- The plan did not define a go-live browser/device matrix, seeded data strategy, staging evidence, rollback checks, observability checks, or post-launch smoke cadence.
- The plan did not define a route coverage matrix or a rule for deciding which untested routes must block launch.

Coverage should be risk-based, deterministic, and tied to release decisions. The goal is not exhaustive tests for every file.

## Go-Live Release Gates

Go-live approval requires passing each release gate below or explicitly documenting the risk, owner, mitigation, expiry, and launch decision.

### Gate 0: Baseline Health

Question: is the branch stable enough to evaluate?

Required commands:

```bash
npm run typecheck
npm run lint
npm run guard:routes
npm run guard:design
npm test
npm run branch:complete
```

Recommended before release promotion:

```bash
npm run prepush
```

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
- raw persisted documents contain the intended canonical data
- downstream projections do not depend on permanent legacy semantic fallback readers
- reconciliation detects `dropped_before_raw`
- reconciliation detects `dropped_in_projection`
- targeted import and rebuild paths are bounded to affected season, round, match, player, or league slices

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

- any production route allows unauthenticated mutation of league, roster, draft, trade, waiver, player, import, fixture, or projection data
- dev-only routes can run in shared or production environments
- hardcoded user or draft routes remain reachable without documented local-only protection

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
- user can create, join, and participate in a draft where enabled
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
- successful imports trigger required rebuild or rematerialization

Launch blockers:

- reconnect can duplicate a mutation
- timer leadership can run concurrently without a guard
- background jobs can mutate production data without authorization or scoped input
- users silently see stale projections after successful imports

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
- import/rebuild operations are auditable
- operators can distinguish raw-data failure from projection failure
- operators can identify affected season, round, match, player, or league scope
- recovery steps are bounded and repeatable
- post-launch smoke tests can be run safely

Launch blockers:

- high-impact jobs have no observable success/failure signal
- performance or CSP endpoints can leak sensitive data
- no safe smoke path exists for production after deploy

## Test Layers

Use the lowest reliable layer that proves the behavior.

### Static And Repository Guards

Use current scripts to protect type safety, lint health, route integrity, design drift, tracked artifacts, dependency boundaries, and formatting.

### Unit Tests

Use for pure domain behavior: canonical stats, scoring, scheduling algorithms, draft reducers, trade value calculations, waiver ordering, identity matching, route helpers, read-model transforms, and utility functions.

### Component Tests

Use for local UI behavior: forms, tables, filters, tabs, dialogs, draft controls, trade panels, waiver panels, league switchers, dashboard modules, loading states, empty states, error states, and accessibility contracts.

### Route And Service Integration Tests

Use for App Router handlers, pages API handlers, auth boundaries, Firestore/Prisma persistence, import/rebuild flows, cron routes, worker coordination, and mutation contracts.

### Manual Browser Workflow Verification

Required until browser automation exists. Cover launch-scope workflows, responsive behavior, accessibility basics, degraded states, console errors, and route reachability.

### Future Browser E2E Tests

Use only for complete workflows that cannot be trusted through lower layers. The repo does not currently include Playwright or Cypress config. The recommended long-term addition is Playwright after approval as a new dev dependency.

Do not list a browser E2E command as runnable until it exists in `package.json`.

## Product Workflow Coverage

Go-live testing must cover Statly as a production AFL fantasy product, not as isolated route checks. Each workflow below should be validated across representative desktop and mobile viewports, authenticated and unauthenticated states where relevant, loading/empty/error states, and at least one realistic seeded league scenario.

### Public, Legal, And App Shell

Cover:

- `/`
- `/fantasy`
- `/help`
- `/privacy`
- `/terms`
- `/data-deletion`
- global navigation and footer
- app shell layout after sign-in
- mobile navigation, account menu, league switchers, and protected-route redirects

Required assertions:

- public pages render without requiring authentication
- legal pages are reachable, readable, and independent of app data loading
- primary calls to action route to the correct auth or onboarding flow
- signed-out users cannot access protected app routes
- signed-in users are not trapped on public/auth-only pages
- app shell preserves navigation state across route changes
- mobile navigation supports core fantasy workflows
- loading and error boundaries do not expose stack traces, secrets, or internal implementation details

### Auth And Session

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

- users can sign in, sign out, and return to a valid post-auth destination
- expired or missing sessions redirect predictably without private data flashes
- auth state is consistent between middleware, server components, client components, and API routes
- auth errors are user-readable and do not disclose provider internals
- protected mutations require an authenticated user
- cross-user data access is blocked
- new users without league/team data see appropriate onboarding or empty state

### Dashboard

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

- dashboard loads with realistic production-like data volume
- empty, partial, stale, and failed data states are explicit and stable
- user-specific data is scoped to the signed-in user and selected league
- league or season switch updates all dependent widgets consistently
- scores, rankings, roster summaries, and alerts agree with source workflows
- dashboard does not block on non-critical widgets if one data source fails
- mobile layout preserves the next most important fantasy action

### Players, Rankings, Stats, And Matches

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

- player search, filters, sort order, and pagination are stable and composable
- rankings and stats use the same canonical player and match data as downstream fantasy workflows
- numeric fields align, sort numerically, and handle zero/missing values intentionally
- player identity remains stable across pages, watchlists, drafts, trades, and waivers
- match metadata, round, venue, teams, and status display consistently
- empty result states distinguish no matching filter from data unavailable
- large tables remain usable on mobile
- data refresh does not reorder or reset user-selected filters unexpectedly

### Leagues

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

- users can access only leagues they belong to unless a route is intentionally public
- league creation validates required fields and creates consistent league/team records
- join flows handle valid, expired, invalid, and already-used invites
- league switch updates standings, rosters, matchups, trades, waivers, and draft state together
- standings and matchup results match the scoring source of truth
- selected league state does not leak between users
- member roles and permissions are enforced in UI and API mutations

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

- commissioner-only routes and actions are inaccessible to regular members
- admin mutations require server authorization, not only hidden UI
- bot actions are bounded and do not override human-owned teams unexpectedly
- league admin changes produce consistent downstream state
- destructive actions require confirmation and produce recoverable or auditable outcomes
- draft link and sync operations are idempotent
- season bootstrap is scoped and cannot overwrite unrelated leagues

### Drafts

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
- only the current eligible drafter can make a pick
- pick validation prevents duplicate players, invalid teams, and out-of-order selections
- timers, auto-picks, and bot picks behave deterministically enough to verify
- queue and watchlist changes are user-scoped and update as players are drafted
- realtime updates do not duplicate picks or skip draft slots
- interrupted sessions can rejoin without losing state
- completed drafts produce valid rosters and transition the league into the expected next state

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

- trade proposals validate roster ownership, roster limits, locked players, and league rules
- users cannot trade, drop, or claim players they are not allowed to move
- accepted trades atomically update both teams
- rejected, cancelled, expired, and completed trades have distinct states
- waiver claims respect priority, budget, lockout, round timing, and roster constraints
- concurrent waiver or trade actions cannot duplicate players across teams
- failed mutations leave rosters unchanged and show actionable errors
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
- injury status displays consistently across player, roster, trade, waiver, and dashboard surfaces
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
- date-based restrictions use server-validated time, not client-only checks

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

- preferences persist after refresh, sign out, and sign in
- user preferences do not leak between accounts or leagues
- selected league/team does not leak across users
- watchlists and draft queues preserve player identity and order
- localStorage parse failures recover safely
- cookie preferences are read consistently by server pages
- unauthorized users cannot read or mutate another user's account data

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
- mock data is visually or operationally distinguishable from production data when surfaced

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
- sensitive authenticated pages are not publicly cacheable

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
- switching user, league, team, season, or route clears stale scoped state
- reconnect events do not duplicate client state
- localStorage and cookie-backed state recovers from invalid values
- optimistic updates reconcile with server truth
- notification and activity events dispatch once per source event
- performance hooks avoid network calls when disabled

## Route Coverage Matrix

Before go-live, maintain a route coverage matrix generated from repository inventory.

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

- the route is not reachable in production
- the route is read-only and covered by a higher-level workflow
- the route is scheduled for removal before go-live
- the risk is documented and explicitly accepted

Hardcoded user-specific or draft-specific routes must not silently ship. They must be removed or tested as local-only blocked paths.

Inventory commands:

```bash
find src/app/api -type f -name 'route.ts' | sort
find src/pages/api -type f -name '*.ts' ! -name '*.test.ts' ! -name '*.spec.ts' | sort
```

Missing colocated App Router route tests can be inspected with:

```bash
python3 - <<'PY'
from pathlib import Path
for p in sorted(Path('src/app/api').rglob('route.ts')):
    if not p.with_name('route.test.ts').exists():
        print(p)
PY
```

Priority definitions:

- `P0`: launch-blocking. Failure prevents go-live unless explicitly accepted by product and engineering leadership.
- `P1`: important launch quality. Failure requires an accepted-risk decision if not fixed.
- `P2`: non-blocking polish, observability, or follow-up work.

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

Required fixture coverage:

- one authenticated standard user
- one authenticated league commissioner/admin user
- one unauthenticated visitor
- one active league with multiple teams
- one empty or newly created league
- one roster with valid player projections
- one roster with missing or incomplete projections
- one rankings dataset large enough to exercise sorting, filtering, pagination, and empty states
- one draft state if draft functionality is enabled
- one trade state if trades are enabled
- one waiver state if waivers are enabled
- one stale-data scenario where last-updated or unavailable states are visible
- one forbidden-access scenario for privileged routes

Fixture rules:

- fixtures must be safe to load repeatedly
- fixtures must not depend on production Firestore documents
- fixtures must not mutate production auth, Firestore, storage, payment, analytics, or external services
- fixture user IDs, league IDs, season IDs, match IDs, and player IDs should be stable across runs
- any fixture reset command must target emulator or staging only
- destructive fixture reset commands must require an explicit non-production environment variable or equivalent guard
- seeded identities must be synthetic and documented

## Auth Strategy

Tests should use explicit auth modes:

- public anonymous user
- authenticated standard user
- authenticated wrong-user
- league member
- league commissioner
- admin
- cron caller
- local fixture operator
- expired or invalid session
- disabled feature access
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

Use staging or production-like environments only for final smoke and release evidence.

Local emulator restrictions:

- must not call production Firestore
- must not call production auth
- must not call production storage
- must not call production payment, email, analytics, or third-party mutation services
- must fail closed if required emulator environment variables are missing

Staging restrictions:

- staging must use isolated data from production
- staging imports/rebuilds must use bounded fixture or test-season scopes
- staging destructive tests must be explicitly scoped and reversible
- staging must not send real user emails, payment actions, or external destructive mutations unless approved for a controlled test

Production testing before launch must be limited to read-only smoke checks unless an approved launch runbook explicitly authorizes a bounded production mutation.

Every staging smoke must state:

- test account
- test league or draft id
- allowed mutations
- cleanup expectation
- rollback signal
- monitoring dashboard or log to inspect

## Browser, Device, And Accessibility Matrix

Before go-live, validate the smallest meaningful matrix.

Browser matrix:

| Browser        | Platform         | Coverage                                         |
| -------------- | ---------------- | ------------------------------------------------ |
| Chrome latest  | macOS or Windows | Full P0 route smoke                              |
| Safari latest  | macOS/iOS        | Full P0 route smoke for layout, auth, navigation |
| Firefox latest | macOS or Windows | P0 route smoke and table/form sanity             |
| Mobile Safari  | iOS              | Mobile nav, roster, rankings, dashboard, auth    |
| Chrome Android | Android          | Mobile nav, roster, rankings, dashboard, auth    |

Viewport matrix:

| Viewport                       | Purpose                          |
| ------------------------------ | -------------------------------- |
| 375px mobile                   | Small mobile layout and nav      |
| 390px/430px mobile             | Common modern iPhone widths      |
| 768px tablet                   | Transitional layout behavior     |
| 1024px laptop/tablet landscape | App shell and table behavior     |
| 1440px desktop                 | Primary desktop workflow         |
| 1920px desktop                 | Wide layout sanity and alignment |

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

- keyboard navigation reaches every interactive control on P0 routes
- focus indicators are visible
- icon-only buttons have accessible names
- forms have associated labels and useful error messages
- protected-route redirects do not trap focus
- dialogs, popovers, menus, tabs, and selects are keyboard operable
- tables preserve semantic structure
- loading, empty, and error states are announced or readable
- color is not the only indicator for status, errors, or selection
- text remains readable in light and dark mode

## Performance And Reliability Matrix

Performance testing should focus on launch-critical user experience, not synthetic perfection.

Before go-live, verify:

- P0 routes load without broken shells or blank screens
- auth redirects complete without loops
- app shell initial load does not block on optional dashboard modules
- dashboard, league, roster, and rankings routes render stable loading states
- dense tables remain responsive with production-like player counts
- player search/filter interactions avoid avoidable layout shift
- draft room remains usable during reconnect
- live scoring and matchup views show stale state instead of crashing
- performance metric ingestion rate limits and deduplicates
- Socket.IO health and metrics endpoints are observable
- Redis/BullMQ unavailable states degrade predictably for non-critical features
- no repeated uncontrolled fetch loops occur
- no recurring console errors or unhandled promise rejections appear on P0 flows

Do not add brittle timing assertions to unit tests. Use route, component, browser, and observability checks where each gives reliable signal.

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

Future script name, once implemented: `npm run test:e2e`.

Purpose:

- verify launch-critical user journeys in a real browser
- check desktop/mobile behavior and critical accessibility interactions
- avoid duplicating component-level coverage

This command must not be required by CI until it is implemented in `package.json`.

### Future Deep Data Tier

Add only after deterministic, safe data-slice scripts exist.

Responsibilities:

- import a targeted Footywire fixture or season slice
- rebuild player read models for that targeted slice
- verify read models for that targeted slice
- reconcile `dropped_before_raw` and `dropped_in_projection`
- verify warehouse mirror parity where relevant

Do not invent script names without implementing the scripts and their safety model.

## Go-Live Evidence Checklist

For a release candidate, collect:

- commit SHA or release identifier
- environment tested: local emulator, staging, or production read-only smoke
- date and tester
- commands run and pass/fail result
- route coverage matrix results for P0 routes
- auth mode results
- fixture dataset/version used
- browser/device matrix results
- accessibility findings
- performance/reliability findings
- known issues
- accepted risks
- launch blockers
- final launch recommendation
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

Recommended release evidence when practical:

```bash
npm run prepush
```

Accepted-risk records must include:

- issue description
- user impact
- affected routes/users
- reason it is acceptable for launch
- owner
- follow-up date or milestone
- rollback or mitigation plan if the risk worsens

Launch blockers must include:

- issue description
- severity
- reproduction steps
- expected behavior
- actual behavior
- required fix or mitigation
- owner
- retest evidence after fix

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

- run existing quality commands
- record current failures
- build the route coverage matrix
- build the page/workflow coverage matrix
- build the hook/context/state coverage matrix
- classify every untested route by launch risk
- identify duplicate, brittle, or low-value tests
- decide whether Playwright should be added now or deferred

### Phase 2: Launch Blocker Coverage

- add or repair tests for unauthenticated mutation paths
- add middleware and security header tests
- add dev fixture and local-only route safety tests
- add route tests for admin, cron, import, repair, worker, queue, draft mutation, trade mutation, waiver mutation, user data, and league administration paths
- remove or block hardcoded user-specific API routes before production

### Phase 3: Canonical Data And Projection Trust

- expand canonical Footywire contract tests
- expand ingestion and read-model convergence tests
- add targeted reconciliation tests for `dropped_before_raw` and `dropped_in_projection`
- verify import success triggers required rebuild or rematerialization
- add deterministic data-slice verification commands only when their safety model is implemented

### Phase 4: Core Product Workflow Coverage

- add component and route coverage for dashboard, players, rankings, leagues, rosters, matchups, trades, waivers, draft room, live scoring, injuries, scheduling, watchlists, and account preferences
- cover happy, empty, loading, error, permission, and stale-data states
- add hook/context/state tests for realtime and client lifecycle behavior

### Phase 5: Browser Go-Live Smoke Suite

- add approved browser E2E tooling
- seed deterministic local or staging data
- cover the smallest set of complete critical journeys
- validate the browser/device/accessibility matrix
- keep E2E stable and high-signal

### Phase 6: Operational Readiness

- verify health, metrics, CSP report, analytics, worker, queue, and socket endpoints
- define staging smoke accounts and cleanup rules
- define rollback checks for import, rebuild, draft, trade, waiver, and fixture operations
- record go-live evidence for each release candidate

### Phase 7: Maintenance

- track test runtime and flake rate
- remove redundant or brittle tests when stronger lower-level tests exist
- keep the route coverage matrix current when routes are added or removed
- review launch blockers before each major release
- promote recurring production incidents into regression tests

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
- all P0 routes/workflows pass under their required auth modes
- no unauthorized access or destructive mutation issue remains open
- emulator and staging checks do not use production services
- core user workflows pass in component/route tests and the manual browser smoke checklist, or approved browser E2E suite once implemented
- canonical Footywire data can be verified from raw persistence through read models
- no dev-only mutation route is reachable in production-like environments
- realtime draft, trade, waiver, and live scoring paths have duplicate-event and reconnect coverage
- health, metrics, CSP, performance, worker, queue, and socket observability paths are verified
- browser/device matrix has been completed for P0 routes
- critical accessibility checks pass
- accepted risks are documented with owner, reason, mitigation, and expiry
- launch blockers are closed and retested
- rollback or mitigation path is known

## Post-Launch Smoke Cadence

Post-launch testing should verify that production remains healthy without causing destructive side effects.

### First 24 Hours After Launch

Run smoke checks:

- immediately after deployment
- 1 hour after deployment
- 4 hours after deployment
- end of launch day

Required checks:

- public home route renders
- sign-in route renders
- authenticated test user can access dashboard
- league overview renders
- roster/team route renders
- rankings/players route renders
- mobile navigation opens and routes correctly
- logout works
- no obvious production console errors on P0 routes
- server logs show no recurring P0 route failures
- no unexpected privileged mutation activity

Production smoke restrictions:

- use a dedicated smoke-test user where possible
- do not mutate real user leagues, teams, rosters, drafts, trades, imports, or rebuilds
- do not run destructive admin, import, repair, or rematerialization actions as smoke tests
- keep production smoke read-only unless a launch runbook explicitly authorizes a bounded mutation

### First Week After Launch

Run daily smoke checks covering:

- public route
- auth route
- dashboard
- league overview
- roster/team
- rankings/players
- one mobile viewport
- logs/errors review
- any accepted-risk follow-up areas

### Ongoing Cadence

After the first week:

- run smoke checks after every production deployment
- run weekly smoke checks for P0 routes
- run additional smoke checks after auth, Firestore, ETL, read-model, routing, or design-system changes
- review accepted risks weekly until closed
- promote repeated smoke failures into tracked launch-quality defects
