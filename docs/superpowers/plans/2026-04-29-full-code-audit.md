# Full Code Audit Implementation Plan

> Superseded on 2026-04-29 by `docs/superpowers/plans/2026-04-29-native-full-code-audit.md`.
> This file records the earlier tool-driven audit direction. The active audit plan uses native Codex review with parallel subagents as the primary review mechanism; CodeRabbit and `codex-code-review` are secondary or blocked context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a durable, evidence-backed audit of Statly that identifies the changes needed to move the codebase toward the best long-term architecture, especially single-contract Footywire convergence, safe mutation paths, reliable projections, accessible UI, and maintainable verification.

**Architecture:** Superseded. The active architecture is documented in `2026-04-29-native-full-code-audit.md`: native Codex review with parallel subagents is primary, local checks provide deterministic proof, and CodeRabbit / `codex-code-review` are secondary or blocked context.

**Tech Stack:** Next.js 15, React 19, TypeScript, Firebase/Firestore, Prisma, Vitest, ESLint, Prettier, CodeRabbit CLI, npm scripts, Firestore emulator where available.

---

## Current Plan Assessment

The previous plan had the right broad goal but was too tool-driven. It listed checks to run, but it did not force enough judgment about whether the codebase is converging on the correct long-term design.

Shortcomings corrected by this rewrite:

- CodeRabbit was treated as the primary audit; this intermediate plan moved toward another tool-driven gate, but the active native plan supersedes it with parallel Codex subagents as primary.
- Audit phases were not cleanly separated into tooling unblock, evidence gathering, architectural review, and remediation decisions.
- Commit steps were embedded in the audit workflow, which is unsafe in the current dirty worktree and unnecessary for audit quality.
- Footywire contract convergence was present but not strict enough about proving that raw canonical documents are the only persisted semantic contract.
- Findings did not require enough long-term remediation detail: invariant, affected paths, best fix direction, migration risk, verification, and regression risk.
- UI and shadcn review focused mostly on token searches instead of accessible, predictable interaction behavior.
- The plan did not clearly distinguish temporary mitigation from durable architectural repair.

## Audit Principles

- Audit before fixing. Do not edit production code while executing this plan unless a separate remediation task is approved.
- Prefer long-term convergence over small patches that preserve duplicated semantics or drift.
- Every finding must cite evidence: file path, command output, failing test, code path, or documented invariant.
- Every recommended fix must name the durable target state and explain why it is better than a narrower patch.
- Do not claim `codex-code-review` or CodeRabbit findings unless the relevant tool completes successfully.
- Do not commit audit artifacts unless the user explicitly approves committing.
- Do not remove or rewrite user work while preparing the audit.

## Files and Artifacts

- Create: `docs/audits/2026-04-29-full-code-audit.md`
  - Final audit report, ranked findings, release recommendation, remediation roadmap.
- Create: `docs/audits/2026-04-29-full-code-audit-evidence.md`
  - Command log summary, review notes, blocked checks, raw CodeRabbit status, and verification evidence.
- Read: `AGENTS.md`
  - Repository operating contract and Footywire architectural north star.
- Read: `.coderabbit.yaml`
  - CodeRabbit configuration.
- Read: `CLAUDE.md`
  - Additional repository guidance if present.
- Read: `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`
- Read: `docs/DATA_RELIABILITY.md`
- Read: `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- Read: `docs/runtime-contract.md`
- Read: `package.json`
- Read: high-risk implementation files:
  - `etl/processFootywireData.ts`
  - `src/lib/stats/footywireCanonicalContract.ts`
  - `src/lib/footywireStatsIngestion.ts`
  - `src/server/readModels/playerReadModels.ts`
  - `src/app/api/etl/import-rounds/route.ts`
  - `src/lib/serverAuth.ts`
  - `src/lib/firebaseAdmin.ts`
  - `Scripts/build-player-read-models.ts`
  - `Scripts/verify-player-read-models.ts`
  - `Scripts/verify-match-logs.ts`

## Finding Format

Use this format for every audit finding:

```markdown
### P0/P1/P2/P3: Short finding title

- Severity: Critical/Major/Minor
- Area: Footywire contract / projection / security / operations / UI / test coverage / maintainability
- Evidence: exact file path, command, test, or code path
- Invariant at risk: exact architectural, security, or UI rule
- Impact: concrete user, data, operational, or maintenance failure mode
- Best long-term fix: durable target-state change, not a short-term workaround
- Migration or rollout risk: expected risk and how to bound it
- Verification required: exact command or manual proof needed after remediation
- Status: Open / Blocked / Accepted risk / Fixed in later task
```

Severity rubric:

- `P0`: data corruption, auth bypass, secret exposure, production outage, or active Footywire projection drift that makes app-facing data wrong.
- `P1`: high-risk architectural drift, stale projection risk, missing rebuild/rematerialization after import, unsafe operational default, or accessibility blocker.
- `P2`: meaningful maintainability, test coverage, UI consistency, observability, or migration risk.
- `P3`: low-risk cleanup that should not distract from convergence work.

## Task 1: Establish Audit Scope and Baseline

**Files:**
- Create: `docs/audits/2026-04-29-full-code-audit.md`
- Create: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Capture repository state**

Run:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
git diff --stat
git log --oneline -5
```

Expected: commands complete and show the active branch, recent commits, and current dirty worktree.

- [ ] **Step 2: Record audit scope**

Create `docs/audits/2026-04-29-full-code-audit.md` with:

```markdown
# Full Code Audit - 2026-04-29

## Scope

- Repository: `/Users/robert/Developer/Statly`
- Branch:
- Base branch: `main`
- Worktree state:
- Audit objective: identify the highest-value long-term fixes needed for correctness, reliability, security, accessibility, and maintainability.
- Out of scope: applying fixes during the audit unless separately approved.

## Executive Summary

- Overall risk:
- Release recommendation:
- Highest-priority architectural risk:
- Highest-priority operational risk:
- Highest-priority UI/accessibility risk:

## Findings

## CodeRabbit Result

## Local Verification Result

## Footywire Contract and Projection Review

## Security and Operational Review

## UI and Accessibility Review

## Test Coverage Review

## Long-Term Remediation Roadmap

## Blocked Checks
```

- [ ] **Step 3: Record evidence ledger**

Create `docs/audits/2026-04-29-full-code-audit-evidence.md` with:

```markdown
# Full Code Audit Evidence - 2026-04-29

## Repository Baseline

## CodeRabbit Attempts

## Static Checks

## Test Runs

## Guard Runs

## Footywire Contract Review Notes

## Security and Operations Review Notes

## UI and Accessibility Review Notes

## Blockers and Assumptions
```

- [ ] **Step 4: Define the audit decision standard**

Add this to the final audit report:

```markdown
## Decision Standard

A recommendation is accepted only if it moves Statly toward a durable target state:

- one canonical persisted raw-match contract for Footywire-derived player-match data
- no permanent downstream semantic fallbacks when canonical data exists
- explicit missing, zero, absent, provenance, source priority, match identity, and player identity semantics
- successful imports paired with bounded rebuild or rematerialization for affected projections
- mutation routes with explicit authorization and observable operational behavior
- shadcn-style UI using semantic tokens, accessible primitives, keyboard support, and predictable composition
- tests and scripts that prove behavior at the same boundary where the risk exists
```

## Task 2: Install and Run Primary `codex-code-review`

**Files:**
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Install the primary review skill**

Run:

```bash
npx skillfish add sd0xdev/sd0x-dev-flow codex-code-review
```

Expected: `codex-code-review` installs successfully to `/Users/robert/.codex/skills/codex-code-review`.

- [ ] **Step 2: Verify the installed skill**

Run:

```bash
test -f /Users/robert/.codex/skills/codex-code-review/SKILL.md
sed -n '1,80p' /Users/robert/.codex/skills/codex-code-review/SKILL.md
```

Expected: the skill file exists and describes Codex MCP code review for PR review, code audit, and second-opinion workflows.

- [ ] **Step 3: Run primary `codex-code-review` where MCP tools are available**

Use the installed `codex-code-review` workflow as the primary review gate.

Expected: the primary review produces severity-grouped findings and a merge/release gate. If the current environment does not expose the skill's required MCP tools, record the tool availability blocker and do not claim primary review findings.

- [ ] **Step 4: Record primary review result**

Add this to the evidence ledger:

```markdown
## Primary Review Tooling

- Primary review tool: `codex-code-review`
- Install command: `npx skillfish add sd0xdev/sd0x-dev-flow codex-code-review`
- Install result: PASS/FAIL
- Codex install path: `/Users/robert/.codex/skills/codex-code-review`
- Execution status: PASS/FAIL/BLOCKED
- Findings summary:
- Gate:
```

## Task 2B: Unblock and Run Secondary CodeRabbit

**Files:**
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Verify CLI and auth**

Run:

```bash
/Users/robert/.local/bin/coderabbit --version
/Users/robert/.local/bin/coderabbit auth status --agent
```

Expected: CodeRabbit version prints and auth reports `"authenticated":true`.

- [ ] **Step 2: Attempt secondary CodeRabbit review**

Run:

```bash
/Users/robert/.local/bin/coderabbit review --agent -c AGENTS.md -c .coderabbit.yaml -c CLAUDE.md
```

Expected: CodeRabbit completes and emits NDJSON `finding` events, or fails with an exact CLI error.

- [ ] **Step 3: If CodeRabbit fails on local artifact paths, classify the blocker**

Run:

```bash
git ls-files dataconnect/.dataconnect/pgliteData | sed -n '1,40p'
git status --short dataconnect/.dataconnect/pgliteData | sed -n '1,40p'
git diff --name-only main...HEAD -- dataconnect/.dataconnect/pgliteData | sed -n '1,40p'
```

Expected: determine whether local pglite data paths are tracked, modified, or present in the committed branch diff.

Record this in the evidence ledger:

```markdown
## CodeRabbit Attempts

- Attempt 1:
  - Command:
  - Result:
  - Exact failure:
- Artifact blocker:
  - Tracked files:
  - Modified files:
  - Present in `main...HEAD`:
  - Recommended unblock:
```

- [ ] **Step 4: Decide the correct long-term CodeRabbit unblock**

Use this decision rule:

```markdown
- If pglite data files are tracked in git, recommend removing generated local database artifacts from version control in a separate cleanup task and adding a guard to prevent recurrence.
- If pglite data files are only untracked, recommend adding or tightening `.gitignore`.
- If pglite data files are required fixtures, recommend moving them to a small deterministic fixture path and excluding volatile database internals.
- Do not delete, reset, or rewrite these files during the audit.
```

- [ ] **Step 5: Summarize CodeRabbit result honestly**

If CodeRabbit completed, add grouped findings under `## CodeRabbit Result`:

```markdown
CodeRabbit raised N issues.

### Critical

- `path/to/file.ts:line` - Impact: exact risk. Suggested fix: exact action.

### Major

- `path/to/file.ts:line` - Impact: exact risk. Suggested fix: exact action.

### Minor

- `path/to/file.ts:line` - Impact: exact risk. Suggested fix: exact action.
```

If CodeRabbit failed, add:

```markdown
CodeRabbit did not complete, so it raised 0 reportable issues for this audit.

Blocked by:

```text
exact CLI failure
```

Required unblock before relying on CodeRabbit:

- exact long-term cleanup recommendation
```

## Task 3: Run Deterministic Local Verification

**Files:**
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Run type checks**

Run:

```bash
npm run typecheck
```

Expected: app and test TypeScript checks pass. If they fail, record the first ten diagnostics with file path and diagnostic code.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: ESLint passes for `src`. Classify failures as correctness, accessibility, dependency-boundary, or style.

- [ ] **Step 3: Run formatting check**

Run:

```bash
npm run format:check
```

Expected: Prettier reports all checked files formatted.

- [ ] **Step 4: Run repository guards**

Run:

```bash
npm run guard:routes
npm run guard:secrets
npm run guard:tracked-artifacts
npm run guard:deps
```

Expected: route runtime, secret scan, tracked artifact, and forbidden import checks pass.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected: full Vitest suite passes after pretest typecheck. If it fails, record failing test file, test name, and first assertion or thrown error.

- [ ] **Step 6: Record verification matrix**

Add this table to `## Local Verification Result`:

```markdown
| Check | Command | Status | Evidence | Long-term implication |
| --- | --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | PASS/FAIL/BLOCKED | exact summary | contract and API type safety |
| Lint | `npm run lint` | PASS/FAIL/BLOCKED | exact summary | maintainability and accessibility rules |
| Format | `npm run format:check` | PASS/FAIL/BLOCKED | exact summary | reviewability |
| Route guards | `npm run guard:routes` | PASS/FAIL/BLOCKED | exact summary | runtime boundary safety |
| Secret guard | `npm run guard:secrets` | PASS/FAIL/BLOCKED | exact summary | credential safety |
| Artifact guard | `npm run guard:tracked-artifacts` | PASS/FAIL/BLOCKED | exact summary | generated artifact hygiene |
| Dependency guard | `npm run guard:deps` | PASS/FAIL/BLOCKED | exact summary | server/client boundary safety |
| Tests | `npm test` | PASS/FAIL/BLOCKED | exact summary | behavior regression protection |
```

## Task 4: Audit Footywire Canonical Contract Convergence

**Files:**
- Read: `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`
- Read: `docs/DATA_RELIABILITY.md`
- Read: `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- Read: `docs/runtime-contract.md`
- Read: `etl/processFootywireData.ts`
- Read: `src/lib/stats/footywireCanonicalContract.ts`
- Read: `src/lib/footywireStatsIngestion.ts`
- Read: `src/server/readModels/playerReadModels.ts`
- Read: `Scripts/verify-player-read-models.ts`
- Read: `Scripts/verify-match-logs.ts`
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Identify all semantic stat readers**

Run:

```bash
rg "legacy|fallback|rawStats|top-level|canonical|provenance|sourcePriority|presence|dropped_before_raw|dropped_in_projection" etl src Scripts tests docs -g '!node_modules'
```

Expected: every semantic reader is either canonical, transitional with exit criteria, or listed as a finding.

- [ ] **Step 2: Verify stat vocabulary is owned once**

Run:

```bash
rg "statKey|stat key|Footywire|canonicalStats|stats\\.|disposals|kicks|handballs|marks|tackles|goals|behinds|hitouts|clearances" etl src Scripts tests -g '!node_modules'
```

Expected: canonical Footywire stat keys are defined in one shared contract and reused. Duplicated stat maps or field interpretation logic become findings.

- [ ] **Step 3: Trace the write path**

Manually review:

```text
etl/processFootywireData.ts
src/lib/stats/footywireCanonicalContract.ts
src/lib/footywireStatsIngestion.ts
```

Record whether the write path proves:

```markdown
- canonical match identity is explicit
- player identity linkage is explicit
- canonical stat keys are lossless for supported Footywire stats
- missing, zero, and absent values are intentionally represented
- provenance and source priority survive persistence
- source metadata required downstream is persisted at the Firestore boundary
```

- [ ] **Step 4: Trace the read and projection path**

Manually review:

```text
src/server/readModels/playerReadModels.ts
Scripts/build-player-read-models.ts
Scripts/verify-player-read-models.ts
Scripts/verify-match-logs.ts
```

Record whether the read path proves:

```markdown
- projections consume canonical data directly
- legacy top-level fields are not permanent semantic fallbacks
- projection logic does not silently drop null, empty, missing, or zero-like values
- provenance is preserved or intentionally summarized
- rebuild scope can be bounded to affected season, round, match, or player slices
```

- [ ] **Step 5: Run focused convergence tests**

Run:

```bash
npx vitest run src/lib/stats/footywireCanonicalContract.test.ts src/lib/footywireStatsIngestion.test.ts src/server/processFootywireData.test.ts src/server/readModels/playerReadModels.test.ts tests/verify-player-read-models-core.test.ts
```

Expected: all focused convergence tests pass. If any fail, classify failure as `dropped_before_raw`, `dropped_in_projection`, identity drift, provenance drift, or unrelated test failure.

- [ ] **Step 6: Record contract findings**

Add findings under `## Footywire Contract and Projection Review` only when they satisfy the finding format. Do not write generic observations without impact and verification.

## Task 5: Audit Import, Rebuild, Repair, and Operational Safety

**Files:**
- Read: `src/app/api/etl/import-rounds/route.ts`
- Read: `src/app/api/cron/daily/route.ts`
- Read: `Scripts/build-player-read-models.ts`
- Read: `Scripts/verify-player-read-models.ts`
- Read: `Scripts/repair-player-directory.ts`
- Read: `Scripts/audit-unresolved-player-directory.ts`
- Read: `src/server/playerDirectoryRepair.ts`
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Search mutation and repair entry points**

Run:

```bash
rg "POST|PUT|PATCH|DELETE|import|repair|rebuild|rematerial|build-player-read-models|verify-player-read-models|cron|admin|authorization|BYPASS_AUTH" src/app/api Scripts src/server src/lib -g '!node_modules'
```

Expected: every high-impact mutation path has explicit authorization, observable output, bounded scope, and verification path.

- [ ] **Step 2: Review import-to-projection behavior**

Manually inspect `src/app/api/etl/import-rounds/route.ts` and record:

```markdown
- What data does successful import mutate?
- Does successful import trigger rebuild/rematerialization?
- Is rebuild scope bounded to affected rounds, matches, players, or season slices?
- If rebuild is deferred, where is the operational handoff recorded?
- What authorization is required in local, preview, and production-like environments?
- What logs or response fields allow operators to verify the outcome?
```

- [ ] **Step 3: Review repair safety**

Manually inspect repair scripts and record:

```markdown
- Can repair run in dry-run mode?
- Can repair scope be bounded?
- Does repair preserve provenance?
- Is output repeatable?
- Is there a verification command after repair?
- Can failed repair be safely retried?
```

- [ ] **Step 4: Run route and repair tests**

Run:

```bash
npx vitest run src/app/api/etl/import-rounds/route.test.ts src/app/api/cron/daily/route.test.ts src/server/playerDirectoryRepair.test.ts src/server/playerDirectoryRosterEvidence.test.ts src/server/playerIdentityResolver.test.ts
```

Expected: route auth, repair, roster evidence, and identity behavior tests pass.

- [ ] **Step 5: Record operational findings**

Add findings under `## Security and Operational Review` when mutation paths lack explicit auth, scope, observability, repeatability, or verification.

## Task 6: Audit Security Boundaries and Environment Defaults

**Files:**
- Read: `src/lib/serverAuth.ts`
- Read: `src/lib/firebaseAdmin.ts`
- Read: `Scripts/validate-env.cjs`
- Read: `check-env-firebase.sh`
- Read: `scripts/scan-secrets.ts`
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Run environment checks**

Run:

```bash
npm run env:validate
npm run env:check:firebase
```

Expected: local environment either passes or reports explicit missing variables. Missing local secrets are blockers, not code defects, unless the code has unsafe permissive defaults.

- [ ] **Step 2: Search auth bypass and admin paths**

Run:

```bash
rg "BYPASS_AUTH|NEXT_PUBLIC_BYPASS_AUTH|serviceAccount|private_key|admin|Authorization|Bearer|cron secret|CRON|FIREBASE|GOOGLE_APPLICATION_CREDENTIALS" src Scripts tests docs -g '!node_modules'
```

Expected: bypass behavior is explicit by environment, secrets are not committed, and admin paths are server-only.

- [ ] **Step 3: Review server/client boundaries**

Run:

```bash
npm run guard:deps
rg "firebase-admin|server-only|next/headers|cookies\\(|headers\\(" src/app src/components src/lib src/server -g '!node_modules'
```

Expected: server-only APIs do not leak into client components, and client code does not import admin modules.

- [ ] **Step 4: Record security findings**

Findings must distinguish between:

```markdown
- confirmed vulnerability
- unsafe default
- missing verification
- local environment blocker
- documentation gap
```

Only confirmed vulnerability or unsafe default should be P0/P1.

## Task 7: Audit UI, Accessibility, and shadcn Alignment

**Files:**
- Read: `STATLY_DESIGN_SYSTEM.md`
- Read: `src/app/page.tsx`
- Read: `src/app/dashboard/DashboardClient.tsx`
- Read: `src/app/players/PlayersPageClient.tsx`
- Read: `src/app/leagues/[id]/LeaguePageClient.tsx`
- Read: `src/components/navigation/MainNavigation.tsx`
- Read: `src/components/draft/DraftHubNav.tsx`
- Read: `src/components/league/LeagueTabs.tsx`
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Search token and one-off style drift**

Run:

```bash
rg "#[0-9a-fA-F]{3,8}|rgb\\(|rgba\\(|style=\\{\\{|text-(red|blue|green|purple|orange|slate|gray)-|bg-(red|blue|green|purple|orange|slate|gray)-|border-(red|blue|green|purple|orange|slate|gray)-" src/app src/components -g '!node_modules'
```

Expected: hard-coded color and one-off style usage is either design-system approved or recorded as drift.

- [ ] **Step 2: Search interaction accessibility**

Run:

```bash
rg "<button|<a |Button|onClick|aria-label|aria-describedby|aria-invalid|role=|tabIndex|Dialog|Popover|Select|Tabs|Dropdown" src/app src/components -g '!node_modules'
```

Expected: icon-only controls have labels, form fields have accessible names, controls remain keyboard reachable, and shadcn/radix-like primitives are preferred over custom behavior.

- [ ] **Step 3: Review key user flows manually**

Review:

```text
src/components/navigation/MainNavigation.tsx
src/app/players/PlayersPageClient.tsx
src/app/dashboard/DashboardClient.tsx
src/app/leagues/[id]/LeaguePageClient.tsx
src/components/draft/DraftHubNav.tsx
```

Record:

```markdown
- Is the first screen an actual app surface rather than a marketing placeholder?
- Are controls discoverable without visible instructional copy?
- Are repeated data views dense, scannable, and predictable?
- Are loading, empty, and error states explicit?
- Does text fit in compact controls on mobile and desktop?
- Are focus states preserved?
- Are semantic theme tokens used instead of hard-coded colors?
```

- [ ] **Step 4: Run focused UI tests**

Run:

```bash
npx vitest run src/app/players/PlayersPageClient.test.ts src/components/league/LeagueTabs.test.tsx src/hooks/__tests__/useLeagueStatColumns.test.ts
```

Expected: page interactions, tabs, and stat column behavior pass.

- [ ] **Step 5: Record UI findings**

Prioritize accessibility and broken workflows over visual polish. Do not recommend a redesign unless the current structure blocks usability, accessibility, or maintainability.

## Task 8: Audit Test Strategy and Missing Proof

**Files:**
- Read: `vitest.config.ts`
- Read: `tsconfig.test.json`
- Read: tests under `src/**/*.test.ts`, `src/**/*.test.tsx`, and `tests/**/*.test.ts`
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Map tests to risk areas**

Run:

```bash
find src tests -type f \\( -name '*.test.ts' -o -name '*.test.tsx' \\) | sort
```

Expected: list every test file.

- [ ] **Step 2: Identify missing proof for architectural claims**

Record whether tests prove:

```markdown
- canonical stat keys cover every supported Footywire stat
- missing, zero, and absent semantics are distinct
- provenance survives ETL through projection
- import routes enforce auth in production-like settings
- import success triggers or clearly schedules bounded rebuild/rematerialization
- verification scripts detect `dropped_before_raw`
- verification scripts detect `dropped_in_projection`
- UI controls are keyboard accessible where interaction is custom
- read models reject or flag malformed canonical documents
```

- [ ] **Step 3: Classify test gaps**

Use this rubric:

```markdown
- P1 test gap: missing proof for behavior that could corrupt data, expose mutation paths, or publish incorrect projections.
- P2 test gap: missing proof for important workflow, accessibility behavior, or migration boundary.
- P3 test gap: useful regression coverage for low-risk formatting, display, or helper behavior.
```

## Task 9: Produce Long-Term Remediation Roadmap

**Files:**
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Normalize findings**

Review all findings and remove duplicates. Merge tool findings and manual findings when they describe the same root cause.

- [ ] **Step 2: Separate fixes from mitigations**

For each P0/P1 finding, write:

```markdown
- Durable fix:
- Temporary mitigation, if needed:
- Why the durable fix is preferred:
- Why the mitigation is not sufficient long term:
```

- [ ] **Step 3: Group remediation into coherent work packages**

Use these groups:

```markdown
## Long-Term Remediation Roadmap

### Work Package 1: Primary Review and Artifact Hygiene

Goal:
Files:
Risks addressed:
Verification:

Primary review gate:
- `codex-code-review`

Secondary review signal:
- CodeRabbit

### Work Package 2: Footywire Canonical Contract Convergence

Goal:
Files:
Risks addressed:
Verification:

### Work Package 3: Import, Rebuild, and Repair Safety

Goal:
Files:
Risks addressed:
Verification:

### Work Package 4: Security and Environment Hardening

Goal:
Files:
Risks addressed:
Verification:

### Work Package 5: UI Accessibility and Design-System Alignment

Goal:
Files:
Risks addressed:
Verification:

### Work Package 6: Test Coverage and Regression Proof

Goal:
Files:
Risks addressed:
Verification:
```

- [ ] **Step 4: Write release recommendation**

Use exactly one:

```markdown
Release recommendation: Block release until P0 findings are fixed and verified.
```

```markdown
Release recommendation: Release only after P1 findings are accepted by owner or scheduled with verification.
```

```markdown
Release recommendation: No audit-blocking issues found; proceed with normal release checks.
```

- [ ] **Step 5: Final self-review**

Before calling the audit complete, verify:

```markdown
- Every P0/P1 has evidence.
- Every P0/P1 has a durable fix direction.
- Every durable fix has a verification command or manual proof.
- CodeRabbit status is represented honestly.
- Blocked checks are listed as blocked, not passed.
- No production code was changed during audit execution.
- Recommendations move Statly closer to single-contract convergence and safer operations.
```

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-full-code-audit.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per audit area, review findings between tasks, and keep remediation planning independent from code changes.
2. **Inline Execution** - Execute the audit tasks in this session using executing-plans, with checkpoints after CodeRabbit, local checks, domain review, and final roadmap.

## Self-Review

- Spec coverage: this plan assesses the audit goal, addresses the shortcomings of the previous version, and centers long-term architecture, security, data reliability, accessibility, and verification.
- Placeholder scan: the plan contains no `TBD`, `TODO`, `implement later`, or vague "add appropriate" instructions.
- Type consistency: commands match observed `package.json` scripts and repository paths.
- Long-term fit: the plan rejects quick fixes that preserve Footywire semantic drift and requires durable remediation paths with explicit verification.
