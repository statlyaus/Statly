# Statly skill routing

This policy is the Statly-owned routing layer over the locked upstream `ask-matt` skill. The upstream
file remains byte-for-byte compatible with `skills-lock.json`; where its route map conflicts with
this document or root `AGENTS.md`, the Statly guidance wins.

## Availability rule

Any skill not installed under `.agents/skills/` is unavailable and must not be recommended or
invoked. Mentions of unavailable upstream flows in `ask-matt` are descriptive upstream content, not
routes that Statly supports. Do not approximate a missing route by creating its expected files or by
silently substituting a different workflow.

Use these supported routes:

- New or materially unresolved product work: `grill-with-docs` or `grilling`, then
  `domain-modeling`; use `prototype` only for a question requiring a runnable answer.
- Large implementation: `to-spec`, then `to-tickets`, then `implement` with `tdd`.
- Focused implementation: `implement` with `tdd`.
- Difficult defects: `diagnosing-bugs`, then `tdd` for the correction.
- Architecture and module design: `codebase-design` with `domain-modeling` where terminology or
  ownership is involved.
- Review: `code-review`; use `product-design-review` for product-level UI review.
- Merge or rebase conflicts: `resolving-merge-conflicts`.
- Documentation drift: `docs-sweep-loop`.
- Draft-room reliability: `draft-reliability-loop`.
- Primary-source investigation: `research`.

The mandatory `statly-engineering-workflow` remains the routing authority for repository changes and
may narrow these routes further.

## Repository-owned persistence

Do not follow upstream instructions to create `CONTEXT.md`, `CONTEXT-MAP.md`, or `docs/adr/`. Record
domain language in `docs/domain/`, architecture decisions in `docs/architecture/`, specifications and
tickets in GitHub Issues when authorized, and delivery history in the pull request.
