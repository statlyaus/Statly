# Dependency Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable dependency-governance workflow that keeps the root app, `etl`, and `functions` packages current with minimal-risk upgrades and explicit review gates for breaking changes.

**Architecture:** Add one repo-owned dependency sweep script that reads all three `package.json` files and classifies candidate upgrades by risk, then wire GitHub Dependabot to propose tightly grouped update PRs on a schedule. Back the automation with a scheduled GitHub workflow and documentation so update discovery, review policy, and verification remain consistent instead of depending on ad hoc terminal checks.

**Tech Stack:** Node.js (`.mjs` script in repo root), Vitest, GitHub Actions, Dependabot, npm worktrees already present in the repository

---

## File Structure

- Modify: `package.json`
  - Add stable scripts for repo-wide dependency reporting and CI verification.
- Create: `scripts/dependency-sweep.mjs`
  - Read root, `etl`, and `functions` manifests; summarize current versions; optionally run `npm outdated --json`; classify upgrades into `safe`, `review`, and `hold`.
- Create: `tests/dependency-sweep.test.ts`
  - Lock the report format and risk classification behavior with deterministic fixtures.
- Create: `.github/dependabot.yml`
  - Schedule package update PRs for all three npm ecosystems with conservative grouping and branch-label policy.
- Create: `.github/workflows/dependency-sweep.yml`
  - Run the repo script on a schedule and on demand; upload the report artifact and fail if the script regresses.
- Create: `docs/dependency-maintenance.md`
  - Document the operating model, review thresholds, verification commands, and migration expectations for risky upgrades.

### Task 1: Add a deterministic dependency sweep test harness

**Files:**
- Create: `tests/dependency-sweep.test.ts`
- Test: `tests/dependency-sweep.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  buildDependencyRows,
  classifyDependencyUpgrade,
  formatDependencyReport,
} from '../scripts/dependency-sweep.mjs';

describe('classifyDependencyUpgrade', () => {
  it('marks exact-version patch bumps as safe', () => {
    expect(
      classifyDependencyUpgrade({
        name: 'firebase-admin',
        current: '13.6.0',
        latest: '13.8.0',
        workspace: 'root',
      })
    ).toEqual({
      lane: 'safe',
      reason: 'same major version; patch/minor candidate',
    });
  });

  it('marks major upgrades as hold', () => {
    expect(
      classifyDependencyUpgrade({
        name: 'next',
        current: '15.5.3',
        latest: '16.0.0',
        workspace: 'root',
      })
    ).toEqual({
      lane: 'hold',
      reason: 'major version change requires dedicated migration review',
    });
  });
});

describe('buildDependencyRows', () => {
  it('reads matching packages across root, etl, and functions', () => {
    const rows = buildDependencyRows([
      {
        workspace: 'root',
        manifestPath: 'package.json',
        dependencies: {
          'firebase-admin': '13.6.0',
          dotenv: '^17.2.2',
        },
      },
      {
        workspace: 'etl',
        manifestPath: 'etl/package.json',
        dependencies: {
          'firebase-admin': '13.8.0',
          dotenv: '^17.4.1',
        },
      },
      {
        workspace: 'functions',
        manifestPath: 'functions/package.json',
        dependencies: {
          'firebase-admin': '13.8.0',
        },
      },
    ]);

    expect(rows).toEqual([
      {
        name: 'dotenv',
        workspaces: {
          etl: '^17.4.1',
          root: '^17.2.2',
        },
      },
      {
        name: 'firebase-admin',
        workspaces: {
          etl: '13.8.0',
          functions: '13.8.0',
          root: '13.6.0',
        },
      },
    ]);
  });
});

describe('formatDependencyReport', () => {
  it('prints a stable markdown summary', () => {
    expect(
      formatDependencyReport({
        generatedAt: '2026-04-29T12:06:50Z',
        packageRows: [
          {
            name: 'firebase-admin',
            workspaces: {
              root: '13.6.0',
              etl: '13.8.0',
              functions: '13.8.0',
            },
          },
        ],
        upgradeCandidates: [
          {
            name: 'firebase-admin',
            workspace: 'root',
            current: '13.6.0',
            latest: '13.8.0',
            lane: 'safe',
            reason: 'same major version; patch/minor candidate',
          },
        ],
      })
    ).toContain('| firebase-admin | 13.6.0 | 13.8.0 | 13.8.0 |');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dependency-sweep.test.ts`
Expected: FAIL with `Cannot find module '../scripts/dependency-sweep.mjs'` or missing export errors.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/dependency-sweep.mjs
export function normalizeVersion(version) {
  return String(version).replace(/^[^0-9]*/, '');
}

export function classifyDependencyUpgrade(candidate) {
  const currentMajor = Number(normalizeVersion(candidate.current).split('.')[0] ?? '0');
  const latestMajor = Number(normalizeVersion(candidate.latest).split('.')[0] ?? '0');

  if (latestMajor > currentMajor) {
    return {
      lane: 'hold',
      reason: 'major version change requires dedicated migration review',
    };
  }

  return {
    lane: 'safe',
    reason: 'same major version; patch/minor candidate',
  };
}

export function buildDependencyRows(manifests) {
  const rows = new Map();

  for (const manifest of manifests) {
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      const existing = rows.get(name) ?? { name, workspaces: {} };
      existing.workspaces[manifest.workspace] = version;
      rows.set(name, existing);
    }
  }

  return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function formatDependencyReport(report) {
  const lines = [
    `# Dependency Sweep Report`,
    ``,
    `Generated: ${report.generatedAt}`,
    ``,
    `| Package | Root | ETL | Functions |`,
    `| --- | --- | --- | --- |`,
    ...report.packageRows.map((row) => {
      return `| ${row.name} | ${row.workspaces.root ?? '-'} | ${row.workspaces.etl ?? '-'} | ${row.workspaces.functions ?? '-'} |`;
    }),
    ``,
    `## Upgrade Candidates`,
    ``,
    `| Workspace | Package | Current | Latest | Lane | Reason |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...report.upgradeCandidates.map((candidate) => {
      return `| ${candidate.workspace} | ${candidate.name} | ${candidate.current} | ${candidate.latest} | ${candidate.lane} | ${candidate.reason} |`;
    }),
  ];

  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dependency-sweep.test.ts`
Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add tests/dependency-sweep.test.ts scripts/dependency-sweep.mjs
git commit -m "test: add dependency sweep coverage"
```

### Task 2: Turn the script into a repo-owned CLI for all three package manifests

**Files:**
- Modify: `scripts/dependency-sweep.mjs`
- Modify: `package.json`
- Test: `tests/dependency-sweep.test.ts`

- [ ] **Step 1: Write the failing CLI test**

```ts
it('prints repo report rows for all workspace manifests', async () => {
  const { spawnSync } = await import('node:child_process');

  const result = spawnSync(process.execPath, ['scripts/dependency-sweep.mjs', '--fixtures'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('# Dependency Sweep Report');
  expect(result.stdout).toContain('| firebase-admin |');
  expect(result.stdout).toContain('## Upgrade Candidates');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dependency-sweep.test.ts -t "prints repo report rows for all workspace manifests"`
Expected: FAIL because the script does not provide a CLI entry point or fixture mode.

- [ ] **Step 3: Extend the script and package scripts**

```js
// scripts/dependency-sweep.mjs
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const WORKSPACES = [
  { workspace: 'root', manifestPath: 'package.json' },
  { workspace: 'etl', manifestPath: 'etl/package.json' },
  { workspace: 'functions', manifestPath: 'functions/package.json' },
];

export function readManifest({ workspace, manifestPath }) {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), manifestPath), 'utf8'));

  return {
    workspace,
    manifestPath,
    dependencies: {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    },
  };
}

export function buildFixtureManifests() {
  return [
    {
      workspace: 'root',
      manifestPath: 'package.json',
      dependencies: { 'firebase-admin': '13.6.0', dotenv: '^17.2.2' },
    },
    {
      workspace: 'etl',
      manifestPath: 'etl/package.json',
      dependencies: { 'firebase-admin': '13.8.0', dotenv: '^17.4.1' },
    },
    {
      workspace: 'functions',
      manifestPath: 'functions/package.json',
      dependencies: { 'firebase-admin': '13.8.0', 'firebase-functions': '6.6.0' },
    },
  ];
}

export async function main(argv = process.argv.slice(2)) {
  const useFixtures = argv.includes('--fixtures');
  const manifests = useFixtures ? buildFixtureManifests() : WORKSPACES.map(readManifest);
  const report = formatDependencyReport({
    generatedAt: new Date().toISOString(),
    packageRows: buildDependencyRows(manifests),
    upgradeCandidates: [],
  });

  process.stdout.write(report);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

```json
{
  "scripts": {
    "deps:report": "node scripts/dependency-sweep.mjs",
    "deps:report:fixtures": "node scripts/dependency-sweep.mjs --fixtures"
  }
}
```

- [ ] **Step 4: Run tests and the CLI**

Run: `npx vitest run tests/dependency-sweep.test.ts`
Expected: PASS

Run: `npm run deps:report:fixtures`
Expected: stdout starts with `# Dependency Sweep Report`

- [ ] **Step 5: Commit**

```bash
git add scripts/dependency-sweep.mjs package.json tests/dependency-sweep.test.ts
git commit -m "feat: add repo dependency report cli"
```

### Task 3: Add conservative update policy with Dependabot

**Files:**
- Create: `.github/dependabot.yml`
- Test: `.github/dependabot.yml`

- [ ] **Step 1: Write the failing policy expectation in the plan notes**

```yaml
# Expected policy requirements:
# - scan root, /etl, and /functions weekly
# - group patch/minor updates by ecosystem
# - keep major updates isolated
# - label dependency PRs for triage
# - cap open PR count to avoid churn
```

- [ ] **Step 2: Validate the repo currently lacks the policy**

Run: `test -f .github/dependabot.yml`
Expected: exit code `1`

- [ ] **Step 3: Create the policy**

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "04:00"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "codex"
    groups:
      root-safe-minors:
        update-types:
          - "minor"
          - "patch"
    ignore:
      - dependency-name: "next"
        update-types: ["version-update:semver-major"]
      - dependency-name: "react"
        update-types: ["version-update:semver-major"]
      - dependency-name: "react-dom"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "npm"
    directory: "/etl"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "04:15"
    open-pull-requests-limit: 3
    labels:
      - "dependencies"
      - "codex"
    groups:
      etl-safe-minors:
        update-types:
          - "minor"
          - "patch"

  - package-ecosystem: "npm"
    directory: "/functions"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "04:30"
    open-pull-requests-limit: 3
    labels:
      - "dependencies"
      - "codex"
    groups:
      functions-safe-minors:
        update-types:
          - "minor"
          - "patch"
    ignore:
      - dependency-name: "firebase-functions"
        update-types: ["version-update:semver-major"]
```

- [ ] **Step 4: Verify YAML shape**

Run: `ruby -e "require 'yaml'; YAML.load_file('.github/dependabot.yml'); puts 'ok'"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add .github/dependabot.yml
git commit -m "chore: add dependency update policy"
```

### Task 4: Add scheduled dependency reporting in GitHub Actions

**Files:**
- Create: `.github/workflows/dependency-sweep.yml`
- Modify: `package.json`
- Test: `.github/workflows/dependency-sweep.yml`

- [ ] **Step 1: Write the failing workflow expectation**

```yaml
# Expected behavior:
# - runs weekly and on workflow_dispatch
# - installs root dependencies
# - runs npm run deps:report
# - uploads a markdown artifact
```

- [ ] **Step 2: Confirm the workflow is absent**

Run: `test -f .github/workflows/dependency-sweep.yml`
Expected: exit code `1`

- [ ] **Step 3: Create the workflow and report output mode**

```json
{
  "scripts": {
    "deps:report:file": "node scripts/dependency-sweep.mjs > dependency-sweep-report.md"
  }
}
```

```yaml
name: Dependency Sweep

on:
  workflow_dispatch:
  schedule:
    - cron: "0 18 * * 0"

permissions:
  contents: read

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install root dependencies
        run: npm ci

      - name: Generate dependency report
        run: npm run deps:report:file

      - name: Upload report artifact
        uses: actions/upload-artifact@v4
        with:
          name: dependency-sweep-report
          path: dependency-sweep-report.md
          if-no-files-found: error
```

- [ ] **Step 4: Verify syntax locally**

Run: `sed -n '1,220p' .github/workflows/dependency-sweep.yml`
Expected: workflow includes `workflow_dispatch`, `schedule`, `npm ci`, and `upload-artifact`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/dependency-sweep.yml package.json
git commit -m "ci: add scheduled dependency sweep"
```

### Task 5: Document the long-term dependency update operating model

**Files:**
- Create: `docs/dependency-maintenance.md`
- Test: `docs/dependency-maintenance.md`

- [ ] **Step 1: Draft the required sections**

```md
# Dependency Maintenance

## Scope
- root app
- `etl`
- `functions`

## Safe upgrade lane
- same-major patch/minor updates
- internal skew alignment between manifests

## Review-required lane
- framework upgrades (`next`, `react`, `react-dom`)
- SDK upgrades with migration guides (`openai`, `inngest`, `firebase-functions`)
- Node runtime and typing realignment

## Verification
- `npm run deps:report`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- service-specific follow-up when `etl` or `functions` deps change
```

- [ ] **Step 2: Validate the doc is absent**

Run: `test -f docs/dependency-maintenance.md`
Expected: exit code `1`

- [ ] **Step 3: Write the full document**

```md
# Dependency Maintenance

## Purpose

This repository has three npm package boundaries:

- `package.json` for the Next.js application and shared tooling
- `etl/package.json` for the Footywire ETL runtime
- `functions/package.json` for Firebase Functions

The long-term rule is simple: small same-major upgrades should be automated and reviewable, while framework, runtime, and major-version changes require a dedicated migration task.

## Weekly flow

1. Dependabot opens grouped patch/minor PRs for each package boundary.
2. GitHub Actions runs the normal CI workflow plus the scheduled dependency report.
3. Reviewers compare the generated markdown report against the PR scope.
4. Major-version upgrades stay isolated and are converted into explicit implementation plans before merge.

## Safe lane

Use the safe lane when all of the following are true:

- the candidate is a patch or minor release in the same major line
- the change does not modify the project Node runtime
- the package is not one of the framework or infra holdouts listed below
- the update reduces version skew already visible across root, `etl`, and `functions`

Examples:

- align `firebase-admin` across all manifests
- align `dotenv` across root and `etl`

## Review lane

Always require a dedicated review and migration note for:

- `next`
- `react`
- `react-dom`
- `openai`
- `inngest`
- `firebase-functions`
- `typescript` when compiler diagnostics materially change
- `@types/node` when runtime targets differ between packages

## Verification commands

Run the smallest relevant set after each dependency PR:

```bash
npm run deps:report
npm run typecheck
npm run lint
npm test
```

When the update touches ETL or Firebase Functions, also run:

```bash
(cd etl && npm run build)
(cd functions && npm run build)
```

If a package has no meaningful automated test command, call that out in the PR summary and rely on the nearest existing validation command instead of inventing one.
```

- [ ] **Step 4: Verify the doc reads cleanly**

Run: `sed -n '1,240p' docs/dependency-maintenance.md`
Expected: document includes `Safe lane`, `Review lane`, and `Verification commands`

- [ ] **Step 5: Commit**

```bash
git add docs/dependency-maintenance.md
git commit -m "docs: add dependency maintenance guide"
```

### Task 6: Tighten the sweep script so it flags risky packages explicitly

**Files:**
- Modify: `scripts/dependency-sweep.mjs`
- Modify: `tests/dependency-sweep.test.ts`
- Test: `tests/dependency-sweep.test.ts`

- [ ] **Step 1: Write the failing risk-policy test**

```ts
it('routes framework and infra packages to review even within the same major', () => {
  expect(
    classifyDependencyUpgrade({
      name: 'openai',
      current: '5.20.2',
      latest: '5.21.0',
      workspace: 'root',
    })
  ).toEqual({
    lane: 'review',
    reason: 'package is pinned to explicit migration review policy',
  });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run tests/dependency-sweep.test.ts -t "routes framework and infra packages to review even within the same major"`
Expected: FAIL because the classifier currently marks all same-major upgrades as `safe`.

- [ ] **Step 3: Add repo-specific review policy**

```js
const REVIEW_PACKAGES = new Set([
  'firebase-functions',
  'inngest',
  'next',
  'openai',
  'react',
  'react-dom',
]);

export function classifyDependencyUpgrade(candidate) {
  if (REVIEW_PACKAGES.has(candidate.name)) {
    return {
      lane: 'review',
      reason: 'package is pinned to explicit migration review policy',
    };
  }

  const currentMajor = Number(normalizeVersion(candidate.current).split('.')[0] ?? '0');
  const latestMajor = Number(normalizeVersion(candidate.latest).split('.')[0] ?? '0');

  if (latestMajor > currentMajor) {
    return {
      lane: 'hold',
      reason: 'major version change requires dedicated migration review',
    };
  }

  return {
    lane: 'safe',
    reason: 'same major version; patch/minor candidate',
  };
}
```

- [ ] **Step 4: Run the test suite**

Run: `npx vitest run tests/dependency-sweep.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/dependency-sweep.mjs tests/dependency-sweep.test.ts
git commit -m "feat: codify dependency risk policy"
```

## Risks and migration notes

- `npm outdated` depends on registry access. The script should treat registry failures as reportable warnings, not silent success.
- `etl` and `functions` are separate npm projects. Do not assume a root `npm ci` validates their lockfiles or runtime compatibility.
- `@types/node` is intentionally skewed today (`24.x` in root vs `20.x` in `etl` and `functions`). Treat runtime alignment as a separate migration task, not part of a minimal dependency sweep.
- Dependabot can create noisy PRs if grouping is too broad. Keep same-major grouping per package boundary and leave majors isolated.

## Verification sequence after implementation

1. `npx vitest run tests/dependency-sweep.test.ts`
2. `npm run deps:report:fixtures`
3. `npm run deps:report`
4. `ruby -e "require 'yaml'; YAML.load_file('.github/dependabot.yml'); puts 'ok'"`
5. `npm run typecheck`
6. `npm run lint`
7. `npm test`

## Self-review

- Spec coverage: The plan covers automated discovery, repo-owned reporting, safe-vs-risk policy, scheduled execution, and maintainer documentation.
- Placeholder scan: No `TODO`, `TBD`, or “write tests later” placeholders remain.
- Type consistency: Script exports, script names, and workflow commands use the same identifiers throughout the plan.

Plan complete and saved to `docs/superpowers/plans/2026-04-29-dependency-governance-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
