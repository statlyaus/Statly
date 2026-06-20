# Ticket-to-PR-Ready Automation

## Purpose

Turn one approved Statly ticket, issue, stale PR intent, or user prompt into one
narrow PR from current `main`.

## When To Run

- A user approves one bounded implementation task.
- A stale PR has useful intent but should be rebuilt from current `main`.
- A bug has a reproducible or clearly identified failing path.

## Cadence

- One run per bounded task.
- Do not start a second task until the current PR is merged, closed, or
  explicitly parked.

## Permission Level

Task-attached writer.

Allowed:

- Inspect current code, docs, tests, and historical PRs as evidence.
- Reproduce or clearly identify the failing path.
- Implement one approved bounded task.
- Add focused tests and docs needed for that task.
- Open one narrow PR.

## Prohibited Actions

- Do not mix unrelated work.
- Do not rebase, cherry-pick, or merge old branches.
- Do not copy broad diffs from old PRs.
- Do not start from a non-main base.
- Do not add dependencies.
- Do not delete branches.

## Protected-File Restrictions

Never touch protected paths listed in `docs/codex/automations/README.md`.

## Stop Conditions

- No failing or uncertain path can be identified.
- The fix requires broad product judgment.
- The edit boundary spans unrelated product areas.
- Verification would mutate `prisma/dev.db`.
- A required change touches protected files.
- Local status becomes unexpectedly dirty.

## Copy-Paste Codex Automation Prompt

```text
Use Plan mode first.

Use:
- AGENTS.md
- .agents/skills/ticket-to-pr-ready-loop/SKILL.md
- .agents/skills/completion-contract-loop/SKILL.md
- .agents/skills/quality-streak-loop/SKILL.md where relevant
- docs/codex/agent-loop-operating-model.md
- docs/codex/loop-library-adoption.md
- docs/codex/temporary-database-verification.md where relevant

Task:
Run the Ticket-to-PR-Ready automation for [TASK_NAME].

Historical evidence only:
[OLD_PRS_OR_DOCS]

Goal:
[ONE_BOUND_TASK_GOAL]

Before editing:
- confirm current main and clean status
- identify active files/routes/components/services
- reproduce or clearly identify the failing/uncertain path
- identify the smallest implementation boundary
- show proposed file list
- show edit plan
- identify tests and verification
- run Council Decision 1 for substantive runtime/test work

Implementation:
- edit only the approved boundary
- add focused regression coverage
- run targeted verification
- run git diff --check
- run Council Decision 2 before commit
- open one narrow PR

Never:
- mix unrelated work
- copy broad old diffs
- touch protected/local/generated files
- touch local stashes
- mutate prisma/dev.db
- add dependencies
```

## Expected Report Format

```text
Task: [name]
Decision: [PR opened / parked / blocked]
Failing or uncertain path: [path]
Edit boundary: [files]
Changed files: [files]
Verification: [commands and results]
PR: [URL or not created]
Residual risk: [none or list]
Protected files: [untouched / risk]
Next action: [babysit PR / merge after checks / split / ask user]
```

## Requires Human Approval

- Starting the task.
- Broadening scope.
- Touching files outside the approved boundary.
- Merging the resulting PR.
- Closing superseded source PRs.

## Must Never Happen Automatically

- Start new feature work without a bounded task.
- Merge or close PRs.
- Delete branches.
- Touch protected files.
- Touch local stashes.
- Claim success without verification.
