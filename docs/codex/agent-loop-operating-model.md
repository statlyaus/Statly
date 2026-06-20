# Codex Agent Loop Operating Model

## Purpose

This document defines the repeatable Codex agent-loop workflow for Statly. It is documentation and skill scaffolding only; it does not change product runtime behavior.

Use it when a Codex session needs to plan, implement, review, fix, re-review, and report work in a way that preserves Statly's existing council gates and source-of-truth discipline.

## Files

- `.agents/skills/draft-reliability-loop/SKILL.md`: first concrete loop for draft-room reliability work.
- `.agents/skills/pr-babysitter/SKILL.md`: PR monitoring, CI follow-up, stale PR triage, and status reporting loop.
- `docs/codex/agent-loop-operating-model.md`: this operating model.
- `AGENTS.md`: short pointer to this model and the repo-local skills.

## Non-Negotiables

- Preserve the council gates in `AGENTS.md`.
- Do not treat council output as verification.
- Do not change runtime code during documentation-only loop work.
- Do not touch protected files: `prisma/dev.db`, `.env`, secrets, `serviceAccountKey.json`, Firebase exports, `node_modules`, `dist`, `coverage`, or `test-results`.
- Keep diffs small, explicit, and reviewable.
- Stage only intended files when commit work is in scope.

## Core Loop

1. Plan.
   - Read `AGENTS.md` and any relevant source-of-truth spec or plan.
   - Run the logical council for substantive work.
   - Continue only after `CHAIRMAN DECISION 1: PROCEED`.
   - State the files, ownership boundary, verification path, and protected-file exclusions.

2. Implement.
   - Make the smallest durable change at the owning boundary.
   - Follow existing repo patterns.
   - Avoid dependencies unless explicitly approved.
   - Keep documentation-only work out of runtime files.

3. Review.
   - Run relevant markdown, lint, type, test, browser, or API checks.
   - Review `git diff` for scope, correctness, and unrelated changes.
   - Do not skip verification because the change is small.

4. Fix.
   - Address failed checks, review findings, or stale assumptions.
   - If new required work crosses the approved boundary, stop and update the plan.

5. Re-review.
   - Re-run the checks that cover the edited boundary.
   - Re-read the final diff.
   - Run Decision 2 before commit when committing is in scope.

6. Report.
   - State what changed, why it changed, what was verified, and residual risk.
   - Include concrete evidence: commands, routes, IDs, URLs, or file paths.
   - Do not claim behavior was verified when only syntax or prose was checked.

## First Concrete Loop: Draft-Room Reliability

Use `.agents/skills/draft-reliability-loop/SKILL.md` for draft-room reliability work, including:

- realtime draft state and persisted pick catch-up;
- manual and automatic pick flow;
- draft room hydration, reload, and direct-load behavior;
- queue, watchlist, and available-player table regressions;
- roster projection and waiver availability after completed drafts;
- browser verification across desktop and mobile when UI behavior changes.

The draft-room loop starts from the same pattern used in the fantasy consolidation docs: establish the source of truth, identify the failing path, fix the owning boundary, verify with concrete browser/API/test evidence, then record residual risk.

## PR Babysitting Loop

Use `.agents/skills/pr-babysitter/SKILL.md` when the task is to keep PRs moving rather than build new product scope.

### Status Prompt

```text
Use the pr-babysitter skill.

PR:
[URL or branch]

Goal:
Inspect status only. Do not edit files.

Report:
- Current branch/base
- CI and review state
- Conflicts or stale risk
- One recommended next action
```

### CI Follow-Up Prompt

```text
Use the pr-babysitter skill.

PR:
[URL or branch]

Goal:
Fix only the failing CI boundary.

Constraints:
- Preserve Statly council gates.
- Do not touch protected files.
- Do not broaden PR scope.

Done when:
- Failing CI path is identified.
- Minimal fix is applied.
- Relevant local check passes or residual risk is reported.
```

### Stale PR Triage Prompt

```text
Use the pr-babysitter skill.

PR list:
[URLs or branch names]

Goal:
Classify each PR as ready, needs-rebase, needs-fix, superseded, or abandon.

Report:
- Classification
- Evidence
- Next action
- Whether council review is required before edits
```

## Review Evidence

For documentation-only agent-loop work, relevant verification is usually:

```bash
npm exec -- prettier --check AGENTS.md .agents/skills/draft-reliability-loop/SKILL.md .agents/skills/pr-babysitter/SKILL.md docs/codex/agent-loop-operating-model.md
git diff -- AGENTS.md .agents/skills/draft-reliability-loop/SKILL.md .agents/skills/pr-babysitter/SKILL.md docs/codex/agent-loop-operating-model.md
git status --short
```

Runtime checks such as `npm run typecheck`, `npm run test:unit`, and browser verification are required when runtime code changes. They are optional for documentation-only scaffolding unless the edited docs reference runtime behavior that must be re-proven.

## Done Criteria

- The relevant skill or operating model explains the loop end to end.
- Draft-room reliability is represented as the first concrete loop.
- PR babysitting and stale PR triage have reusable prompts.
- Existing council gates remain intact.
- Verification evidence is recorded in the final report.
