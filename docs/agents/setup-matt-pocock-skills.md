# Statly setup constraints

Apply these repository-owned constraints whenever `setup-matt-pocock-skills` runs. They replace the
upstream setup defaults where those defaults conflict with Statly's existing sources of truth. Do
not edit the copied upstream skill to encode these rules.

## Approved decisions

- Use GitHub Issues in [`statlyaus/Statly`](https://github.com/statlyaus/Statly/issues). Pass
  `--repo statlyaus/Statly` to GitHub CLI commands and follow
  [`docs/agents/issue-tracker.md`](issue-tracker.md).
- Keep domain language under [`docs/domain/`](../domain/fantasy-model.md) and architecture decisions
  under [`docs/architecture/`](../architecture/data-platform.md). Start from
  [`docs/README.md`](../README.md) and follow [`docs/agents/domain.md`](domain.md).
- Update the existing root [`AGENTS.md`](../../AGENTS.md) in place. Preserve surrounding project
  guidance and do not add a second `## Agent skills` section.
- Do not create `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`, or duplicate domain, architecture, or
  glossary documents.

These decisions are already approved. Do not repeat the upstream setup interview unless the user
asks to change the issue tracker or documentation layout.

## Triage labels

The `triage` skill is not installed, so do not create triage-label guidance or mutate repository
labels. If Statly installs that skill later, reuse existing labels where possible, include the
`wontfix` role, and obtain explicit approval before creating or renaming labels.

## Authority

Setup may inspect and propose repository files, but it does not grant authority to create or modify
GitHub issues, labels, pull requests, or other remote state. Follow the mutation boundaries in
[`docs/agents/issue-tracker.md`](issue-tracker.md) and the delivery process in
[`docs/development/delivery.md`](../development/delivery.md).
