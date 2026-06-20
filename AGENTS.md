# AGENTS.md

## Goal

Build Statly through durable, root-cause engineering. The best solution is the one that makes the next related change safer, clearer, and less likely to resurrect old behavior.

Prefer the smallest change that fully solves the underlying problem. Do not confuse "small" with "local" when the real fault crosses auth, routing, data loading, caching, state, schema, or UI boundaries.

## Decision Standard

For every non-trivial bug or feature, choose the solution that best satisfies these criteria, in order:

1. Correctness at the source of truth.
2. Coherent behavior across server rendering, API routes, client navigation, and browser refresh.
3. Clear ownership of data, authorization, and presentation responsibilities.
4. Regression coverage at the boundary where the failure appeared.
5. Reviewable scope with no unrelated cleanup.

If a local fix fails any of the first three criteria, it is not the long-term solution.

## Required Working Style

Before editing a non-trivial bug or feature:

1. Reproduce or identify the failing path.
2. Trace where the bad state originates.
3. Compare against nearby working patterns.
4. Decide whether the correct fix is local or architectural.
5. State the chosen boundary for the fix.
6. Identify relevant tests, lint, type checks, and browser verification.

For complex work, use this exact plan format:

```md
## PROPOSED EDIT PLAN

Working with: [filename(s)]
Total planned edits: [number]

### Edit sequence:

1. [Specific change] - Purpose: [why]
2. [Specific change] - Purpose: [why]
3. [Specific change] - Purpose: [why]

Dependencies:

- [What depends on what]

Verification:

- [Tests/checks/browser flows]
```

For files larger than 300 lines or refactors spanning multiple concerns, present the plan before editing and wait for approval.

## LLM Council

Statly uses a repo-local adaptation of [karpathy/llm-council](https://github.com/karpathy/llm-council) for multi-perspective implementation review in Codex sessions. Use the logical council provider by default so council review does not incur API cost and does not require a local model server.

- Treat `npm run codex:council` as the default council hook for substantive Statly work in every session, worktree, and chat.
- After each user prompt, include the logical council members in decision making before choosing an edit boundary, plan, implementation approach, or verification path. For trivial prompts, this can be an internal role check; for substantive prompts, run `npm run codex:council:logical -- --prompt "<user prompt>"` or the diff variant before acting.
- The council must produce a visible debate before the chairman decides. The required order is `Committee Debate`, then `Chairman Decision`.
- The logical provider uses named council members:
  - The Contrarian - hunts for what will fail. Not pessimism, just the friend asking the questions you're avoiding.
  - First Principles - strips assumptions, asks if you're solving the right problem.
  - The Expansionist - ignores risk, hunts for hidden upside.
  - The Outsider - zero context, catches the curse of knowledge.
  - The Executor - what do you do Monday morning?
- The chairman synthesizes the verdict: where the council agrees, where it clashes, blind spots it caught, the best long-term recommendation, and one concrete next step.
- The chairman must reject short-term patches. Decision 1 and Decision 2 can proceed only when the solution is long-term, optimal for the current constraints, scalable, maintainable, and addresses the root cause at the correct ownership boundary.
- Do not treat "council review ran", "no objection", or a successful council command exit as approval. Approval requires the explicit line `CHAIRMAN DECISION 1: PROCEED` before work starts, or `CHAIRMAN DECISION 2: COMMIT` before commit.
- The chairman owns two explicit gates:
  1. Decision 1: proceed or do not proceed with the requested work. If proceed, start the automated workflow from the chairman's one concrete next step, keep the verdict visible as the decision frame, and do not stop at a recommendation or ask for confirmation.
  2. Decision 2: commit or do not commit after completed work and checks. If commit, use only the reviewed commit path below.
- For substantive work, deploy sub-agents when the active Codex session exposes multi-agent tools. Delegate outstanding supporting work and bounded, non-blocking sidecar tasks with disjoint write scopes; keep immediate blocking work local; integrate and verify sub-agent output before finalizing.
- After Decision 1 is proceed, work continues automatically into implementation: complete the approved change, carry out supporting changes through sub-agents where available, integrate their output, complete verification, stage only the intended files, then run a commit-readiness review with `npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether this completed work should be committed."` plus relevant checks.
- If Decision 2 is commit and checks pass, commit through `npm run codex:commit:reviewed -- "commit message"`. Do not use blanket staging or `npm run codex:commit` for this automated path. Do not commit unrelated dirty files, user changes, local databases, or env files.
- Use `npm run codex:council:ollama -- --prompt "..."` when a free local model-backed council is explicitly desired; the Ollama provider expects `OLLAMA_BASE_URL` or `http://127.0.0.1:11434`.
- Use `npm run codex:council:openrouter -- --prompt "..."` only when a paid OpenRouter council is explicitly desired; OpenRouter requires its API key environment variable.
- If the logical scaffold is insufficient and Ollama/OpenRouter are unavailable, state that model-backed council review was skipped and continue with the best local review path; do not block urgent or trivial work solely on council availability.
- Do not paste secrets into council prompts. The council is an engineering review aid, not product runtime code.

## Codex Agent Loops

- Use `docs/codex/agent-loop-operating-model.md` as the repo-local operating model for repeatable Codex loops that plan, implement, review, fix, re-review, and report.
- Use `.agents/skills/draft-reliability-loop/SKILL.md` for draft-room reliability loops.
- Use `.agents/skills/pr-babysitter/SKILL.md` for PR monitoring, CI follow-up, and stale PR triage loops.
- Use `docs/codex/loop-library-adoption.md` for the repo-local Loop Library-inspired workflow set: repository cleanup, completion contracts, ticket-to-PR-ready planning, fresh-clone verification, docs sweeps, and quality streaks.
- These loop docs do not replace the council gates above; preserve Decision 1 before substantive work and Decision 2 before commit.

## Architecture Rules

- Server Components should load protected server data through server-side loaders, services, or repositories.
- Do not make a Server Component fetch this app's own API route when shared server code can be called directly.
- API routes are transport adapters. They should authenticate, call shared server logic, and translate the result to HTTP.
- Client Components should fetch through client-aware APIs only when browser auth/session state or interaction requires it.
- Authorization belongs at the data boundary, not only in page components or UI affordances.
- Normalize external, optional, or legacy data before it reaches rendering components.
- Expected 401, 403, and 404 states should be returned or rendered deliberately. Do not log them as unexpected failures.
- Unexpected failures should be logged with useful context and without leaking secrets.
- Navigation components must not silently rewrite the user's route unless that redirect is explicit product behavior.
- Next.js prefetching must not trigger noisy unauthorized server work. If protected routes are prefetched, the server auth/session path must handle that cleanly.

## UI And shadcn Standards

- Follow existing shadcn/ui-style composition and open-code patterns.
- Prefer small composed primitives over monolithic custom wrappers.
- Use semantic theme tokens such as `bg-background`, `text-foreground`, `border-border`, and established project CSS variables.
- Preserve light/dark support where the surrounding feature supports it.
- Preserve keyboard support, focus visibility, labels, and screen-reader clarity.
- Every interactive element needs a semantic element or accessible name.
- Prefer existing primitives and local patterns over new abstractions.
- Do not add dependencies unless clearly justified and approved.
- Avoid unrelated visual redesign while fixing behavior.

## Done Means

A task is done only when:

- The requested behavior is implemented.
- The root cause is addressed at the correct boundary.
- The diff is reviewable and avoids unrelated cleanup.
- Relevant regression tests pass.
- Relevant lint, type, and build checks pass, or any remaining warnings are explicitly reported.
- Browser behavior is verified for route, hydration, navigation, or visual changes.
- The final summary states what changed, why, what was verified, and any residual risk.
