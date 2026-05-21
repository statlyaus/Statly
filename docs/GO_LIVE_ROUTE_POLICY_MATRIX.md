# Go-Live Route Policy Matrix

Date: 2026-05-18

## Policy Legend

- `public`: reachable without auth and cannot mutate protected data.
- `authenticated-self`: authenticated user may read or mutate only their own user-scoped data.
- `league-member`: authenticated league member may read league-scoped data.
- `commissioner`: league owner/admin/commissioner may mutate league administration data.
- `draft-participant`: authenticated draft participant may mutate only permitted draft state.
- `admin-token`: operational admin token required through `ADMIN_API_TOKEN`.
- `cron-token`: scheduled-job token required through `CRON_SECRET`.
- `webhook-secret`: provider webhook verification required.
- `local-only`: returns 404 outside explicit local runtime.
- `retire`: remove or permanently redirect before launch.

## P0 Routes

| Route                        | Policy                                    | Status   | Evidence                                          |
| ---------------------------- | ----------------------------------------- | -------- | ------------------------------------------------- |
| `/api/admin/workers`         | `admin-token`                             | complete | `src/app/api/admin/workers/route.test.ts`         |
| `/api/admin/queue`           | `admin-token`                             | complete | `src/app/api/admin/queue/route.test.ts`           |
| `/api/auth/session`          | `public` with Firebase token verification | complete | `src/app/api/auth/session/route.test.ts`          |
| `/api/user/profile/[userId]` | `authenticated-self`                      | complete | `src/app/api/user/profile/[userId]/route.test.ts` |
| `/api/dev/test-user`         | `local-only`                              | complete | `src/app/api/local-only-routes.test.ts`           |
| `/api/add-test-data`         | `local-only`                              | complete | `src/app/api/local-only-routes.test.ts`           |
| `/api/create-test-draft`     | `local-only`                              | complete | `src/app/api/local-only-routes.test.ts`           |
| `/api/test-lobby`            | `local-only`                              | complete | `src/app/api/local-only-routes.test.ts`           |
| `/api/env-check`             | `local-only`                              | complete | `src/app/api/local-only-routes.test.ts`           |
| `/api/admin-check`           | `local-only`                              | complete | `src/app/api/local-only-routes.test.ts`           |
| `/api/drafts/[id]/debug`     | `local-only`                              | complete | `src/app/api/local-only-routes.test.ts`           |
| `/api/tradeReview`           | `local-only`                              | complete | `src/pages/api/tradeReview.test.ts`               |
| `/api/listTrades`            | `local-only`                              | complete | `src/pages/api/listTrades.test.ts`                |

## Expanded Launch-Critical Routes

| Route                                | Policy               | Status    | Evidence                                                                |
| ------------------------------------ | -------------------- | --------- | ----------------------------------------------------------------------- |
| `/api/cron/reminders`                | `cron-token`         | complete  | `src/app/api/cron/reminders/route.test.ts`                              |
| `/api/cron/live-stats`               | `cron-token`         | complete  | `src/app/api/cron/live-stats/route.test.ts`                             |
| `/api/cron/daily`                    | `cron-token`         | complete  | `src/app/api/cron/daily/route.test.ts`                                  |
| `/api/leagues`                       | `authenticated-self` | complete  | `src/app/api/leagues/route.test.ts`                                     |
| `/api/leagues/[id]/draft-settings`   | `commissioner`       | complete  | `src/app/api/leagues/[id]/draft-settings/route.test.ts`                 |
| `/api/leagues/[id]/roster/[userId]`  | `authenticated-self` | complete  | `src/app/api/leagues/[id]/roster/[userId]/route.test.ts`                |
| `/api/drafts/[id]/schedule`          | `commissioner`       | complete  | `src/app/api/drafts/[id]/schedule/route.test.ts`                        |
| `/api/inngest`                       | `webhook-secret`     | exception | `src/app/api/inngest/route.test.ts`; SDK signature validation relied on |
| `/api/leagues/[id]/waivers/*`        | `league-member`      | complete  | `src/app/api/leagues/[id]/waivers/*.test.ts`                            |
| `/api/drafts/[id]/start`             | `commissioner`       | complete  | `src/app/api/drafts/[id]/start/route.test.ts`                           |
| `/api/drafts/[id]/auto-pick`         | `cron-token`         | complete  | `src/app/api/drafts/[id]/auto-pick/route.test.ts`                       |
| `/api/drafts/[id]/queue`             | `draft-participant`  | complete  | `src/app/api/drafts/[id]/queue/route.test.ts`                           |
| `/api/drafts/[id]/pre-queue`         | `draft-participant`  | complete  | `src/app/api/drafts/[id]/pre-queue/route.test.ts`                       |
| `/api/drafts/[id]/watchlist`         | `draft-participant`  | complete  | `src/app/api/drafts/[id]/watchlist/route.test.ts`                       |
| `/api/leagues/join`                  | `authenticated-self` | complete  | `src/app/api/leagues/join/route.test.ts`                                |
| `/api/leagues/[id]/members`          | `league-member`      | complete  | `src/app/api/leagues/[id]/members/route.test.ts`                        |
| `/api/leagues/[id]/actions/[userId]` | `authenticated-self` | complete  | `src/app/api/leagues/[id]/actions/[userId]/route.test.ts`               |

## Rule

A P0 route may not move to launch-ready until `Status` is `complete` and `Evidence` names a passing test, guard, or documented launch exception.
