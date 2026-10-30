---
name: file-pr
description: File a concise pull request that leads with the problem. Use when the user asks to file, open, or create a PR, and whenever the workflow opens one.
---

# File PR

Adapted from the `file-pr` skill in `t3dotgg/tstack`; this version is Statly-owned and follows
`docs/development/delivery.md`.

Before filing, check whether a pull request for this branch already exists:
`gh pr list --repo statlyaus/Statly --head <branch>`. Review the diff against `origin/main` to make
sure its contents match the goal and carry nothing unrelated: no environment files, credentials,
local databases, or generated output. The branch comes from `origin/main`, one concern per branch.

## Title

Titles become squash commits on `main`. Use this repository's style, a plain sentence that says why
the change matters; `gh pr list --repo statlyaus/Statly --state merged --limit 10` shows the current
convention.

BAD

> ❌ perf(server): negotiate permessage-deflate on the websocket

GOOD

> ✅ perf(server): cut websocket frame size by 70%+ with gzipping

## Description

Open with a simple explanation of the problem based on the user's original prompt, then briefly
explain the solution. Do not lead with an implementation inventory:

BAD

> ❌ Removed implicit workspace carry-over from every "new thread" entry point (cmd+n / cmd+shift+o,
> sidebar v1/v2 buttons, command palette). New threads inherit only the project from context;
> branch, worktree, and env mode always come from the configured defaults. Deleted
> buildContextualThreadOptions, startNewThreadInProjectFromContext, and the v1 sidebar's
> seed-context machinery.

GOOD

> ✅ My "new worktree" default was ignored when starting new threads on existing worktrees. Super
> unintuitive. Now your preferences always apply.

Then the record `docs/development/delivery.md` requires: `## Summary` (problem, solution, the
owning boundary and decisions), `## Verification` (commands run and their results, pre-existing
failures, what was not run and why), impact on security, data, deployment or compatibility when
there is any, and follow-ups. End with `Created with <model> in Claude Code.` using the model name
the harness reports, naming subagent models that wrote part of the change, then the repository's
attribution footer.

Before submission, check the title, description, quotes and attachments for secrets, private
details, and local absolute paths.

## Filing

Open a real pull request so review bots run. Open a draft only for complex work you want to look
at in the rendered diff first, then mark it ready. Never close and recreate a pull request to
update it. If `gh pr create` fails because the GraphQL rate limit is used up, open it through
REST: `gh api repos/statlyaus/Statly/pulls -f title=... -f head=... -f base=main -F body=@<file>`.

After filing, bind the pull request in the app and turn on Auto-fix, auto-merge (squash) and
auto-archive, per the standing approval. `full-stop` is the exception: it turns auto-merge off.
From then on `pr-findings` handles what the app reports.

Do not post a follow-up pull request comment unless it serves the user's request. When a comment is
needed, use the `leaving-pr-comments` skill.
