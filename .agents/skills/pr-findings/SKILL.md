---
name: pr-findings
description: Act on what the app's pull request monitor reports (a failing check, a merge conflict, a review comment) on a bound pull request, and keep it up to date with main. Use on every CI monitor event, and when the user says "babysit".
---

# PR findings

Adapted from the `babysit-pr` skill in `t3dotgg/tstack`. Upstream ships its own watcher; this
repository does not need one, so this skill keeps only the half that decides what to do with a
finding. It is Statly-owned.

## Who watches

The desktop app does. With Auto-fix on, it wakes this session on CI failures, merge conflicts and
review comments, and auto-merge lands the pull request when the gate passes. It does not wake you
when checks go green or the branch falls BEHIND, so read `get_status` on every wake and every turn,
and update a BEHIND branch then. Never write a watcher,
polling loop or `sleep` loop, never schedule a wakeup or a Monitor for CI, and never run upstream's
`pr-wait`. Every watcher on the GitHub account shares one rate limit.

"Babysit" in this repository means: bind the pull request, turn on Auto-fix and auto-archive, end
the turn, and act on each wake. Leave auto-merge as you find it: `file-pr` is the only place that
turns it on, and a `full-stop` or rebuilt pull request must stay off. If a pull request was opened elsewhere and is not bound here, first check with
`list_sessions` and `get_status` that no other session owns it; if one does, leave it to that
session and tell the user. A wake is
news, not a merge decision: check the merge gate yourself.

## GitHub rate limits

`gh pr create`, `gh pr view` and `gh pr checks` use GraphQL. When GraphQL is used up, the REST limit
is separate and usually still has room: `gh api repos/statlyaus/Statly/pulls/<n>` reads a pull
request and `gh api repos/statlyaus/Statly/commits/<sha>/check-runs` reads its checks.

## Reviews

Ignore check results older than the latest push, but act on every unresolved review thread and
unanswered comment whatever its age: the ruleset will not merge with an open conversation. Verify every bot finding against the
source before changing code. Fix real findings and CI failures. Distinguish repository failures from
infrastructure flakes: re-run only the failed jobs (`gh run rerun <id> --failed`), never a full
re-run or an empty commit.

Decide each finding explicitly, as `docs/development/delivery.md` requires:

- **structurally correct**: implement it on the same branch and state what changed;
- **wrong for this repository**: reply with the reason and the evidence, so the next reader does
  not re-raise it;
- **out of scope**: name the boundary it belongs to and record it as a follow-up.

CodeRabbit is advisory. Treat its findings like any other finding, but never wait for it and never
hold a merge for it. Use `leaving-pr-comments` for every comment posted on the user's behalf, and
resolve a thread only after its reply was posted successfully.

Keep the pull request at the size the user's goal needs. Review loops tend to grow a pull request
one cheap-looking fix at a time. Fix real bugs in the intended case. Decline the rest with a written
reason, and list them as follow-ups: unneeded tests, guards for edge cases that do not matter, extra
integration or compatibility, and small performance costs. Prefer the fix that deletes or narrows
code.

## Base branch

- **Dependabot pull requests:** Dependabot rebases and force-pushes its own branches, which would
  wipe your commits. Never push to one or run `update-branch` on it; comment `@dependabot rebase`
  verbatim, with no callout, and let it update itself. For a failing Dependabot pull request,
  report it to the user; any fix goes on its own branch from `origin/main`.
- **BEHIND:** update without being asked, by a merge; never rebase or force-push a pushed branch.
  With the branch checked out here, merge locally and push: in an app-made worktree call
  `sync_with_base_branch` (the sandbox cannot write `.claude/skills` and the other protected paths
  a local merge touches), elsewhere `git fetch origin && git merge --no-edit origin/main`. With no
  local checkout, run `gh pr update-branch <n> --repo statlyaus/Statly`, and before any later
  commit on that branch run `git pull --no-rebase origin <branch>`. If the sandbox refuses a write
  to a protected path during a merge, stop and ask the user; never work around it.
- **DIRTY (conflicts):** check the branch out and merge locally as above (`update-branch` refuses
  conflicts), resolve with `resolving-merge-conflicts`, commit, push.
- A live pull request this session owns updates in place however far behind or conflicting. That
  is the one exception to the owner's rule that such a branch is rebuilt from `origin/main`; any
  other branch that conflicts or is more than 20 commits behind goes to `modernize`.
- **A rejected push** means the remote moved, usually by `update-branch`. Run
  `git pull --no-rebase origin <branch>`, then push again. Never force.
- Never merge when the pull request is BEHIND or DIRTY, or when base commits that landed after the
  last green run touch this pull request's files. Update, push, and wait for green.

If an overlapping pull request makes this one obsolete, report it to the user and ask before
closing. If nothing changed, end the turn without a message. Never post or say "still waiting".
