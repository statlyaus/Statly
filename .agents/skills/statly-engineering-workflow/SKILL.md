---
name: statly-engineering-workflow
description: Mandatory for every Statly request that creates, changes, fixes, refactors, reviews, or prepares delivery of application, server, data, ETL, test, configuration, or documentation code.
---

# Statly Engineering Workflow

Route repository work through the smallest reliable planning, implementation, review, and delivery
path. Treat root `AGENTS.md` and Statly's canonical documentation as authoritative when an upstream
skill conflicts with repository policy.

## Start safely

1. Read the applicable `AGENTS.md` guidance and the canonical docs for the owning boundary.
2. Inspect the current worktree and preserve unrelated or protected files.
3. Identify the smallest sustainable owning-boundary change and the relevant verification commands.
4. Keep the current intermediate state functional.

## Route the work

- For a new product, feature concept, materially unresolved product direction, or request asking
  whether something is worth building, load `grill-with-docs`, `grilling`, and `domain-modeling` as
  needed to clarify demand, challenge assumptions, reconcile canonical documentation, and identify
  the narrowest valuable product before implementation planning.
- When one unresolved design question needs a runnable answer, load `prototype` before specification.
  Use its logic branch for backend state, ordering, retry, and authority questions, or its UI branch
  for competing page structures. Keep the prototype throwaway, in-memory or on an explicitly scratch
  local store, and isolated on a `prototype/*` branch. Never connect it to protected or production
  data, promote it directly as production code, or let it create `CONTEXT.md`, `docs/adr/`, or a
  parallel glossary. Capture the answer in the existing issue and, when required, the canonical
  `docs/domain/` or `docs/architecture/` source before continuing to `to-spec`.
- For a large initiative that cannot fit one session, load `to-spec`, then `to-tickets`. Do not
  publish GitHub issues unless the user requested issue creation; otherwise present the proposed
  specification and tickets for approval.
- For a difficult bug, regression, intermittent failure, or performance problem, load
  `diagnosing-bugs`. Establish one reproducible failing command before proposing a fix.
- For implementation, load `implement`, agree the observable behaviour and public test seams, then
  load `tdd`. Work in red-green-refactor slices and keep focused checks passing between slices.
- For an architecture or domain-language decision, load `codebase-design` and `domain-modeling`.
  Preserve Prisma, Firebase, Firestore, Redis, league/season scoping, ETL, and realtime ownership
  boundaries defined by Statly documentation.
- At completion, load `code-review` and review against both repository standards and the approved
  request, specification, or tickets. Resolve actionable findings before declaring the work done.
- For delivery, follow `docs/development/delivery.md` exactly.

Load specialist skills by reading their complete `SKILL.md` files before applying them. Use the
specialist method only for the phase it covers; this workflow remains the routing authority.

## Planning controls

- Work on one file at a time unless the approved task inherently requires coordinated generated
  files or a second file.
- For a complex change or any file over 300 lines, use the exact `## PROPOSED EDIT PLAN` format from
  repository guidance and wait for approval before editing.
- Make one conceptual change at a time. After each approved edit, report what changed, why, and what
  was verified.
- If new required scope appears, stop, revise the plan, and obtain approval before continuing.
- Prefer sustainable owning-boundary solutions over symptom patches or speculative abstractions.

## Completion and authority

- Run checks relevant to every changed boundary. Before a requested pull request, run the complete
  supported checks listed in root `AGENTS.md`; CI remains the deterministic authority.
- Do not create competing domain glossaries, context files, ADR trees, plans, or status archives.
- Never commit, push, open or merge a pull request, create issues, or deploy unless that external or
  delivery action is explicitly requested.
- Never include protected environment files, credentials, local databases, generated output, or
  unrelated work in the change.
