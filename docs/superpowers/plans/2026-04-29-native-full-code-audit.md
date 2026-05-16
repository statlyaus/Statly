# Native Full Code Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a full-scale native audit of Statly using parallel subagents and local verification, without depending on CodeRabbit or `codex-code-review` as primary review gates.

**Architecture:** The main agent coordinates evidence, runs deterministic checks, and owns final synthesis. Subagents independently audit security/operations, Footywire convergence, test/tooling health, and frontend/accessibility; their outputs are merged only when backed by code evidence and verification paths.

**Tech Stack:** Next.js 15, React 19, TypeScript, Firebase/Firestore, Prisma, Vitest, ESLint, Prettier, npm scripts, local shell verification.

---

## Audit Model

- Primary review: native Codex review with subagents.
- Secondary review: optional external tooling only after native blockers are resolved.
- Scope: current dirty worktree at `/Users/robert/Developer/Statly`.
- Output:
  - `docs/audits/2026-04-29-full-code-audit.md`
  - `docs/audits/2026-04-29-full-code-audit-evidence.md`
- Constraint: do not edit production code during the audit.

## Subagent Workstreams

### Workstream 1: Security and Operations

**Scope:**
- `middleware.ts`
- `src/app/api/admin/**`
- `src/app/api/cron/**`
- `src/app/api/etl/import-rounds/route.ts`
- `src/lib/serverAuth.ts`
- `src/lib/firebaseAdmin.ts`
- `scripts/scan-secrets.ts`
- `Scripts/check-tracked-local-artifacts.mjs`

**Review for:**
- unauthenticated mutation paths
- unsafe development-only defaults leaking into shared environments
- secret exposure in build outputs
- admin SDK/server-only boundary leaks
- operational observability and retry safety

### Workstream 2: Footywire Contract Convergence

**Scope:**
- `etl/processFootywireData.ts`
- `src/lib/stats/footywireCanonicalContract.ts`
- `src/lib/footywireStatsIngestion.ts`
- `src/server/readModels/playerReadModels.ts`
- `src/app/api/etl/import-rounds/route.ts`
- `Scripts/build-player-read-models.ts`
- `Scripts/verify-player-read-models.ts`
- `tests/verify-player-read-models-core.test.ts`

**Review for:**
- canonical Firestore raw-match contract as single persisted semantic source
- duplicate or permanent legacy semantic readers
- missing/zero/absent semantics
- provenance preservation
- bounded rebuild/rematerialization
- `dropped_before_raw` and `dropped_in_projection` risk

### Workstream 3: Tests, Tooling, and Release Gates

**Scope:**
- `package.json`
- `vitest.config.ts`
- `tsconfig*.json`
- `Scripts/**`
- `scripts/**`
- failing test files
- guard scripts

**Review for:**
- failing tests
- brittle or misaligned tests
- unsafe script help behavior
- incomplete prepush/CI coverage
- generated artifact hygiene
- format/lint/typecheck gaps

### Workstream 4: Frontend, Accessibility, and shadcn Alignment

**Scope:**
- `STATLY_DESIGN_SYSTEM.md`
- `src/app/page.tsx`
- `src/app/fantasy/page.tsx`
- `src/app/players/PlayersPageClient.tsx`
- `src/app/leagues/[id]/LeaguePageClient.tsx`
- `src/components/navigation/MainNavigation.tsx`
- `src/components/league/LeagueTabs.tsx`
- `src/components/draft/**`

**Review for:**
- keyboard accessibility
- accessible names and form labels
- shadcn-style composition
- semantic theme-token usage
- light/dark support
- layout/text overflow risk
- server/client boundary mistakes in UI

## Finding Format

Every finding must use this structure:

```markdown
### P0/P1/P2/P3: Finding title

- Severity: Critical/Major/Minor
- Area:
- Evidence:
- Invariant at risk:
- Impact:
- Best long-term fix:
- Migration or rollout risk:
- Verification required:
- Source: native coordinator / security subagent / Footywire subagent / tooling subagent / frontend subagent
- Status: Open
```

## Task 1: Dispatch Native Audit Subagents

**Files:**
- Read: `AGENTS.md`
- Read: relevant workstream files
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Dispatch security/operations subagent**

Expected: subagent returns P0/P1/P2/P3 findings with file/line evidence and verification commands.

- [ ] **Step 2: Dispatch Footywire convergence subagent**

Expected: subagent returns findings about canonical contract convergence, projection drift, rebuild scope, and reconciliation proof.

- [ ] **Step 3: Dispatch tests/tooling subagent**

Expected: subagent returns findings about failing checks, script safety, artifact hygiene, and release gates.

- [ ] **Step 4: Dispatch frontend/accessibility subagent**

Expected: subagent returns findings about accessible interaction, semantic token drift, and UI maintainability.

## Task 2: Coordinator Verification

**Files:**
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Run deterministic checks**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run guard:routes
npm run guard:secrets
npm run guard:tracked-artifacts
npm run guard:deps
npm test
```

Expected: record pass/fail status, exact failure summaries, and blocked checks.

- [ ] **Step 2: Run focused checks**

Run:

```bash
npx vitest run src/lib/stats/footywireCanonicalContract.test.ts src/lib/footywireStatsIngestion.test.ts src/server/processFootywireData.test.ts src/server/readModels/playerReadModels.test.ts tests/verify-player-read-models-core.test.ts
npx vitest run src/app/api/etl/import-rounds/route.test.ts src/app/api/cron/daily/route.test.ts src/server/playerDirectoryRepair.test.ts src/server/playerDirectoryRosterEvidence.test.ts src/server/playerIdentityResolver.test.ts
npx vitest run src/app/players/PlayersPageClient.test.ts src/components/league/LeagueTabs.test.tsx src/hooks/__tests__/useLeagueStatColumns.test.ts
```

Expected: record focused pass/fail status.

## Task 3: Merge Subagent Findings

**Files:**
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Deduplicate findings**

Merge duplicate findings by root cause. Keep the highest severity and all useful evidence.

- [ ] **Step 2: Reject unsupported findings**

Do not include any finding without concrete file/line evidence, command output, or documented invariant.

- [ ] **Step 3: Preserve disagreements**

If subagents disagree on severity, record the final coordinator severity and the reason.

## Task 4: Produce Native Audit Report

**Files:**
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Rewrite review-tool sections**

State that native Codex review with subagents is primary. CodeRabbit and `codex-code-review` are not required to complete this audit.

- [ ] **Step 2: Update executive summary**

Include:

```markdown
- overall risk
- release recommendation
- highest-priority security risk
- highest-priority data/convergence risk
- highest-priority tooling/release risk
- highest-priority frontend/accessibility risk
```

- [ ] **Step 3: Update remediation roadmap**

Group findings into coherent long-term work packages:

```markdown
1. Security and admin-route authorization
2. Secret and generated-artifact hygiene
3. Player search/read-model contract repair
4. Test and release gate recovery
5. Footywire convergence hardening
6. Script operator UX
7. Frontend design-system alignment
```

## Task 5: Final Verification

**Files:**
- Read: `docs/audits/2026-04-29-full-code-audit.md`
- Read: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Check for placeholders**

Run:

```bash
rg "Pending|TBD|TODO|implement later" docs/audits/2026-04-29-full-code-audit.md docs/audits/2026-04-29-full-code-audit-evidence.md
```

Expected: no unresolved placeholder content.

- [ ] **Step 2: Confirm no production code edits**

Run:

```bash
git status --short
```

Expected: only audit docs and plan docs are newly changed by this audit pass; production code remains untouched by the audit.

## Self-Review

- Spec coverage: plan uses native review, includes subagents, and covers security, Footywire convergence, test/tooling health, and frontend/accessibility.
- Placeholder scan: no `TBD`, `TODO`, or vague future implementation instructions.
- Long-term fit: findings must recommend durable fixes that move Statly toward safer operations and single-contract Footywire convergence.
