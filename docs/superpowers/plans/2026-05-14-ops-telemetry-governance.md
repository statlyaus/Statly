# Ops Telemetry Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land dependency governance and web-vitals telemetry changes as an isolated operations PR.

**Architecture:** Keep dependency sweep reporting as repo tooling and ClickHouse/web-vitals persistence as telemetry infrastructure. Do not mix telemetry changes with canonical data import, read-model API behavior, or UI migration.

**Tech Stack:** Node scripts, GitHub Actions, Vitest, ClickHouse client, TypeScript services.

---

## Scope

This PR owns:

- `.github/dependabot.yml`
- `.github/workflows/dependency-sweep.yml`
- `Scripts/dependency-sweep.mjs`
- `tests/dependency-sweep.test.ts`
- `docs/dependency-maintenance.md`
- `clickhouse/schema/web_vitals.sql`
- `src/services/webVitalsPersistence.ts`
- `src/services/webVitalsMetricsConfig.ts`
- `src/services/webVitalsMetricsConfig.test.ts`

## Task 1: Dependency Governance Workflow

- [ ] **Step 1: Verify dependency sweep tests**

Run:

```bash
npx vitest run tests/dependency-sweep.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 2: Verify fixture output**

Run:

```bash
npm run deps:report:fixtures
```

Expected output contains:

```text
# Dependency Sweep Report
| root | openai | 5.20.2 | 5.21.0 | review |
```

- [ ] **Step 3: Add workflow docs**

Update `docs/dependency-maintenance.md` to describe safe, review, and hold lanes and how to read the report.

## Task 2: Web Vitals ClickHouse Config

- [ ] **Step 1: Add metrics config tests**

`src/services/webVitalsMetricsConfig.test.ts` must verify default batch size and ClickHouse session settings.

- [ ] **Step 2: Implement config helper**

`src/services/webVitalsMetricsConfig.ts` must export:

```ts
export function defaultMetricsBatchSize(): number;
export function buildClickHouseSessionSettings(timezone: string): Record<string, string>;
```

- [ ] **Step 3: Wire persistence service**

`src/services/webVitalsPersistence.ts` must use the config helper and preserve Firestore fallback behavior.

## Final Verification

Run:

```bash
npx vitest run tests/dependency-sweep.test.ts src/services/webVitalsMetricsConfig.test.ts
npm run typecheck
git diff --check
```

Expected: all pass in the isolated ops branch.

## Self-Review

- Scope is ops/telemetry only.
- No UI, ETL, or Prisma migration changes are included.
- Commands are exact and verifiable.
