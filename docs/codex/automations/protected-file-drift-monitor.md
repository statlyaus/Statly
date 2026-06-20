# Protected File Drift Monitor Automation

## Purpose

Detect protected-file drift before it reaches a PR, commit, merge, or final
completion claim. This automation is read-only and reports risk only.

## When To Run

- Before commit.
- Before PR creation.
- Before merge.
- After local smoke or browser/API verification.
- Any time protected local state is mentioned.

## Cadence

- At the start and end of risky runtime tasks.
- After running any command that may create, seed, migrate, build, or test.
- Before every final report that claims protected files were untouched.

## Permission Level

Read-only.

Allowed:

- Inspect `git status`.
- Inspect protected path status.
- List local stashes.
- Report protected-file risk.

## Prohibited Actions

- Do not restore files.
- Do not stash files.
- Do not delete files.
- Do not edit files.
- Do not close PRs.
- Do not merge PRs.
- Do not delete branches.

## Protected-File Restrictions

Never touch protected paths listed in `docs/codex/automations/README.md`.

## Stop Conditions

- A protected path appears dirty.
- A command would need to inspect secrets.
- A command would mutate protected files.
- Local status includes unexpected files.

## Copy-Paste Codex Automation Prompt

```text
Use Plan mode first.

Use:
- AGENTS.md
- .agents/skills/repository-cleanup-loop/SKILL.md
- .agents/skills/completion-contract-loop/SKILL.md
- docs/codex/agent-loop-operating-model.md
- docs/codex/loop-library-adoption.md

Task:
Run the Protected File Drift Monitor automation.

Permission level:
Read-only. Do not edit, restore, stash, delete, close, merge, or push anything.

Inspect:
- git status --short --branch
- git status --short -- prisma/dev.db
- git status --short -- .env .env.* serviceAccountKey.json
- git status --short -- functions/lib dataconnect node_modules dist coverage test-results
- git stash list | head -5

Report:
- current branch
- whether protected paths are clean
- whether local stashes were untouched
- any unexpected dirty files
- stop condition if any protected path appears

Never:
- restore files
- stash files
- delete files
- edit files
- touch local stashes
- touch protected/local/generated files
```

## Expected Report Format

```text
Branch: [branch]
Workspace status: [clean / dirty]
Protected path status: [clean / risk]
Protected paths with changes: [none or list]
Local stash status: [untouched, top stash shown]
Stop condition: [none or reason]
Next action: [continue / stop and ask user]
```

## Requires Human Approval

- Any cleanup action.
- Any restore action.
- Any stash action.
- Any branch deletion.
- Any protected-file edit.

## Must Never Happen Automatically

- Restore, stash, delete, or edit files.
- Apply or drop stashes.
- Close or merge PRs.
- Hide protected drift by cleaning it up silently.
