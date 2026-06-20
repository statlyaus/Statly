# PR Babysitter Automation

## Purpose

Keep one Statly PR moving without broadening scope. This automation inspects
checks, review comments, changed files, and merge blockers. It may fix only
must-fix review comments that are inside the existing PR boundary.

## When To Run

- After opening a PR.
- After CI starts or finishes.
- After CodeRabbit, Sourcery, DeepSource, GitGuardian, CodeFactor, or a human
  reviewer comments.
- Before asking a human to merge.

## Cadence

- On PR creation.
- After every new commit to the PR.
- After every review-bot pass.
- Before merge readiness is reported.

## Permission Level

PR-attached.

Allowed:

- Inspect the named PR.
- Inspect CI/check status and review comments.
- Inspect the PR diff against `main`.
- Fix must-fix comments only inside the existing PR scope.
- Push a follow-up commit only after the normal Statly checks and Council
  Decision 2.

## Prohibited Actions

- Do not merge automatically.
- Do not close PRs automatically.
- Do not broaden scope.
- Do not start feature work.
- Do not edit files outside the existing PR boundary unless a must-fix comment
  proves the boundary file is required.
- Do not delete branches.

## Protected-File Restrictions

Never touch protected paths listed in `docs/codex/automations/README.md`.

## Stop Conditions

- A must-fix comment would broaden the PR.
- A required fix touches protected files.
- Checks fail for unclear infrastructure reasons.
- Local status contains unrelated dirty files.
- The PR is no longer based on current `main` and needs human merge/rebase
  judgment.

## Copy-Paste Codex Automation Prompt

```text
Use Plan mode first.

Use:
- AGENTS.md
- .agents/skills/pr-babysitter/SKILL.md
- .agents/skills/completion-contract-loop/SKILL.md
- docs/codex/agent-loop-operating-model.md
- docs/codex/loop-library-adoption.md

Task:
Run the PR Babysitter automation for PR [PR_NUMBER_OR_URL].

Permission level:
PR-attached. Do not merge. Do not close. Do not broaden scope.

Inspect:
- PR title/body
- base/head branches
- changed files
- CI/check status
- CodeRabbit comments
- Sourcery comments
- DeepSource/GitGuardian/CodeFactor status
- PR diff against main
- local branch status if relevant

Classify findings:
- must fix before merge
- optional but safe
- ignore/noise
- residual risk

If must-fix comments exist:
- show the narrow edit plan first
- edit only files already in the PR boundary unless clearly required
- run targeted verification for touched files
- run git diff --check
- run Council Decision 2 before commit
- push only the reviewed fix

If no must-fix comments exist:
- report ready for human merge consideration
- do not edit files

Never:
- merge automatically
- close automatically
- delete branches
- touch protected/local/generated files
- touch local stashes
```

## Expected Report Format

```text
PR: [number/title]
Status: [ready / needs fix / blocked / residual risk]
Checks: [pass/fail/pending summary]
Review bots: [CodeRabbit/Sourcery/DeepSource/GitGuardian/CodeFactor]
Must-fix findings: [none or list]
Optional findings: [none or list]
Residual risk: [none or list]
Files changed by babysitter: [none or list]
Verification run: [commands]
Next human action: [merge / review / rerun / decide scope]
```

## Requires Human Approval

- Merging.
- Closing.
- Broadening scope.
- Rebase/merge conflict resolution.
- Touching files outside the PR boundary.

## Must Never Happen Automatically

- Merge a PR.
- Close a PR.
- Delete a branch.
- Touch protected files.
- Touch local stashes.
- Convert optional suggestions into scope expansion.
