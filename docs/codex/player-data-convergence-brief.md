# Player Data Convergence Brief

## Purpose

Player data convergence is the process of making Statly's player identity,
statistics, rankings, draft read models, and fantasy category values agree on the
same player records and stat meanings.

This brief is a design boundary only. It does not add a runner, package script,
runtime behavior, schema change, migration, or data write path.

The next implementation should start with a read-only audit from current `main`.
Any write-capable convergence work must first prove itself against a disposable
temporary database and must never mutate the protected local `prisma/dev.db`.

## Current State

Current `main` already has several useful pieces:

- `src/lib/playerIdentity.ts` provides `buildCanonicalPlayerId` for stable
  fallback identifiers.
- `src/lib/playerName.ts` resolves player names from `player_name` or known
  match-stat document ID shapes.
- `src/lib/playerValidation.ts` validates and normalizes player payloads for UI
  use.
- `src/lib/data.ts` loads the local JSON player snapshot and normalizes common
  stat keys.
- `src/server/draft/readModels/draftPlayerReadModel.ts` enriches available draft
  players with stats using direct IDs, canonical IDs, name plus team, and
  unambiguous names.
- `src/app/api/player-stats/route.ts` reads Firestore `player_match_stats` and
  maps the real-data nine-category values used by the fantasy product.
- `src/app/api/players/search/route.ts` aggregates Firestore match stats and
  falls back to the local player directory when Firestore is empty or
  unavailable.
- `src/app/api/players/[id]/route.ts` resolves Prisma players first, then local
  directory data, then Firestore latest-stat name matches.
- `src/app/api/rankings/route.ts` still builds ranking aggregates directly from
  Firestore match stats.
- `tests/unit/draftPlayersRouteReadModel.test.ts` covers draft stat enrichment
  and selected category behavior.
- `src/lib/__tests__/playerValidation.test.ts` covers player payload
  validation.

Current `main` does not have a player data convergence runner, a
`converge:player-data` package script, or a current rollout protocol for applying
player directory repairs.

## Current Ladder Status

Current `main` has completed these safe, non-writing player data convergence
ladder steps:

| Step                                | Status    | Evidence                                                                                                                     |
| ----------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 read-only diagnostic        | Completed | Current player identity, stats, ranking, and draft read-model ownership were inspected without mutating state.               |
| Phase 2 pure diagnostic module      | Completed | `src/server/playerDataConvergenceDiagnostic.ts` and fixture tests compare in-memory player/stat/category records.            |
| Phase 3 tracked-data guard          | Completed | `tests/unit/playerDataConvergenceTrackedData.test.ts` verifies tracked data remains identity-converged.                      |
| Phase 4 pure action planner         | Completed | `src/server/playerDataConvergencePlanner.ts` converts diagnostics into non-writing recommendations.                          |
| Phase 4b tracked-data planner guard | Completed | `tests/unit/playerDataConvergenceTrackedData.test.ts` verifies warning-only tracked data stays safe for read-only follow-up. |

The current tracked-data warning is narrow and understood: four
`player_stats_2025.json` rows have all nine real-data category values as `null`.
Those rows are skipped, with source evidence and a source-data coverage warning,
not player identity repair candidates.

The current safety position is:

- identity convergence is good for tracked data;
- the tracked-data shape is warning-only and safe for read-only follow-up;
- write-capable convergence remains unsafe without a separate approved plan;
- no runner, package script, Prisma write path, Firestore write path, or durable
  repair workflow exists yet.

The next possible phase is a temp-DB-only write dry-run design. That design must
use `/tmp/statly-verify-*.db`, avoid production and protected local database
writes, define rollback criteria, require human approval before any apply path,
and still defer any durable runner until explicitly approved.

Stop condition: do not implement write-capable convergence from this ladder
status. Stop before adding apply behavior, repair behavior, package scripts,
runners, Prisma writes, Firestore writes, or ranking mutations.

## Temp-DB-Only Write Dry-Run Design

This section defines the next safe implementation boundary. It is a design
contract only. It does not authorize a runner, package script, apply function,
Prisma write, Firestore write, schema change, ranking mutation, local JSON
change, fixture rewrite, or durable data repair.

### Scope

The next implementation PR may design and test a write dry-run planner against
in-memory evidence and a disposable database strategy. It must still stop before
any command writes to real local, shared, or production data.

A write dry-run means:

- planned write behavior is exercised only against a disposable
  `/tmp/statly-verify-*.db` database;
- source evidence is copied or seeded into that temp database only when the
  command is explicitly approved;
- all output is structured evidence for review;
- rollback is deleting the temp database, not repairing mutated local state.

### Temp DB Contract

Any future write dry-run must use the temporary database runbook:

```bash
export STATLY_VERIFY_DB="/tmp/statly-verify-$(date +%Y%m%d%H%M%S).db"
export DATABASE_URL="file://${STATLY_VERIFY_DB}"
: > "$STATLY_VERIFY_DB"
```

Before schema setup, seeding, dry-run planning, or temp apply simulation, the
workflow must prove:

- `DATABASE_URL` is set;
- `DATABASE_URL` starts with `file://`;
- `STATLY_VERIFY_DB` is under `/tmp/statly-verify-*.db`;
- neither variable points inside the repository;
- neither variable points at `prisma/dev.db`;
- the script does not override or ignore the caller-provided `DATABASE_URL`.

Before and after the run, capture:

```bash
git status --short -- prisma/dev.db
stat -f "%m %z %N" prisma/dev.db 2>/dev/null || stat -c "%Y %s %n" prisma/dev.db
git status --short --branch
```

The expected result is no `prisma/dev.db` status output, unchanged
`prisma/dev.db` stat metadata, and no protected or generated artifacts in git
status.

### Input Evidence Contract

Dry-run inputs must come from the diagnostic and planner boundaries, not ad hoc
database queries or fallback assumptions. Every dry-run report must include:

- total canonical players;
- total source stat records;
- direct ID matches;
- canonical ID matches;
- normalized name plus team matches;
- ambiguous name matches;
- unmatched canonical players;
- unmatched source records;
- duplicate source identities;
- missing expected category values;
- stale or deprecated category keys;
- skipped null-stat source evidence;
- proposed repair count;
- skipped repair count and reasons.

Fallback canonical ID or name/team matching is evidence for review, not proof
that a repair is safe.

### Deterministic Repair Eligibility

Only deterministic, explainable repairs may enter a future dry-run plan. The
planner must skip or block:

- ambiguous name matches;
- unmatched source records;
- unknown or malformed names;
- duplicate source identities without a reviewed rule;
- stale category mappings without an explicit mapping decision;
- partial missing category values;
- rows where all expected category values are `null`;
- any player merge or split requiring product judgment.

The four currently tracked all-null stat rows remain skipped source evidence and
must not become identity repair candidates.

### Human Approval Gates

Explicit human approval is required before:

- adding an apply function;
- adding a CLI or package script;
- running any write-capable command, even against `/tmp`;
- promoting from dry-run planning to temp apply simulation;
- writing Prisma player rows outside a disposable temp database;
- touching Firestore, production, shared, or developer data;
- changing category mappings used by rankings or fantasy scoring.

Approval for a design brief is not approval to implement writes.

### Stop Conditions

Stop immediately if:

- `DATABASE_URL` is missing, non-`file://`, outside `/tmp`, inside the repo, or
  points at `prisma/dev.db`;
- a command references, reads, or mutates `prisma/dev.db`;
- a command asks for `.env`, real secrets, production credentials, Firebase
  exports, or service account files;
- generated files, dataconnect local data, `coverage`, `dist`, or
  `test-results` appear;
- any ambiguous name match or unmatched source record is present;
- product judgment is required to merge, split, create, or delete players;
- a proposed repair is not explainable from diagnostic evidence;
- the work requires package scripts, Prisma schema changes, Firestore writes,
  ranking mutations, local JSON edits, fixture rewrites, branches, or stashes.

### Rollback Criteria

Rollback for a temp dry-run is deletion of the disposable database:

```bash
rm -f "$STATLY_VERIFY_DB"
```

If temp apply output is wrong, discard the temp database, fix the planner or
design, and rerun from a new `/tmp/statly-verify-*.db` path. Do not use local
untracked database state, stashes, or manual edits as a recovery mechanism.

### Required Evidence Before Any Future Apply Path

Before any later PR proposes an apply path, it must provide:

- focused unit tests for diagnostic, planner, and apply boundaries;
- a temp-DB-only dry-run report with the input evidence counts above;
- before/after `prisma/dev.db` status and stat checks;
- `git diff --check`;
- lint, typecheck, and prettier checks for touched TypeScript or markdown;
- a residual-risk note for any skipped browser/API/full-stack smoke.

Write-capable convergence remains blocked until a separate PR satisfies this
evidence contract and receives explicit approval for the apply boundary.

## Source-Of-Truth Map

| Concern                                           | Current owner                                                              | Canonical source                                           | Notes                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Protected league, draft, roster, and waiver state | Prisma services and API routes                                             | Prisma                                                     | Follow `AGENTS.md`: auth and ownership checks belong at the server/data boundary.                   |
| Player directory used by draft availability       | `prisma.player` plus `src/lib/data.ts` fallback paths                      | Prisma should become canonical for protected fantasy flows | Local JSON remains a compatibility/read fallback.                                                   |
| Player identity fallback                          | `src/lib/playerIdentity.ts`                                                | Deterministic canonical ID helper                          | Useful when source records lack stable IDs, but not a substitute for repaired canonical rows.       |
| Player name parsing                               | `src/lib/playerName.ts`                                                    | Explicit `player_name`, then known document ID formats     | Unknown or malformed names should be reported by diagnostics, not silently repaired by write paths. |
| Match stats ingestion surface                     | `player_match_stats` Firestore collection and ETL scripts                  | Raw AFL/ETL evidence                                       | Firestore is source evidence for stats, not the protected fantasy ownership source of truth.        |
| Draft player stat read model                      | `src/server/draft/readModels/draftPlayerReadModel.ts`                      | Prisma player pool enriched by local/stat evidence         | Current matching is tolerant but should be audited for misses and ambiguity.                        |
| Player stats API                                  | `src/app/api/player-stats/route.ts`                                        | Firestore match stats                                      | Public stat projection; uses real-data category replacements.                                       |
| Player search/profile APIs                        | `src/app/api/players/search/route.ts`, `src/app/api/players/[id]/route.ts` | Prisma/local directory plus Firestore latest stats         | These paths currently contain fallback convergence logic and should be audited before writes.       |
| Rankings API                                      | `src/app/api/rankings/route.ts`                                            | Firestore match stats                                      | Still has older category names and TODO ownership behavior; treat as a convergence risk area.       |
| Fantasy category values                           | `src/types/fantasyCategories.ts`                                           | `realDataNineCategory` preset                              | Keep `inside50s`, `effectiveDisposals`, and `scoreInvolvements` aligned with current spec.          |

## Historical Context From Old #398

Old #398 attempted to add a full convergence workflow from a non-main branch:

- `Scripts/run-player-data-convergence.ts`
- `src/server/playerDataConvergenceRun.ts`
- `src/server/playerDataConvergenceRun.test.ts`
- `package.json` script `converge:player-data`
- `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- a long implementation plan under `docs/superpowers/plans/`

The old PR was trying to make player identity repair repeatable by planning and
running phases for diagnosis, directory sync dry-run/apply, bounded read-model
rebuild, and verification.

That intent is useful. The old branch should not be merged or rebuilt wholesale
because it was based on old non-main history, touched runner/package/database
rollout territory at once, and relied on local copied database verification.
Current `main` now has stricter workflow scaffolding and a temporary database
verification runbook, so the work should be rebuilt in smaller phases.

## Risks

- Repairing player identity can change draft room stat visibility, rankings,
  search results, and player profile IDs.
- A write-capable runner can mutate protected local or developer data if it does
  not respect `DATABASE_URL`.
- Firestore match stats, local JSON, and Prisma player rows may disagree on ID,
  team, name, position, or category shape.
- Fallback matching can hide bad source data by producing apparently valid
  player rows.
- Rankings still use older category labels and TODO ownership behavior, so
  convergence should not assume all read surfaces are already aligned.
- Broad runner work can reintroduce branch sprawl if bundled with data repairs,
  package scripts, and product behavior changes.

## Non-Goals

- A convergence runner is out of scope for this brief.
- Package scripts must not be added or changed here.
- Player data, Prisma data, Firestore data, local JSON, and fixture data must
  remain untouched.
- Prisma schema changes are out of scope.
- Rankings, player search, and draft read models should not be rewritten as part
  of the design brief.
- Firestore must not become canonical for protected league, draft, roster, or
  waiver state.
- Verification must not use real secrets, production credentials, Firebase
  exports, or local protected databases.

## Protected Paths

Future convergence work must never touch these unless a user explicitly changes
the project rule:

- `prisma/dev.db`
- `.env` and `.env.*`
- secrets and `serviceAccountKey.json`
- Firebase exports
- generated `functions/lib` files
- dataconnect local data
- `node_modules`
- `dist`
- `coverage`
- `test-results`
- local stashes

## Proposed Implementation Phases

### Phase 1: Read-Only Audit/Diagnostic

Build a read-only diagnostic from current `main`.

Recommended first boundary:

- Add a pure server-side audit module that accepts already-loaded player
  directory rows and match-stat-like records.
- Report identity coverage, ambiguous name matches, missing canonical IDs,
  category shape mismatches, and draft read-model enrichment misses.
- Cover the diagnostic with unit tests using in-memory fixtures only.
- Leave package scripts for a later phase.
- Keep `prisma/dev.db` unread and unwritten.
- Repair output should be limited to optional stdout or returned structured
  objects in tests.

The diagnostic should answer:

- Which match-stat records map to an existing Prisma player?
- How many records only map through fallback canonical IDs?
- Which records are ambiguous by name?
- Are any records using category names outside the current real-data preset?
- Which available draft players miss stat enrichment?

Stop if the diagnostic needs product judgment about whether two players should
be merged.

### Phase 2: Temp DB Dry-Run Convergence Proof

After Phase 1 is reviewed, prove any proposed convergence plan against a
temporary database only.

Use `docs/codex/temporary-database-verification.md`:

```bash
export STATLY_VERIFY_DB="/tmp/statly-verify-$(date +%Y%m%d%H%M%S).db"
export DATABASE_URL="file://${STATLY_VERIFY_DB}"
```

Before and after any smoke or dry-run command, confirm `prisma/dev.db` is not
modified:

```bash
git status --short -- prisma/dev.db
```

The dry-run should produce structured evidence without applying repairs to the
real local database:

- total records inspected;
- records matched by direct ID;
- records matched by canonical ID;
- records matched by name plus team;
- ambiguous records;
- missing category values;
- proposed repair count;
- skipped records and reasons.

Stop immediately if any script ignores `DATABASE_URL`, references
`prisma/dev.db`, writes generated artifacts, or asks for real secrets.

### Phase 3: Narrow Write Path Or Runner

Only after Phase 2 passes, add the smallest write-capable path.

The preferred shape is:

- a pure planner that builds a convergence plan from diagnostic output;
- a separately reviewed apply function that receives an explicit plan;
- a CLI or package script only after the planner and apply boundary are tested;
- a dry-run default with an explicit apply flag;
- bounded season/round arguments;
- structured JSON output for CI and PR evidence.

The runner must not create players directly from weak diagnostics. It should
apply only reviewed, deterministic repairs with clear skipped-record reporting.

### Phase 4: Quality Streak / Regression Verification

Before merging write-capable convergence work:

- run focused unit tests for planner, diagnostics, and apply boundaries;
- run typecheck;
- run prettier and eslint for touched files;
- run `git diff --check`;
- run temp DB dry-run verification;
- run temp DB apply verification only if the PR explicitly includes an apply
  path;
- confirm `prisma/dev.db` and local stashes are untouched;
- record residual risk for any browser/API smoke that is skipped.

## Rollback Plan

Every write-capable phase must support rollback by design:

- run only against a disposable database until the apply path is reviewed;
- keep repair plans as structured output before applying;
- make apply operations bounded by season, round, and player IDs;
- log skipped records without guessing;
- stop on unexpected category, identity, or ownership conflicts;
- never rely on local untracked database state for recovery;
- if an apply path produces incorrect rows in a temp DB, discard the temp DB and
  fix the planner before trying again.

Production or shared-environment rollback is out of scope until a deployment
and data-operations plan exists.

## Done Criteria

The full player data convergence effort is done only when:

- player identity diagnostics are read-only and covered by fixture tests;
- every proposed repair is explainable from source evidence;
- dry-run output proves coverage and ambiguity rates for a bounded slice;
- write-capable apply behavior is opt-in and tested;
- draft read models, player search/profile APIs, rankings, and fantasy category
  values agree on the same repaired identities for the bounded slice;
- verification uses a temporary database or safe fixtures;
- `prisma/dev.db`, secrets, generated files, and local stashes remain untouched;
- residual risks are documented for any skipped browser/API/local smoke checks.

## First Recommended Implementation PR

Create a narrow Phase 1 PR:

```text
test/server: add read-only player data convergence diagnostic
```

Suggested file boundary:

- `src/server/playerDataConvergenceDiagnostic.ts`
- `tests/unit/playerDataConvergenceDiagnostic.test.ts`

Suggested behavior:

- accept in-memory player directory rows and match-stat-like records;
- normalize IDs through `buildCanonicalPlayerId`;
- classify direct ID, canonical ID, name plus team, name-only, ambiguous, and
  unmatched records;
- report category coverage for the current real-data nine-category preset;
- return structured diagnostics without side effects.

Verification:

- prettier for touched files;
- eslint for touched files;
- targeted unit tests;
- typecheck;
- `git diff --check`;
- Council Decision 2 before commit.

Do not add a package script, CLI runner, database writes, or temp DB smoke in the
first implementation PR. Those belong to later phases after the diagnostic shape
is reviewed.
