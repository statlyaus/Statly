---
name: council
description: Trigger this if the user says "council". Three independent Claude reviewers score a change and loop until they are satisfied.
---

# Council

Adapted from the `council` skill in `t3dotgg/tstack`, which seats one flagship model from each of
three providers. This repository runs on Claude Code only, so this council is three fresh Claude
subagents with different briefs. It buys three independent readings of the code, not three
different trainings. Say so when you report. For most changes `review-loop` is enough. Convene a
council for security, permissions, auth, data loss, state or concurrency, or an architecture
decision, or when the user asks.

Before convening, address outstanding pull request comments, fix known issues, and run the relevant
checks. Give the council the updated implementation; do not defer known fixes until reviews return.
If the user wants to discard the implementation and explore new ideas, skip fixes to code being
replaced.

## Seats

Start three `general-purpose` agents with the Agent tool, in parallel, never as forks. Use the
most capable Claude model the tool offers unless the user names models. If the user names seats,
use those. Seats are always read-only: the brief forbids edits, commits,
pushes, pull request comments and subagents. Each seat gets the request, the diff command, the base
SHA, the intent, and one lens:

1. **Correctness.** Bugs, broken callers, mismatch with intent, tests that pass vacuously.
2. **Boundaries.** Prisma, Firebase, Firestore and Redis authority; league and season scope on
   every query, cache key, room and event; the outcomes boundary kept apart from fantasy code;
   honest commands; realtime success backed by persisted state. Root `AGENTS.md` and
   `docs/architecture/` are the reference.
3. **Product and operations.** The user's goal, docs updated with the code, migrations and data
   safety, deployment and compatibility impact, and what the diff does not need.

If you cannot seat three, report it. Do not pretend a seat ran.

Ask each seat for a score out of 10, findings with `file:line` and a severity (blocker, should,
nit), and a verdict. Count each full review pass as one round. A fresh review after fixes starts
a new round. Default budget: 3 rounds. Stop when every seat scores 9 or more with no blocker or
should open, or when a round returns only nits.

## Between rounds

Collect the responses. Summarise the useful findings, the disagreements, and the recommended next
steps. Verify each finding yourself before acting, as `review-loop` does: smallest fix, decline
nits with a reason, and fight scope creep. If you agree with a recommendation, make the change and
request a fresh round.

## Record

If the work ends in a pull request, put the results in the description, above the attribution
footer. Edit the description; do not post a comment for this.

```markdown
## Council review

Rounds: 2

| Seat                   | Round 1 | Round 2 |
| ---------------------- | ------- | ------- |
| Correctness (<model>)  | 7/10    | 9/10    |
| Boundaries (<model>)   | 8/10    | 10/10   |
| Product and operations | 7/10    | 9/10    |
```

If a seat gives no score, write `no score`. Do not invent one. If there is no pull request, put
the same results in the final reply only.
