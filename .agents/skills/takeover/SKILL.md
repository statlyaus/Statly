---
name: takeover
description: Take over existing work. Use when the user asks to take over a pull request, branch, worktree, or another session's thread, or requests a takeover.
---

# Takeover

Take responsibility for finishing the original goal while preserving the original contributors'
credit. Do not defend an implementation just because another agent already built it. Adapted from
the `takeover` skill in `t3dotgg/tstack`; this version is Statly-owned.

In this repository "someone else" is usually another Claude session, a worktree, or a handoff note
under `.statly-local/`. Before touching anything, read the linked issue's comments and list the
sessions for one still working on it or bound to its pull request: one session per ticket. A running session owns its
branch; message it or stop, never race it.

## Read the handoff

Read the source pull request, branch, or thread, including review findings and the user's later
corrections. Resolve the handoff to the actual code and current head, and account for uncommitted
work in its worktree (`git status --porcelain --ignored`; never remove a worktree that holds
`.statly-local/` data). Treat the handoff as context, not proof. If the source is a `local/*`,
`backup/*` or `rescue/*` branch, ask the user before carrying anything, as `modernize` says.

## Continue on a new branch

Check each commit's files as `modernize` says, then create a new branch from `origin/main` and
carry the original commits onto it with
`git cherry origin/main <branch> | awk '$1=="+"{print $2}' | xargs git cherry-pick`. It keeps Git authorship and co-author trailers, and skips
merge commits and patches already on `main`. Then add your fixes as separate commits. Never
amend, rebase, reset or force-push the original branch. Continue in place only when the user asks
for it, and then only by adding commits. Do not overwrite unrelated work or change the original
pull request without authorization. If the original has auto-merge on
(`gh pr view <n> --repo statlyaus/Statly --json autoMergeRequest`), ask the user to turn it off:
two pull requests carrying the same commits must not both be able to merge.

Credit the original contributors in the pull request description and link the original pull request
when there is one. Name a session by the model that ran it. The squash merge keeps `Co-Authored-By`
trailers; use verified identities, never guessed emails. Model attribution is not a substitute for
contributor credit.

Use `modernize` to update the continuation against `origin/main` and the current architecture.
Rework what is necessary to finish the same goal, not unrelated features. Simplify the
implementation without dropping intended behaviour or surfaces. Recheck the source pull request
too: it may have improved while you were working.

## Verify for yourself

Independently verify the original failure and realistic workflows, following repository guidance
and permissions. Run the touched boundary's checks. For UI, run the app and look. Green mocked tests
do not prove the user experience works. State what remains unverified.

## Finish

When the requested finish includes a pull request, use `file-pr` to file or update it, hand it to
the app's monitor, and handle wakes with `pr-findings`. Use `leaving-pr-comments` for replies and
for the note on the original pull request. Merge or close the original pull request only when
authorized.

Report what you inherited, what you changed, how you verified it, how credit was preserved, and any
remaining decision.
