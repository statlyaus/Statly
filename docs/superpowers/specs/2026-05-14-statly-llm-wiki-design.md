# Statly LLM Wiki Design

## Goal

Create a persistent, LLM-maintained engineering knowledge base for Statly that reduces repeated rediscovery, preserves decision context, exposes contradictions, and helps future implementation work move toward the repository's long-term architecture and design standards.

The wiki is a generated synthesis layer. It is not a replacement for source code, tests, migrations, `AGENTS.md`, `STATLY_DESIGN_SYSTEM.md`, or canonical architecture documents.

## Problem

Statly already has many durable documents, plans, audits, implementation notes, source files, and tests. Future agents can search them, but they must often reconstruct the same architecture and risk model from scratch.

The generic LLM Wiki pattern solves the accumulation problem, but it is too loose for Statly unless adapted. Statly needs source authority, contradiction handling, page lifecycle status, and verification expectations encoded from the start.

## Design

Add a wiki under `docs/wiki/`.

The LLM owns this directory. It may read the rest of the repository as source material, but it must not edit authoritative source docs or product code during wiki maintenance unless the user explicitly asks for that.

The initial wiki contains:

- `schema.md`: operating contract for future LLM wiki maintenance.
- `index.md`: content-oriented catalog that future agents read first.
- `log.md`: append-only chronological maintenance log.
- `questions.md`: unresolved questions, contradictions, and investigations.
- `overview.md`: high-level synthesis of Statly architecture and current priorities.
- `topics/footywire-canonical-contract.md`: starter synthesis of the highest-priority data architecture topic.
- `topics/design-system.md`: starter synthesis of product UI and design-system conventions.

## Authority Model

Authoritative sources include:

- source code
- tests
- database schemas and migrations
- `AGENTS.md`
- `STATLY_DESIGN_SYSTEM.md`
- architecture and operations docs under `docs/`
- verified runtime behavior

The wiki is useful only when it cites those sources or marks statements as inference, question, or hypothesis. If the wiki conflicts with code or authoritative docs, it must record the conflict instead of hiding it.

## Page Model

Each page uses YAML frontmatter:

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

Pages should synthesize rather than copy source documents. Every non-obvious claim should cite a repo path, code symbol, test file, command, or known verification gap.

## Core Workflows

### Ingest

When a new source, plan, audit, architecture doc, or major code change should become durable knowledge, the LLM reads the source, identifies claims and risks, updates relevant wiki pages, updates the index, and appends to the log.

### Query

When answering broad questions, the LLM reads `docs/wiki/index.md`, drills into relevant pages, verifies important claims against authoritative sources when accuracy matters, and offers to file durable findings back into the wiki.

### Lint

Periodic linting checks for stale pages, contradictions, orphan pages, uncited claims, missing concepts, and unresolved questions that should become implementation work.

## Contradiction Policy

Contradictions are first-class knowledge. When found, the LLM must preserve both claims, cite both sources, mark affected wiki pages as conflicted when appropriate, and add an entry to `docs/wiki/questions.md`.

The LLM must not invent a resolution unless authoritative source material proves one.

## Long-Term Success Criteria

The wiki is successful when future agents can answer "how does this part of Statly work?" by reading a small number of synthesized pages, then verifying details against cited source files.

The wiki is failing if it becomes:

- a second source of truth
- stale documentation without status markers
- copied source docs with different wording
- uncited architectural claims
- a place where contradictions are hidden
- broader than the system it is meant to clarify

## Verification

This first implementation is documentation-only. Verification should confirm:

- all expected files exist under `docs/wiki/`
- every wiki page has frontmatter
- links use the intended local wiki/page conventions
- no product code changed
- markdown formatting passes the repository's formatter check for the touched files when practical
