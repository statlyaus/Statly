# Go-Live Test Execution Report

Date: 2026-05-20
Branch: `codex/agentorch`
Scope: first execution slice of `docs/COMPREHENSIVE_SITE_TEST_STRATEGY.md`

## Executive Status

Statly is not go-live ready yet.

The baseline automated suite now passes after fixing a live matchup race, but the go-live execution uncovered launch-blocking gaps in route authorization coverage, realtime delivery guarantees, worker/admin controls, debug endpoint exposure, and design-system drift.

The first remediation slice has now closed the P0 route policy items recorded in `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md` and added draft realtime idempotency tests. Browser workflow execution has now been started with local fixture data, and the first browser pass found additional launch blockers in draft room readiness, trade centre readiness, waiver browser stability, and full auth lifecycle coverage.

The second remediation slice closed additional public mutation risks in cron, league draft-settings, and draft scheduling routes. The third remediation slice closed the remaining planned route-hardening families: draft lifecycle controls, draft member-private queue/watchlist surfaces, waiver routes, league join/member/action exposure, and Inngest route wiring evidence. The next browser-finding remediation slice has now hardened draft read behavior against corrupt fixture maintenance, fixed Firebase client SDK interop for waiver subscriptions, made `/tradecentre` a canonical league trade redirect, tightened fixture verification so corrupt live draft order data is detected before smoke runs, added an emulator-safe fixture repair path for corrupt locked fixture drafts, and made the standalone waiver page use API polling when local auth bypass is enabled.

The latest slice closed the desktop real-auth lifecycle blocker, the mobile login/logout blocker, the stale ranking evidence gap, the mobile ranking/player display gap, the read-model command target-safety gap, the first league, draft, trade, and waiver mutation lifecycle gaps at the authenticated API layer, the league creation/roster route coverage gap, the design-system guard blocker, the Socket.IO Redis fallback/rate-limit unit coverage gap, the Socket.IO invalid-token middleware gap, the shared/draft socket reconnect-cleanup coverage gap, and the unsafe direct Socket.IO timer mutation gap. `src/middleware.ts` is now the active Next middleware location for this `src/app` project, exact protected route roots are matched, login fails if the server cookie cannot be created, restored Firebase client auth waits for server-session refresh before exposing the user to redirecting UI, login explicitly sets client user state after server-session creation, and logout clears client user state after server-session deletion. Browser smoke now proves desktop login/session restore, mobile login/logout, protected `/dashboard`, desktop/mobile ranking/player stat display, and local desktop/mobile league create/join/switcher UI lifecycles. League create, invite join, member list, and switcher visibility now have real-session API proof plus browser click-through proof. Draft queue, watchlist, start, pick, and cleanup now have real-session API proof. Desktop Browser smoke now proves scheduled-room start/pick, scheduled-draft queue/watchlist add/remove, real Redis backfill after a pick, reload reconnect without a persistent stale connection banner, and no new hydration errors after fixing deterministic deadline formatting. Mobile Browser smoke now proves authenticated live draft rendering at 390x844. Draft available-player identity is fixed so duplicate player aliases are removed before pagination and picked aliases are excluded, the production socket auth contract now supports browser-safe Socket.IO auth payload tokens, primary draft deltas are persisted to the Redis backfill log before socket emission, duplicate raw multi-room delta delivery is fixed, and the Socket.IO allow-request limiter now has focused coverage for Redis bucket totals plus in-memory fallback rejection when Redis is unavailable. The shared Socket.IO browser provider now has regression coverage for auth payload tokens, configured reconnect policy, unmount listener cleanup, and cancelled target discovery; the server middleware boundary now rejects invalid production tokens before accepting sockets; the draft socket layer now has coverage for join, backfill from the last event timestamp, reconnect status, listener removal, and leave emission on unmount; direct socket pick, timer, pause, and resume mutations now fail closed without destructuring untrusted payloads, so malformed/no-arg socket emits still produce `draft:error` and timer authority remains the Prisma-backed server pick-deadline contract. Trade propose, cancel/retract, decline, accept/execute, counter, parent-supersede, and list status rollup now have real-session API proof; desktop Browser proposal/retract, accept, decline, counter, reviewer-control visibility, admin approve, admin reject, and league veto vote now pass using owner plus Fixture Bot 1 bypass actors. Trade conflict copy now distinguishes stale action conflicts from player-lock conflicts, announces the conflict as `role="alert"`, and failed actions attempt a server refresh after optimistic rollback. Mobile 390x844 Browser/CDP proof now covers decline, accept/execute, and counter/parent-supersede from the mobile workspace. Active trade review mutation routes now deny regular managers and require owner/commissioner review-manager roles before approve/reject/finalize calls, and the trade workspace now exposes reviewer-visible admin approve/reject plus league veto controls backed by expanded list/detail visibility after review decisions. Waiver settings, submit/list/cancel, submit/process, roster add/drop, and process permission edges now have proof; desktop Browser submit/cancel/process now passes after moving waiver submit membership resolution to the authenticated server actor and adding owner/commissioner process controls. Mobile non-bypass waiver smoke now proves Firestore listeners authenticate and receive an out-of-band claim update without API polling fallback, and mobile 390x844 waiver proof now covers create, player/drop selection, submit, cancel, process controls, and settings save. The fresh dashboard no-error rerun exposed and fixed an underfilled-league season-state `500`; follow-up mobile dashboard proof had zero failed app responses. Accessibility hardening now covers named popover dialogs, mobile navigation expanded state, trade-confirmation dialog focus trapping, draft connection live-region semantics, and trade conflict alerts, with focused test and CDP proof. Local degraded-state evidence now covers dashboard weekend/season-state failure, dashboard leaderboard aggregate failure, league matchup no-data and background refresh failure, waiver API polling/realtime-auth fallback failure, draft recoverable action/start failure, draft socket disconnect/reconnect, trade action conflict, player detail API failure, player match-history API failure, and admin worker backend outage. Local dev performance timings have been captured for dashboard and launch-critical mobile routes. The app-mounted Web Vitals monitor no longer imports the missing `web-vitals` package or returns a no-op; it now records native browser `CLS`, `FID`, `FCP`, `INP`, `LCP`, and `TTFB` metrics and posts only supported Web Vitals to `/api/analytics/performance`. `npm run guard:design` now passes with zero active findings after the semantic-token and lucide migration across app and component surfaces. Remaining gaps are production-like staging smoke, production-grade performance/Web Vitals evidence from a real staging or production-like run, and cross-browser evidence.

This report records the executed evidence and the next required test/fix queue. It is intentionally separate from the strategy document: the strategy defines the target, while this document records what has actually been carried out.

## Gates Executed

| Gate                                       | Command                                                                                                                                                                                                                                                                                                                                                           | Result                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App typecheck                              | `npm run typecheck`                                                                                                                                                                                                                                                                                                                                               | Passed                       | Next.js route types generated; app and test TypeScript projects completed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Lint                                       | `npm run lint`                                                                                                                                                                                                                                                                                                                                                    | Passed                       | ESLint completed for `src`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Production build                           | `npm run build`                                                                                                                                                                                                                                                                                                                                                   | Passed                       | Next.js 15.5.3 production build compiled successfully, generated 84 static pages, collected build traces, and emitted the route size report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Unit/integration tests                     | `npm test`                                                                                                                                                                                                                                                                                                                                                        | Passed after fixes           | Latest run passed 147 files, 595 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Focused live matchup regression            | `npx vitest run src/components/league/LeagueMatchupTab.test.tsx --reporter=verbose`                                                                                                                                                                                                                                                                               | Passed                       | 18 tests passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Route security guard                       | `npm run guard:routes`                                                                                                                                                                                                                                                                                                                                            | Passed                       | 8 ETL routes and 113 API routes checked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Design-system guard                        | `npm run guard:design`                                                                                                                                                                                                                                                                                                                                            | Passed                       | Active findings: 0. Hard-coded palette/hex candidates: 0. Legacy icon import candidates: 0. Remaining allowlisted intentional findings: 8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Production-style release build             | `npm run build:release`                                                                                                                                                                                                                                                                                                                                           | Passed                       | Release build completed with `BYPASS_AUTH=false` and `NEXT_PUBLIC_BYPASS_AUTH=false`, compiled successfully, generated 84 static App Router pages, and emitted the route size report. This also verifies the Web Vitals collector no longer depends on the missing `web-vitals` package during production bundling.                                                                                                                                                                                                                                                                                                                                                              |
| Staging preflight contract                 | `npm run go-live:staging-preflight`                                                                                                                                                                                                                                                                                                                               | Added; awaiting staging env  | The remaining staging blocker is now executable instead of prose-only. The preflight fails closed unless production-like staging policy is present (`STATLY_RUNTIME_ENV` not local, bypass auth disabled, admin/cron/ETL tokens, Firebase admin credentials), plus a HTTPS non-local staging URL, smoke account, fixture league/draft IDs, read-only mutation scope, cleanup policy, monitoring URL, release/build ID, and full browser matrix declaration. It then performs only safe read-only `GET` checks and blocks on any 5xx response.                                                                                                                                 |
| Release evidence contract                  | `npm run go-live:evidence-check -- --file <evidence.json>`                                                                                                                                                                                                                                                                                                        | Added; awaiting evidence     | Browser/performance/degraded-state acceptance is now machine-checkable. The evidence check requires a staging or preview release artifact with release metadata, commit SHA, test date, tester, staging fixture identity, passing command evidence for `typecheck`, `lint`, route/design guards, `npm test`, and `branch:complete`, route coverage for launch-critical public/protected/admin-denial paths, desktop and mobile accessibility proof, complete Chrome/Safari/Firefox/Mobile Safari/Chrome Android coverage, desktop and mobile proof for P0 workflows, production-like Web Vitals metrics, staging degraded-state proof, actionable accepted risks, no placeholder evidence URLs, no open launch blockers, and a final launch recommendation with rationale, rollback plan, and post-deploy smoke plan. The checked-in template at `docs/go-live-evidence.example.json` is covered by regression tests and passes the validator; `npm run go-live:evidence-check -- --init ... --output <evidence.json>` generates a release-specific draft that intentionally fails until real evidence is filled in. |
| Local fixture readiness                    | `STATLY_RUNTIME_ENV=local ... FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 npm run dev:fixtures -- verify full-leagues --json`                                                                                                                                                                                                                                          | Passed after emulator repair | Three full-league fixtures now verify `ok: true` with 12 members, 264 rostered players, 12-week schedules, 72 matchups, and coherent drafts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Browser smoke                              | Browser automation against local fixture pages                                                                                                                                                                                                                                                                                                                    | Partial                      | Draft, tradecentre, and waiver page-load blockers were re-smoked on desktop and mobile after remediation. Auth lifecycle, player/ranking display, league create/join/switcher, draft start/pick, draft queue/watchlist, draft reload/backfill, draft mobile rendering, production-like two-client draft realtime, trade propose/retract/accept/decline/counter/review-control visibility, trade review admin approve/reject and veto vote, mobile trade decline/accept/counter, waiver submit/cancel/process plus manager process-control denial, mobile waiver claim/settings controls, mobile non-bypass waiver Firestore listener delivery, and fresh dashboard no-error/degraded season-state proof now have browser evidence. Staging smoke remains open. |
| Non-functional local smoke                 | Headless Chrome CDP against dashboard, league workspace, trades, waivers, players, admin workers, draft room, plus route/network interception for degraded-state proof                                                                                                                                                                                               | Local pass                   | Sampled routes had zero visible unnamed controls/form fields. Keyboard traversal reached launch-critical controls. Mobile nav now reports `Open navigation` / `Close navigation` with `aria-expanded`; league switcher popover renders `aria-label="Select league"`; the trade confirmation modal has focus-trap regression coverage. Dashboard stayed usable when `/api/weekend-summary`, `/api/leagues/*/season-state`, and `/api/player-stats/aggregate` returned forced `503`s; league matchup showed retry UI for malformed success/no-data; waiver polling showed a stale-state banner while preserving the shell under forced roster/list `503`s; player detail and match-history failures rendered retryable alerts without fatal overlay; admin worker backend outage preserved the worker shell with retry; draft socket disconnect/reconnect preserved the live draft shell and cleared after network restoration; trade action conflict rendered stale-state copy as `role="alert"` with no player-lock misclassification. Local dev performance timings were captured, and the Web Vitals client collector now has focused regression plus live local browser proof: `TTFB`, `FCP`, and `LCP` metric posts returned `200` from `/api/analytics/performance`. Production Web Vitals/cross-browser/staging evidence remains open. |
| Desktop real-auth lifecycle                | Disposable headless Chrome CDP against `/login?next=/dashboard` and `/dashboard` with Auth emulator user `tester@statly.dev`                                                                                                                                                                                                                                      | Passed                       | Login created an HTTP-only `statly_session`; deleting the cookie forced `/dashboard` to `/login`; Firebase restore recreated the cookie and returned to `/dashboard`; two session POSTs returned 200.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Middleware protected root guard            | `npx vitest run src/middleware.test.ts --reporter=verbose` plus `curl -I http://localhost:3000/dashboard`                                                                                                                                                                                                                                                         | Passed                       | Unit tests covered exact-root matchers and session redirect behavior; unauthenticated `/dashboard` now returns `307` to `/login?next=%2Fdashboard`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Auth session restore contract              | `npx vitest run src/AuthContext.test.tsx --reporter=verbose`                                                                                                                                                                                                                                                                                                      | Passed                       | 5 tests passed covering session POST failure, login user state, restored-user session refresh, keeping restored auth loading until server session refresh completes, and logout user clearing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Mobile real-auth logout                    | Disposable headless Chrome CDP at 390x844 against `/login?next=/dashboard`, mobile navigation, and `/dashboard` after logout                                                                                                                                                                                                                                      | Passed                       | Login created an HTTP-only `statly_session`; mobile drawer exposed signed-in account controls; logout deleted the session cookie; `/dashboard` redirected to `/login` after logout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Player/ranking browser proof               | Chrome CDP, headless Chrome mobile DOM, and API checks for `/rankings`, `/players/aaron_naughton`, `/players/ply_aaron_naughton`                                                                                                                                                                                                                                  | Passed desktop/mobile        | Rankings rendered published rows; player match logs showed present zeroes as `0` and absent advanced stats as `-`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| League browser UI lifecycle                | Headless Chrome CDP at 1800x1000 using real Auth emulator users through `/leagues/new`, `/leagues/join?code=...`, and the navigation league switcher                                                                                                                                                                                                              | Passed local desktop         | Owner created league `cmpciv41t002jux2p6lt32vof` with invite `J4ODHIR8`; joiner joined through the UI; workspace showed `2/8 TEAMS`; switcher/list text contained the joined league and `YOUR TEAM` showed the joiner team.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| League authenticated API lifecycle         | Real `statly_session` cookies for owner and joiner against a newly created league                                                                                                                                                                                                                                                                                 | Passed API                   | Owner created league `cmpciicsa002cux2p9h72qt2z`, joiner joined via invite `XOK391XZ`, member list returned two teams, and joiner's league list contained the created league for switcher visibility.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Draft authenticated API lifecycle          | Real `statly_session` against fixture draft `cmpci2dvv01e4uxmwzo05xz0w`                                                                                                                                                                                                                                                                                           | Passed API                   | Queue add, watchlist add/get/remove, draft start, pick, and queue cleanup returned `200`; draft became `LIVE`, current pick advanced to `2`, and one persisted pick for Aaron Cadman was recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Draft browser UI lifecycle                 | Codex in-app Browser against refreshed fixture draft `cmpckfkjf01e4ux4qj3pvok2t`                                                                                                                                                                                                                                                                                  | Passed local desktop         | League `Join Draft Room` opened the scheduled room; `Start draft now` called the start API after the fix, the room rendered `LIVE`/`Pause draft`/connected socket state, `Select Aaron Cadman` was enabled and clicked, and API verification showed `currentPick: 2` with one persisted pick.                                                                                                                                                                                                                                                                                                                                                                                    |
| Draft browser reconnect/backfill           | Codex in-app Browser against fixture draft `cmpckfkk501fkux4qhb3tj4xy`, plus HTTP backfill and Redis checks                                                                                                                                                                                                                                                       | Passed local desktop         | Browser selected `Aaron Cadman`; HTTP backfill since the pre-mutation timestamp returned `STATE_PATCH`, `PICK_MADE`, and follow-up `STATE_PATCH`; reload kept current pick visible and the connection-lost banner cleared after socket join. A hydration mismatch was found and fixed by deterministic `LivePickHeader` deadline formatting.                                                                                                                                                                                                                                                                                                                                     |
| Draft mobile browser rendering             | Codex in-app Browser at 390x844 against fixture draft `cmpckfkjz01euux4qjmv88tae` with real Auth emulator login                                                                                                                                                                                                                                                   | Passed local mobile          | Mobile authenticated draft room rendered `LIVE ENGINE`, `DRAFT ORDER`, 936 available players, `Queue & Watchlist`, and a deterministic 24-hour deadline with no new filtered runtime/auth/hydration console errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Draft realtime serialization               | `npx vitest run src/server/draft/services/DraftRealtimeDispatcher.test.ts --reporter=verbose`                                                                                                                                                                                                                                                                     | Passed                       | Covers deterministic pick delta IDs and Redis-delivered `draft:state` payloads where `currentPick.expiresAt` arrives as an ISO string instead of a `Date`; dispatcher emits the state patch deadline without throwing.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Draft socket auth contract                 | `npx vitest run src/server/socketioAuth.test.ts src/contexts/SocketContext.test.tsx --reporter=verbose`                                                                                                                                                                                                                                                           | Passed                       | Browser client now supplies Firebase ID tokens through Socket.IO `auth`; server auth accepts bearer headers or Socket.IO auth payload tokens and still rejects missing/invalid production tokens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Draft queue/watchlist browser UI           | Codex in-app Browser against scheduled fixture draft `cmpckfkjz01euux4qjmv88tae`                                                                                                                                                                                                                                                                                  | Passed local desktop         | Canonical board rendered 936 available players; `Add Aaron Hall to queue` and `Add Aaron Hall to watchlist` moved Aaron Hall into the rail, then visible remove controls cleared both. API verification showed queue/watchlist counts back to 0 and draft still `SCHEDULED`.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Draft available-player identity            | `npx vitest run 'src/app/api/drafts/[id]/available-players/route.test.ts' --reporter=verbose` plus direct API checks                                                                                                                                                                                                                                              | Passed                       | Available-player route dedupes active `Player` rows by canonical name/team identity before pagination and excludes all aliases of picked players; scheduled draft first page had no duplicate names and live draft excluded picked Cadman/Francis identities.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Trade authenticated API lifecycle          | Real `statly_session` cookies for owner and Fixture Bot 1 against fixture league `cmpci2do40002uxmw1sa8z22i`                                                                                                                                                                                                                                                      | Passed API                   | Proposal/cancel, proposal/decline, proposal/accept, counter creation, parent supersede, and list status rollup returned expected `CANCELLED`, `DECLINED`, `EXECUTED`, `PROPOSED`, and `SUPERSEDED` states.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Trade review mutation authorization        | `npx vitest run src/services/tradeService.test.ts 'src/app/api/trades/[id]/[action]/route.test.ts' --reporter=verbose`                                                                                                                                                                                                                                            | Passed                       | Active `approve-review`, `reject-review`, and `finalize-review` actions now require owner/commissioner review-manager roles before service mutation; route tests prove regular managers are denied and commissioners can approve.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Trade review workspace controls            | `npx vitest run src/app/api/trades/route.test.ts 'src/app/api/trades/[id]/route.test.ts' src/components/trades/TradeReviewPanel.test.tsx --reporter=verbose` plus local Browser seeded-review smoke                                                                                                                                                               | Passed                       | Trade list/detail routes now expose pending admin reviews to owner/commissioner reviewers and pending veto reviews to eligible league members; the trade review panel exposes approve/reject/veto/finalize controls from the canonical trade workspace. Browser proof showed enabled `Approve trade`/`Reject trade` for admin review and enabled `Veto trade` for league veto review.                                                                                                                                                                                                                                                                                            |
| Trade review mutation click-through        | `npx vitest run 'src/app/api/trades/[id]/route.test.ts' src/app/api/trades/route.test.ts --reporter=verbose` plus local Browser admin approve, admin reject, and veto vote smoke                                                                                                                                                                                  | Passed local desktop         | Browser clicked admin reject to `REVIEW_REJECTED`, admin approve to `EXECUTED`/`APPROVED`, and league veto to a persisted `TradeReviewVote(VETO)`. The click-through exposed and fixed a post-review access defect where reviewers saw `403` after rejecting; list/detail routes now keep reviewed admin trades visible to eligible reviewers.                                                                                                                                                                                                                                                                                                                                   |
| Draft reconnect/backfill and room identity | `npx vitest run src/server/draft/services/DraftRealtimeDispatcher.test.ts src/server/draft/realtime/draftDeltaLog.test.ts src/server/__tests__/roomStore.test.ts --reporter=verbose`                                                                                                                                                                              | Passed                       | Primary `draft:delta` payloads are appended to `draft:{draftId}:events` with timestamp scores, capped to 500 entries, TTL'd for one hour, and read through one shared since-exclusive parser used by socket and HTTP backfill. Room capacity/display counts now group multiple sockets for one member/user as one active participant while retaining socket IDs for cleanup. Dispatcher emits to the canonical `draft:{draftId}` room once to avoid duplicate raw delivery to sockets that joined both legacy and canonical rooms.                                                                                                                                               |
| Draft production-like two-client realtime  | Two `socket.io-client` clients with Firebase Auth emulator ID tokens, session-cookie draft API mutation, and HTTP backfill                                                                                                                                                                                                                                        | Passed local realtime        | After the duplicate-delivery fix and socket restart, both authenticated clients joined draft `cmpckfkjz01euux4qjmv88tae`, each received exactly one `PICK_MADE` and one `STATE_PATCH` for pick 2, HTTP backfill returned the same two deltas, and the database advanced to `currentPick: 3` with picks for `Aaron Cadman` and `Aaron Francis`.                                                                                                                                                                                                                                                                                                                                   |
| Trade browser propose/retract              | Codex in-app Browser against local fixture league `cmpckfkdf0002ux4qqqx01d2o`                                                                                                                                                                                                                                                                                     | Passed local desktop         | Visible create-trade flow selected Fixture Bot 1, outgoing/incoming players, confirmed the trade, rendered the `PROPOSED` outgoing offer, then `Retract offer` moved the trade to `CANCELLED`; API verification showed latest event `TRADE_CANCELLED`.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Trade browser accept/decline/counter       | Codex in-app Browser with owner on port `3000` and Fixture Bot 1 bypass actor on port `3004`                                                                                                                                                                                                                                                                      | Passed local desktop         | Fixture Bot 1 accepted one incoming trade to `EXECUTED`, declined another to `DECLINED`, and submitted a counter that moved the parent to `SUPERSEDED` and created a new `PROPOSED` outgoing counter trade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Waiver authenticated API lifecycle         | Real `statly_session` against fixture league `cmpci2do40002uxmw1sa8z22i`                                                                                                                                                                                                                                                                                          | Passed API                   | Settings load, submit/list/cancel, submit/process, and direct roster add/drop verification passed; final claim statuses included one `CANCELLED` and one `SUCCESSFUL`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Waiver browser submit/cancel               | Codex in-app Browser against local fixture league `cmpckfkdf0002ux4qqqx01d2o`; focused route/component regressions                                                                                                                                                                                                                                                | Passed local desktop         | Browser selected `Tom Green`, selected `aaron-cadman` to drop, submitted a pending claim, then cancelled it back to `0` open claims with no stale error banner. Submit now resolves the league member from authenticated server identity and the UI preserves `memberId` from roster payloads.                                                                                                                                                                                                                                                                                                                                                                                   |
| Waiver browser process control             | Codex in-app Browser against local fixture league `cmpckfkdf0002ux4qqqx01d2o`; focused route/component/service regressions                                                                                                                                                                                                                                        | Passed local desktop         | Browser submitted a pending `Tom Green` claim, clicked the owner-visible `Process claims` control, rendered `Processed 1 waiver claim.`, and direct API verification showed zero pending claims with latest claim `cmpdi5qqf000fuxr9qdi0wk92` as `SUCCESSFUL`. Browser/API permission proof showed Fixture Bot 1 managers do not see process controls and receive `403`; owner no-op processing returns `200`. Regression coverage also proves commissioners can process, managers cannot, and process success refreshes state even when realtime subscriptions are enabled.                                                                                                     |
| Admin worker UI denial                     | `npx vitest run src/app/admin/workers/page.test.tsx src/app/api/admin/workers/route.test.ts --reporter=verbose`                                                                                                                                                                                                                                                   | Passed                       | 2 files, 6 tests passed; browser re-run showed denial copy and no worker controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Browser-finding regressions                | `npx vitest run src/lib/firebaseClient.test.ts 'src/app/api/drafts/[id]/route.test.ts' src/server/devFixtures/services/fixtureVerifier.test.ts src/server/devFixtures/services/fixtureDraftService.test.ts src/server/devFixtures/core/runner.test.ts src/app/tradecentre/page.test.tsx 'src/app/leagues/[id]/waivers/WaiversClient.test.tsx' --reporter=verbose` | Passed                       | Covers Firebase SDK interop, draft read resilience, fixture validation, fixture verify exit behavior, fixture draft repair, trade centre redirect behavior, and waiver bypass-auth polling behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Defect Fixed During Execution

### Live matchup stream race

The first full `npm test` pass failed in:

`src/components/league/LeagueMatchupTab.test.tsx > LeagueMatchupTab > deduplicates recent scoring events for duplicate player-category deltas`

The focused test passed in isolation, which pointed to a timing-sensitive race. The stream handler and background fetch logic calculated deltas from `dataRef.current`, but the ref was previously refreshed by a later React effect. Under full-suite load, a stream update could arrive after the page rendered as live but before the ref had caught up, producing no player deltas and no "Recent scoring events" rail.

The fix updates `dataRef.current` synchronously when a fresh matchup payload is accepted, before setting React state. Both fetch and EventSource paths now compute deltas against the same previous payload and immediately advance the ref to the accepted payload.

Changed file:

- `src/components/league/LeagueMatchupTab.tsx`

Verification:

- Focused matchup suite passed: 18 tests.
- Full suite passed after the fix: 96 files, 414 tests.
- `npm run lint` passed.
- `npm run typecheck` passed.

## P0 Hardening Completed During Execution

### Admin worker and queue API protection

The first launch-blocking route class was addressed during this execution pass:

- `/api/admin/workers`
- `/api/admin/queue`

Both `GET` and `POST` handlers now require shared operational admin authorization before reading worker/queue state or performing mutations. The shared helper accepts `x-admin-token` or `Authorization: Bearer <token>` using `ADMIN_API_TOKEN`. Missing tokens are allowed only for an explicit local runtime, and `CRON_SECRET` is intentionally not accepted for admin worker/queue controls.

Changed files:

- `src/lib/operationalAuth.ts`
- `src/lib/operationalAuth.test.ts`
- `src/app/api/admin/workers/route.ts`
- `src/app/api/admin/workers/route.test.ts`
- `src/app/api/admin/queue/route.ts`
- `src/app/api/admin/queue/route.test.ts`

Verification:

- `npx vitest run src/lib/operationalAuth.test.ts src/app/api/admin/workers/route.test.ts src/app/api/admin/queue/route.test.ts --reporter=verbose` passed: 3 files, 16 tests.
- Full suite passed after hardening: 96 files, 414 tests.

Follow-up browser finding:

- The browser admin workers page initially rendered worker controls for the bypass user. It now fails closed by default and only renders the operator UI when `STATLY_RUNTIME_ENV=local` and `STATLY_ENABLE_ADMIN_WORKER_UI=true`.

Additional changed files:

- `src/app/admin/workers/page.tsx`
- `src/app/admin/workers/page.test.tsx`

Additional verification:

- `npx vitest run src/app/admin/workers/page.test.tsx src/app/api/admin/workers/route.test.ts --reporter=verbose` passed: 2 files, 6 tests.
- Browser re-run on `/admin/workers` showed denial copy and no `Add Worker`, `Restart All`, or `Stop All` controls.

### P0 route policy remediation

The route policy matrix was added and the P0 route rows were hardened or covered:

- `/api/auth/session` now has cookie creation and deletion tests.
- `/api/user/profile/[userId]` now rejects unauthenticated reads and cross-user reads or updates.
- Local-only debug, fixture, and environment routes now return 404 outside explicit local runtime before touching data dependencies.
- Legacy Pages API trade routes now return 404 outside explicit local runtime.

Changed files:

- `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md`
- `src/app/api/auth/session/route.test.ts`
- `src/app/api/user/profile/[userId]/route.ts`
- `src/app/api/user/profile/[userId]/route.test.ts`
- `src/app/api/local-only-routes.test.ts`
- `src/app/api/dev/test-user/route.ts`
- `src/app/api/add-test-data/route.ts`
- `src/app/api/create-test-draft/route.ts`
- `src/app/api/test-lobby/route.ts`
- `src/app/api/env-check/route.ts`
- `src/app/api/admin-check/route.ts`
- `src/app/api/drafts/[id]/debug/route.ts`
- `src/pages/api/tradeReview.ts`
- `src/pages/api/tradeReview.test.ts`
- `src/pages/api/listTrades.ts`
- `src/pages/api/listTrades.test.ts`

Verification:

- `npm run typecheck:tests` passed.
- `npx vitest run src/lib/operationalAuth.test.ts src/app/api/local-only-routes.test.ts 'src/app/api/user/profile/[userId]/route.test.ts' src/app/api/auth/session/route.test.ts src/pages/api/tradeReview.test.ts src/pages/api/listTrades.test.ts src/server/draft/services/DraftRealtimeDispatcher.test.ts src/contexts/DraftContext.realtime.test.tsx src/hooks/__tests__/useRealtimeDraft.test.ts src/components/draft/room/draftRoomViewModel.test.ts --reporter=verbose` passed: 10 files, 37 tests.

### Draft realtime idempotency

Draft realtime deltas now carry deterministic event IDs and the draft client tracks applied event IDs so duplicate delivery is ignored as a contract, not as a timing assumption.

The desktop draft browser pass also exposed a realtime serialization bug: Redis-delivered `draft:state` payloads are JSON, so `currentPick.expiresAt` can arrive as an ISO string while the dispatcher expected a `Date`. The dispatcher now normalizes `Date`, ISO string, and numeric deadlines before emitting state patches.

The subagent draft audit also found that production browser clients could not satisfy socket auth because the server only checked an `Authorization` header during the Engine.IO request, while the active browser client did not send a token. The client now passes the current Firebase ID token through Socket.IO `auth`, and the sidecar validates either bearer headers or browser-safe auth payload tokens in middleware before accepting production sockets.

Changed files:

- `src/contexts/SocketContext.tsx`
- `src/contexts/SocketContext.test.tsx`
- `src/server/socketioAuth.ts`
- `src/server/socketioAuth.test.ts`
- `src/server/socketioServer.ts`
- `src/server/socketioCommandGuards.ts`
- `src/server/socketioCommandGuards.test.ts`
- `src/server/socketioRateLimit.ts`
- `src/server/socketioRateLimit.test.ts`
- `src/server/draft/domain/draftTypes.ts`
- `src/server/draft/services/DraftRealtimeDispatcher.ts`
- `src/server/draft/services/DraftRealtimeDispatcher.test.ts`
- `src/contexts/DraftContext.tsx`
- `src/contexts/DraftContext.realtime.test.tsx`

Verification:

- Covered by the combined focused regression command above.
- Serialization regression covered by `npx vitest run src/server/draft/services/DraftRealtimeDispatcher.test.ts --reporter=verbose`, which passed with 2 tests.
- Socket auth and provider lifecycle contract covered by `npx vitest run src/server/socketioAuth.test.ts src/contexts/SocketContext.test.tsx --reporter=verbose`, which passed with 13 tests.
- Socket rate-limit contract covered by `npx vitest run src/server/socketioRateLimit.test.ts --reporter=verbose`, which passed with 2 tests for Redis bucket totals and in-memory fallback rejection.
- Draft socket reconnect/backfill/listener cleanup contract covered by `npx vitest run src/contexts/DraftContext.realtime.test.tsx --reporter=verbose`, which passed with 3 tests.
- Direct socket mutation rejection covered by `npx vitest run src/server/socketioCommandGuards.test.ts --reporter=verbose`, which passed with 3 tests. `draft:pick`, `draft:timer:start`, `draft:pause`, and `draft:resume` now use this guard plus malformed-payload context extraction so clients cannot create an independent timer authority or crash the rejection boundary with no-arg emits.

### Browser smoke and design-debt artifacts

Launch evidence artifacts were added for the remaining non-automated gates:

- `docs/GO_LIVE_BROWSER_SMOKE_EVIDENCE.md`
- `docs/audits/go-live-design-drift-decision-2026-05-18.md`

Browser smoke has now been partially executed against the local fixture dataset. Local browser proof covers the launch-critical dashboard, league, draft, trade, waiver, player, and ranking workflows on desktop and mobile where local deterministic fixtures exist. Go-live readiness still fails because staging and non-functional evidence remain incomplete:

- staging auth lifecycle has not been executed with production-like cookies
- the live fixture draft room initially stayed on `Loading Draft Room`; after route hardening and fixture repair, desktop and mobile browser re-smoke rendered the scheduled 264-pick draft room with the socket connected
- the standalone trade centre initially stayed on `Loading Trade Centre`; after replacing it with a server redirect, desktop and mobile browser re-smoke reached the league trade workspace
- waiver pages initially emitted Firebase subscription initialization errors; after Firebase client interop and bypass-auth realtime gating fixes, desktop and mobile browser re-smoke rendered the waiver page without the `collection()` crash or Firestore rules errors
- desktop and mobile player detail/ranking evidence now proves canonical missing-vs-zero display and published ranking rows
- mobile league create/join/switcher, mobile trade accept/counter, waiver settings save, and fresh dashboard no-error proof are now closed locally

Fixture readiness note:

- After adding draft-order completeness checks, `npm run dev:fixtures -- verify full-leagues --json` returned `ok: false` and exited `1` because each of the three local full-league fixture drafts had only slots `1, 11, 12` rather than `1-12`.
- The fixture apply path now resets corrupt locked fixture drafts before reprovisioning. Running apply against `FIRESTORE_EMULATOR_HOST=127.0.0.1:8082` repaired all three full-league fixtures.
- Follow-up verification under the emulator returned `ok: true` and exited `0`.
- A later fixture-owned reset/apply/verify on 2026-05-19 refreshed the primary fixture IDs to league `cmpci2do40002uxmw1sa8z22i`, invite `UHRHZPBR`, and draft `cmpci2dvv01e4uxmwzo05xz0w`. Verification again returned `ok: true` before mutation testing.

The design drift blocker is now closed:

- `npm run guard:design` passes with 0 active findings.
- Hard-coded palette/hex candidates and legacy icon import candidates are both 0.
- The remaining 8 allowlisted intentional findings are non-active demo/debt entries.
- Verification after the design migration: `npm run guard:design`, `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint`, `npm test`, `git diff --check`, `npm run graphify:update`, and `npm run branch:complete` passed.

### Real auth and protected dashboard remediation

Desktop real-auth smoke with the Firebase Auth emulator found two launch-blocking issues:

- The protected route middleware was located at repo root, but the app uses `src/app`; Next did not load it for `/dashboard`, so unauthenticated `/dashboard` returned `200`.
- Restored Firebase client auth exposed `user` before the refreshed server cookie was created, so login-page auto-redirect could race middleware and strand the user on `/login` after the cookie POST succeeded.

Fixes:

- Moved middleware into `src/middleware.ts` and added exact protected root matchers for `/dashboard`, `/app`, and `/league`.
- Updated `AuthProvider` so login/signup/social sign-in fail when `/api/auth/session` fails, and restored Firebase auth keeps `loading=true` until the server session refresh finishes.
- Removed the redundant `/dashboard` client redirect to `/fantasy`; middleware owns protected-route access, while the dashboard keeps a loading state during client auth restore.
- Updated `AuthProvider` so successful login sets client user state immediately and logout clears client user state after deleting the server session.

Changed files:

- `src/AuthContext.tsx`
- `src/AuthContext.test.tsx`
- `src/app/dashboard/DashboardClient.tsx`
- `src/app/dashboard/DashboardClient.test.tsx`
- `src/middleware.ts`
- `src/middleware.test.ts`
- deleted inactive root `middleware.ts`

Verification:

- `npx vitest run src/AuthContext.test.tsx --reporter=verbose` passed: 5 tests.
- `npx vitest run src/app/dashboard/DashboardClient.test.tsx --reporter=verbose` passed: 2 tests.
- `npx vitest run src/middleware.test.ts --reporter=verbose` passed: 3 tests.
- `curl -I http://localhost:3000/dashboard` returned `307` to `/login?next=%2Fdashboard`.
- Disposable headless Chrome CDP smoke passed: login created an HTTP-only `statly_session`, missing-cookie dashboard access redirected to login, Firebase restore recreated the server cookie, and the final path was `/dashboard`.
- Disposable mobile Chrome CDP smoke at 390x844 passed: login created an HTTP-only `statly_session`, the mobile drawer exposed signed-in account controls, logout deleted the session cookie, and `/dashboard` redirected to `/login` after logout.

Operational finding and remediation:

- `STATLY_RUNTIME_ENV=local npm run build:player-read-models -- --mode rankings --season 2026` initially published 230 ranking snapshots but reported `emulator:false` and `credentialSource:"service_account_base64"`, exposing a repeatable release-candidate safety gap.
- `Scripts/build-player-read-models.ts` now fails closed in local runtime unless the private `FIRESTORE_EMULATOR_HOST` is set, or the operator explicitly opts into a live target with `--allow-live-firebase` or `STATLY_ALLOW_LIVE_FIREBASE_READ_MODELS=true`.
- Changed files: `Scripts/build-player-read-models.ts`, `tests/build-player-read-models.test.ts`.
- Verification: `npx vitest run tests/build-player-read-models.test.ts --reporter=verbose` passed, and `STATLY_RUNTIME_ENV=local FIRESTORE_EMULATOR_HOST= NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST= npm run build:player-read-models -- --mode rankings --season 2026` exited `1` with the refusal message before Firebase Admin initialization.

### League authenticated lifecycle remediation evidence

A new league was created through the authenticated API with the owner account, then a second Auth emulator user joined it through the invite path to prove the core league creation, join, member-list, and league-switcher data contracts without relying on bypass auth.

Evidence:

- Owner `tester@statly.dev` created league `cmpciicsa002cux2p9h72qt2z`; the create response returned `201`, invite code `XOK391XZ`, and `maxTeams: 4`.
- Joiner `statly-go-live-joiner@statly.fixture` joined through `/api/leagues/join`; the response returned `201`, member `cmpciid7s002gux2p3up33wua`, and team name `Go Live Joiners`.
- `/api/leagues/cmpciicsa002cux2p9h72qt2z/members` returned two teams: the owner team and `Go Live Joiners`.
- `/api/leagues/user/statly-go-live-joiner` returned the newly created league, proving the joined league is visible to the switcher/list contract.

Browser click-through evidence:

- Owner `tester@statly.dev` signed in through `/login?next=/leagues/new`, submitted `/leagues/new`, and created league `cmpciv41t002jux2p6lt32vof` with name `Go Live UI League 1779188445745`, invite code `J4ODHIR8`, `maxTeams: 8`, and nine-category scoring.
- A clean browser profile signed in as `statly-go-live-joiner@statly.fixture`, loaded `/leagues/join?code=J4ODHIR8`, submitted team `Go Live UI Joiners 1779188502767`, and landed on `/leagues/cmpciv41t002jux2p6lt32vof?tab=draft`.
- The joined league workspace showed `2/8 TEAMS`, `League Members: 2/8`, and the joiner team in the `YOUR TEAM` panel.
- The desktop navigation league switcher/list surface contained `Go Live UI League 1779188445745` for the joiner account.

Testability note:

- `/leagues/new` and `/leagues/join` render the intended visible labels, but their generated input IDs are not stable enough for durable browser automation. The local smoke targeted placeholders after confirming this. Future Playwright coverage should add stable accessible selectors or use robust label queries.

Remaining league lifecycle gaps:

- Mobile browser proof for create/join/switcher.
- Form validation and error-state click-through.
- Staging proof with production-like auth/cookie/runtime settings.

### Draft authenticated lifecycle remediation evidence

The latest draft fixture was reset and reapplied through the fixture-owned local path, then exercised with a real Firebase Auth emulator `statly_session` for `tester@statly.dev`.

Evidence:

- Fixture reset/apply/verify completed with `ok: true` for all three full-league fixtures.
- Primary draft: `cmpci2dvv01e4uxmwzo05xz0w`.
- Primary member: `cmpci2do40004uxmwzfu1ltls`.
- Queue add returned `200` and persisted one queued player.
- Watchlist add/get/delete returned `200`, and get showed one watched player after add.
- Draft start returned `200`, changed the draft to `LIVE`, and reported current pick `1`.
- Pick returned `200`, advanced current pick to `2`, and `/api/drafts/[id]/picks` showed one persisted pick for `Aaron Cadman`.
- Queue cleanup returned `200` and cleared the queue.

Remaining draft lifecycle gaps:

- Mobile browser click-through for the full mutation lifecycle beyond the current mobile render and API/socket proof.
- Browser-level multi-client room membership proof beyond the new user-scoped room-store regression.

### Trade authenticated lifecycle remediation evidence

Fixture Bot 1 was added to the Auth emulator with UID `statly-fixture-full-league-1-bot-1` so both sides of a trade could act through real local session cookies instead of a bypass-only identity.

Evidence against league `cmpci2do40002uxmw1sa8z22i`:

- Owner `tester@statly.dev` proposed a trade, then cancelled it; final status `CANCELLED`.
- Owner proposed a second trade, Fixture Bot 1 loaded its details, then declined it; final status `DECLINED`.
- Owner proposed a third trade, Fixture Bot 1 accepted it; final status `EXECUTED` with `executedAt` present.
- Owner proposed a fourth trade, Fixture Bot 1 created a counter with `parentTradeId`; counter status `PROPOSED` and the parent appeared as `SUPERSEDED`.
- Listing trades for the owner returned five lifecycle rows with status counts for `CANCELLED`, `DECLINED`, `EXECUTED`, `PROPOSED`, and `SUPERSEDED`.

Remaining trade lifecycle gaps:

- Desktop Browser click-through is now present for proposal, retract/cancel, accept, decline, and counter. Active review mutation authorization now denies regular managers before service mutation and allows commissioners.
- Reviewer-visible admin and veto controls now have route/component proof; local desktop browser click-through plus mobile decline, accept, and counter proof exist. Remaining work is staging proof.
- Mobile decline smoke exposed an empty-body follow-up action request that returned `500`; `POST /api/trades/[id]/[action]` now catches empty/malformed JSON and returns the existing `400` validation response instead. Verified by `npx vitest run 'src/app/api/trades/[id]/[action]/route.test.ts' --reporter=verbose`.
- Staging proof with production-like auth/cookie/runtime settings.

### Waiver authenticated lifecycle remediation evidence

The owner account `tester@statly.dev` exercised waiver routes against league `cmpci2do40002uxmw1sa8z22i` with a real Auth emulator session cookie.

Evidence:

- Settings returned `200` with system `ROLLING_LIST`.
- Submit returned `201`; listing waivers showed the claim as `PENDING`.
- Cancel returned `200` for the submitted claim.
- A second submit returned `201`; process returned `200` with `processed: 1` and result `SUCCESSFUL`.
- Direct roster verification showed the acquired player was on the owner's roster and the dropped player was no longer on it.
- Final waiver status rollup contained one `CANCELLED` claim and one `SUCCESSFUL` claim.
- Follow-up local Browser proof against league `cmpckfkdf0002ux4qqqx01d2o` selected `Tom Green`, dropped `aaron-cadman`, submitted the claim, saw it as `PENDING`, then cancelled it back to `0` open claims with no stale error banner.
- The browser blocker was a roster/member contract mismatch: the UI sent a normalized roster id as `teamId` while the service expected a league member reference. Submit now resolves the member from the authenticated server user and no longer requires a client team id; the UI also preserves `memberId` from the roster API for compatibility.
- Follow-up local Browser process-control proof against the same league submitted a pending `Tom Green` claim, exposed the owner-only `Process claims` control, clicked it, rendered `Processed 1 waiver claim.`, and direct API verification returned zero pending claims with latest claim `cmpdi5qqf000fuxr9qdi0wk92` as `SUCCESSFUL`.
- Permission-edge proof loaded the same waiver page as Fixture Bot 1 on port `3004`; Browser found zero `Process claims` buttons, `POST /api/leagues/cmpckfkdf0002ux4qqqx01d2o/waivers/process` returned `403 Forbidden`, and the owner no-op process endpoint on port `3000` returned `200` with `{ processed: 0, results: [] }`.
- The process-control browser blocker was missing role-aware UI for an existing route/service capability. The page now carries league member role from SSR into the client, gates processing by owner/commissioner role, calls `POST /api/leagues/[id]/waivers/process`, refreshes API-only state after success, and surfaces the process result.
- Component regression now proves successful process also refreshes roster/waiver state when realtime subscriptions are enabled, so app state does not depend solely on listener delivery after a high-impact process action.
- Follow-up non-bypass mobile realtime investigation ran against a restarted Auth + Firestore emulator stack with `BYPASS_AUTH=false` and a 390x844 headless browser. Server-side waiver submit/cancel/process now materializes Firestore `members`, `rosters`, `waivers`, `waiverPriorities`, and `activity` projections, writes explicit `null` optional values, chunks Firestore batches, and returns failure instead of success when projection sync fails. Firestore rules now include league-scoped waiver priority and activity projection reads. The root cause of the listener denial was AuthProvider passing the lazy exported `auth` proxy into Firebase Auth SDK operations, which created UI/session state but left Firestore Listen requests without an auth bearer. AuthProvider now resolves `getClientAuth()` and uses that concrete instance for auth-state observation, login/signup/social auth, logout, and server-session fallback lookup. Browser proof confirmed the Firestore Listen request now includes `Authorization: Bearer ...`, emitted zero permission-denied errors, submitted an out-of-band claim for `ply_chad_wingard`, and saw the mobile page update from `OPEN CLAIMS 7` to `OPEN CLAIMS 8` with `Chad Wingard` present and zero waiver API polling during the listener update.
- Follow-up mobile claim-control click-through at 390x844 selected `Tom Stewart`, selected `aaron-cadman` to drop, submitted the claim, observed pending/submitted markers, cancelled it, then clicked `Process claims` and observed `Processed 8 waiver claims.` The CDP runtime/network filter recorded zero app errors.

Remaining waiver lifecycle gaps:

- Browser settings interaction proof.
- Staging proof with production-like environment variables and non-bypass Firebase Auth.

### Expanded route hardening

Additional launch-critical route gaps were closed after subagent route inventory:

- `/api/cron/reminders` and `/api/cron/live-stats` now use shared cron authorization and fail closed when `CRON_SECRET` is missing outside explicit local runtime.
- `/api/leagues/[id]/draft-settings` now requires an authenticated actor and passes `actorUserId` into the service, where owner/commissioner authorization is enforced.
- `/api/drafts/[id]/schedule` now requires an authenticated owner or commissioner before schedule update or cancellation mutates draft state.

Changed files:

- `src/app/api/cron/reminders/route.ts`
- `src/app/api/cron/reminders/route.test.ts`
- `src/app/api/cron/live-stats/route.ts`
- `src/app/api/cron/live-stats/route.test.ts`
- `src/app/api/leagues/[id]/draft-settings/route.ts`
- `src/app/api/leagues/[id]/draft-settings/route.test.ts`
- `src/server/league/services/LeagueApplicationService.ts`
- `src/app/api/drafts/[id]/schedule/route.ts`
- `src/app/api/drafts/[id]/schedule/route.test.ts`

Verification:

- `npx vitest run src/app/api/cron/reminders/route.test.ts src/app/api/cron/live-stats/route.test.ts 'src/app/api/leagues/[id]/draft-settings/route.test.ts' 'src/app/api/drafts/[id]/schedule/route.test.ts' --reporter=verbose` passed: 4 files, 15 tests.

### Remaining route family hardening

The remaining planned route families were hardened and covered:

- Draft lifecycle routes:
  - `/api/drafts/[id]/start` now requires an authenticated actor and service-level owner/commissioner authorization.
  - `/api/drafts/[id]/auto-pick` now requires the cron/system token contract.
  - `/api/drafts/[id]/pause` and `/api/drafts/[id]/resume` now map service authorization and state errors to `403`, `404`, `400`, or `409` instead of collapsing to `500`.
- Draft private member surfaces:
  - `/api/drafts/[id]/queue`, `/api/drafts/[id]/pre-queue`, and `/api/drafts/[id]/watchlist` now bind `memberId` to the authenticated user before read or mutation.
- Waiver routes:
  - list/settings/submit/cancel/process routes now have auth and permission evidence proving unauthenticated and unauthorized requests do not call service mutation/read methods.
- League route backdoors:
  - `/api/leagues/join` no longer satisfies the hard-coded `123ABC` launch invite path before service handling.
- `/api/leagues/[id]/members` is authenticated and league-member scoped.
- `/api/leagues/[id]/actions/[userId]` authenticates and checks self-user access before due-action processing.
- `/api/leagues` now authenticates mutation requests before JSON parsing and ignores client-supplied `commissionerId` ownership claims.
- `/api/leagues/[id]/roster/[userId]` now authenticates self-user writes before JSON parsing or roster-table work, rejects cross-user writes before DB mutation, and returns `400` for invalid roster bodies.
- Inngest:
  - route wiring through `serve` is covered. Webhook signature rejection remains delegated to the Inngest SDK/runtime contract rather than unit-tested against SDK internals.

Verification:

- `npx vitest run 'src/app/api/drafts/[id]/start/route.test.ts' 'src/app/api/drafts/[id]/auto-pick/route.test.ts' 'src/app/api/drafts/[id]/pause/route.test.ts' 'src/app/api/drafts/[id]/resume/route.test.ts' 'src/app/api/drafts/[id]/queue/route.test.ts' 'src/app/api/drafts/[id]/pre-queue/route.test.ts' 'src/app/api/drafts/[id]/watchlist/route.test.ts' 'src/app/api/leagues/[id]/waivers/route.test.ts' 'src/app/api/leagues/[id]/waivers/settings/route.test.ts' 'src/app/api/leagues/[id]/waivers/submit/route.test.ts' 'src/app/api/leagues/[id]/waivers/cancel/route.test.ts' 'src/app/api/leagues/[id]/waivers/process/route.test.ts' 'src/app/api/inngest/route.test.ts' 'src/app/api/leagues/join/route.test.ts' 'src/app/api/leagues/[id]/members/route.test.ts' 'src/app/api/leagues/[id]/actions/[userId]/route.test.ts' src/server/draft/services/DraftApplicationService.test.ts --reporter=verbose` passed: 17 files, 75 tests.
- `npx vitest run src/app/api/leagues/route.test.ts 'src/app/api/leagues/[id]/roster/[userId]/route.test.ts' --reporter=verbose` passed: 2 files, 6 tests.

## Subagent Coverage Findings

### Route coverage

Inventory inspected 115 route handlers:

- 113 App Router route handlers under `src/app/api/**/route.ts`
- 2 Pages API handlers under `src/pages/api/*.ts`
- 26 route handlers have colocated tests
- 89 route handlers do not have colocated tests

P0 missing-test route families:

- Auth/session and user data
- Remaining draft operations outside the covered lifecycle, queue, pre-queue, watchlist, schedule, and auto-pick route families
- Waiver lifecycle browser flows; route-level list/settings/submit/cancel/process authorization evidence is now present
- Remaining league mutations outside the covered join/member/action slices
- Remaining admin, cron, import, and queue controls outside the covered worker/queue and hardened cron slices
- Legacy trade Pages API routes

Immediate launch blockers from route inventory:

1. `/api/admin/workers` was hardened with shared operational token authorization and regression tests during this pass.
2. `/api/admin/queue` was hardened with shared operational token authorization and regression tests during this pass.
3. `/api/auth/session` now has session cookie creation/deletion tests; revocation and browser redirect behavior still need end-to-end coverage.
4. `/api/user/profile/[userId]` now has identity binding tests.
5. `/api/leagues` and `/api/leagues/[id]/roster/[userId]` now have launch-critical mutation tests. Broader roster read/degraded-data tests remain useful but are no longer tracked as a route blocker.
6. Draft mutation route coverage has been added for start, auto-pick, schedule, queue, pre-queue, and watchlist. Remaining draft route work should focus on any product flows not represented by those route families.
7. Waiver list/settings/submit/cancel/process routes now have focused route evidence; desktop Browser lifecycle coverage now exists for submit, cancel, and process, and mobile claim-control coverage now exists for create, player/drop selection, submit, cancel, process, and settings save. The remaining waiver gaps are staging proof and broader degraded-state/accessibility evidence.
8. `/api/tradeReview` and `/api/listTrades` are gated local-only; remove them if no local workflow still depends on them.
9. `/api/inngest` has route wiring evidence, but direct webhook signature rejection remains delegated to Inngest SDK/runtime behavior.
10. Remaining debug, fixture, and hardcoded personal/demo endpoint decisions need to be tracked through the route policy matrix before launch.

### Product workflow coverage

Inventory found 45 App Router pages. Only two obvious page/client-level tests were found:

- `src/app/(auth)/forgot-password/ForgotPasswordForm.test.tsx`
- `src/app/players/PlayersPageClient.test.ts`

High-priority workflow gaps:

- Auth/session redirects across middleware, login, register, and session route.
- Dashboard first authenticated load and degraded data states.
- League create, join, switch, roster, member, permission, and matchup flows.
- Commissioner/admin worker and queue access.
- Draft room pick, queue, watchlist, pause/resume/start, reconnect, and stale state flows.
- Trade centre proposal/review/accept/reject UI flows.
- Waiver staging proof and broader degraded-state/accessibility flows.
- Player detail, stats, matches, rankings, and leaderboard views using canonical data.
- Injury and live-data degradation across dashboard, player, roster, trade, and waiver surfaces.
- User account, teams, watchlists, draft settings, and local preference isolation.
- Middleware protected-route redirects, CORS behavior, dev token behavior, and security headers.

No Playwright or Cypress browser E2E setup was evident in `package.json`; the strategy requires real browser validation for P0 workflows, so this is a launch-readiness gap.

### Realtime, worker, and fixture coverage

Inventory covered 90 scoped realtime/worker/dev-fixture files and found roughly 9 scoped test files.

P0 missing tests:

- Duplicate realtime delivery risk between draft rooms `draftId` and `draft:${draftId}`.
- Socket.IO production auth now has token-parsing, client-token, and invalid-token middleware-boundary regression coverage. Redis fallback and rate-limit behavior now have focused helper coverage.
- Shared Socket.IO provider cleanup, cancelled target discovery, reconnect option propagation, and draft-specific join/backfill/reconnect/listener cleanup now have focused coverage. Direct socket pick, timer, pause, and resume mutations now fail closed so the Prisma-backed draft API and server pick-deadline scheduler remain authoritative.
- Worker health, pick-expiry job lifecycle, stale job skipping, shutdown, failed jobs, and cleanup intervals.
- Dev fixture destructive safety, including production refusal and fixture-owned reset protection.

Operational blockers:

- Worker/admin APIs must be protected or removed before launch.
- Draft realtime duplicate delivery must be tested and either fixed or proven idempotent.
- Socket.IO production auth defaults must be tested under production-like browser/server settings.

## Design-System Gate

`npm run guard:design` now passes with:

- 0 active findings
- 0 hard-coded palette/hex candidates
- 0 legacy icon import candidates
- 8 allowlisted intentional findings

This closes the design-system gate as a release blocker. The long-term rule remains that new UI must use semantic tokens and lucide icons, and any future guard waiver must be narrow, reviewed, and tied to non-launch-critical legacy/demo code.

Design launch-decision artifact:

- `docs/audits/go-live-design-drift-decision-2026-05-18.md`

## Launch Blockers

The following must be resolved or explicitly accepted before go-live:

1. Complete staging proof against repaired staging fixtures and real staging sessions. `npm run go-live:staging-preflight` now enforces production-like runtime policy, the required staging URL, smoke account, fixture IDs, release/build ID, cleanup policy, monitoring URL, read-only mutation scope, browser matrix declaration, and read-only route health before evidence can be accepted.
2. Capture release browser evidence for the P0 product workflows in the strategy. Automated browser E2E remains recommended for repeatability, but it is not listed as a runnable gate until approved tooling and a `package.json` script exist.
3. Run staging-like smoke tests with production-like environment variables, cookies, auth, Firestore, queue, socket, and cron settings.
4. Capture production-grade performance/Web Vitals evidence and cross-browser evidence from staging or another production-like deployed target; current runtime metrics are local Chrome/dev-emulator proof only. Fill a release-specific copy of `docs/go-live-evidence.example.json` or generate one with `npm run go-live:evidence-check -- --init ... --output <evidence.json>`; `npm run go-live:evidence-check -- --file <evidence.json>` now rejects local-only, placeholder, missing route-coverage, missing accessibility, or otherwise incomplete evidence.
5. Broaden degraded-state evidence in staging and production-like environments beyond the sampled local probes; the evidence check requires at least one staging or preview degraded-state proof item tied to the release artifact metadata and fixture context.

## Rewritten Execution Plan

The initial next-step queue has been replaced with a stricter remediation plan:

- `docs/superpowers/plans/2026-05-18-go-live-remediation-execution-plan.md`

That plan rewrites the remaining work around durable contracts:

1. fail closed for local-only and legacy operational routes
2. bind authenticated user routes to the authenticated identity
3. protect or retire legacy mutable Pages API routes
4. make draft realtime delivery idempotent by contract
5. capture launch-scope browser workflow evidence without adding unapproved dependencies
6. keep the design-system guard passing with zero active findings

Use that plan as the implementation source of truth. Keep this report as the evidence log.

## Current Verdict

The automated baseline is healthier than when execution started because the full test suite passed earlier, a live matchup race was fixed, the first P0 route policy slice is complete, duplicate draft realtime delivery is now idempotent by contract, additional cron/league/draft mutation routes now fail closed, the remaining planned launch-critical route families now have focused route evidence, league creation and roster writes now fail closed before parsing untrusted bodies, the first browser-finding remediation slice has route-level regression coverage plus emulator fixture repair evidence, and the local non-functional pass now covers sampled accessibility names, keyboard traversal, mobile navigation state, trade modal focus trapping, dashboard degraded-state behavior, leaderboard aggregate failure, matchup malformed/no-data failure, waiver polling failure, draft inline action failure, draft socket disconnect/reconnect, trade action conflict, player detail/match-history API failure, admin worker backend outage, and local dev performance timings.

The site still fails go-live readiness because production-like staging smoke tests need to be executed against real staging target details and production-grade performance/cross-browser evidence is missing. The missing staging inputs and release evidence are now executable gates rather than undocumented manual prerequisites.
