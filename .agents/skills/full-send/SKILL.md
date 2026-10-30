---
name: full-send
description: Trigger this if the user says "full send". They are walking away and want the change taken to a merged pull request unattended.
---

# Full Send

The user is not watching this thread. Own the work from its current state to a merged pull request.
Your updates and your final message go unread until long after you stop.

Apply this only to an explicit "full send". Without it, follow `statly-engineering-workflow` as
usual. Adapted from the `full-send` skill in `t3dotgg/tstack`; this version is Statly-owned.

## What "full send" adds here

This repository already commits, pushes, opens a pull request and auto-merges it without asking,
and the owner's standing rule already covers test methods (browser, simulator, dev server,
screenshots). "Full send" confirms those for this task and adds three things: proof for every
change, a review loop before filing, and the merge gate below.

It does not add permission for: deleting data, touching production or infrastructure, go-live
checklist steps, waking the grading VM without `STATLY_VM_WAKE_REASON`, force-pushing, amending or
resetting a committed branch, pushing `main`, or closing a pull request you did not open.

## Steps

1. **Finish the change.** Complete the goal from the user's request with the smallest change that
   works. Fix the case that happened, not every case that could. If you are on `main`, create a
   branch from `origin/main` first. One concern per branch.
2. **Prove it.** Get proof for every change you made. See "Proof".
3. **Get feedback.** Run `review-loop` on the change. Fix blockers and shoulds; decline nits with a
   reason.
4. **File the PR** with `file-pr`. Add one short line to the description that says how you proved
   the change.
5. **Hand it to the app's monitor.** Bind the pull request and turn on Auto-fix, auto-merge (squash)
   and auto-archive, as `file-pr` says. The app wakes this session on CI failures, merge conflicts
   and review comments, not when checks go green or the branch falls BEHIND. Never poll, never run
   a watcher, never schedule a wakeup for CI.
6. **Handle every wake** with `pr-findings`: fix real findings and CI failures, with proof for each
   fix before you push it; decline the rest with a written reason.
7. **Report** in your final message: the pull request link, the head SHA, your proof, each decision
   you made for the user, and that auto-merge lands it once the merge gate passes. Say that if `main`
   moves first, the pull request goes BEHIND and waits: the monitor does not wake for that, so the
   user's next message ("babysit" is enough) gets it updated.

End the turn only when the pull request is bound with auto-merge on and nothing is left for you to
fix. A pending check is not a reason to stay; a wake is. There is no merge commit when the turn
ends; the app archives the session once the pull request merges.

## Proof

Proof is evidence you observed yourself in this session: command output, a reproduction, a
screenshot. Use the most direct proof the change allows:

- Reproduce the original failure, apply the fix, then watch the same reproduction pass.
- Run the checks CI runs for the touched boundary: `docs:check`, `lint:ci`, `typecheck`,
  `test:unit`, `test:int`, `test:e2e`, `build`.
- Add one focused test that fails without the fix, when the behaviour has none.
- For UI and runtime behaviour, run the app and look at the change. Green mocked tests do not prove
  that the user experience works. Attach screenshots to the pull request when they help.

When you cannot find a way to prove a change, you do not have full confidence. Ask the user.

## Merge gate

Full confidence means all of these are true on the latest commit:

- Your proof covers every change in the diff.
- Required checks are green.
- Review bots have finished, and each finding is fixed or dismissed with a written reason.
  CodeRabbit is advisory: never wait for it and never hold a merge for it.
- No human review still requests changes.
- The branch is up to date with `main` and GitHub reports it as mergeable. If it is BEHIND, update
  it as `pr-findings` says; never rebase or force-push.

The repository merges by squash auto-merge through branch protection. Never use `--admin` or
another bypass. Auto-merge enforces only required checks and resolved conversations; the rest of
this gate is yours. Check it on every wake, and turn auto-merge off if proof or review cannot be
completed.

## Asking the user

A question in a normal message goes unseen. Ask with `AskUserQuestion`: one short question, the
pull request link, what blocks you, and the options with your recommendation first.

Ask only when you cannot continue alone:

- You cannot prove the change.
- The merge gate cannot pass, and you cannot fix that yourself.
- The next step is outside the grant above.
- The goal is ambiguous in a way that changes the result.
- Another pull request makes this one obsolete.

Decide everything else yourself with sensible defaults, and list those decisions in the report. If
the question gets no answer, take the safe path: commit, file the pull request with auto-merge off
(or turn it off), leave it open, and start your final message with the question.
