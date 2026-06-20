# Statly Automation Pack

## Purpose

This directory defines the documentation-only automation setup for five
high-impact Statly loops:

1. PR Babysitter
2. Protected File Drift Monitor
3. Completion Contract
4. Ticket-to-PR-Ready
5. Temp DB Quality Streak

These are copy-paste Codex automation prompts and permission models. They do not
install automations, add dependencies, change runtime code, create package
scripts, or enable fully autonomous repository maintenance.

## Shared Rules

All automations must follow:

- `AGENTS.md`
- `.agents/skills/pr-babysitter/SKILL.md`
- `.agents/skills/repository-cleanup-loop/SKILL.md`
- `.agents/skills/completion-contract-loop/SKILL.md`
- `.agents/skills/ticket-to-pr-ready-loop/SKILL.md`
- `.agents/skills/quality-streak-loop/SKILL.md`
- `docs/codex/agent-loop-operating-model.md`
- `docs/codex/loop-library-adoption.md`
- `docs/codex/temporary-database-verification.md`

## Protected Files

No automation may touch:

- `prisma/dev.db`
- `.env` or `.env.*`
- secrets or `serviceAccountKey.json`
- Firebase exports
- generated files, including `functions/lib`
- dataconnect local data
- `node_modules`
- `dist`
- `coverage`
- `test-results`
- local stashes

## Permission Summary

| Automation                   | Permission level           | Can start now?                  | Automatic writes?                           |
| ---------------------------- | -------------------------- | ------------------------------- | ------------------------------------------- |
| PR Babysitter                | PR-attached                | Yes                             | Only in-scope must-fix PR feedback          |
| Protected File Drift Monitor | Read-only                  | Yes                             | No                                          |
| Completion Contract          | Read-only / blocker        | Yes                             | No                                          |
| Ticket-to-PR-Ready           | Task-attached writer       | Yes, for approved bounded tasks | One narrow PR only                          |
| Temp DB Quality Streak       | Verification-only at first | Partially                       | No, until one manual temp DB smoke succeeds |

## Immediate Automations

These can start immediately:

- PR Babysitter, because it is attached to an existing PR and cannot merge,
  close, or broaden scope automatically.
- Protected File Drift Monitor, because it is read-only.
- Completion Contract, because it only classifies evidence and blocks unsupported
  completion claims.
- Ticket-to-PR-Ready, when the user attaches it to one approved bounded task.

## Deferred Automation

Temp DB Quality Streak is not fully enabled yet.

It must remain non-writing until one manual local smoke succeeds using a
disposable database under `/tmp/statly-verify-*.db`. If a command ignores
`DATABASE_URL`, tries to use `prisma/dev.db`, or produces protected artifacts,
the automation must stop and report residual risk.

## Must Never Happen Automatically

- Merging PRs.
- Closing PRs.
- Deleting branches.
- Dropping, popping, applying, or editing stashes.
- Restoring or deleting protected files.
- Touching `prisma/dev.db`.
- Adding dependencies.
- Adding package scripts.
- Creating broad cleanup or feature PRs.
- Claiming completion without evidence.

## Expected Use

Each page in this directory contains a copy-paste prompt. Paste the prompt into a
new Codex task, fill in the bracketed fields, and keep the automation scoped to
the named PR, task, branch, or verification target.
