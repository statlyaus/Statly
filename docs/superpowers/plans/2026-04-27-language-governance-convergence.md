# Language Governance Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish durable Statly terminology governance by defining high-risk domain language once, then migrating one bounded concept at a time without breaking persisted contracts or reintroducing Footywire stage drift.

**Architecture:** `docs/DOMAIN_GLOSSARY.md` is the vocabulary source of truth. Implementation proceeds through gates: glossary/docs, identity compatibility, canonical adapter exit criteria, read-model boundary naming, ranking vocabulary, API errors, and reusable UI copy. Prisma and Firestore field names remain stable until a migration plan proves compatibility, tests, and operational rollback.

**Tech Stack:** TypeScript, Next.js App Router, Prisma, Firestore Admin SDK, Vitest, Markdown docs, Prettier.

---

## Goal Assessment

The plan's goal is correct: make terminology precise enough to protect long-term maintainability and canonical Footywire convergence.

The plan must optimize for:

- semantic ownership before code churn
- persisted/API compatibility before renames
- test-backed migration slices
- no broad mechanical substitutions
- explicit exit criteria for transitional adapters

The long-term solution is not a one-time rename pass. It is a governance system: glossary first, then bounded migrations that gradually make the code match the glossary.

## Shortcomings in the Previous Plan

- It was task-rich but did not explicitly assess the goal.
- It included useful implementation steps, but the long-term governance model was implicit.
- It did not clearly separate gates that must happen before source changes.
- Some examples used placeholder fixture names that future workers would need to adapt.
- It did not state enough stop conditions for preventing rename churn.
- It underemphasized that schema/API field names are compatibility surfaces, not immediate cleanup targets.

This rewrite keeps the useful task sequence but strengthens the long-term decision model.

## Non-Negotiable Invariants

- Canonical raw-match meaning stays at the Firestore contract boundary.
- Player identity language distinguishes source team text, AFL club facts, season registrations, and fantasy teams.
- Ranking/value language distinguishes ranking values, legacy weighted totals, projected fantasy scores, and actual fantasy scores.
- Compatibility adapters are isolated and have removal criteria.
- Persisted field names are not renamed without migration design.
- No broad `team` to `club`, `data` to `payload`, or `status` to `state` substitutions.

## File Ownership

- `docs/DOMAIN_GLOSSARY.md`: preferred vocabulary and avoided terms.
- `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`: identity terminology rules.
- `shared/player-identity/playerIdentityResolver.ts`: `sourceTeamName` compatibility alias and diagnostics.
- `shared/player-identity/playerMatchStats.ts`: source-team versus AFL-club lookup naming.
- `src/lib/stats/playerStatSnapshot.ts`: canonical fallback adapter exit criteria.
- `src/server/readModels/playerReadModels.ts`: raw-document versus projection-row boundary naming.
- `docs/PLAYER_RANKING_MIGRATION_DESIGN.md`: ranking/value terminology migration.
- `src/lib/apiResponse.ts`: future API error vocabulary helpers.
- `src/components/ui/DataTable.tsx`, `src/components/dashboard/Sparkline.tsx`: reusable UI copy defaults.

## Gate 1: Glossary and Documentation Lock

**Purpose:** Make preferred terms explicit before source code starts changing.

**Files:**

- Modify: `docs/DOMAIN_GLOSSARY.md`
- Modify: `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- Test: Markdown formatting

- [ ] **Step 1: Verify glossary seed terms**

Run:

```bash
rg -n "^## Term: (AFL Club|Fantasy Team|Source Team Name|Current Player Club|Season Registered Club|Canonical Raw Match Contract|Canonical Raw Match Document|Published Player Read Model|Ranking Value|Legacy Total Value|Projected Fantasy Score|Actual Fantasy Score)" docs/DOMAIN_GLOSSARY.md
```

Expected: one match for every listed term. If any term is missing, add it using the existing glossary entry structure.

- [ ] **Step 2: Add identity terminology rules**

In `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`, add a terminology section:

```md
## Terminology

Identity work uses these glossary terms:

- `sourceTeamName`: the team text observed in source data before identity resolution.
- `aflClub`: the real AFL club concept.
- `currentPlayerClub`: the mutable current club on the player profile.
- `seasonRegisteredClub`: the AFL club fact for a player in a specific season.
- `fantasyTeam`: a user's team inside a Statly fantasy league.

Do not use bare `team` in new identity logic unless the value is explicitly a fantasy team. Persisted fields such as `UnresolvedPlayerStatRow.team` remain compatibility fields until a schema migration is planned.
```

- [ ] **Step 3: Tighten ambiguous prose**

Replace prose like `Normalize player name and team` with `Normalize player name and source team name`. Do not rename schema fields in examples.

- [ ] **Step 4: Verify formatting**

Run:

```bash
npx prettier --check docs/DOMAIN_GLOSSARY.md docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md
```

Expected: pass.

**Stop condition:** Do not proceed to source changes until the glossary and identity protocol agree on `sourceTeamName`, `aflClub`, `currentPlayerClub`, `seasonRegisteredClub`, and `fantasyTeam`.

## Gate 2: Player Identity Compatibility Alias

**Purpose:** Introduce preferred language without breaking existing callers or persisted unresolved-row fields.

**Files:**

- Modify: `shared/player-identity/playerIdentityResolver.ts`
- Modify: `src/server/playerIdentityResolver.test.ts`
- Optional modify: `shared/player-identity/playerMatchStats.ts`

- [ ] **Step 1: Find existing test fixtures**

Run:

```bash
sed -n '1,260p' src/server/playerIdentityResolver.test.ts
```

Identify an existing player/season/club fixture. Use that real fixture in the new tests.

- [ ] **Step 2: Add failing compatibility tests**

Add tests with the existing fixture:

```ts
it('resolves sourceTeamName as the preferred source team identity context', async () => {
  const directory = await loadPlayerIdentityDirectory(prisma, 2026);
  const resolution = resolvePlayerIdentityFromDirectory(directory, {
    playerName: '<existing fixture player name>',
    sourceTeamName: '<existing fixture club>',
    season: 2026,
  });

  expect(resolution.outcome).toBe('resolved');
});

it('keeps legacy team input compatible while sourceTeamName migrates in', async () => {
  const directory = await loadPlayerIdentityDirectory(prisma, 2026);
  const resolution = resolvePlayerIdentityFromDirectory(directory, {
    playerName: '<same fixture player name>',
    team: '<same fixture club>',
    season: 2026,
  });

  expect(resolution.outcome).toBe('resolved');
});
```

Replace placeholders with existing fixture values before running.

- [ ] **Step 3: Add preferred alias**

In `PlayerIdentityInput`, add:

```ts
sourceTeamName?: string | null;
```

Add:

```ts
function readInputSourceTeamName(input: PlayerIdentityInput): string | null {
  return readString(input.sourceTeamName) ?? readString(input.team);
}
```

Use `readInputSourceTeamName(input)` for resolution and diagnostics. Continue writing existing `team` and `normalizedTeam` persisted fields for compatibility.

- [ ] **Step 4: Add diagnostic compatibility**

Prefer `normalizedSourceTeamName` in diagnostics. If existing tests or callers require `normalizedTeam`, keep both temporarily:

```ts
diagnostics: {
  playerName,
  normalizedPlayerNames,
  normalizedSourceTeamName,
  normalizedTeam: normalizedSourceTeamName,
}
```

Add a short comment that `normalizedTeam` is transitional compatibility language.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run src/server/playerIdentityResolver.test.ts
```

Expected: pass.

**Stop condition:** Stop after preferred input and diagnostics exist. Do not rename Prisma fields or source payload fields in this gate.

## Gate 3: Canonical Stat Fallback Exit Criteria

**Purpose:** Make compatibility fallback readers explicitly transitional.

**Files:**

- Modify: `src/lib/stats/playerStatSnapshot.ts`
- Modify tests closest to canonical stat snapshots, likely `src/lib/stats/footywireCanonicalContract.test.ts`

- [ ] **Step 1: Confirm existing coverage**

Run:

```bash
rg -n "buildCanonicalStatSnapshotFromRawDocument|readCanonicalStatPresenceFromRawDocument" src tests
```

If tests already cover canonical and fallback behaviour, extend them. If not, add coverage in the nearest existing stats test file.

- [ ] **Step 2: Preserve canonical-first behaviour**

Add or verify a test proving `canonical_stats` wins over legacy `stats` or `raw_row` values.

- [ ] **Step 3: Name the fallback adapter**

In `playerStatSnapshot.ts`, add a focused comment or helper name:

```ts
// Transitional raw stat adapter. Remove after repaired scopes no longer contain
// pre-canonical player_match_stats documents without canonical_stats.
```

Do not add a new semantic reader.

- [ ] **Step 4: Run focused tests**

Run the closest available tests:

```bash
npx vitest run src/lib/stats/footywireCanonicalContract.test.ts src/lib/__tests__/playerMatchStats.test.ts
```

Expected: pass, or document the nearest existing command if these files are not the right coverage.

**Stop condition:** Stop once fallback intent and removal criteria are explicit. Do not remove fallback behaviour in this gate.

## Gate 4: Read-Model Boundary Naming

**Purpose:** Clarify canonical raw document versus projection row language in the largest drift-sensitive read-model file.

**Files:**

- Modify: `src/server/readModels/playerReadModels.ts`
- Modify: `src/server/readModels/playerReadModels.test.ts`

- [ ] **Step 1: Locate boundary variables**

Run:

```bash
rg -n "\bconst data\b|\bdata: Record<string, unknown>|doc\\.data\\(\\)" src/server/readModels/playerReadModels.ts
```

Only rename variables where the concept is one of `canonicalRawMatchDocument`, `rawMatchDocument`, `projectionRow`, or `publishedReadModelRow`.

- [ ] **Step 2: Rename one concept at a time**

Example:

```ts
const rawMatchDocument = doc.data() as Record<string, unknown>;
const canonicalPlayerId = readCanonicalPlayerId(rawMatchDocument);
```

Do not rename parser helper parameters like `value` unless they cross a domain boundary.

- [ ] **Step 3: Run focused checks**

Run:

```bash
npx vitest run src/server/readModels/playerReadModels.test.ts
npm run typecheck:tests
```

Expected: pass.

**Stop condition:** Stop when canonical raw documents and projection rows are distinguishable. Do not perform cosmetic renames.

## Gate 5: Ranking Vocabulary Migration

**Purpose:** Make ranking language future-proof before public ranking/API expansion.

**Files:**

- Modify: `docs/PLAYER_RANKING_MIGRATION_DESIGN.md`
- Optional modify: `src/server/stats/StatsReadService.ts`

- [ ] **Step 1: Add ranking terminology section**

Add:

```md
## Ranking Terminology

- `rankingValue` is the preferred future scalar for sorting ranked players.
- `totalValue` is legacy compatibility language from the weighted score model.
- `projectedFantasyScore` is a forward-looking score estimate and must not be used as a ranking synonym.
- `actualFantasyScore` is recorded match output and must not be used as a ranking synonym.
```

- [ ] **Step 2: Avoid schema renames**

Do not rename Prisma fields in this task. Only use clearer local names or backwards-compatible additions.

- [ ] **Step 3: Verify formatting**

Run:

```bash
npx prettier --check docs/PLAYER_RANKING_MIGRATION_DESIGN.md
```

Expected: pass.

**Stop condition:** Stop once docs identify `totalValue` as compatibility language and `rankingValue` as preferred future language.

## Gate 6: API Error Vocabulary Pilot

**Purpose:** Prove API language governance on one route family before broad adoption.

**Files:**

- Modify: `src/lib/apiResponse.ts`
- Modify one selected route family, recommended: `src/app/api/leagues/[id]/matchup/route.ts`
- Modify matching route tests

- [ ] **Step 1: Add optional error vocabulary without breaking callers**

Introduce or document an error body shape:

```ts
type ApiErrorBody = {
  error: string;
  errorCode?: string;
  message?: string;
  diagnostics?: Record<string, unknown>;
  validationIssues?: Record<string, unknown>;
};
```

- [ ] **Step 2: Convert one route family only**

Use domain-specific wording:

```ts
return commonErrors.internalServerError('Failed to load league matchup slate');
```

- [ ] **Step 3: Run route tests**

Run:

```bash
npx vitest run src/app/api/leagues/[id]/matchup/route.test.ts
```

Expected: pass.

**Stop condition:** Stop after one route family. Do not standardize every API route in this gate.

## Gate 7: Reusable UI Empty/Error Copy

**Purpose:** Prevent reusable components from spreading vague product copy.

**Files:**

- Modify: `src/components/ui/DataTable.tsx`
- Modify: `src/components/dashboard/Sparkline.tsx`

- [ ] **Step 1: Replace vague reusable defaults**

Change reusable defaults from `No data available` to a neutral actionable default or require caller-provided copy:

```tsx
emptyMessage = 'No rows are available for this view';
```

- [ ] **Step 2: Improve chart accessible label**

Replace `aria-label="No data"` with:

```tsx
aria-label="No values available for this chart"
```

- [ ] **Step 3: Run app typecheck**

Run:

```bash
npm run typecheck:app
```

Expected: pass.

**Stop condition:** Stop after reusable defaults. Do not chase every one-off screen copy in this gate.

## Final Verification

Run after selected implementation gates:

```bash
npm run typecheck
npm run lint
npx prettier --check docs/DOMAIN_GLOSSARY.md docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md docs/PLAYER_RANKING_MIGRATION_DESIGN.md
npm test
```

If a full suite is blocked by environment setup, record the blocker and run the narrowest available focused tests for touched files.

## Rollout Rule

Ship in small commits:

1. Glossary/docs.
2. Identity compatibility alias and tests.
3. Canonical adapter exit criteria and tests.
4. Read-model boundary naming.
5. Ranking/API/UI vocabulary pilots.

Do not merge a terminology slice if it introduces a new synonym without updating the glossary.
