---
name: fresh-clone-loop
description: Use when verifying Statly setup, bootstrap, cloneability, docs accuracy, or clean-environment behavior in a disposable environment.
---

# Fresh Clone Loop

## Purpose

Use this skill to test whether Statly can be understood or bootstrapped from a clean disposable environment. It must never copy real secrets or mutate the main working tree's protected local state.

## When To Use

- Verifying setup docs.
- Checking fresh-clone dependency, test, or build assumptions.
- Auditing whether a PR is reproducible outside local state.

## When Not To Use

- Normal feature implementation.
- Work that needs real production credentials.
- Tasks that can be verified safely in the existing worktree.

## Required Inputs

- `AGENTS.md`
- Setup docs or prompt being verified
- Target branch or commit
- Disposable directory path outside protected local data
- Current `git status --short --branch` of the main worktree

## Protected Files

Never copy or read real `.env`, secrets, `serviceAccountKey.json`, Firebase exports, `prisma/dev.db`, generated `functions/lib` files, dataconnect local data, `node_modules`, `dist`, `coverage`, or `test-results` from the main worktree into the disposable clone.

## Permission Model

| Action    | Allowed Without Approval                                       | Requires Explicit Approval            | Never Automatic                       |
| --------- | -------------------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| Observe   | Inspect docs and public repo files                             | Inspecting private credentials        | Reading/copying secrets               |
| Plan      | Propose disposable clone path and commands                     | Long-running or network-heavy setup   | Using protected local DB              |
| Implement | Create/delete disposable temp clone if explicitly part of task | Installing dependencies in temp clone | Modifying main worktree               |
| Push      | Not allowed                                                    | Explicit approval only                | Pushing from disposable clone         |
| Merge     | Not allowed                                                    | Explicit approval only                | Merging from disposable clone         |
| Close     | Not allowed                                                    | Explicit approval only                | Closing PRs from clone verification   |
| Delete    | Delete only the disposable clone created for the task          | Deleting any existing user directory  | Deleting branches/stashes/local state |

## Loop

1. Confirm main worktree status and protected stash risk.
2. Choose a disposable path.
3. Clone or checkout the target without secrets.
4. Run only documented setup/verification commands.
5. Record missing docs, failing commands, and environment assumptions.
6. Remove only the disposable clone if cleanup was part of the plan.

## Stop Conditions

- A command asks for real secrets.
- A script tries to use `prisma/dev.db` from the main worktree.
- The disposable path is ambiguous or unsafe.
- Verification would mutate non-disposable state.

## Verification Expectations

- Exact commands and outputs.
- Clear distinction between docs defects and environment defects.
- Final confirmation that main worktree and stashes were untouched.
