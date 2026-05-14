# Docs Architecture Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land architecture and governance documentation after the code slices are stable.

**Architecture:** Documentation should describe the converged system and operating rules, not compensate for unresolved drift. Keep long-form analysis in docs and keep `AGENTS.md` focused on execution rules.

**Tech Stack:** Markdown documentation, repo AGENTS operating instructions, no runtime code.

---

## Scope

This PR owns documentation only:

- `AGENTS.md`
- `STATLY_DESIGN_SYSTEM.md`
- `docs/DOMAIN_GLOSSARY.md`
- `docs/LANGUAGE_AUDIT_2026-04-27.md`
- `docs/STRUCTURED_LANGUAGE_AUDIT_2026-04-27.md`
- `docs/TEAM_CLUB_LANGUAGE_AUDIT_2026-04-27.md`
- `docs/UBIQUITOUS_LANGUAGE_GOVERNANCE.md`
- `docs/audits/2026-04-29-full-code-audit.md`
- `docs/audits/2026-04-29-full-code-audit-evidence.md`

## Task 1: AGENTS Operating Contract

- [ ] **Step 1: Review code slice outcomes**

Confirm which code PRs have landed before finalizing `AGENTS.md`.

- [ ] **Step 2: Keep AGENTS concise**

`AGENTS.md` must include execution rules for:

```text
canonical contract ownership
source-of-truth boundaries
rematerialization requirements
verification requirements
UI/shadcn rules
```

Do not duplicate full architecture reviews in `AGENTS.md`.

## Task 2: Design System Record

- [ ] **Step 1: Align with current UI direction**

`STATLY_DESIGN_SYSTEM.md` must describe Statly as a dense AFL fantasy operations product and point UI workers toward semantic tokens and shadcn-style composition.

- [ ] **Step 2: Avoid code changes**

This task must not edit `src/` files.

## Task 3: Language Governance Docs

- [ ] **Step 1: Group language docs**

Keep glossary and audit files together in one docs PR so review can evaluate product language consistency.

- [ ] **Step 2: Verify markdown only**

Run:

```bash
git diff --name-only | rg -v '^(AGENTS.md|STATLY_DESIGN_SYSTEM.md|docs/)'
```

Expected: no output.

## Final Verification

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

## Self-Review

- Scope is documentation only.
- Docs are sequenced after code PRs.
- Verification command is exact.
