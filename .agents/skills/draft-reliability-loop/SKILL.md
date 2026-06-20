---
name: draft-reliability-loop
description: Use when improving, verifying, or babysitting Statly draft-room reliability, realtime draft behavior, pick flow, roster projection, waiver availability, or draft-room regressions.
---

# Draft Reliability Loop

## Purpose

Use this skill to run repeatable Codex loops for Statly draft-room reliability work. Keep the loop evidence-driven: identify the failing path, fix the owning boundary, verify the browser/API behavior, then re-review before reporting or committing.

This skill is documentation and workflow only. It must not be used as permission to change product runtime code without the normal Statly planning, council, implementation, and verification gates.

## Required Inputs

- `AGENTS.md`
- The current draft-room source-of-truth spec or plan under `docs/superpowers/`
- The user's requested draft-room issue, PR, or reliability target
- Current `git status --short --branch`

## Loop

1. Plan the boundary.
   - Read the relevant source-of-truth docs before editing.
   - Run the logical council for substantive work.
   - Continue only after `CHAIRMAN DECISION 1: PROCEED`.
   - State the owning boundary: auth, API route, shared server service, client state, realtime sync, browser UI, tests, or docs.

2. Reproduce or prove the path.
   - Prefer browser verification for route, hydration, realtime, navigation, and visual behavior.
   - Prefer API checks for command/read-model boundaries.
   - Prefer focused tests for regressions that can be made deterministic.
   - Record concrete IDs, URLs, commands, and observed state.

3. Implement the smallest durable fix.
   - Fix the source of truth, not only the visible symptom.
   - Preserve Prisma as canonical for protected fantasy data unless the current source-of-truth doc says otherwise.
   - Treat API routes as transport adapters over shared logic.
   - Keep client state catch-up paths consistent with persisted server state.
   - Do not add dependencies for loop mechanics.

4. Review and fix.
   - Run relevant tests, type checks, lint, and browser/API checks.
   - Review `git diff` before staging.
   - Run council Decision 2 on the staged or final diff when committing is in scope.
   - If review finds defects, fix them and repeat verification.

5. Re-review.
   - Re-run the checks that failed or guarded the edited boundary.
   - Re-run browser/API verification when behavior changed.
   - Re-run Decision 2 before committing after material fixes.

6. Report.
   - Summarize what changed, why it changed, what was verified, and residual risk.
   - Include concrete evidence rather than broad claims.
   - Do not claim done if checks or browser verification were skipped; state the gap.

## Draft-Room Reliability Checklist

- [ ] Source-of-truth docs read.
- [ ] Council Decision 1 returned `CHAIRMAN DECISION 1: PROCEED`.
- [ ] Failing or risky path identified with concrete route/API/state.
- [ ] Owning boundary stated before editing.
- [ ] Runtime code changes, if any, stayed inside the approved boundary.
- [ ] Protected files were not touched: `prisma/dev.db`, `.env`, secrets, `serviceAccountKey.json`, Firebase exports, `node_modules`, `dist`, `coverage`, and `test-results`.
- [ ] Regression coverage or explicit verification evidence exists.
- [ ] `git diff` reviewed.
- [ ] Council Decision 2 completed before commit when commit is in scope.

## Prompt Template

Use this template when starting a draft-room reliability loop:

```text
Use the draft-reliability-loop skill.

Target:
[draft-room reliability issue, PR, stale behavior, or verification target]

Read:
- AGENTS.md
- [current source-of-truth spec/plan]

Constraints:
- Preserve Statly council gates.
- Fix the source of truth, not just the visible symptom.
- Do not touch protected files or unrelated runtime code.

Done when:
- The failing path is reproduced or concretely identified.
- The owning boundary is fixed or documented as out of scope.
- Relevant tests/checks/browser or API verification are complete.
- The final report includes evidence and residual risk.
```

## Common Mistakes

| Mistake                                               | Correction                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Treating a browser symptom as the owning boundary     | Trace to auth, API, persistence, realtime delivery, or client state before editing. |
| Using council output as a substitute for verification | Council gates decide whether to proceed or commit; they do not prove behavior.      |
| Fixing only the open tab state                        | Verify refresh, direct load, and persisted server state when draft data changes.    |
| Letting local databases or env files enter the diff   | Check `git status --short` before and after verification.                           |
| Reporting "done" with skipped checks                  | State skipped checks and why, then name the residual risk.                          |
