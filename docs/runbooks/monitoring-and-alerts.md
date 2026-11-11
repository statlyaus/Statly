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

| Monitor slug         | Netlify function → route                                 | Schedule (UTC) | Margin | Max runtime | Issue after |
| -------------------- | -------------------------------------------------------- | -------------- | ------ | ----------- | ----------- |
| `cron-waivers`       | `cron-waivers.mts` → `/api/cron/waivers`                 | `0 * * * *`    | 10 min | 10 min      | 1 failure   |
| `cron-scoring`       | `cron-scoring.mts` → `/api/cron/scoring`                 | `0 * * * *`    | 10 min | 10 min      | 1 failure   |
| `cron-nba-boxscores` | `cron-nba-boxscores.mts` → `/api/cron/nba?job=boxscores` | `7,37 * * * *` | 10 min | 10 min      | 2 failures  |

An issue resolves after one good run. The waivers route runs hourly and processes waivers only in the
6 am Melbourne hour; every hourly run still checks in, so the monitor also proves the scheduler is alive.
The other crons (daily, injuries, trades, the other NBA jobs) are not monitored: each monitor past
the plan's included quota is billed. To monitor one, add it to `CRON_MONITORS` and wrap its route in
`monitorCronRun`; a unit test keeps each monitor's schedule equal to its Netlify function's.

## Missing AFL match result

`netlify/functions/cron-afl-results.mts` calls `/api/cron/afl-results` hourly at :35 UTC. For every
AFL game in the Firestore fixture that started in the last 14 days and whose scheduled end (start + 3
hours) was more than 6 hours ago, it looks for a current `AflMatchResult` row (same season, round and
two clubs). Each game without one is logged as `Missing AFL result: {home} v {away} ({match_uid}) …`,
which reaches Sentry, and the run answers 500. The check writes nothing. It is not a Crons monitor
(billing), so a scheduler outage is silent; the waivers and scoring monitors cover the scheduler.

What to do:

1. Look at the ETL logs (Cloud Run `statly-etl`) for `AFL results ingest failed`. The usual causes are
   a Footywire or fitzRoy failure, `DATABASE_URL` unset, or a database outage. Every failure writes
   nothing; the ETL retries every 10 minutes while a stats window is open (6 hours after each start).
2. Re-run the ingest by hand from `etl/` with `DATABASE_URL` naming the fantasy database. For the
   season's last 18 matches: `npm run build && Rscript fetch_fw_results.R 2026 18 | node dist/processResultData.js`.
   Leave the count off to re-read the whole season (about 10 minutes, one page per match). Unchanged
   results are a no-op; a changed one supersedes the stored row.
3. `reverted to a superseded result` means Footywire changed a score back to an earlier version. The
   ingest refuses it; read the match's rows (`WHERE "matchId" = …` ordered by `createdAt`), confirm
   the official score, then decide by hand.
4. A game that was abandoned has no Footywire match page, so the ingest never records it. Insert its
   `ABANDONED` row by hand (no scores, no margin; the table's CHECK constraint enforces this) with
   the Footywire match id if there is one, or `abandoned-{match_uid}` if not.

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
