---
name: docs-sweep-loop
description: Use for Statly documentation source-of-truth drift, historical reports, stale plans, broken links, or documentation-only cleanup.
---

# Statly documentation sweep

Use this skill when the task is primarily documentation classification, consolidation, or validation.
It does not authorize runtime product changes or reading protected local data.

## Sources

Read:

- `AGENTS.md`
- `docs/README.md`
- the named documents and their inbound links
- current source/configuration only where needed to verify a claim
- `git status --short --branch`

## Classify

Account for every scoped document as:

- Keep
- Rewrite
- Merge
- Move
- Extract enduring content, then delete
- Delete

Prefer current ownership boundaries, decisions, and executable runbooks. Completed plans, dated status
reports, screenshots, and implementation narration belong in merged pull requests and Git history.

## Protected state

Never read or modify `prisma/dev.db`, `.env*`, `.Renviron`, secrets, service-account files, Firebase
exports, generated `functions/lib`, local Data Connect state, `node_modules`, `dist`, `coverage`,
`test-results`, or unrelated output.

## Sweep

1. Identify the canonical destination before deleting or moving a source.
2. Verify operative claims from current code/configuration.
3. Extract only enduring content; do not preserve redundant prose in an archive directory.
4. Update inbound links and tests that read document paths in the same change.
5. Run `npm run docs:check` and focused tests for changed document contracts.
6. Review `git diff --check`, changed-path metadata, safe diffs that explicitly exclude protected
   state, and Markdown counts before/after. Never print a complete diff that could contain `.env*`,
   credentials, local databases, or generated output.

Stop for owner input when a document encodes unresolved product direction, deletion would remove an
unverified operational decision, or the needed change expands into runtime behavior.
