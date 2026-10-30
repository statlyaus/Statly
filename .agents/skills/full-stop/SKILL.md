---
name: full-stop
description: Trigger this when the user asks for "full stop" as the request, never on a sentence that ends "Full stop." for emphasis. Same as full-send, but the pull request waits for the user to merge it.
---

# Full Stop

Do the same work as `full-send`, but stop with the pull request ready for the user to merge. Never
merge it. Adapted from the `full-stop` skill in `t3dotgg/tstack`; this version is Statly-owned.

Read `full-send` and follow its steps, proof rules, review loop and findings handling. An explicit
"full stop" authorizes that work, including its test methods, without a separate "full send". Its
merge permission does not apply. The overrides below take precedence.

## No merging

This is the one explicit exception to the standing approval that every pull request gets
auto-merge. Never enable it: when `file-pr` and full-send's step 5 bind the pull request, turn on
Auto-fix and auto-archive only. Right after binding, and before ending every turn, confirm with
`get_status` that auto-merge is off. This replaces full-send's "end the turn only when the pull
request is bound with auto-merge on". Report these settings. If you cannot prevent automatic
merging, report the blocker before proceeding.

You may commit and push by adding commits to this task's branch, and bring it up to date as
`pr-findings` says. Never merge, enable auto-merge, push `main`, rebase, force-push, amend or
reset a committed branch, bypass branch protection, or delegate any of those.

## Stop at the gate

Use full-send's merge gate as the readiness check. Replace its merge step with a handoff. Proof and
review must cover the final diff; recheck behaviour changes and meaningful conflict fixes before
handoff.

Fetch `origin/main` and check the live pull request's head, base, checks, reviews and mergeability.
Confirm it is open, not a draft, and not set to merge without the user. If someone else merged it,
report that instead.

- **Ready to merge:** the merge gate passes. Leave the pull request open and unmerged.
- **Checks pending:** everything else passes and only CI is running. The app does not wake you when
  checks go green, so say so with the head SHA and give the readiness verdict on the user's next
  message. Never poll.
- **Waiting for required approval:** only human approval remains. Confirm that this is the actual
  blocker.
- **Blocked:** explain what prevents readiness, what you tried, and what is needed. Follow
  full-send's rules for asking the user.

Report the pull request link, final head, verdict, proof, reviewer outcome and remaining risks.
State that the pull request is still open, unmerged, and that auto-merge is off.
