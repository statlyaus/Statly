# Ubiquitous Language Governance

## Goal

Statly should use one durable vocabulary for AFL fantasy concepts across code, UI, APIs, persistence, analytics, logs, tests, support material, and architecture docs.

This document exists to make terminology safer to change over time. It is not a general preference list for nicer names. Its purpose is to prevent vague, overloaded, or inconsistent language from becoming duplicated business logic, unclear contracts, confusing UI, unreliable analytics, or incorrect AFL fantasy calculations.

The best long-term solution is the smallest coherent terminology change that:

- makes the domain concept explicit
- reuses existing Statly language where it is correct
- removes ambiguity at the highest stable boundary
- preserves compatibility where contracts are already public or persisted
- avoids broad rename churn that does not improve correctness or comprehension

## Scope

Use this governance when reviewing or changing domain models, shared services, database fields, Firestore documents, Prisma schema, API contracts, analytics events, UI copy, logs, alerts, tests, README files, architecture notes, tickets, and pull request descriptions.

For Footywire-derived player-match data, this document is subordinate to the canonical contract rules in `AGENTS.md`. Terminology changes in that pipeline must continue moving the system toward one canonical persisted Firestore raw-match contract and zero permanent parallel semantic readers.

## Non-Goals

Do not use this governance to:

- rename every imperfect local variable
- enforce personal wording preferences
- make names artificially verbose
- block harmless local shorthand
- replace established domain terms without a migration plan
- hide broad terminology refactors inside unrelated feature or bug-fix work

## Core Principle

Vague language hides assumptions. Prefer names and copy that answer what AFL fantasy concept this is, who uses it, when it applies, what rule or lifecycle it represents, whether it is imported/canonicalized/calculated/projected/user-entered/persisted/rebuilt/reconciled/published, and how someone would verify it.

## Risk Model

Classify language findings by risk before recommending a change.

### Must Change

Change terms that can cause wrong business logic, user confusion, accessibility issues, analytics ambiguity, API contract confusion, schema drift, or future defects.

Examples:

- `score` used for both projected and actual scores
- `team` used for both AFL club and fantasy team
- `status` used for unrelated states such as player availability, fixture result, import progress, and trade validation
- `active`, `current`, or `latest` used without a lifecycle definition
- button or error copy that does not tell users what action occurred or what failed
- persisted or public fields whose meaning differs from their name

### Should Change

Change terms that are understandable today but likely to become confusing as the codebase grows.

Examples:

- `data`, `result`, or `payload` in shared domain functions or public component APIs
- `helper`, `utils`, or `manager` files that own business rules
- tests named around mechanics rather than behaviour
- UI copy such as `Update details` when the action has a specific object

### Nice to Change

Leave these for scoped cleanup unless the current task is already about terminology.

Examples:

- short-lived local variables where the surrounding type is obvious
- slightly clearer test names
- comments that could explain intent more precisely

## High-Risk Term Classes

### Generic Object Names

Risk terms:

- `data`, `item`, `object`, `record`, `entry`, `result`, `response`, `payload`, `value`, `info`, `details`, `meta`, `config`, `options`, `params`

Use only when the scope is local and the type already makes the meaning obvious. In shared or domain-heavy code, prefer terms such as `playerProjectionInput`, `roundScoreBreakdown`, `tradeRecommendation`, `fixtureDifficultyRating`, `ownershipTrend`, `salaryChangeSummary`, or `playerSelectionStatus`.

### Weak Action Words

Risk terms:

- `handle`, `process`, `manage`, `do`, `run`, `execute`, `perform`, `update`, `set`, `get`, `make`, `fix`, `check`

Framework conventions and simple accessors may use these words. Domain actions should describe the outcome, such as `calculateRoundProjectedScore`, `normalisePlayerPosition`, `publishRoundLockoutStatus`, `validateTradeLimit`, `syncFixtureResults`, `importPlayerRoundScores`, or `refreshPlayerSalaryHistory`.

### Ambiguous State Words

Risk terms:

- `active`, `inactive`, `enabled`, `disabled`, `valid`, `invalid`, `complete`, `pending`, `ready`, `available`, `locked`, `open`, `closed`, `live`, `final`

State names usually need a domain qualifier: `isPlayerSelectable`, `isRoundLockedForTrading`, `isFixtureFinalised`, `hasProjectionInputs`, `isTradeWindowOpen`, `isPriceChangeConfirmed`, or `isPlayerAvailableForSelection`.

### Placeholder Technical Names

Risk terms:

- `temp`, `new`, `old`, `legacy`, `final`, `latest`, `current`, `next`, `misc`, `common`, `shared`, `helper`, `utils`, `manager`

If a placeholder is already widespread, do not casually rename it. First define the preferred term, document why the old term is being replaced, and migrate one layer or file at a time.

### Overloaded AFL Fantasy Terms

Review these with extra care:

- `score`, `average`, `projection`, `price`, `salary`, `value`, `team`, `club`, `squad`, `lineup`, `round`, `fixture`, `match`, `status`, `position`, `role`, `ownership`, `availability`, `selection`

Prefer explicit distinctions:

- `projectedScore` vs `actualScore`
- `roundProjectedScore` vs `seasonProjectedScore`
- `playerSalary` vs `playerValueRating`
- `aflClub` vs `fantasyTeam`
- `fixtureStartTime` vs `roundLockoutTime`
- `playerPosition` vs `fantasyEligiblePosition`
- `selectionStatus` vs `availabilityStatus`

## Review Workflow

Follow this sequence before recommending a rename or wording change.

1. Identify the exact term or phrase.
2. Locate the context: local variable, shared function, domain type, database field, API contract, UI copy, analytics event, log, test, or doc.
3. Classify the risk: generic noun, weak verb, ambiguous state, ambiguous boolean, placeholder name, subjective copy, overloaded domain term, inconsistent synonym, or missing domain distinction.
4. Search existing usage before inventing a new term.
5. Determine impact: calculation risk, contract ambiguity, duplicated logic, searchability, UI clarity, accessibility, analytics interpretation, or test clarity.
6. Recommend the smallest sustainable change.
7. Decide whether the fix belongs in the current change or in a tracked terminology migration.

Do not treat search hits as findings automatically. Each candidate needs context and severity.

## Replacement Quality Rubric

Score proposed replacements before recommending them.

- `0`: no improvement, such as `data` to `info` or `process` to `handle`
- `1`: slight improvement, such as `data` to `playerData`
- `2`: good improvement that names the domain concept and intent, such as `playerData` to `playerProjectionInput`
- `3`: strong improvement that is specific, stable, searchable, and consistent, such as `score` to `roundProjectedScore`

Prefer score `2` or `3`. Do not recommend a score `1` replacement when a score `2` or `3` option is available without awkwardness.

## Decision Rules

Block or require a fix when:

- the term is part of a public API, database schema, analytics event, shared domain model, or canonical persisted contract and is ambiguous
- the wording could cause users to take the wrong action
- the ambiguity affects scoring, projections, trade validation, salary changes, lockout behaviour, ownership interpretation, identity resolution, import correctness, rebuild scope, or reconciliation
- the term conflicts with an existing glossary or canonical contract definition

Request a follow-up when:

- the issue is real but larger than the current task
- the fix requires database migration, API versioning, analytics coordination, broad UI updates, or backfill work
- multiple files or layers need coordinated migration
- the current change remains correct with a documented migration path

Leave it alone when:

- the term is local, obvious, and short-lived
- the surrounding type makes the meaning unambiguous
- renaming would add noise without improving understanding
- the term is required by a framework, library, external API, or source-data contract

## Migration Strategy

For widespread vague or overloaded terms:

1. Define the preferred term.
2. Document the old term and why it is being replaced.
3. Identify affected layers: code, tests, database, API, UI, analytics, logs, docs, and support workflows.
4. Decide whether backwards compatibility or dual-read support is required.
5. Add or preserve tests around the domain behaviour before or during the rename.
6. Rename one file, layer, or bounded concept at a time.
7. Keep adapters isolated, named as transitional, and tied to an exit condition.
8. Remove old terminology only after references and dependent data are migrated.
9. Update the glossary.

For public APIs, analytics events, and persisted fields, prefer explicit migration and deprecation over abrupt renames.

## Glossary Governance

When introducing or changing a core term:

1. Search existing usage first.
2. Reuse the existing preferred term unless it is incorrect.
3. If the existing term is wrong, rename it deliberately instead of adding a synonym.
4. Update related tests, docs, UI copy, analytics names, and logs as part of the same conceptual change or create explicit follow-up tasks.
5. Document the preferred term in the nearest glossary or architecture doc.
6. Include examples of what the term does and does not mean.

Use glossary entries with this shape: term, definition, use when, do not use for, preferred code terms, avoided terms, and related terms.

## Naming Patterns

- Domain entity: `[domain qualifier] + [entity]`, such as `aflClub`, `fantasyTeam`, `playerProjection`, `roundFixture`, `salaryHistory`
- Domain state: `[entity] + [state type]`, such as `playerAvailabilityStatus`, `fixtureResultStatus`, `tradeValidationStatus`, `roundLockoutStatus`
- Boolean condition: `is/has/can/should + [entity] + [specific condition]`, such as `isPlayerSelectable`, `hasValidTradeCombination`, `canUserEditFantasyTeam`
- Domain action: `[verb] + [domain object] + [outcome or constraint]`, such as `calculateRoundProjectedScore`, `validateTradeLimit`, `importFixtureResults`
- UI action: `[clear verb] + [specific object]`, such as `Save trade changes`, `View player projections`, `Compare selected players`

Avoid negative booleans where a positive domain condition is clearer. Prefer `isTradeWindowOpen` over `isNotLocked`.

## Accessibility and UX Language

Accessible language must be specific.

- Buttons must describe the action.
- Links must describe the destination or result.
- Form labels must identify the exact field purpose.
- Empty states must explain why no content appears and what can happen next.
- Error messages must identify the problem and suggest a next step when useful.
- ARIA labels must add useful context when visible text is not enough.
- Icon-only actions must have accessible names.

User-facing errors should include what failed, why it failed when safe, and what the user can do next. Developer logs should include technical context without exposing secrets.

## Audit Workflow

Run automated searches to find candidates, then review manually.

```bash
rg "\b(data|item|object|record|entry|result|response|payload|value|info|details|meta|config|options|params)\b" .
rg "\b(handle|process|manage|do|run|execute|perform|update|set|get|make|fix|check)\b" .
rg "\b(active|inactive|enabled|disabled|valid|invalid|complete|pending|ready|available|locked|open|closed|live|final)\b" .
rg "\b(temp|new|old|legacy|final|latest|current|next|misc|common|shared|helper|utils|manager)\b" .
rg "\b(score|average|projection|price|salary|value|team|club|squad|lineup|round|fixture|match|status|position|role|ownership|availability|selection)\b" .
```

For each audit scope, record:

- term or phrase
- location
- current meaning
- risk category
- severity
- suggested replacement
- replacement score
- affected layers
- migration or compatibility requirements
- smallest next action

## Acceptance Criteria

A language review is complete when:

- vague or overloaded terms have been identified and manually classified
- each finding has a severity and affected scope
- suggested replacements improve specificity rather than style alone
- existing terminology has been checked before introducing new terms
- user-facing copy is actionable and accessible
- public or persisted contract changes include migration notes
- broad terminology problems are separated into explicit follow-up work
- no unnecessary rename churn has been introduced

## Final Rule

A better term should reduce future explanation. If the new language still requires a long explanation every time someone sees it, it is probably not specific enough yet.
