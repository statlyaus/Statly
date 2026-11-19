# Statly skill routing

This policy is the Statly-owned routing layer over the locked upstream skills. The upstream files
remain byte-for-byte compatible with `skills-lock.json`; where their instructions conflict with this
document or root `AGENTS.md`, the Statly guidance wins.

## Availability rule

Any skill not installed under `.agents/skills/` is unavailable and must not be recommended or
invoked. Mentions of unavailable upstream skills inside locked upstream files (for example
`/setup-matt-pocock-skills` in `to-spec` and `to-tickets`, or `code-review` in `tdd`) are
descriptive upstream content, not routes that Statly supports. Do not approximate a missing route
by creating its expected files or by silently substituting a different workflow.

Use these supported routes:

- New or materially unresolved product work: `grilling`, reconciled with the canonical docs in
  `docs/agents/domain.md`; use `prototype` only for a question requiring a runnable answer.
- Large implementation: `to-spec`, then `to-tickets`, then `ponytail` with `tdd`.
- Focused implementation: `ponytail` with `tdd`.
- Difficult defects: `diagnosing-bugs`, then `tdd` for the correction.
- Architecture and module design: `codebase-design`, with `docs/agents/domain.md` where terminology
  or ownership is involved.
- Review: `review-loop`; use `product-design-review` for product-level UI review.
- Merge or rebase conflicts: `resolving-merge-conflicts`.
- Documentation drift: `docs-sweep-loop`.
- Draft-room reliability: `draft-reliability-loop`.
- Delivery, from a working change to a merged pull request: the Statly-owned adaptations of
  `t3dotgg/tstack` in `docs/agents/delivery-skills.md`. `review-loop` ("review loop") before a
  pull request; `council` for security, auth, data loss, state or architecture; `file-pr` to open
  one; `pr-findings` on every CI monitor event; `modernize` for an old pull request; `takeover`
  for another session's work; `leaving-pr-comments` for every GitHub comment; `full-send` and
  `full-stop` when the user walks away. Offer the fitting one at its moment; run `full-send`,
  `full-stop`, `council` and a `modernize` update or rebuild only on the user's word.

Statly override: `grilling` asks one question at a time through the AskUserQuestion tool (owner
preference), not as prose questions inside a reply.

Where `ponytail` conflicts with `statly-engineering-workflow` (planning gates, `tdd`
red-green-refactor, test-framework use) or root `AGENTS.md`, the Statly guidance wins. Its
exceptions for validation, security, and accessibility always apply.

The mandatory `statly-engineering-workflow` remains the routing authority for repository changes and
may narrow these routes further.

## Claude Code registration

Claude Code loads skills only from `.claude/skills/`, which holds one symlink per registered skill
into `.agents/skills/`. Registered: `statly-engineering-workflow`, `grilling`, `to-spec`,
`to-tickets`, `ponytail`, `tdd`, `diagnosing-bugs`, `resolving-merge-conflicts`, `codebase-design`,
`prototype`, `docs-sweep-loop`, `draft-reliability-loop`, `product-design-review`,
`unslop-design`, `review-loop`, `council`, `file-pr`, `pr-findings`, `modernize`, `takeover`,
`leaving-pr-comments`, `full-send`, and `full-stop`.

Every installed skill is registered. To register a new one, add its symlink:
`ln -s ../../.agents/skills/<name> .claude/skills/<name>`.

## Repository-owned persistence

Do not follow upstream instructions to create `CONTEXT.md`, `CONTEXT-MAP.md`, or `docs/adr/`. Record
domain language in `docs/domain/`, architecture decisions in `docs/architecture/`, specifications and
tickets in GitHub Issues when authorized, and delivery history in the pull request.
