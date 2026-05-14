# Statly LLM Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-local LLM-maintained engineering wiki for Statly.

**Architecture:** The generated knowledge layer lives entirely under `docs/wiki/`. Existing docs, code, tests, schemas, and runtime behavior remain authoritative source material and are not replaced by the wiki.

**Tech Stack:** Markdown, YAML frontmatter, repository docs, git history.

---

## File Structure

- Create `docs/wiki/schema.md`: wiki operating contract and workflows.
- Create `docs/wiki/index.md`: content-oriented catalog.
- Create `docs/wiki/log.md`: append-only chronological log.
- Create `docs/wiki/questions.md`: open questions and contradictions.
- Create `docs/wiki/overview.md`: initial Statly architecture synthesis.
- Create `docs/wiki/topics/footywire-canonical-contract.md`: data architecture topic page.
- Create `docs/wiki/topics/design-system.md`: UI/design-system topic page.
- Create `docs/superpowers/specs/2026-05-14-statly-llm-wiki-design.md`: approved design record.
- Create `docs/superpowers/plans/2026-05-14-statly-llm-wiki.md`: implementation record.

### Task 1: Record Design And Plan

**Files:**

- Create: `docs/superpowers/specs/2026-05-14-statly-llm-wiki-design.md`
- Create: `docs/superpowers/plans/2026-05-14-statly-llm-wiki.md`

- [x] **Step 1: Capture the approved design**

Write the design record with the goal, authority model, page model, workflows, contradiction policy, and verification criteria.

- [x] **Step 2: Capture the implementation plan**

Write this implementation plan with the exact files created and verification steps.

### Task 2: Create Wiki Operating Contract

**Files:**

- Create: `docs/wiki/schema.md`

- [x] **Step 1: Define source authority**

State that the wiki is a generated synthesis layer and cannot override code, tests, migrations, `AGENTS.md`, `STATLY_DESIGN_SYSTEM.md`, or architecture docs.

- [x] **Step 2: Define workflows**

Document ingest, query, and lint workflows with required updates to `index.md`, `log.md`, and `questions.md`.

- [x] **Step 3: Define page conventions**

Specify YAML frontmatter, citation expectations, status values, and contradiction handling.

### Task 3: Seed Navigation And Maintenance Files

**Files:**

- Create: `docs/wiki/index.md`
- Create: `docs/wiki/log.md`
- Create: `docs/wiki/questions.md`

- [x] **Step 1: Create the index**

Add grouped links for overview, architecture, product and UI, operations, decisions, and open questions.

- [x] **Step 2: Create the log**

Add an initial parseable maintenance entry for the wiki scaffold.

- [x] **Step 3: Create questions**

Add initial open questions focused on canonical contract convergence, scoped rebuilds, security posture, and design-system migration.

### Task 4: Seed Topic Pages

**Files:**

- Create: `docs/wiki/overview.md`
- Create: `docs/wiki/topics/footywire-canonical-contract.md`
- Create: `docs/wiki/topics/design-system.md`

- [x] **Step 1: Create overview**

Summarize Statly's architecture, source authority, active priority, and wiki role.

- [x] **Step 2: Create Footywire topic**

Summarize the canonical raw-match contract direction, known gaps, and verification expectations.

- [x] **Step 3: Create design-system topic**

Summarize the product design standard, preferred UI patterns, migration posture, and verification expectations.

### Task 5: Verify Documentation Scaffold

**Files:**

- Verify: `docs/wiki/**/*.md`
- Verify: `docs/superpowers/specs/2026-05-14-statly-llm-wiki-design.md`
- Verify: `docs/superpowers/plans/2026-05-14-statly-llm-wiki.md`

- [ ] **Step 1: List created files**

Run:

```bash
find docs/wiki docs/superpowers/specs docs/superpowers/plans -path '*statly-llm-wiki*' -o -path 'docs/wiki/*.md' -o -path 'docs/wiki/topics/*.md' | sort
```

Expected: the seven wiki files, one design spec, and one implementation plan are present.

- [ ] **Step 2: Check frontmatter**

Run:

```bash
for f in docs/wiki/*.md docs/wiki/topics/*.md; do head -n 1 "$f"; done
```

Expected: each wiki page starts with `---`.

- [ ] **Step 3: Run formatter check on touched markdown**

Run:

```bash
npx prettier --check docs/wiki docs/superpowers/specs/2026-05-14-statly-llm-wiki-design.md docs/superpowers/plans/2026-05-14-statly-llm-wiki.md
```

Expected: all matched files use Prettier formatting, or Prettier reports exact files that need formatting.
