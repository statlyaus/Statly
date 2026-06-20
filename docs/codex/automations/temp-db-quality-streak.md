# Temp DB Quality Streak Automation

## Purpose

Run repeatable Statly quality checks that need a disposable database without
mutating protected local state. This automation is verification-only at first.

## When To Run

- A PR needs browser/API/local smoke that creates or mutates data.
- A previous PR skipped full local smoke because `prisma/dev.db` was protected.
- A risky runtime PR needs repeated quality evidence against safe fixtures.

## Cadence

- After one manual temp DB smoke succeeds.
- Before merging runtime PRs that need local browser/API evidence.
- During flaky or stateful verification follow-up.

## Permission Level

Test/verification only at first.

Allowed now:

- Plan the quality streak.
- Inspect safe check configs.
- Use `/tmp/statly-verify-*.db` for read-only or explicitly safe verification.
- Report skipped checks and residual risk.

Deferred:

- Writing smoke flows remain disabled until one manual temp DB smoke succeeds.

## Prohibited Actions

- Do not mutate protected local state.
- Do not use `prisma/dev.db`.
- Do not continue if `DATABASE_URL` is ignored.
- Do not add package scripts.
- Do not change runtime code.
- Do not treat a failed smoke as permission to broaden scope.

## Protected-File Restrictions

Never touch protected paths listed in `docs/codex/automations/README.md`.

## Stop Conditions

- `DATABASE_URL` is missing.
- `DATABASE_URL` points inside the repository.
- A script prints, reads, or writes `prisma/dev.db`.
- `git status --short -- prisma/dev.db` shows a change.
- Generated files, Firebase exports, dataconnect local data, `coverage`, or
  `test-results` appear.
- A command asks for real secrets or production credentials.

## Copy-Paste Codex Automation Prompt

```text
Use Plan mode first.

Use:
- AGENTS.md
- .agents/skills/quality-streak-loop/SKILL.md
- .agents/skills/completion-contract-loop/SKILL.md
- docs/codex/temporary-database-verification.md
- docs/codex/agent-loop-operating-model.md
- docs/codex/loop-library-adoption.md

Task:
Run the Temp DB Quality Streak automation for [PR_OR_BRANCH].

Permission level:
Verification-only. Remain non-writing until one manual temp DB smoke has already succeeded.

Before running:
- confirm git status --short --branch
- confirm git status --short -- prisma/dev.db has no output
- set STATLY_VERIFY_DB to /tmp/statly-verify-*.db
- set DATABASE_URL=file://${STATLY_VERIFY_DB}
- confirm DATABASE_URL does not point inside the repo
- define the check streak and stop conditions

Allowed checks:
[LIST_SAFE_COMMANDS]

Stop immediately if:
- DATABASE_URL is ignored
- prisma/dev.db changes
- protected/generated/local files appear
- secrets are required
- the check needs product/runtime changes

Report:
- temp DB path
- commands run
- pass/fail results
- confirmation prisma/dev.db was unchanged
- skipped checks and residual risk

Never:
- mutate protected local state
- touch local stashes
- add scripts or dependencies
- edit runtime code
- continue after a stop condition
```

## Expected Report Format

```text
Target: [PR/branch]
Mode: [planning only / read-only verification / manual temp smoke verified]
Temp DB path: [/tmp/statly-verify-*.db or none]
Commands: [list]
Results: [pass/fail/skipped]
prisma/dev.db status before: [clean/risk]
prisma/dev.db status after: [clean/risk]
Protected artifacts: [none or list]
Residual risk: [none or list]
Next action: [continue / stop / manual smoke required]
```

## Requires Human Approval

- Enabling write-capable smoke runs.
- Running long local full-stack smoke.
- Expanding verification into implementation.
- Keeping or deleting temporary artifacts.

## Must Never Happen Automatically

- Mutate `prisma/dev.db`.
- Touch local stashes.
- Add package scripts.
- Add dependencies.
- Delete existing files or branches.
- Continue after `DATABASE_URL` or protected-file drift fails.
