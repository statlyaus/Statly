---
name: quality-streak-loop
description: Use when running repeated Statly quality passes, check streaks, flaky-test follow-up, or verification sweeps across safe fixtures.
---

# Quality Streak Loop

## Purpose

Use this skill for repeated quality passes where the goal is to improve confidence without mutating protected local state. It is especially strict about temporary databases and safe fixtures.

## When To Use

- Running a sequence of lint, typecheck, unit, API, or browser checks.
- Following up on flaky checks.
- Establishing a verification streak before a risky PR.
- Checking whether a fix remains stable after reruns.

## When Not To Use

- Feature discovery.
- Tests that require real secrets.
- Any flow that mutates `prisma/dev.db`.

## Required Inputs

- `AGENTS.md`
- Target branch or PR
- Check list or quality goal
- Fixture/database strategy
- Current `git status --short --branch`

## Protected Files

Never mutate `prisma/dev.db`, `.env`, secrets, `serviceAccountKey.json`, Firebase exports, generated `functions/lib` files, dataconnect local data, `node_modules`, `dist`, `coverage`, or `test-results`. Use temporary DB copies or safe generated fixtures only.

## Permission Model

| Action    | Allowed Without Approval                                | Requires Explicit Approval                          | Never Automatic                             |
| --------- | ------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------- |
| Observe   | Read check configs, run safe read-only/status commands  | Inspecting external dashboards not named            | Reading secrets                             |
| Plan      | Define check sequence and safe fixture strategy         | Long soak tests or browser tests with data mutation | Using protected DB directly                 |
| Implement | Fixes only through normal implementation loop           | Editing tests/runtime files                         | Patching around failures without root cause |
| Push      | Only after approved fixes and Decision 2                | Any push of quality-only changes                    | Pushing artifacts                           |
| Merge     | Only with explicit merge instruction and passing checks | Quality PR merge                                    | Merging with flaky/unknown checks           |
| Close     | Not part of quality streak unless scoped                | Closing flaky PRs                                   | Closing issues because checks passed once   |
| Delete    | Remove only temporary files created by the loop         | Deleting existing artifacts                         | Deleting stashes/branches/local DB          |

## Loop

1. Confirm clean status and protected-file constraints.
2. Define the streak: commands, order, pass threshold, and stop rules.
3. Use temporary DBs or safe fixtures for stateful checks.
4. Run checks and capture exact failures.
5. If failures need code changes, switch to the relevant implementation skill and council gates.
6. Report pass streak, failed checks, skipped checks, and residual risk.

## Stop Conditions

- A check would mutate `prisma/dev.db`.
- A command needs real secrets.
- Failures indicate product/runtime work beyond verification.
- Artifacts appear in protected output directories.

## Verification Expectations

- Exact command list and pass/fail results.
- Temporary DB path when used.
- Final `git status --short --branch`.
- Explicit residual-risk note for skipped or flaky checks.
