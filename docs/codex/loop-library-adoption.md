# Loop Library Adoption

## Purpose

This document records the Statly-specific adoption of useful Loop Library-style workflow patterns. These are repo-local documentation and skills only. They do not install global skills, add dependencies, change runtime behavior, or enable autonomous repository maintenance.

## Adopted Loops

| Loop                | Repo-local skill                                   | Statly use                                                                                        |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Repository cleanup  | `.agents/skills/repository-cleanup-loop/SKILL.md`  | Scoped stale PR cleanup, protected-file triage, and branch-sprawl control.                        |
| Completion contract | `.agents/skills/completion-contract-loop/SKILL.md` | Evidence-backed final reports and done-criteria checks.                                           |
| Ticket to PR-ready  | `.agents/skills/ticket-to-pr-ready-loop/SKILL.md`  | Turning issues, prompts, or stale PR intent into narrow implementation plans from current `main`. |
| Fresh clone         | `.agents/skills/fresh-clone-loop/SKILL.md`         | Disposable setup verification without copying real secrets or local DB state.                     |
| Docs sweep          | `.agents/skills/docs-sweep-loop/SKILL.md`          | Separating current source-of-truth docs from historical complete notes and stale plans.           |
| Quality streak      | `.agents/skills/quality-streak-loop/SKILL.md`      | Repeated verification runs using safe fixtures or temporary databases only.                       |

## Why These Fit Statly

Statly has accumulated old branches, stale PRs, historical completion docs, and local-only development state. These loops keep future Codex sessions from repeating the same failure modes:

- closing or merging PRs without checking current `main`;
- claiming work is done without concrete test, API, browser, or status evidence;
- copying broad diffs from old stacked branches;
- using real secrets or protected local databases for verification;
- treating historical markdown as current source of truth;
- running quality checks that mutate `prisma/dev.db` or produce protected artifacts.

## Permission Boundaries

All adopted loops separate these actions:

- `observe`: inspect files, PRs, checks, docs, or status;
- `plan`: propose scope, file list, verification, and stop conditions;
- `implement`: edit only after the applicable Statly gate and within scope;
- `push`: only after intended changes are verified and committed;
- `merge`: only after explicit instruction, passing checks, and review requirements;
- `close`: only when explicitly scoped, with explanatory comments;
- `delete`: never automatic for branches, stashes, protected data, or historical docs.

## Deferred Automation

Five-minute maintainer style automation is intentionally not enabled.

Reasons:

- Statly still needs human product judgment for onboarding, draft reliability, dashboard, and player-data workflows.
- Closing, merging, or deleting repository state can lose useful intent if done without scoped review.
- Local `prisma/dev.db`, stashes, env files, Firebase exports, generated files, and dataconnect local data are protected.
- Verification often requires choosing between temporary databases, browser checks, API checks, and product-specific fixtures.
- Council gates in `AGENTS.md` remain the controlling workflow for substantive work.

Until this changes, automated maintenance is limited to explicitly requested, scoped actions in a Codex session.

## Source-Of-Truth Rules

- Use `AGENTS.md` for repository-wide working rules and council gates.
- Use `docs/codex/agent-loop-operating-model.md` for the base Codex loop model.
- Use `.agents/skills/pr-babysitter/SKILL.md` for PR monitoring and cleanup.
- Use `.agents/skills/draft-reliability-loop/SKILL.md` for draft reliability work.
- Use the new Loop Library-inspired skills only when their trigger matches the task.

Historical docs, completed plans, stale PR descriptions, and old branch diffs are evidence. They are not source-of-truth instructions unless current docs or the user explicitly promote them.

## Verification For Loop Changes

Documentation-only loop changes should normally verify with:

```bash
npm exec -- prettier --check AGENTS.md .agents/skills/*/SKILL.md docs/codex/*.md
git diff --check
git status --short
```

Skill frontmatter should also be validated locally before commit. Runtime checks are not required unless runtime files are edited.
