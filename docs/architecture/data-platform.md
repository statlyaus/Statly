# Runtime and data platform

- Status: accepted ownership model; PostgreSQL production cutover is not complete
- Last verified against source: 2026-10-04

## Current state

Statly is a modular Next.js application with separate process entry points for web/API, Socket.IO,
workers, and ETL. The Prisma schema uses PostgreSQL 16 for
development, tests, and CI.

The managed production PostgreSQL database is not provisioned yet. This document does not claim that
it has been deployed. Go-live remains blocked until the
[go-live checklist](../runbooks/postgresql-cutover.md) is satisfied.

## Ownership map

| Concern                                                                           | Owner                                         | Boundary                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| User identity and tokens                                                          | Firebase Authentication                       | Server code verifies identity before domain authorization.                 |
| Leagues, seasons, membership, drafts, rosters, lineups, matchups, trades, waivers | Prisma services                               | Canonical protected state; every operation is league- and season-scoped.   |
| Live AFL stat evidence                                                            | Footywire/fitzRoy ETL and Firestore ingestion | External data is normalized before fantasy calculations.                   |
| AFL injury list                                                                   | Prisma snapshots of the Footywire list        | Append-only, 48-hour freshness, exact name-and-club identity match only.   |
| NBA reference data for fantasy basketball                                         | Prisma `Nba*` tables, written by NBA ingest   | Provider-ID identity only; bounded jobs fail closed; licensing guard.      |
| Compatibility projections                                                         | Firestore, temporarily                        | Rebuild from canonical relational state; never reverse ownership silently. |
| Queues, locks, caches, rate limits, Pub/Sub                                       | Redis                                         | Ephemeral coordination only, never durable fantasy truth.                  |
| Bidirectional realtime delivery                                                   | Socket.IO                                     | Transport for server-authoritative events and commands.                    |
| Delayed/background work                                                           | BullMQ workers                                | Idempotent jobs with durable results written through domain services.      |
| Web-vitals telemetry                                                              | Configured telemetry backend                  | Isolated from transactional league data.                                   |

Waiver settings, including the FAAB budget, are part of Prisma's league settings; Firestore holds no
waiver settings.

Authentication is not authorization. A valid Firebase UID does not imply membership, commissioner
rights, roster ownership, draft participation, or waiver eligibility.

## Relational target

Production Prisma workloads run on managed PostgreSQL. The provider must supply
encrypted connections, automated backups, point-in-time recovery, monitoring, and a rehearsed restore
path.

- `DATABASE_URL` is the pooled application connection for web, Socket.IO, and workers.
- `DIRECT_DATABASE_URL` is the direct migration/administrative connection.
- Connection budgets include every process class, not only the web tier.
- The PostgreSQL baseline preserves IDs, relationships, enums, timestamps, and current string-JSON
  semantics. JSON columns move to `jsonb` in cohorts (#955), keeping their `...Json` names. The
  `LeagueSettings` columns (`positionLimitsJson`, `autoPickRulesJson`, `lineupSlotsJson`,
  `categoryDirectionsJson`, `competitionRulesJson`) are `jsonb`: write plain objects, never
  `JSON.stringify` output, which would store a JSON string. Their normalizers (`normalizeLineupSlots`,
  `normalizeCategoryDirections`, `normalizeCompetitionRules`, `normalizeDraftPositionLimits`,
  `normalizeDraftAutoPickRules`) remain the shape authority. Each cohort's migration fails on any
  unparseable stored value, listing the row ids, and carries its manual rollback SQL in a comment.
  Cohort 2 converted `League.categoriesJson`, `LeagueMember.notificationSettingsJson` and
  `LeagueMatchupScore.categoriesJson` the same way. Category readers pass the stored value to
  `normalizeFantasyCategoryKeys`, each with its own fallback (an empty list for drafts, `goals` for
  competition, the nine-category preset elsewhere). Cohort 3 converted the outbox, audit and
  command payload columns (`LeagueCompetitionAudit.payloadJson`, `SocialMessage.contextJson`,
  `SocialModerationRecord.retainedContentJson`, `SocialCommand.responseJson`,
  `SocialOutboxEvent.payloadJson`, `LeagueTradeEvent.payloadJson`, `LeagueTradeCommand.responseJson`,
  `LeagueTradeOutboxEvent.payloadJson`). Write SQL `NULL` to a nullable one with `Prisma.DbNull`.
  Prisma cannot substring-filter jsonb, so the player-identity planner matches those columns' text
  form in raw SQL. The competition route's audit `payload` is now an object, not a string. Cohort 4
  converted `TeamAction.details` (waiver claims, drops and trades), `DraftEvent.payload` and
  `LobbyActivity.details`. Filter a jsonb field with a Prisma JSON path filter
  (`details: { path: ['playerId'], equals: id }`), never a text match: jsonb's text form puts a
  space after each colon. The planner's pending-action blocker reads `TeamAction.details` as text in
  raw SQL too.

The migration history starts at a reviewed PostgreSQL baseline. No user data existed on SQLite, so
there is no transfer. The SQLite history is archived in `prisma/migrations-sqlite-archive/` and must
never be replayed.

### Database identity

The AFL trade outcomes database states which application and schema format it satisfies.
`outcome_database_identity` holds a single CHECK-enforced row — `application_id`
(`statly-afl-trade-outcomes`) and `schema_format` — mirroring the way SQLite's file header records an
application id and a schema format number so a reader can refuse a file written for a different
contract instead of misreading it. The migration that writes the row asserts it before committing,
and `afl-outcomes-postgres.test.ts` binds the deployed row to `OUTCOME_DATABASE_IDENTITY` in code.

Bump `schema_format` only when a reader built for the previous format would misread a database at the
new one; it is a compatibility decision, not a refactor. The applied migration head is deliberately
not duplicated in the row, because `_prisma_migrations` already reports it and a copy would rot.

Startup does not yet assert compatibility. Enforcement is currently at deploy time (the migration
fails closed) and in CI (the binding test); a runtime precondition that refuses a database whose
identity disagrees with the running application is still outstanding.

## Firebase boundaries

Firebase Authentication remains the identity provider. Firebase Admin credentials are server-only,
must come from the deployment secret manager or local ignored environment, and must be validated
against the expected project.

Browser Firebase code is split by capability instead of passing through a combined SDK entry point:

- the app boundary owns configuration validation and the single default Firebase app;
- the authentication boundary initializes Auth synchronously so session restoration can subscribe
  immediately, preferring IndexedDB persistence before browser-local persistence and preserving the
  popup/redirect resolver;
- the Firestore boundary owns the browser database instance and optional emulator connection;
- the analytics boundary initializes asynchronously after hydration, only when supported and when a
  measurement ID is configured, and never while emulators are active.

Authentication emulator setup must finish before auth listeners or sign-in commands run. The
authentication service worker is a separate JavaScript realm and intentionally performs its own Auth
initialization with IndexedDB persistence; it must not import the browser boundary.

`src/lib/etlIntegration.ts` is a documented transitional exception: browser live-data consumers and
server competition/read-model consumers currently share its Firestore client implementation. The
client boundary split must preserve this behavior, not disguise it with a `client-only` marker. Moving
server ETL reads to an Admin, Prisma, or repository-owned boundary requires a separate data-ownership
migration with parity evidence.

Firestore is not the long-term authority for transactional fantasy state. Every remaining fallback or
dual-write path needs an owner, parity check, removal condition, and failure policy. A projection
failure must not cause the application to treat stale Firestore state as canonical.

## Realtime and workers

Socket.IO remains the realtime transport because draft and social flows are bidirectional,
room-oriented, and require reconnect recovery. Multi-instance production uses the official Redis
adapter and appropriate load-balancer affinity. Production startup must fail closed if required Redis
coordination is unavailable.

BullMQ owns draft delays and background jobs. Timers use idempotent IDs, bounded retention, startup
reconciliation, graceful shutdown, and queue monitoring. Cron or Firebase Functions may enqueue coarse
work but must not become a second authoritative draft clock.

See [realtime delivery](realtime.md) for command and catch-up invariants.

### Rate limits

HTTP rate limits (`src/lib/rateLimit.ts`) and league social limits
(`src/server/leagues/social/socialRateLimit.ts`) share one fixed-window counter: Redis `INCR` plus
`EXPIRE` in one `MULTI`, keyed by limiter, caller, and window. Every web instance therefore spends the
same budget, and a restart does not reset it.

The caller is the authenticated user id when the route passes one. Otherwise it is the client IP read
from trusted headers only: `x-nf-client-connection-ip` when `NETLIFY=true` (Netlify's edge overwrites
it), else the `x-forwarded-for` hop `RATE_LIMIT_TRUSTED_PROXY_COUNT` entries from the right (default
1). Hops further left are client-written and ignored, so a spoofed header cannot move a caller into
another bucket. A request with no trustworthy IP shares the `unknown` bucket.

When Redis is missing, reconnecting, erroring, or takes over 500 ms to answer, the behaviour is set
per limiter:

| Limiter                | Redis unavailable                       | Why                                                                                           |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `auth`, `api`, `heavy` | Fail closed: HTTP 503, `Retry-After: 5` | These guard credentials and expensive work; an unenforced limit is worse than a short outage. |
| `public`               | Count in this process only              | Anonymous reads stay available, and each instance still caps a single caller instead of none. |
| League social actions  | Count in this process only              | Unchanged from before: these callers are authenticated and keyed per user and league.         |

Either fallback logs one warning per minute while it lasts.

## ETL and player identity

The supported source is Footywire through fitzRoy. The pipeline streams source rows through TypeScript
normalization and writes live-stat evidence to Firestore. Fetch, parse, validation, or write failure
fails the cycle; production does not substitute mock data.

Player identity may be tolerant at read boundaries, but canonical repairs are explicit data
operations. Firestore match-stat evidence must not create or merge protected player ownership by
guessing. Use the [player identity runbook](../runbooks/player-identity.md) for reviewed consolidation.

### Injury list snapshots

The Footywire injury list is the only source of lineup availability. `netlify/functions/cron-injuries.mts`
calls `/api/cron/injuries` every six hours; the route does nothing outside 1 January to 7 October
Melbourne time (`src/server/injuries/injuryListSchedule.ts`), so the off-season holds the last
in-season snapshot until it ages out. In season, `src/server/injuries/injuryListIngestion.ts` fetches,
parses and matches the list, then stores it as an `InjuryListSnapshot` with one `InjuryListEntry`
per row. A snapshot is identified by a hash of the parsed source rows together with each row's
player link, so a fetch that repeats a stored list only advances that snapshot's `confirmedAt`,
while a list whose rows or player links differ (a player imported since the last run, for example)
is a new snapshot. Stored snapshots and entries are never rewritten, which keeps the record of which
links were in force when a default lineup was filled.

Ingestion fails closed. A fetch error or timeout, a page with no club tables or no rows, or more
than 600 rows writes nothing. Each row is matched to a `Player` on exact normalized name and club
only; a row with no match or more than one match is stored with no `playerId` and its match status,
never guessed. Injuries are not league- or season-scoped data.

Readers use `src/server/injuries/injuryListReadModel.ts`, which returns the latest snapshot only
while it was confirmed within the last 48 hours; otherwise it reports `none` or `stale`. Default
lineups and the lineup page then treat every player as available and log a warning. A `TEST` return
estimate is shown but does not block selection; every other status does.

### NBA stats (fantasy basketball)

The [fantasy basketball](../domain/basketball.md) section reads global NBA reference tables that only
`src/server/basketball/ingest` writes. A provider port (`nbaStatsProvider.ts`) hides the source; the
one adapter today, `espn/`, reads ESPN's public site API, validates every response with zod and
converts it to provider-neutral values: standard team codes (GSW, NYK, SAS, NOP, UTA, WAS), seconds
played, a did-not-play reason enum and US Eastern game dates. It sends at most four requests at a
time. Only regular-season games are stored; the NBA Cup final, preseason, play-in and playoff games
are dropped by the adapter. That invariant rests on where box scores come from: a box score
(`summary`) carries no competition type, so it cannot tell a Cup final from a standard game.
Box-score candidates come only from the filtered schedule and scoreboard. Do not add a path that
fetches box scores by event id from anywhere else.

`/api/cron/nba?job=…` runs one bounded job per call, each from its own Netlify scheduled function:

| Job         | Function                 | Schedule (UTC)   | Writes                                                                     |
| ----------- | ------------------------ | ---------------- | -------------------------------------------------------------------------- |
| `boxscores` | `cron-nba-boxscores.mts` | every 30 minutes | game status from yesterday's and today's scoreboards; at most 8 box scores |
| `injuries`  | `cron-nba-injuries.mts`  | hourly at :17    | `NbaPlayerInjury`, replaced as a whole list in one transaction             |
| `players`   | `cron-nba-players.mts`   | daily at 08:47   | `NbaTeam` by code, `NbaPlayer` and `NbaPlayerIdentity`                     |
| `schedule`  | `cron-nba-schedule.mts`  | daily at 09:27   | `NbaGame` by provider and external ID, new or changed games only           |

Box scores are fetched for FINAL games never ingested (oldest first), then once more at least 12
hours after the first ingest to pick up stat corrections (`boxScoreFinalisedAt`); a game first
ingested more than 24 hours after tip-off is final at once. Each game is one transaction: the game
row, any player the provider has not seen before (created from the box score; identity is the
provider ID, never a name match) and the game's complete set of player lines. A write that clashes
with an overlapping run on a unique key is left to that run and listed as `concurrent_write`. A game
skipped (for any other reason) by two runs in the last 24 hours is deferred, not fetched, until one
of those skips is a day old, so a box score that keeps failing cannot use up every run's budget; the
run summary counts it as `deferred`. The players job creates new players and their identities in a
few batched statements inside one transaction.

Each injury row keeps the status (`OUT` or `DAY_TO_DAY`), side and type, return date, the
provider's one-line note and its own fantasy status code, and a `seasonEnding` flag the adapter
derives from that code (`OFS` on ESPN), so a season-ending injury with no real return date is not read
as a short absence.
The fields and the flag's rule are in [fantasy basketball](../domain/basketball.md#injury-report).

Ingestion fails closed. Every fetch and check runs before the first write, and a rejected run
(`fetch_failed`, `parse_failed`, `out_of_bounds`, `unlicensed_provider`) writes only its
`NbaIngestRun` row. Bounds: exactly 30 teams and 300 to 700 rostered players; 1,100 to 1,300
regular-season games (1,230 in a full season); at most 400 injury rows, and at least 20 while the
season is on. Box scores reject the run when a scoreboard cannot be read, every fetch fails, or the
provider answers 401, 403 or 429; one game that cannot be fetched or parsed, or fails its sanity
check (both teams present, 8 to 20 listed players each), is skipped and listed in the run summary.
Injury rows whose athlete has no `NbaPlayerIdentity` are skipped and counted, and so is a box-score
row with no player identity at all that records nothing (no stats, or all zeros; ESPN lists some
unsigned two-way players that way); a row with real numbers but no identity fails its game.

Licensing guard: ESPN's terms allow personal, non-commercial use only, so its adapter is flagged
`commercialUseLicensed: false`. Every job, from the cron route or the scripts, refuses such a
provider with `unlicensed_provider` when `NODE_ENV=production` unless
`NBA_STATS_ALLOW_UNLICENSED_PROVIDER=true` is set deliberately. A licensed feed is an owner decision
before any public launch. Netlify's access to ESPN is untested.

Every invocation writes an `NbaIngestRun` row first and sets `finishedAt` and `outcome` when it ends.
A row with `finishedAt` still null more than an hour after `startedAt` means the function was killed
part-way, almost always by the hosting time limit; whatever it wrote before then is complete per
game or per list, and the next run carries on.

Production is seeded once, before the Netlify schedules are enabled, from an operator's machine:
`npm run nba:sync -- --job players --allow-remote`, then `--job schedule`, with `DATABASE_URL` and
`DIRECT_DATABASE_URL` naming the production database. The scripts treat any remote database as
production, so the licensing guard applies: `NBA_STATS_ALLOW_UNLICENSED_PROVIDER=true` is needed
while the provider is unlicensed. The scheduled box-score runs then catch up eight games at a
time.

Season backfills run locally through `npm run nba:backfill` (see
[testing](../development/testing.md#secured-endpoint-testing)), never through cron. They reuse the
same jobs at one request per second, then compare the stored points, rebounds and assists of ESPN's
top 50 scorers with ESPN's own season totals and fail on any difference. `--tolerance N` accepts a
difference of up to N per stat, for when ESPN's totals feed disagrees with its own box scores: in
2026-27 it is one assist off for RJ Barrett and Kyshawn George after game 401909846, whose box score
and game logs match the stored rows. The default is 0.

The [role outlook](../domain/basketball.md#read-model-roleoutlookts) reads earlier seasons too:
the 3 seasons before the current one for back-to-back records and up to 13 for each player's career
rates. Backfill those 3 (for 2026-27, `--season 2026`, `--season 2025` and `--season 2024`); older
seasons barely change the projections. Its computed output is cached in the Next.js data cache per
season, keyed by the latest successful box-score ingest, the injury report's fetch time and the
Eastern date, and its history tables per season for a day. No table stores either.

## Rejected alternatives

- Production SQLite on local or network storage: insufficient concurrency and failover behavior.
- Firestore as the only database: poor fit for relational authorization, joins, uniqueness, and
  cross-aggregate transactions.
- Immediate Firestore removal: unsafe without migration and parity evidence.
- Firebase Functions as the draft clock: unsuitable as the sole sub-second timer authority.
- Microservices or full event sourcing now: additional failure modes without independent domain
  ownership or replay operations to justify them.

## Completion criteria for PostgreSQL

Production is on PostgreSQL only after the managed database is provisioned, all process classes use
the managed connections, backup/restore evidence exists, and domain validation and smoke checks pass.
Until then, documentation and deployment reports must describe the managed database as a target, not
current production state.
