# Statly documentation

This index lists Statly's current, maintained documentation. Source code and configuration remain the
authority when a document and implementation disagree; fix the document in the same change.

## Architecture

- [Runtime and data platform](architecture/data-platform.md) — current ownership boundaries and the
  accepted production target.
- [Realtime delivery](architecture/realtime.md) — Socket.IO, Redis, BullMQ, reconnect, and authority
  boundaries.

## Domain

- [Fantasy model](domain/fantasy-model.md) — category head-to-head scoring, league/season scope, and
  default categories.
- [Drafts and waivers](domain/draft-and-waivers.md) — draft commands, persistence, roster projection,
  and waiver availability.

## Development

- [Setup](development/setup.md) — Node, environment, Firebase, Redis, and local-stack setup.
- [Testing](development/testing.md) — supported checks and disposable database rules.
- [Dependency overrides](development/dependency-overrides.md) — reviewed npm override rationale.
- [Delivery](development/delivery.md) — pull requests, native auto-merge, archival policy, and
  post-merge verification.

## Product

- [League competition rules](product/league-competition-rules.md) — fixtures, lineups, scoring,
  standings, finals, and commissioner actions.
- [Design principles](product/design-principles.md) — AFL-first product quality, responsive data
  density, accessibility, and evidence expectations.

## Runbooks

- [PostgreSQL cutover](runbooks/postgresql-cutover.md) — planned, not yet executed.
- [Player identity consolidation](runbooks/player-identity.md) — reviewed production data operation.

## Subsystem guides

- [AFL ETL](../etl/README.md) — Footywire/fitzRoy ingestion and validation.

## Documentation policy

- Keep enduring decisions, non-obvious boundaries, and executable runbooks.
- Keep historical narration, completed plans, screenshots, and implementation summaries in merged
  pull requests and Git history.
- Do not add absolute local paths, real credentials, environment files, or claims that have not been
  verified from the current repository or deployed environment.
- Run `npm run docs:check` whenever Markdown, environment examples, agent instructions, or internal
  links change.
