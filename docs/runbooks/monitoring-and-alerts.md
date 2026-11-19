# Monitoring and alerts

What tells someone that a scheduled job, the Socket.IO server or a BullMQ worker failed. Everything
goes to the one Sentry project the web app already uses; no other vendor is involved.

## What alerts where

| Failure                                                     | How Sentry hears about it                                                                                   | Code                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Web route or server action throws                           | `onRequestError` in `src/instrumentation.ts`                                                                | existing                                 |
| A caught server failure is logged (`logger.error`)          | forwarded by `src/lib/logger.ts`                                                                            | existing (#1198)                         |
| A monitored cron run answers 400 or more, or throws         | `error` check-in on its Crons monitor                                                                       | `src/server/cron/cronMonitors.ts`        |
| A monitored cron never runs, or runs over 10 minutes        | missed / timed-out check-in                                                                                 | same                                     |
| Socket.IO server: uncaught exception or unhandled rejection | Sentry's Node handlers, flushed before shutdown                                                             | `src/server/socketioServer.ts`           |
| Draft worker or web-vitals worker: a job fails              | `reportJobFailure`, tagged `queue`, `job_name`, `league_id`, `season_id`, `draft_id` where the job has them | `src/server/monitoring/processSentry.ts` |
| Either worker: uncaught exception or unhandled rejection    | Sentry's Node handlers                                                                                      | same                                     |
| An AFL match result is missing 6 h after the game's end     | `logger.error` per game from the hourly `/api/cron/afl-results` check                                       | `src/server/etl/missingAflResults.ts`    |

Every process tags its events with `service` (`socket-server`, `draft-worker`, `web-vitals-worker`;
web app events have none). Job failures are reported once, from the worker's `failed` event; the
job-level log lines are warnings so they do not report the same failure again.

## Cron monitors

Check-ins come from the API route after its `CRON_SECRET` check, so an unauthorised call never checks
in. Each check-in carries the monitor config, which creates or updates the monitor in Sentry; nobody
has to create monitors by hand. Schedules are UTC, the same as the Netlify scheduled functions.

| Monitor slug       | Netlify function → route                         | Schedule (UTC) | Margin | Max runtime | Issue after |
| ------------------ | ------------------------------------------------ | -------------- | ------ | ----------- | ----------- |
| `cron-waivers`     | `cron-waivers.mts` → `/api/cron/waivers`         | `0 * * * *`    | 10 min | 10 min      | 1 failure   |
| `cron-scoring`     | `cron-scoring.mts` → `/api/cron/scoring`         | `0 * * * *`    | 10 min | 10 min      | 1 failure   |
| `cron-bloodsucker` | `cron-bloodsucker.mts` → `/api/cron/bloodsucker` | `*/5 * * * *`  | 5 min  | 10 min      | 2 failures  |

An issue resolves after one good run. The waivers route runs hourly and processes waivers only in the
6 am Melbourne hour; every hourly run still checks in, so the monitor also proves the scheduler is alive.
The other crons (daily, injuries, trades, the other NBA jobs) are not monitored: each monitor past
the plan's included quota is billed. To monitor one, add it to `CRON_MONITORS` and wrap its route in
`monitorCronRun`; a unit test keeps each monitor's schedule equal to its Netlify function's.

## Stalled scoring round

`/api/cron/scoring` reports a league round that is still not FINAL 12 hours
(`STALLED_ROUND_GRACE_HOURS`) after its last known match start. Each one is logged as
`Round scoring stalled: league {leagueId}, season {season}, round {round} ({reason})`, an error that
opens its own Sentry issue, and the run answers 500 so `cron-scoring` stays red. It keeps alerting
every hour until the round is FINAL; later rounds of the league still score. The log context and the
route's JSON (`stalledRounds`) carry the detail for each reason:

| Reason                  | Detail                 | What to do                                                                                                                                                              |
| ----------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unavailable-stats`     | `missingPlayerIds`     | Lineup players have no stat totals. Check the round's stats ingest, then each player's Footywire link ([player identity](player-identity.md#footywire-stats-identity)). |
| `afl-matches-not-final` | `aflMatchIdsNotFinal`  | An AFL match in the round is not final in the fixture. Check the stats/fixture ingest for that match; if the source is wrong, fix the data.                             |
| `afl-results-missing`   | `waitingOnResults`     | A No Losers league waits on a stored AFL result. See [Missing AFL match result](#missing-afl-match-result).                                                             |
| `unresolved-matchups`   | `unresolvedMatchupIds` | Two-team matchups stayed unscored. See [unscored finalized matchups](unscored-finalized-matchups.md).                                                                   |

## Bloodsucker sweep

`cron-bloodsucker` closes due exclusive windows and runs due bites (see
[Bloodsucker bites](../product/league-competition-rules.md#bloodsucker-bites)). Its JSON answer lists
`closedLeagueIds`, `autoExecutedBiteIds`, `waitingLockBiteIds`, `unpairableBiteIds`,
`knownFailingBiteIds` and `failedLeagueIds`; any failed league answers 500 and checks in as error.
Two failed or missed runs in a row open a Sentry issue.

- **Failed league.** A bite that throws, or is still suspended (its matchup not FINAL) 2 hours past
  its deadline, fails **one** run: the log line `Bloodsucker auto-bite failed: league {leagueId}, bite {biteId}` (an error, so it
  reaches Sentry) names the league and bite, and the bite row records `failureCount`,
  `lastFailureAt`, `lastFailureReason` and `failureAlertedAt`. That one failed run is the alert.
  Later runs still try the bite every 5 minutes and count the failure, but answer 200 and list the
  bite in `knownFailingBiteIds` (log line `Bloodsucker auto-bite is still failing: league …, bite …`, a warning), so
  one stuck bite cannot keep the monitor red or hide another league's failure. A window close that
  fails (`Bloodsucker window close failed: league {leagueId}`) still fails every run until it works.
- **A bite the alert named does not fix itself by being ignored.** Later bites in that league wait
  for it (oldest grant first) and its victim stays frozen. Read the reason and fix the cause; the
  next run then runs the bite with no manual step. Bites that are failing now:
  `SELECT id, "leagueId", status, "failureCount", "lastFailureAt", "lastFailureReason" FROM "LeagueBite" WHERE status IN ('OPEN','WAITING_LOCK') AND "failureCount" > 0;`
- **Suspended bite (`BITE_SUSPENDED`).** A commissioner re-score run while an AFL match was not
  final writes the matchup back to LIVE while its round stays FINAL. The hourly scoring job rescores
  such a round until the matchup is FINAL again, then the bite runs; while it cannot, `cron-scoring`
  reports the round as stalled. A round cannot be force-finalized while an AFL match is not final,
  so if the AFL data stays wrong, fix the data; meanwhile a commissioner who is neither the
  Bloodsucker nor the victim (or the owner) can cancel the bite to unfreeze the victim.
- **Unpairable bite.** A bite whose Bloodsucker or victim has an empty roster at the deadline ends
  as `CANCELLED` with `cancelledBy = NO_PAIR`, audited as `BITE_CANCELLED` by the system, and is
  listed once in `unpairableBiteIds`. It is not a failure and needs no action.
- **League busy.** A sweep that cannot get the League row within 20 seconds (round scoring holds it)
  skips that bite without failing; the next run takes it.
- **Waiting bites.** A `WAITING_LOCK` bite is normal while a round is in progress and runs at the first
  run after the round ends. Overdue or waiting bites:
  `SELECT id, "leagueId", status, "deadlineAt" FROM "LeagueBite" WHERE status IN ('OPEN','WAITING_LOCK') AND "deadlineAt" < now() - interval '15 minutes';`
  A row there with no round in progress means the sweep is failing or not running; an `OPEN` row may
  also be waiting on its matchup going FINAL again or on an older bite.

## Missing AFL match result

`netlify/functions/cron-afl-results.mts` calls `/api/cron/afl-results` hourly at :35 UTC. For every
AFL game in the Firestore fixture that started this calendar year (UTC) and whose scheduled end (start + 3
hours) was more than 6 hours ago, it looks for a current `AflMatchResult` row exactly as No Losers
scoring joins one: same season, round and two clubs in either order, read from each side's
`matchUid` (`src/server/etl/aflMatchJoinKey.ts`). Each game without one is logged as
`Missing AFL result: {home} v {away} ({match_uid}) …`, which reaches Sentry, and the run answers 500.
A stored current result in one of those rounds that no fixture game joins (so no player's stat row
either) is logged as `Unjoined AFL result: {matchUid} matches no fixture game …` and also answers 500:
its round waits on a result that is in fact stored, usually because Footywire's round label differs
from the fixture's. A missing result keeps alerting every hour until it is stored or the year ends
(owner decision 2026-11-15); Sentry groups the repeats for one game into one issue. The check writes nothing. It is not a Crons monitor
(billing), so a scheduler outage is silent; the waivers and scoring monitors cover the scheduler.

What to do:

1. Look at the ETL logs (Cloud Run `statly-etl`) for `AFL results ingest failed`. The usual causes are
   a Footywire or fitzRoy failure, `DATABASE_URL` unset, or a database outage. Every failure writes
   nothing; the ETL retries every 10 minutes while a stats window is open (6 hours after each start)
   and re-reads the whole season every 6 hours outside one, which also picks up a correction to an
   older game.
2. Re-run the ingest by hand from `etl/` with `DATABASE_URL` naming the fantasy database. For the
   season's last 18 matches: `npm run build && Rscript fetch_fw_results.R 2026 18 | node dist/processResultData.js`.
   Leave the count off to re-read the whole season (about 10 minutes, one page per match). Unchanged
   results are a no-op; a changed one (including a change back to an earlier score) supersedes the
   stored row, and the next hourly `/api/cron/scoring` run re-scores any No Losers round that used it.
   A failed re-score is logged as `Failed to re-score a No Losers round after an AFL result
correction` and the run answers 500. `FINAL_ROUND_RESULTS_UNJOINED` there means the corrected
   result no longer joins its game; the round keeps its FINAL scores until it does (see step 4). A
   round whose stats are unavailable is listed under `resultCorrections.pending` and retried each run.
   Once one has waited more than 12 hours after its correcting result arrived, it is `overdue`: the
   run answers 500 and logs it under `overdueResultCorrections` with the league, round and
   `correctedAt` (owner decision 2026-11-15). Find why the round cannot be recalculated (usually a
   lineup player whose stat row lost its identity link) and fix the data; the next run re-scores it.
3. A game abandoned without a result has no Footywire match page, so the ingest never records it.
   Record it from `etl/` with `DATABASE_URL` naming the fantasy database, clubs as the fixture names
   them, home first (no hand SQL):
   `npm run record-abandoned -- --season 2026 --round 5 --home Geelong --away Hawthorn`.
   Add `--match-id {id}` if Footywire has a match id for it; otherwise the row's id is
   `abandoned-{matchUid}`. It writes one `ABANDONED` row (no scores, no margin), supersedes a stored
   result of the same match id, and re-running it changes nothing.
4. For `Unjoined AFL result`, compare the result's `matchUid` with the fixture game's `match_uid` in
   Firestore `matches`. A different round number means Footywire and the fixture disagree on the
   round; fix the source that is wrong and re-run the ingest.

## Settings only the owner can make

- **`SENTRY_DSN`** must be set where each process runs: Netlify (web app and crons, already used by the
  web app) and, at go-live, the Socket.IO and worker hosts. Without it nothing is sent and nothing
  fails. `SENTRY_DISABLED=true` turns it off; `SENTRY_ENVIRONMENT` names the environment for the
  socket and worker processes (default `NODE_ENV`).
- **Alert routing:** Sentry opens an issue for a failed or missed cron run and for each new error. Make
  sure the project's issue alert rule emails (or otherwise notifies) the owner, including for Crons
  issues (Sentry → Alerts, and each monitor's notification settings under Crons).
- **Billing:** three cron monitors. Check the Sentry plan's included monitor quota.

## Privacy

The socket and worker processes use the same `privateSentryDataCollection` as the web app (#1158): no
user info, cookies, headers, bodies, query data, queue job arguments or local variables, and no
tracing. Job failures send only the queue, job name, job id, attempt count and the league, season and
draft ids, never the job data.
