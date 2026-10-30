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
- This repository never rebases or force-pushes a pushed branch and never amends a committed one.
  A branch updates by `gh pr update-branch` or by merging `origin/main` into it. A branch that
  conflicts with `main` or is more than 20 commits behind is rebuilt: a new branch from
  `origin/main`, carrying only the commits not already on `main`.
- Never build on an `archive/*`, `local/*`, `backup/*` or `rescue/*` branch. Branch from
  `origin/main` and carry the commits over.
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

1. Work on a disposable local branch or worktree at the recorded head.
2. Clean and shallowly behind: `gh pr update-branch <n> --repo statlyaus/Statly`. Otherwise merge
   `origin/main` into the branch and resolve each conflict with `resolving-merge-conflicts`,
   according to the pull request's intent and `main`'s newer invariants. If a conflict reveals a
   product or architecture disagreement, stop and reconsider the disposition instead of guessing.
3. Conflicting with `main` or more than 20 commits behind: rebuild on a new branch from
   `origin/main` by cherry-picking only the commits not already on `main`, open a new pull request
   that links the old one, and leave closing the old one to the user.
4. Compare before and after with `git range-diff` and inspect the final diff. Confirm that no
   intentional behaviour disappeared and no already-landed behaviour was reintroduced.
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
