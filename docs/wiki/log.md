---
title: 'Statly Wiki Log'
type: 'overview'
status: 'current'
last_updated: '2026-05-14'
sources:
  - 'docs/wiki/schema.md'
tags:
  - 'wiki'
  - 'log'
---

# Statly Wiki Log

Append entries with parseable headings:

```markdown
## [YYYY-MM-DD] ingest | Short title
```

Entry types: `ingest`, `query`, `lint`, `decision`, `contradiction`, `maintenance`.

## [2026-05-14] maintenance | Initial Statly LLM Wiki scaffold

Created the first `docs/wiki/` scaffold for a repository-local LLM-maintained engineering knowledge base.

Pages touched:

- `docs/wiki/schema.md`
- `docs/wiki/index.md`
- `docs/wiki/log.md`
- `docs/wiki/questions.md`
- `docs/wiki/overview.md`
- `docs/wiki/topics/footywire-canonical-contract.md`
- `docs/wiki/topics/design-system.md`

Sources used:

- `AGENTS.md`
- `STATLY_DESIGN_SYSTEM.md`
- `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`
- `docs/DATA_RELIABILITY.md`

Unresolved risks:

- The starter topic pages are synthesis pages, not proof that the underlying architecture is converged.
- Future ingests should verify claims against code and tests before marking detailed behavior as current.
