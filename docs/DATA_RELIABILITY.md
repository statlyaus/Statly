# Data reliability charter

Statly serves three different **speeds** of data. This document defines lanes, what Phase 1 implemented, Phase 2 in **staged slices** with **exit criteria**, and how alerting should treat non-production.

## Lanes (mental model)

| Lane                       | Purpose                                               | Typical stores / paths                                                                                                                        |
| -------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Player read models** | Season-long research, `/api/players`, rankings inputs | Prisma `Player`, `PlayerSeasonSummary`, `PlayerProjectionPublication`, ranking snapshots                                                      |
| **B — Live**               | Head-to-head while games run, AFL score context       | League matchup stream (`/api/leagues/.../matchup/stream`), ETL live feeds (e.g. `/api/etl/live-matches`), Firebase league overview where used |
| **C — Trades**             | Proposals, review, execution, audit                   | Prisma `Trade`, `TradeItem`, `TradeAudit`, `tradeService` transactions                                                                        |

**Principle:** batch summaries, live push/poll, and transactional writes stay **separate contracts**. Do not promise live latency for season aggregates or vice versa.

---

## Phase 1 (implemented)

### Player read model health signal

- **`getPlayerReadModelHealth()`** (`src/lib/playerReadModelHealth.ts`) uses the same **resolved season** logic as APIs (`resolveLatestProjectedSeason`) and reports:
  - `playerCount`
  - `resolvedSeason`
  - `seasonSummaryCount` (rows in `PlayerSeasonSummary` for that season)
  - `totalSummaryRows`, `latestSummaryUpdatedAt`, latest publication metadata (if any)
  - **`summaryGapDetected`**: true when players exist but there are zero summaries for the resolved season (fact, all environments).
  - **`evaluationMode`**: `strict` | `lenient` — see below.

### Strict vs lenient evaluation (noise control)

Evaluation order (first match wins):

1. **`HEALTH_LENIENT_READ_MODELS=true`** → always **lenient** (use on staging builds that run with `NODE_ENV=production` but should not page on missing summaries).
2. **`HEALTH_STRICT_READ_MODELS=true`** → **strict** (force prod-like checks in any environment).
3. Otherwise **`NODE_ENV === 'production'`** → **strict**; else **lenient**.

- **Degraded** overall for this sub-check only when `summaryGapDetected && evaluationMode === 'strict'`.
- In **lenient** mode the lane stays **healthy** so local/test environments without precompute do not page the on-call channel; the JSON still exposes `summaryGapDetected: true` for humans and for **environment-scoped** monitors if you want.

### Health API integration

- **`GET /api/health`** includes `services.playerReadModels` with status, timing, and `details` for dashboards / alerts.
- Overall health remains **200 + degraded** when any service (including this one in **strict** mode) is degraded.

### How to use it (alerting)

- **Production / strict staging:** alert when `data.services.playerReadModels.status === "degraded"` for longer than your chosen window **and** `details.evaluationMode === "strict"`.
- **Local / lenient dev:** rely on `details.summaryGapDetected === true` for dashboards or **non-paging** notifications; do **not** use overall `status === "degraded"` alone across all environments (avoids alert fatigue).

### SLO vocabulary (internal)

- Use **SLO** for engineering targets; use **SLA** only for user- or contract-facing promises backed by measurement.
- Phase 1 does **not** set numeric SLOs — it adds **observable signals** so you can measure baselines first.

### HTTP cache note (Phase 1)

- **`GET /api/players`** bypasses the in-memory **`middlewareConfigs.public`** response cache so the route’s **`Cache-Control`** (`s-maxage` / `stale-while-revalidate`) is what browsers and CDNs see, aligned with summary publication cadence.

---

## Phase 2 — staged plan

Work is split so **dependencies** are explicit: measure before you promise numbers.

### Phase 2a — Read models & pipelines (depends on Phase 1 signals)

| Step | Work                                                                                                                                                       | Exit criteria                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 2a.1 | Document the **single command** (or script entry) that publishes season **S** (precompute + publication if applicable).                                    | Runbook section exists; a new engineer can refresh summaries in staging in under 15 minutes following the doc alone.             |
| 2a.2 | Emit **job metrics** after each precompute run: duration, exit code, rows upserted into `PlayerSeasonSummary`, publication counts / `publishedAt`.         | Metrics visible in logs or existing observability sink; failed runs emit **structured** error with `season` and job id.          |
| 2a.3 | Define **coverage SLO** (example: ≥ 95% of `Player.id` have a `PlayerSeasonSummary` row for published season **S**) using **measured** baseline from 2a.2. | SLO number recorded in this doc or an ADR; alert fires only when measured coverage drops below SLO for **N** consecutive checks. |

**Lane A — suggested SLIs (names only; thresholds TBD after baseline)**

1. `player_season_summary_rows{season}` — gauge from DB or job output.
2. `precompute_job_duration_seconds` — histogram.
3. `precompute_job_last_success_timestamp` — gauge / log-derived.
4. `player_read_model_summary_gap` — boolean (same fact as health `details.summaryGapDetected`; **strict vs lenient** only changes whether overall status is `degraded`).
5. `published_season` — label from `PlayerProjectionPublication` when present.

---

### Phase 2b — Live lane (depends on choosing **where** synthetics run)

| Step | Work                                                                                                                                                                            | Exit criteria                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 2b.1 | **Split ownership**: matchup stream vs external AFL feed (different runbooks).                                                                                                  | On-call doc lists two contacts or two sections.                                                   |
| 2b.2 | Add **synthetic probe** (CI or external monitor — pick one in 2b.1): (a) open matchup stream, receive first event or timeout; (b) `GET /api/etl/live-matches` 200 + JSON shape. | Probe runs on a schedule; failing probe creates a **non-SLA** ticket template (best-effort live). |
| 2b.3 | **User-facing copy** in product help: live scoring is best-effort unless you later commit to measured availability.                                                             | Copy reviewed; linked from live UI or help center.                                                |

**Lane B — suggested SLIs (names only)**

1. `matchup_stream_open_success` — counter (success/fail).
2. `matchup_stream_seconds_to_first_event` — histogram.
3. `live_matches_request_duration_seconds` — histogram.
4. `live_matches_http_5xx_total` — counter.
5. `live_matches_payload_staleness_seconds` — gauge (only if you define “fresh” from feed semantics).

---

### Phase 2c — Trades lane (split **API reliability** vs **data integrity**)

| Step | Work                                                                                                                                                                                                                      | Exit criteria                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 2c.1 | **API SRE:** dashboard **trade POST** success (treat 4xx validation separately from 5xx), latency p95, 5xx rate — wire to whatever you standardize on (`metricsCollector` Redis keys today; Prometheus later if adopted). | Dashboard exists; on-call can answer “are trades failing?” in one click.                                       |
| 2c.2 | **Data integrity:** schedule **invariants** agreed with backend (examples only — define precisely before implementing): trades in `PROPOSED` with zero `TradeItem`; `TradeItem` referencing missing `Trade`.              | One scheduled job or migration check; alert → runbook with **no** production data mutation without human step. |
| 2c.3 | Runbook links from alerts to **rollback / manual fix** steps (different doc for API vs integrity).                                                                                                                        | Every alert from 2c.1–2c.2 has a URL in the alert payload.                                                     |

**Lane C — suggested SLIs (names only)**

1. `trade_post_requests_total` by `status_class` (2xx / 4xx / 5xx).
2. `trade_post_duration_seconds` — histogram.
3. `trade_post_5xx_total` — counter.
4. `trade_integrity_violation_total{check=name}` — counter from scheduled invariant job.
5. `trade_idempotent_replay_total` — counter (reuse / conflict — optional, if you expose it).

---

### Cross-cutting (after 2a.2 has signal volume)

| Step | Work                                                                                                                                                                                                     | Exit criteria                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| X.1  | **Error budgets** per lane per calendar month, tied to **existing** signals first: `metricsCollector` totals / error rate for HTTP, health `playerReadModels` for summaries, Phase 2b/2c SLIs once live. | One-page internal doc: budget %, window, **what we stop shipping** when exhausted (e.g. no new live features until stream SLI recovers). |
| X.2  | Revisit **optional** `GET /api/health?deep=1` **only if** p95 latency or CPU of full GET exceeds agreed threshold for your probe interval — measure first.                                               | Threshold recorded; if not exceeded, defer.                                                                                              |

---

## Error budgets and today’s metrics (explicit)

Until Prometheus (or similar) is standard, **error budgets** for Phase 2 should be computed from:

- **`metricsCollector`** (`src/lib/metrics.ts`): `totalRequests`, `totalErrors`, `errorRate`, `averageResponseTime` (Redis-backed when connected).
- **`GET /api/health`**: lane-specific degradation flags.
- **Phase 2 job / lane SLIs** once emitted.

Do **not** treat “error budget” as a user SLA until those numbers have **30+ days** of baseline in production.

---

## Ownership (fill names)

| Lane | Primary owner | Backup |
| ---- | ------------- | ------ |
| A    | _TBD_         | _TBD_  |
| B    | _TBD_         | _TBD_  |
| C    | _TBD_         | _TBD_  |

Update this table when roles are assigned.
