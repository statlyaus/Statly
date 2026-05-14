---
title: 'Statly LLM Wiki Schema'
type: 'overview'
status: 'current'
last_updated: '2026-05-14'
sources:
  - 'AGENTS.md'
  - 'STATLY_DESIGN_SYSTEM.md'
  - 'docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md'
  - 'docs/DATA_RELIABILITY.md'
tags:
  - 'wiki'
  - 'schema'
  - 'agent-workflow'
---

# Statly LLM Wiki Schema

This file is the operating contract for `docs/wiki/`.

The wiki is a persistent, LLM-maintained engineering knowledge base for Statly. It exists to reduce repeated rediscovery, preserve decision context, expose contradictions, and make future implementation work safer.

The wiki is not an authoritative source by itself. It is a generated synthesis layer that points back to authoritative sources.

## Authority Model

Authoritative sources include:

- source code
- tests
- database schemas and migrations
- `AGENTS.md`
- `STATLY_DESIGN_SYSTEM.md`
- architecture and operations docs under `docs/`
- verified runtime behavior

The LLM owns `docs/wiki/`.

The LLM may read the rest of the repository as source material, but it must not edit authoritative docs, product code, tests, migrations, or runtime configuration as part of wiki maintenance unless the user explicitly asks for that.

When a wiki page conflicts with an authoritative source, the authoritative source wins. The wiki should record the conflict, cite both sides, and add or update an open question.

## Page Frontmatter

Every wiki page must start with YAML frontmatter:

```yaml
---
title: 'Page Title'
type: 'overview | topic | decision | source-summary | question | contradiction'
status: 'current | draft | stale | conflicted | superseded'
last_updated: 'YYYY-MM-DD'
sources:
  - 'AGENTS.md'
tags:
  - 'statly'
---
```

Status values:

- `current`: source-backed and believed accurate.
- `draft`: useful but incomplete.
- `stale`: likely outdated and needs review.
- `conflicted`: contains an unresolved contradiction.
- `superseded`: replaced by a newer page or source.

## Writing Rules

- Synthesize. Do not copy long sections from source docs.
- Cite repo paths, code symbols, tests, scripts, or commands for non-obvious claims.
- Mark inference explicitly when a claim is reasoned from sources rather than directly stated.
- Prefer short pages with strong links over large documents that repeat source material.
- Use wiki links for internal wiki pages, such as `[[overview]]` and `[[footywire-canonical-contract]]`.
- Use normal markdown links for repository paths when a precise path matters.
- Do not hide uncertainty. Put unresolved issues in `docs/wiki/questions.md`.

## Ingest Workflow

Use ingest when a source should become durable knowledge.

Sources can include:

- new or changed architecture docs
- implementation plans and audits
- code changes that affect architecture or operational behavior
- tests that clarify contract behavior
- external references explicitly approved for Statly context

Steps:

1. Read the source and identify authoritative claims, decisions, risks, and open questions.
2. Search `docs/wiki/index.md` for relevant existing pages.
3. Update or create focused wiki pages.
4. Add cross-links to related pages.
5. Record contradictions instead of silently resolving them.
6. Update `docs/wiki/index.md`.
7. Append an entry to `docs/wiki/log.md`.

## Query Workflow

Use query when answering broad questions about Statly architecture, behavior, product design, or operations.

Steps:

1. Read `docs/wiki/index.md`.
2. Read relevant wiki pages.
3. Verify important claims against authoritative sources when accuracy matters.
4. Answer with citations.
5. If the answer creates reusable knowledge, offer to file it back into the wiki.

## Lint Workflow

Use lint periodically to check wiki health.

Look for:

- pages with no inbound links
- stale pages whose sources have changed
- contradictions between wiki pages
- contradictions between wiki pages and authoritative sources
- important concepts mentioned without a page
- uncited claims
- unresolved questions that should become implementation work
- pages that duplicate authoritative docs instead of synthesizing them

Record lint results in `docs/wiki/log.md`. Add unresolved findings to `docs/wiki/questions.md`.

## Contradiction Handling

Contradictions are first-class knowledge.

When a contradiction is found:

1. Preserve both claims.
2. Cite both sources.
3. Mark affected pages `status: conflicted` when the contradiction affects the page's main claim.
4. Add a `## Contradiction` section to the affected page when useful.
5. Add or update an entry in `docs/wiki/questions.md`.
6. Avoid inventing a resolution unless authoritative source material proves one.

## Long-Term Standard

The wiki is successful when future agents can answer "how does this part of Statly work?" by reading a small number of synthesized pages, then verifying details against cited source files.

The wiki is failing if it becomes:

- a second source of truth
- stale documentation without status markers
- copied source docs with different wording
- uncited architectural claims
- a place where contradictions are hidden
- broader than the system it is meant to clarify
