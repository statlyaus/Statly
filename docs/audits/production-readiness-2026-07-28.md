# Production Readiness Reconciliation — 2026-07-28

## Outcome

The locally actionable production-readiness work is implemented on
`codex/production-readiness-plan`. The branch is materially safer and has release-grade local evidence,
but this report is **not** production launch approval.

Production launch remains blocked until the managed PostgreSQL cutover is provisioned, rehearsed, and
executed. Deployment-specific Redis, load-balancer, secret, browser-CI, backup, and restore evidence must
also be supplied by the owning environment.

This ledger reconciles the findings in the supplied “Statly Production Readiness Plan” against current
source and branch commits. It distinguishes source fixes from assumptions that were disproved and work
that cannot be honestly completed without external infrastructure.

## Status definitions

- **Implemented:** source or documentation changed and relevant checks passed.
- **Verified:** current source already satisfies the concern or the audit premise was incorrect.
- **Partial:** the risky boundary is mitigated, but a deliberate migration remains.
- **External gate:** accepted target, but completion requires provisioned infrastructure or production
  authority.
- **Rejected:** proposed change would weaken the supported design or solve a false premise.
- **Upstream residual:** no safe compatible package resolution exists in the current dependency line.

## Finding reconciliation

| Finding                                                          | Status                           | Resolution and evidence                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 SQLite cannot run production workloads                       | **External gate**                | PostgreSQL is the accepted production target in [the platform ADR](../codex/production-data-platform-adr.md). [The cutover runbook](../codex/postgresql-cutover-runbook.md) requires managed infrastructure, backup/restore proof, a production-shaped rehearsal, validation, and rollback. `prisma/schema.prisma` intentionally remains SQLite until those gates exist; changing it earlier would create an untestable deployment. |
| 1.2 Missing critical indexes                                     | **Implemented**                  | `b946691d` adds reviewed indexes for active player search and league matchup-score status, backed by schema architecture tests and a disposable migration-history application. Existing draft/social indexes were retained where they already serve the query shape; the audit’s proposed list was not copied blindly.                                                                                                              |
| 1.3 League is a god object because Prisma includes all relations | **Verified / premise disproved** | Prisma relation fields are schema navigation/backrelations and are not automatically loaded. Query cost is controlled by explicit `select`/`include` at repository/read-model boundaries. Removing relations would weaken referential modeling without fixing a demonstrated query.                                                                                                                                                 |
| 2.1 ETL returns mock production data                             | **Implemented**                  | `1eff119e` removes the mock production path and consolidates the canonical real-data ETL source. ETL/source-of-truth architecture tests pass.                                                                                                                                                                                                                                                                                       |
| 2.2 Footywire scraper has a hard-coded match                     | **Implemented**                  | `1eff119e` removes the one-off hard-coded production path in favor of the parameterized/canonical ETL flow.                                                                                                                                                                                                                                                                                                                         |
| 2.3 No data convergence logic                                    | **Verified**                     | The repository already contains player identity/data convergence planners, diagnostics, dry-run/apply plans, temporary-database simulations, and tracked-data tests. `docs/codex/player-data-convergence-brief.md` defines the current ownership and safety boundary.                                                                                                                                                               |
| 3.1 Development auth can leak to production                      | **Implemented**                  | `34bcbcf6` requires explicit client/server opt-in in addition to non-production mode. `c03397d4` is unrelated; the opt-in regression is covered by `socketProviderDevAuth` and `devAuth` tests.                                                                                                                                                                                                                                     |
| 3.2 Session cookie lacks origin protection                       | **Implemented**                  | `abff443b` validates request origin and hardens session/app-route authorization. Session security tests pass.                                                                                                                                                                                                                                                                                                                       |
| 3.3 Proxy/middleware is a stub                                   | **Implemented**                  | `abff443b` establishes deliberate route protection and server-side session verification while preserving authorization at loaders/services/API boundaries. Middleware presence is not treated as authorization by itself.                                                                                                                                                                                                           |
| 3.4 Hard-coded Sentry DSN and production sampling                | **Implemented**                  | `4cd3e79b` makes Sentry configuration environment-driven and explicit for production. Client initialization tests and production build pass.                                                                                                                                                                                                                                                                                        |
| 4.1 Legacy Socket.IO `draftRooms` map splits state               | **Implemented**                  | `2893681e` removes the legacy authoritative room map from `src/server/socketioServer.ts`; Redis-backed room state remains canonical. Architecture tests assert the old access pattern is absent. A similarly named map in the separate `liveDraftWebSocketManager` belongs to that isolated client/service implementation and is not the removed Socket.IO room authority.                                                          |
| 4.2 Timer leadership can expire without ownership check          | **Verified**                     | `startDraftTimer` atomically checks the Redis leader token and extends the lock on every tick through Lua. Loss of ownership clears the timer and records the leadership-loss metric before draft mutation.                                                                                                                                                                                                                         |
| 4.3 Worker reconciliation has no distributed lock                | **Implemented**                  | `a0969c63` coordinates reconciliation through a Redis lock with tested concurrent-worker behavior.                                                                                                                                                                                                                                                                                                                                  |
| 4.4 Socket.IO `allowRequest` has a floating promise              | **Implemented**                  | `e9fef025` settles the callback exactly once through an explicit async wrapper and covers success/failure paths.                                                                                                                                                                                                                                                                                                                    |
| 5.1 API error formats are inconsistent                           | **Partial**                      | `400bef63` normalizes legacy and structured envelopes at the shared client boundary and keeps expected 4xx responses out of unexpected-error logging. Routes can migrate incrementally to `apiResponse` without a 100-route flag day. New/changed routes should use the shared response helpers; existing envelopes remain a tracked compatibility surface.                                                                         |
| 5.2 Empty `src/app/api/api.ts`                                   | **Verified**                     | The file is absent. No replacement abstraction was added.                                                                                                                                                                                                                                                                                                                                                                           |
| 5.3 Development/test routes exist in production                  | **Implemented**                  | `f122ccd7` makes development tools fail closed unless explicitly enabled; production returns unavailable responses before side effects. Seven route tests and architecture checks cover the gate. The routes remain available for the isolated local-stack/E2E fixture path by design.                                                                                                                                              |
| 6.1 Logger posts to missing `/api/logs`                          | **Implemented**                  | `56bdb0d6` removes the timer/network transport and uses bounded structured output. Logger tests prove there is no interval, fetch, `flushLogs`, or `/api/logs` path.                                                                                                                                                                                                                                                                |
| 6.2 `forceFLush` typo                                            | **Verified**                     | The misspelled and old flush APIs are absent and regression-tested.                                                                                                                                                                                                                                                                                                                                                                 |
| 6.3 Health check omits Prisma                                    | **Implemented**                  | `5e4fe99f` adds relational health with response timing and failure reporting. Focused health tests pass.                                                                                                                                                                                                                                                                                                                            |
| 7.1 Auth context fabricates a Firebase `User`                    | **Implemented**                  | `68f0601d` introduces the application-owned auth user shape instead of casting a handmade object to the Firebase SDK type. Auth and consuming UI type checks pass.                                                                                                                                                                                                                                                                  |
| 7.2 Auth UI lacks error handling                                 | **Verified / premise disproved** | `AuthForm` already catches email/password and OAuth failures and renders/notifies them. `localDevelopmentAuthArchitecture` enforces form-boundary error ownership. Adding duplicate global context error state would blur responsibility.                                                                                                                                                                                           |
| 8.1 Duplicate icon/animation dependencies                        | **Implemented selectively**      | `e6fa1e80` removes unused packages. Heroicons and Lucide remain because both have active callers; paired Chart.js packages remain intentionally paired. `c03397d4` replaces the vulnerable Giphy UI wrapper with native composition, removes 30 transitive packages, and shrinks affected route bundles.                                                                                                                            |
| 8.2 Node engine range is too narrow                              | **Rejected**                     | `>=22 <23` is an intentional supported-production-major contract aligned with Docker and CI. Accepting unverified future majors would weaken reproducibility. Node 22.22.0 was used for final verification.                                                                                                                                                                                                                         |
| 8.3 Overrides are undocumented                                   | **Implemented**                  | `docs/dependency-overrides.md` records purpose/removal gates. `02eb6e74` removes stale Firebase Admin overrides and updates the policy after dependency resolution and tests.                                                                                                                                                                                                                                                       |
| 9.1 Draft domain has no unit tests                               | **Verified / premise disproved** | Tests cover snake sequencing, auto-pick selection, authoritative deadlines, stale scheduling versions, pause/completion projection, roster ownership, reconciliation, and full-draft soak behavior. The final unit run includes 787 passing tests.                                                                                                                                                                                  |
| 9.2 E2E is Chromium-only                                         | **Implemented**                  | `ed194f6b` adds Firefox and WebKit smoke projects while keeping the full flow on Chromium. The Firefox/WebKit matrix passed locally against a disposable `/private/tmp` SQLite database: 8/8 tests, with Redis disabled, Socket.IO disabled, Firebase unable to reach a real project, and artifacts redirected outside the repository. CI must repeat the complete three-engine matrix.                                             |
| 10.1 Service-account validation/rotation is missing              | **Implemented**                  | `667885ee` validates decoded credential structure, project identity, and PEM formatting. `docs/firebase-setup.md` documents planned and compromised-key rotation. `.env.template` contains dummy configuration rather than secrets.                                                                                                                                                                                                 |

## Additional readiness changes

These branch changes close risks exposed while tracing the original findings:

| Commit     | Outcome                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `196ecf11` | Removes the magic league invite path.                                                                                                                                                       |
| `71725340` | Removes unsafe roster fallbacks.                                                                                                                                                            |
| `5d69ea1b` | Requires persisted league identity throughout draft flows and removes obsolete linking shortcuts.                                                                                           |
| `0a817a79` | Installs the official Socket.IO Redis adapter, fails closed in production, closes clients cleanly, and documents sticky sessions/private Redis.                                             |
| `161c2287` | Makes both worker entrypoints executable in production through `tsx`, provides a complete worker type gate, and closes shared Redis on shutdown.                                            |
| `02eb6e74` | Updates security-relevant dependencies within supported majors, removes stale overrides, eliminates production critical advisories, and externalizes server-only BullMQ from Next bundling. |
| `c03397d4` | Removes the directly vulnerable Giphy UI wrapper while preserving search, pagination, analytics, idempotency, attribution, and accessible media.                                            |

## Architecture decision reconciliation

| Requested decision            | Long-term decision                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 primary database      | Managed PostgreSQL for production; SQLite only for local/disposable verification. **External gate remains.**                                                                 |
| ADR-002 Prisma + Firebase     | Prisma/PostgreSQL owns protected structured state; Firebase Auth stays; Firestore transactional fallbacks phase out through explicit parity/removal gates.                   |
| ADR-003 realtime transport    | Keep Socket.IO with the Redis adapter and load-balancer affinity; host it as a long-running service.                                                                         |
| ADR-004 job queue             | Keep BullMQ + Redis for draft timing and background work; do not create a second Firebase timer authority.                                                                   |
| ADR-005 schema design         | Hybrid: JSONB for cohesive flexible configuration, normalized tables for queried/constrained operational data. Do not combine this redesign with the first provider cutover. |
| ADR-006 outbox/event sourcing | Keep the transactional outbox. Do not adopt full event sourcing/CQRS without replay/versioning/tooling need and team capacity.                                               |
| ADR-007 monolith/services     | Keep the modular monolith; separate deployable process classes for web, sockets, workers, and ETL when scaling requires it.                                                  |
| ADR-008 hosting               | Next.js may use a web/serverless platform; Socket.IO and workers require long-running compute. Exact providers remain an operations choice.                                  |

The durable decision record is [Production Data and Runtime Platform](../codex/production-data-platform-adr.md).

## Verification snapshot

Final local verification used Node `22.22.0`, the major declared by the repository:

- `npm run prisma:generate` — passed with Prisma 6.19.3
- `npm run lint:ci` — passed
- `npm run typecheck` — passed
- `npm run typecheck:tests` — passed
- `npm run worker:build` — passed for both worker entrypoints
- focused Giphy component tests — 2 files, 7 tests passed
- unit suite — 198 files, 787 tests passed
- `npm run build` — passed with Next.js 15.5.22
- fresh migration history — all 23 SQLite migrations applied to a disposable `/private/tmp` database;
  `prisma migrate status` reported the schema current
- Firefox/WebKit smoke matrix — 8/8 tests passed (4 per browser) in 1.2 minutes against disposable
  state, with artifacts redirected to `/private/tmp`
- production dependency audit — 28 total: 1 low, 14 moderate, 13 high, 0 critical
- full dependency audit — 38 total: 2 low, 15 moderate, 21 high, 0 critical
- `git diff --check` — passed for each reviewed commit

Audit counts are a time-stamped registry snapshot and may change without a lockfile change. No forced
audit fix was used.

## Residual risks and release gates

### Production launch blockers

1. Complete [the PostgreSQL cutover runbook](../codex/postgresql-cutover-runbook.md) against managed
   production infrastructure.
2. Prove pooled/direct connection budgets, automated backups, point-in-time recovery, and a restore
   drill.
3. Repeat the Playwright Chromium/Firefox/WebKit matrix in isolated CI with its disposable database and
   artifacts; the local Firefox/WebKit smoke matrix passes 8/8.
4. Verify production Redis private networking/TLS/authentication, queue retention, Socket.IO adapter
   health, and load-balancer affinity.
5. Validate production secrets, Sentry destination/sampling, Firebase credential scope/rotation, cron
   authentication, and deployment-specific health checks without logging secret material.

### Accepted transitional work

- API routes still expose legacy envelopes; the shared client boundary is tolerant while routes migrate.
- Firestore remains a compatibility and live-stat input surface in documented paths. Each fallback
  requires an owner and removal condition.
- PostgreSQL JSONB/normalization follows provider cutover as separate migrations.
- The build reports the existing notice that the Next.js ESLint plugin is not detected by the custom
  flat configuration; repository lint itself passes.

### Upstream dependency residuals

The remaining direct audit effects are inherited through the current supported Next/Firebase lines.
At this snapshot npm recommends unsafe downgrades (for example Next 9.3.3, Firebase Admin 10.3.0, or
Firebase Functions 4.9.0) rather than compatible security upgrades. Sentry is marked through its Next
relationship rather than a vulnerable installed Sentry version. These findings require recurring audit,
upstream upgrade adoption when a compatible release exists, and explicit release-owner risk review.

### Operational note from local verification

During an earlier worker runtime smoke, the web-vitals worker connected to the configured local Redis
instance and consumed queued local web-vitals jobs before it was stopped. No production environment was
targeted and no cleanup or destructive command was run. Operators relying on that local queue should
assume its prior web-vitals contents changed. This is why future worker smoke runs must use a dedicated
Redis namespace or disposable instance.

## Final disposition

The branch completes the authorized source, test, and documentation remediation for the supplied audit.
It should be reviewed as a sequence of narrow commits, not squashed into an unsupported claim that
Statly is already production-deployed. The correct release disposition is **no-go until the external
production gates above are evidenced**, with PostgreSQL cutover as the primary blocker.
