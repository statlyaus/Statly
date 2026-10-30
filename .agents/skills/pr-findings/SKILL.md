---
name: pr-findings
description: Act on what the app's pull request monitor reports (a failing check, a conflict, a BEHIND branch, a review comment) on a bound pull request. Use on every CI monitor event, and when the user says "babysit".
---

# PR findings

Adapted from the `babysit-pr` skill in `t3dotgg/tstack`. Upstream ships its own watcher; this
repository does not need one, so this skill keeps only the half that decides what to do with a
finding. It is Statly-owned.

## Who watches

The desktop app does. With Auto-fix on, it wakes this session on CI failures, merge conflicts and
review comments, and auto-merge lands the pull request when the gate passes. Never write a watcher,
polling loop or `sleep` loop, never schedule a wakeup or a Monitor for CI, and never run upstream's
`pr-wait`. Every watcher on the GitHub account shares one rate limit.

"Babysit" in this repository means: bind the pull request, turn the switches on, end the turn, and
act on each wake. If a pull request was opened elsewhere and is not bound, bind it first. A wake is
news, not a merge decision: check the merge gate yourself.

## GitHub rate limits

`gh pr create`, `gh pr view` and `gh pr checks` use GraphQL. When GraphQL is used up, the REST limit
is separate and usually still has room: `gh api repos/statlyaus/Statly/pulls/<n>` reads a pull
request and `gh api repos/statlyaus/Statly/commits/<sha>/check-runs` reads its checks.

## Reviews

Only act on checks and comments newer than the latest push. Verify every bot finding against the
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

- **BEHIND:** run `gh pr update-branch <n> --repo statlyaus/Statly` without being asked. It adds a
  merge commit; never rebase or force-push a pushed branch.
- **DIRTY (conflicts):** merge `origin/main` into the branch locally, resolve with
  `resolving-merge-conflicts`, commit, push.
- Never merge when the pull request is BEHIND or DIRTY, or when base commits that landed after the
  last green run touch this pull request's files. Update, push, and wait for green.

If an overlapping pull request makes this one obsolete, report it to the user and ask before
closing. If nothing changed, end the turn without a message. Never post or say "still waiting".
