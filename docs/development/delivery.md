# Pull-request delivery and archival policy

## Standard path

Statly delivers changes through GitHub:

```text
origin/main → feature branch → implementation → local checks → pull request
→ required CI/security/review gates → native squash auto-merge → main verification
→ remote and local feature-branch cleanup
```

Do not push or commit directly to `main`, bypass a required check, force-push shared history, or add a
privileged workflow token to merge pull requests.

## Start a change

Preserve unrelated work and create the branch from the fetched remote commit:

```sh
git status --short --branch
git fetch origin --prune
git switch --create <branch> origin/main
```

If the current worktree is dirty, do not pull or reset over it. Use an isolated worktree/branch from
`origin/main` and keep local databases, environment files, generated output, and user changes out of
the new worktree diff.

## Pull-request record

The pull-request description records:

- what changed and why;
- the owning boundary and important decisions;
- verification commands and results;
- security, data, deployment, and compatibility impact;
- known pre-existing failures or residual risk; and
- any setting or follow-up that could not be completed.

Open complex work as a draft, review the rendered diff, address actionable review feedback on the same
branch, then mark it ready. Do not close/recreate a pull request merely to update it.

## Review feedback

Automated and human review comments are part of the change, not advisory. A change is not done while
it has unread comments.

Read them before marking a pull request ready, before enabling auto-merge, and after any push that may
have triggered a fresh review:

```sh
gh pr view <number> --json reviews --jq '.reviews[].body'
gh api repos/statlyaus/Statly/pulls/<number>/comments \
  --jq '.[] | .path + ":" + (.line|tostring) + " " + .body'
```

Decide each finding explicitly, and record the decision in the pull-request description or a reply:

- **structurally correct** — implement it on the same branch and state what changed;
- **wrong for this repository** — reply with the reason and the evidence, so the next reader does not
  re-raise it;
- **out of scope** — name the boundary it belongs to and record it as a follow-up.

A finding can be correct while every check passes. A split source of truth, a policy that contradicts a
persisted contract, or a test that passes vacuously are all invisible to a suite that does not assert
them, which is precisely when an unread comment costs most. A green check is not a decision.

`gh pr checks` answers whether a reviewer ran. Only the commands above answer what it said. They are
different gates, and a change can be green on the first while failing the second.

Confirm that a review happened before trusting its silence. A reviewer that skipped, exhausted its
budget, or is disabled for the base branch leaves no comments, and a skipped check reads as satisfied
to anyone who only looks at status. Record which reviewers ran and what they found. When none ran,
self-review the diff against the review rules in root `AGENTS.md` and say so in the pull request, so an
unreviewed change is a stated fact rather than an invisible one.

A reviewer's own "addressed in `<sha>`" annotation is not evidence. Verify the claim in the code or by
reproducing the failure: an annotation has been wrong in both directions, reporting a finding as
addressed when it was not, and a finding was fixed in a later commit without any annotation at all.

## Merge gates

The default-branch ruleset requires a pull request, an up-to-date branch, resolved review conversations,
and the stable checks emitted by the repository workflows and configured security scanner. This is a
single-collaborator repository, so it does not require an impossible self-approval; deterministic gates
and review conversations remain mandatory.

Branches based on anything other than `main` receive no code CI, because the workflow triggers on
`pull_request` for `main` only. That is safe rather than a gap, and the reason is worth recording so it
is not "fixed" later: a stacked pull request's commits reach `main` only through its parent, merging the
child moves the parent's head, and the ruleset's strict required checks then demand a fresh `CI Gate` for
that head. The suites run against the combined code before it can merge.

Do not widen the trigger to close the apparent gap. It duplicates the outcomes suite on every stacked
pull request and buys earlier feedback only, not correctness. When a stacked pull request needs its own
verification before that point, dispatch `CI` for its branch with `workflow_dispatch`; that is how the
run for the lock-order branch was produced.

Native GitHub auto-merge is the only automatic merger. Enable squash auto-merge only when:

- the acceptance criteria and documentation are complete;
- the pull request is ready and mergeable;
- required checks pass;
- no unresolved actionable review thread or blocking review remains;
- the diff has no secret, non-example environment file, protected data, or unrelated change; and
- the pull-request description matches the final result.

Auto-merge waits for branch protection; it is not permission to bypass it.

## Repository settings

The intended long-term settings are:

- squash merge enabled; merge commits and rebase merging disabled;
- native auto-merge enabled;
- merged head branches deleted automatically;
- `main` cannot be deleted or force-pushed;
- `main` changes require pull requests, required status checks, and resolved conversations; and
- GitHub secret scanning and push protection enabled where the repository plan supports them.

Check names are part of the delivery API. Rename a required job only in a coordinated workflow and
ruleset change.

## Archive

The merged pull request is the authoritative historical record. GitHub retains its description, diff,
commits, discussion, reviews, and recorded check outcomes. The one-parent squash commit on `main` is the
permanent code-history record.

- Do not create `archive/*` branches.
- Do not retain completed implementation plans or status reports as a second history.
- Do not tag every pull request. Reserve tags for releases, production milestones, or explicit recovery
  points.
- Do not automatically delete closed but unmerged branches; review them separately.
- A deleted merged branch can be restored from its pull request when genuinely needed.

## Post-merge verification

After GitHub merges:

1. Record the pull-request number and merge commit SHA.
2. Fetch `origin` and confirm that SHA is the remote `main` tip and has one parent.
3. Confirm required checks pass on the merged commit.
4. Confirm the remote feature branch was automatically deleted.
5. Confirm the merged pull request remains accessible as the archive.
6. Inspect deployment checks/API records tied to that exact SHA.
7. If a deployment occurred, run the documented non-destructive health/smoke checks against its
   canonical URL.
8. Fast-forward a clean local `main`, remove the completed worktree/branch, and prune remote-tracking
   references.

A successful build is not deployment evidence. If no deployment integration reports a deployment for
the merge SHA, record that no automatic deployment was observed; do not invent a production URL or run
an undocumented manual deploy.

If merged-main CI or deployment fails, preserve history, determine whether the pull request introduced
the failure, and deliver any justified correction through a new narrow pull request. Do not
automatically rewrite history, bypass protection, or revert production.
