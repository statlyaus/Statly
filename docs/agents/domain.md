# Domain and architecture documentation

Statly already has canonical domain and architecture documentation. Engineering skills must extend
that structure instead of introducing Matt Pocock's default `CONTEXT.md` and `docs/adr/` layout.

## Read before exploring

Start at [`docs/README.md`](../README.md), then read only the sources relevant to the owning boundary:

- [`docs/domain/fantasy-model.md`](../domain/fantasy-model.md) and the adjacent domain documents for
  fantasy concepts, competition rules, drafts, rosters, waivers, trades, scoring, and shared product
  language.
- [`docs/architecture/data-platform.md`](../architecture/data-platform.md) and the adjacent
  architecture documents for runtime ownership, authorization, persistence, realtime delivery,
  ingestion, and external-system boundaries.
- [`docs/development/testing.md`](../development/testing.md) and the adjacent development documents
  for testing, delivery, and engineering operations.
- Root [`AGENTS.md`](../../AGENTS.md) for repository-wide sources of truth and safety constraints.

Follow direct links from these indexes and documents rather than loading every file.

## Preserve one source of truth

- Do not create `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`, or a parallel glossary.
- Record clarified terminology in the relevant existing `docs/domain/` document.
- Record durable architecture decisions in the relevant existing `docs/architecture/` document, or
  add a focused document there and link it from `docs/README.md` when the approved scope requires it.
- Use the vocabulary already established by the canonical documents. Surface conflicts explicitly
  instead of silently redefining a term or ownership boundary.
- Historical plans, status reports, and completed implementation notes are not sources of truth;
  delivery history belongs in the pull request described by `docs/development/delivery.md`.

When an upstream skill asks for a glossary or ADR, apply its reasoning method but write the durable
result into this Statly-owned structure.
