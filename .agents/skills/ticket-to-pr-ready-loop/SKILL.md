---
name: ticket-to-pr-ready-loop
description: Use when turning a Statly ticket, issue, prompt, or stale PR intent into a narrow PR-ready implementation plan from current main.
---

# Ticket To PR-Ready Loop

## Purpose

Use this skill to turn a request into a narrow, verifiable Statly PR plan. It requires a reproduced failure or clearly identified uncertain path before implementation.

## When To Use

- Converting a stale PR into a fresh task.
- Starting a bug fix, reliability task, or small feature from current `main`.
- Preparing a branch plan with files, tests, and browser/API verification.

## When Not To Use

- Non-editing PR cleanup.
- Broad product discovery.
- Tasks that lack a concrete behavior, failure, or acceptance path.

## Required Inputs

- `AGENTS.md`
- User ticket, issue, or stale PR numbers
- Current source-of-truth docs for the feature area
- Current `git status --short --branch`
- Historical PRs as evidence only, when named

## Protected Files

Never touch `prisma/dev.db`, `.env`, secrets, `serviceAccountKey.json`, Firebase exports, generated `functions/lib` files, dataconnect local data, `node_modules`, `dist`, `coverage`, or `test-results`.

## Permission Model

| Action    | Allowed Without Approval                                        | Requires Explicit Approval                          | Never Automatic                        |
| --------- | --------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| Observe   | Read docs, current code, historical PR diffs, tests, issues     | Pulling broad old branch diffs into current work    | Copying old stacked branches wholesale |
| Plan      | Identify failing path, file list, edit boundary, verification   | Implementation plan crossing new product boundaries | Starting from a non-main base          |
| Implement | Only after Decision 1 and a clear plan                          | Runtime edits, test edits, docs edits               | Editing protected files                |
| Push      | After checks and Decision 2 when PR creation is in scope        | Any push outside the approved branch                | Pushing dirty/unreviewed changes       |
| Merge     | Not during ticket-to-PR-ready unless explicitly requested later | Passing checks and explicit merge instruction       | Merging own PR without review/checks   |
| Close     | Not part of implementation                                      | Closing superseded source PRs if scoped             | Closing unrelated PRs                  |
| Delete    | Not allowed                                                     | Explicit approval only                              | Deleting branches/stashes/local data   |

## Loop

1. Confirm current `main` and clean status.
2. Read source-of-truth docs and current code.
3. Reproduce or identify the failing/uncertain path.
4. Compare historical evidence without copying broad diffs.
5. State:
   - owning boundary;
   - proposed file list;
   - edit plan;
   - tests/checks/browser/API verification;
   - residual risk.
6. Run council Decision 1 before implementation.

## Stop Conditions

- No reproducible or identifiable path exists.
- The fix would require protected local state.
- The task needs product decisions before engineering.
- The plan expands beyond the requested scope.

## Verification Expectations

- Focused tests at the failing boundary.
- Typecheck/lint/format checks for touched code.
- Browser/API checks for user-visible or route behavior.
- Council Decision 2 before commit.
