---
name: docs-sweep-loop
description: Use when reviewing Statly documentation, source-of-truth drift, historical complete notes, stale plans, or docs-only cleanup.
---

# Docs Sweep Loop

## Purpose

Use this skill to review Statly docs without confusing current source-of-truth instructions with historical completion notes. It is for docs-only cleanup, consolidation, and drift reporting.

## When To Use

- Auditing docs after feature or PR cleanup.
- Finding stale "complete" markdown that should not drive implementation.
- Preparing docs-only PRs.
- Reconciling specs, plans, and agent-loop docs.

## When Not To Use

- Runtime implementation.
- Product decisions that need new specs.
- Treating historical docs as current requirements without validation.

## Required Inputs

- `AGENTS.md`
- Named docs/specs/plans
- Current `git status --short --branch`
- User's docs-sweep scope

## Protected Files

Never touch `prisma/dev.db`, `.env`, secrets, `serviceAccountKey.json`, Firebase exports, generated `functions/lib` files, dataconnect local data, `node_modules`, `dist`, `coverage`, or `test-results`.

## Permission Model

| Action    | Allowed Without Approval                                             | Requires Explicit Approval         | Never Automatic                                 |
| --------- | -------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------- |
| Observe   | Read scoped docs and related current code references                 | Broad repo-wide sweeps             | Reading secrets/local data                      |
| Plan      | Classify docs as current, historical, stale, or needs owner decision | Changing source-of-truth hierarchy | Declaring product direction alone               |
| Implement | Docs-only edits after plan approval                                  | Moving/deleting docs               | Runtime edits                                   |
| Push      | If docs PR is in scope and checks pass                               | Any push outside docs branch       | Pushing runtime changes                         |
| Merge     | Only with explicit merge instruction and passing checks              | Docs merge after approval          | Self-merging broad docs changes                 |
| Close     | Only doc-related PRs explicitly scoped                               | Any unscoped PR                    | Closing product PRs from docs sweep             |
| Delete    | Not allowed                                                          | Explicit approval only             | Deleting branches/stashes/docs history casually |

## Loop

1. Identify current source-of-truth docs.
2. Identify historical notes, completed plans, and stale reports.
3. Compare claims against current code only when needed.
4. Propose minimal docs changes or a no-edit report.
5. For docs edits, run markdown formatting and diff review.

## Stop Conditions

- A doc implies runtime behavior that is unverified.
- The sweep requires product direction decisions.
- The change would delete historical context without approval.
- Local status becomes dirty outside scoped docs.

## Verification Expectations

- `npm exec -- prettier --check` for touched markdown.
- `git diff --check`.
- `git diff` review for docs-only scope.
- Council Decision 2 before commit when committing.
