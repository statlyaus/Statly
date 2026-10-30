---
name: modernize
description: Bring an old pull request or branch up to date and decide whether it should still exist. Use when asked to rebase, update, revive, or "modernize" a pull request or branch.
---

# Modernize

Modernize the idea, not just the branch. A clean update does not prove that the pull request still
belongs in the product. Adapted from the `modernize` skill in `t3dotgg/tstack`; this version is
Statly-owned.

## Guardrails

- Fetch `origin` before starting: `main`, the branch, and any related branch.
- Treat existing worktree changes as user-owned. Use a disposable branch or worktree when the active
  worktree is dirty or in use. Check free disk and remove a finished worktree first.
- Modernizing authorizes updating the pull request branch. It does not authorize merging, closing,
  changing the base branch, or expanding scope.
- Before touching the branch, check with `list_sessions` and `get_status` for a live or bound
  session that owns it; if one does, leave the branch to that session and tell the user. One
  session per branch.
- This repository never rebases or force-pushes a pushed branch and never amends a committed one.
  A branch with no conflicts and at most 20 commits behind updates in place by a merge, as
  `pr-findings` says for BEHIND. One that conflicts with `main` or is more than 20 commits behind
  is rebuilt: a new branch from `origin/main`, carrying only the commits not already on `main`.
- Never build on an `archive/*`, `local/*`, `backup/*` or `rescue/*` branch. Never carry commits
  from `local/*`, `backup/*` or `rescue/*` without asking the user first: most are local because
  they commit `.env.production`, `prisma/dev.db` or a live password, the repository is public, and
  the push hook publishes a branch on its first commit.
- Before carrying commits from any branch, list each one's files with
  `git show --name-only <sha>`. If one touches `.env*` other than `.env.example`, `prisma/dev.db`
  or a credential, stop and ask the user; never drop it or carry it silently.
- Do not post a pull request comment unless the user asked for one. Use `leaving-pr-comments` for
  every comment posted on the user's behalf.

## Establish the pull request's intent

Resolve the pull request and record its URL, state, base, head branch, current head SHA, author,
checks and review state. Read the title, body, linked issues, commits, review threads and complete
diff. State the smallest coherent goal it was trying to accomplish before judging its
implementation.

Record the merge base with `origin/main` so the original change and the later `main` changes can be
compared separately.

## Check what changed around it

Inspect commits and diffs added to `main` since the branch diverged. Search merged and open pull
requests when titles, code paths or behaviour suggest a replacement or competing implementation.
The session-start report also flags commits already on `main` under other hashes.

Look beyond overlapping lines:

- Has the same user-facing problem already been solved?
- Did APIs, types, schemas, dependencies, or ownership boundaries change?
- Do both sides now claim ownership of the same behaviour or invariant?
- Was the code being changed deleted, moved, or intentionally simplified?
- Would landing it restore an old behaviour or create two ways to do the same thing?
- Is the original benefit still large enough to justify the maintenance cost?

Do not describe a pull request as current merely because Git reports no conflicts.

## Choose a disposition before pushing

- **MODERNIZE**: the goal is still useful and the implementation remains the right shape. Update,
  resolve conflicts, test, and push.
- **REWORK**: the goal is still useful, but a mechanical update would preserve the wrong
  implementation. Explain the smallest credible rewrite and stop before pushing unless the user
  also asked for that rework.
- **CLOSE**: the pull request is superseded, obsolete, directionally wrong, or no longer worth its
  cost. Cite concrete evidence and stop. Do not spend time updating an obsolete branch, and do not
  close it without explicit permission.

Be willing to recommend `CLOSE`. Age alone is not evidence, and sunk effort is not a reason to keep
a pull request alive.

## Update without losing intent

For a `MODERNIZE` disposition:

1. Check out the pull request's branch in a clean worktree at the recorded head. If the branch is
   checked out elsewhere, use a detached worktree there and push with `git push origin HEAD:<branch>`.
2. No conflicts and at most 20 commits behind: update in place by a merge, as `pr-findings` says
   for BEHIND, so the local head is the pushed head.
3. Conflicting with `main` or more than 20 commits behind: check each commit's files as the
   guardrails say, then rebuild on a new branch from `origin/main` with `git cherry origin/main <branch> | awk '$1=="+"{print $2}' | xargs git cherry-pick`, which skips merge commits and patches already on `main`.
   Resolve conflicts with `resolving-merge-conflicts`, according to the pull request's intent and
   `main`'s newer invariants. If a conflict reveals a product or architecture disagreement, stop and
   reconsider the disposition instead of guessing. File the new pull request with `file-pr`,
   auto-merge off, linking the old one, and ask the user to close the old one.
4. Inspect the final diff (`git diff origin/main...HEAD`) against the original pull request's
   diff; for a rebuild, also `git range-diff` the old and new commits. Confirm that no intentional
   behaviour disappeared and no already-landed behaviour was reintroduced.
5. Run the repository's focused checks for the touched boundary. Distinguish real failures from
   pre-existing or infrastructure failures.
6. Push by adding commits. Never force.

Do not merge the pull request.

## Report

Lead with `MODERNIZE`, `REWORK`, or `CLOSE` and the reason. Then summarise:

- meaningful changes on `main`;
- conceptual conflicts or confirmation that none were found;
- the update and push result, if performed;
- checks run and their results;
- the remaining decision or work, with a link to the pull request.

Separate observed facts from judgment. Say what could not be verified instead of manufacturing
confidence.
