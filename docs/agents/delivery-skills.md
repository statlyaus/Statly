# Delivery skills

Nine Statly-owned skills adapted from [`t3dotgg/tstack`](https://github.com/t3dotgg/tstack) for
Claude Code. They cover the stretch from "the change works on my machine" to "the pull request
merged": review, filing, findings, old branches, handoffs, and running unattended. They are not in
`skills-lock.json`: edit them here, in `.agents/skills/<name>/SKILL.md`.

## Say this, get that

| Say           | Skill                 | What it does                                                                                        | When it earns its cost                                                                                            |
| ------------- | --------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "full send"   | `full-send`           | Finishes the change, proves it, runs a review loop, files the PR, hands it to the app, auto-merges. | You are walking away and want it merged without another look.                                                     |
| "full stop"   | `full-stop`           | Same as full send, but turns auto-merge off and stops with the PR ready for you.                    | You want it done but want to be the one who merges.                                                               |
| "review loop" | `review-loop`         | A fresh Claude reviewer reads the diff; the agent fixes blockers, declines nits; up to 3 rounds.    | Before any non-trivial PR. Cheap. The agent runs it unprompted when a change warrants it.                         |
| "council"     | `council`             | Three fresh Claude reviewers with different lenses score the change out of 10 and loop.             | Security, permissions, auth, data loss, state or concurrency, or an architecture call. Three reviewers per round. |
| "file a PR"   | `file-pr`             | Files a PR that leads with the problem, then the solution, in this repository's record format.      | Every PR. The agent uses it whenever it opens one.                                                                |
| "babysit"     | `pr-findings`         | What to do when the app reports a failing check, conflict, BEHIND branch or review comment.         | Every CI monitor event. The app does the watching; this is the handling.                                          |
| "modernize"   | `modernize`           | Updates an old PR or branch and decides MODERNIZE, REWORK or CLOSE.                                 | A PR older than a week, BEHIND with conflicts, or one you are not sure should still exist.                        |
| "take over"   | `takeover`            | Finishes another session's PR, branch or handoff on a new branch, keeping its credit.               | Another session left work half done, or a handoff note in `.statly-local/` points at a branch.                    |
| (automatic)   | `leaving-pr-comments` | Formats every GitHub comment the agent posts on your behalf.                                        | Any reply to a bot or reviewer.                                                                                   |

## How the agent brings them up

The skills only pay off if they get used at the right moment, so the agent is expected to name
them when the moment comes.

**Offers.** At these moments the agent says, in one line, which skill fits and the words that
trigger it, then keeps working. It never blocks on the offer:

- You say you are leaving, or "just get it done": `full-send` or `full-stop`.
- A change touches auth, permissions, data deletion, migrations, or state and concurrency:
  `council`.
- A pull request is more than a week old, BEHIND with conflicts, or you ask whether it is still
  worth landing: `modernize`.
- You point at another session's branch, worktree, or a handoff note: `takeover`.

**Unprompted use.** The agent may run `review-loop`, `file-pr`, `pr-findings`, `modernize` and
`leaving-pr-comments` without asking when they are clearly worth it, and says which it used.
`full-send`, `full-stop` and `council` run only on your word: the first two change whether and when
a pull request merges, and the third costs three reviewers per round.

## Learning them

- "I'm going to bed. Land the waiver fix." Say **full send**. The agent proves the fix, runs a
  review loop, files the PR, turns the app's switches on, and ends its turn. The app wakes it on a
  failure; auto-merge lands it.
- "Get the trade page PR ready, I'll merge it tomorrow." Say **full stop**. Same work, auto-merge
  off, and a verdict: ready, waiting for approval, or blocked.
- "This touches FAAB debits." Say **council**, or let the agent offer it. Three seats: correctness,
  Statly boundaries, product and operations. Scores land in the PR description.
- "PR 950 has been sitting for two weeks." Say **modernize**. The agent reads what `main` did in
  the meantime and recommends MODERNIZE, REWORK or CLOSE before touching the branch. Here a branch
  is updated with `gh pr update-branch` or rebuilt from `origin/main`, never rebased or force-pushed.
- "The other session got halfway through #853." Say **take over**. New branch from `origin/main`,
  original commits carried over with their authorship, fixes on top, credit in the PR.
- A CI monitor event arrives. No trigger needed: `pr-findings` decides each finding as
  `docs/development/delivery.md` requires, re-runs only failed jobs, and updates a BEHIND branch
  without asking.

## What changed from upstream

| Upstream                                                  | Here                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `sol-loop` reviews with OpenAI's GPT Sol through T3 tools | `review-loop`: a fresh Claude subagent via the Agent tool, continued with `SendMessage` between rounds.         |
| `council` seats three providers' flagships                | Three Claude seats with different lenses. Independence of reading, not of training; the skill says so.          |
| `babysit-pr` ships a Python watcher, `pr-wait`            | `pr-findings`: the desktop app's Auto-fix monitor watches; the skill keeps only the handling rules.             |
| Rebase and `--force-with-lease`                           | `gh pr update-branch`, merge `origin/main` into the branch, or rebuild from `origin/main`. No force-push, ever. |
| Open a real PR, never a draft                             | A draft only for complex work you want to see rendered first, per `docs/development/delivery.md`.               |
| Merge when the gate passes, stay until merged             | Auto-merge, Auto-fix and auto-archive via the app; the session ends its turn and is woken on events.            |
| Ask with the harness's question tool                      | `AskUserQuestion`: one short question, options, recommended first.                                              |
| `gh` on the current repo                                  | `--repo statlyaus/Statly` everywhere.                                                                           |

Dependencies between them: `full-send` uses `review-loop`, `file-pr` and `pr-findings`.
`full-stop` uses `full-send`. `takeover` uses `modernize`, `file-pr`, `pr-findings` and
`leaving-pr-comments`. `file-pr`, `pr-findings` and `modernize` use `leaving-pr-comments`.
