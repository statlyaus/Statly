# Multi-Season Player Data Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make player-data convergence durable for `2023`, `2024`, `2025`, and `2026` by defining historical player identity once at the Firestore raw-contract boundary, syncing Prisma season directories through reviewed evidence, rebuilding bounded read models, and proving season-scoped `/players` output cannot drift from projections.

**Architecture:** Treat Firestore `player_match_stats` raw documents as the persisted semantic source, but normalize stored player identity through one shared canonical contract helper before any downstream reader sees it. Replace one-off local DB seeding with a repeatable `diagnose -> reviewed roster evidence -> atomic Prisma directory sync -> bounded read-model rebuild -> strict verifier` workflow for every target season. Keep `/players` season-scoped by reading the selected season's projections, not the global player directory.

**Tech Stack:** Next.js App Router, TypeScript, Prisma SQLite/Postgres-compatible client usage, Firebase Admin Firestore reads, Vitest, `tsx` operational scripts, existing player read-model builder and verifier, Superpowers subagent-driven development workflow.

---

## Goal Assessment

The earlier short-term plan, `docs/superpowers/plans/2026-05-08-current-dev-player-data-convergence.md`, had a narrow goal: restore the current dev stack's `/players` data by converging local Prisma with canonical `2026` Firestore player ids for round `0`. That goal was useful as an emergency local repair, but it was not the best long-term solution for Statly's player-data architecture.

The real product and architecture goal is broader:

1. Historical seasons `2023`, `2024`, `2025`, and current season `2026` must be materializable from Firestore raw rows into Prisma projections through the same semantic contract.
2. Player identity meaning must be defined once at the raw Firestore contract boundary and reused by diagnostics, directory sync, read-model rebuilds, verifiers, and API surfaces.
3. Repair operations must be repeatable from a clean local database, not dependent on inline shell scripts or an operator remembering old provider id quirks.
4. `/players?season=YYYY` must reflect that season's projected player pool, not every `Player` ever inserted into Prisma.
5. Verification must fail if any claimed season still has `skippedWithoutCanonicalId`, `dropped_before_raw`, or `dropped_in_projection` failures.

## Shortcomings In The Existing Plan And One-Off Execution

The existing long-term plan and the recent execution fall short in these specific ways:

- **2026-only reviewed evidence:** `Scripts/sync-player-directory-season.ts` in the convergence worktree rejects seasons other than `2026`, so `2023/2024/2025` cannot use the reviewed evidence gate.
- **One-off DB seeding:** Historical rows were inserted into `prisma/dev.db` from inline `tsx -e` commands. That repaired one database but did not create durable repo tooling.
- **Duplicated identity forms:** Historical raw rows can expose provider-style ids such as `ply_aaron_cadman`, while shared fallback logic strips `ply_` to `aaron_cadman`. Seeding both forms made local verification pass but introduced duplicate Prisma identities.
- **Contract drift:** The raw contract does not yet centralize "stored provider id" versus "canonical Statly player id" semantics across diagnostics, sync, read models, and reconciliation.
- **API global-player leakage:** `/api/players` counted and paged `Player` globally, so adding historical directory rows inflated every season until `src/server/players/playerPool.ts` was patched locally.
- **Verifier ambiguity:** Local verifier passes can coexist with duplicate player ids if the projection path happens to resolve one form consistently.
- **External merged-source timeout:** `--include-merged-live` timed out for `2025` round `8`; the long-term workflow needs explicit local/raw verification and separate optional external-source verification.
- **Missing primitives on the active branch:** The active checkout does not contain `Scripts/sync-player-directory-season.ts`, `src/server/playerDirectorySeasonRoster.ts`, `src/server/playerDirectorySeasonRosterSync.ts`, or `src/server/playerDataConvergenceRun.ts`. Durable implementation must first integrate or create these primitives in a clean worktree.
- **No clean branch integration:** The current checkout is dirty, and local fixes include an untracked `src/server/players/playerPool.ts`. Durable implementation must happen on a clean integration branch/worktree.

## Long-Term Invariants

These invariants define success:

1. Firestore raw documents remain the only persisted semantic source for Footywire/Fryzigg-derived player-match rows.
2. A single shared helper resolves raw stored player identity into:
   - provider/source id, for provenance
   - canonical Statly player id, for Prisma `Player.id`
   - resolution strategy, for audit and verification
3. Downstream readers do not invent their own `ply_` stripping, slug fallback, team matching, or missing-id semantics.
4. `PlayerSeasonRegistration` rows are created through reviewed, season-scoped evidence or generated evidence that is explicitly reviewed before apply.
5. Directory sync is idempotent and transaction-backed.
6. Rebuild scope is bounded to requested seasons and rounds.
7. `/api/players?season=YYYY` returns only players with `PlayerSeasonSummary` rows for `YYYY`, with `total` matching that projected season pool.
8. Verifiers fail the run when:
   - `skippedWithoutCanonicalId > 0`
   - `dropped_before_raw > 0`
   - `dropped_in_projection > 0`
   - duplicate canonical identities exist for one season/name/team without an explicit alias relationship
9. Mixed real-Firestore/local-SQLite repair runs require explicit operator intent and leave artifact evidence.

## File Map

Canonical identity contract:

- Modify: `shared/player-identity/playerMatchStats.ts`
- Modify: `src/lib/playerIdentity.ts`
- Test: `src/lib/__tests__/playerMatchStats.test.ts`

Diagnostics and evidence:

- Modify: `src/server/diagnostics/playerIdentityGapDiagnosis.ts`
- Modify: `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`
- Create: `src/server/playerDirectoryEvidenceFromRaw.ts`
- Create: `src/server/playerDirectoryEvidenceFromRaw.test.ts`
- Create: `src/data/playerRosterEvidence2023.ts`
- Create: `src/data/playerRosterEvidence2024.ts`
- Create: `src/data/playerRosterEvidence2025.ts`
- Modify: `src/data/playerRosterEvidence2026.ts`
- Create: `src/data/playerRosterEvidence.ts`

Directory sync:

- Create or modify: `Scripts/sync-player-directory-season.ts`
- Create or modify: `src/server/playerDirectorySeasonRoster.ts`
- Create or modify: `src/server/playerDirectorySeasonRoster.test.ts`
- Create or modify: `src/server/playerDirectorySeasonRosterSync.ts`
- Create or modify: `src/server/playerDirectorySeasonRosterSync.test.ts`

Convergence runner:

- Create or modify: `src/server/playerDataConvergenceRun.ts`
- Create or modify: `src/server/playerDataConvergenceRun.test.ts`
- Create or modify: `Scripts/run-player-data-convergence.ts`
- Modify: `package.json`

Read models and API:

- Modify: `src/server/readModels/playerReadModels.ts`
- Modify: `src/server/readModels/playerReadModels.test.ts`
- Modify: `src/server/players/playerPool.ts`
- Create or modify: `src/server/players/playerPool.test.ts`
- Modify: `src/app/api/players/route.test.ts`

Verification and docs:

- Modify: `Scripts/verify-player-read-models-core.ts`
- Modify: `tests/verify-player-read-models-core.test.ts`
- Modify: `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- Modify: `docs/DATA_RELIABILITY.md`
- Create: `docs/player-data-convergence-runbook.md`

## Branch And Worktree Strategy

Do not continue implementation in the dirty `/Users/robert/Developer/Statly` checkout. Use a clean worktree.

- [ ] **Step 1: Preserve current dirty state**

```bash
cd /Users/robert/Developer/Statly
mkdir -p tmp/player-data-convergence
git status --short --branch > tmp/player-data-convergence/current-status.txt
git diff --name-only > tmp/player-data-convergence/current-dirty-files.txt
```

Expected:
- `tmp/player-data-convergence/current-status.txt` records the dirty branch state.
- `tmp/player-data-convergence/current-dirty-files.txt` records touched files.

- [ ] **Step 2: Create clean implementation worktree**

```bash
cd /Users/robert/Developer/Statly
git worktree add .worktrees/player-data-convergence-multiseason -b codex/player-data-convergence-multiseason HEAD
cd .worktrees/player-data-convergence-multiseason
npm install
git status --short --branch
```

Expected:
- Branch is `codex/player-data-convergence-multiseason`.
- Worktree is clean after install, except expected package metadata if npm changes it.

- [ ] **Step 3: Run baseline tests for files present before integration**

```bash
npx vitest run \
  src/lib/__tests__/playerMatchStats.test.ts \
  src/server/diagnostics/playerIdentityGapDiagnosis.test.ts \
  src/server/readModels/playerReadModels.test.ts \
  src/app/api/players/route.test.ts \
  tests/verify-player-read-models-core.test.ts
```

Expected:
- Tests pass before implementation, or failures are documented with exact test names before proceeding.

## Task 0: Integrate Or Create Convergence Foundation Primitives

**Invariant enforced:** The active branch has first-class convergence primitives before multi-season behavior is added.

**Files:**
- Create or modify: `src/server/playerDirectorySeasonRoster.ts`
- Create or modify: `src/server/playerDirectorySeasonRoster.test.ts`
- Create or modify: `src/server/playerDirectorySeasonRosterSync.ts`
- Create or modify: `src/server/playerDirectorySeasonRosterSync.test.ts`
- Create or modify: `Scripts/sync-player-directory-season.ts`
- Create or modify: `src/server/playerDataConvergenceRun.ts`
- Create or modify: `src/server/playerDataConvergenceRun.test.ts`
- Create or modify: `Scripts/run-player-data-convergence.ts`
- Modify: `package.json`

- [ ] **Step 1: Confirm whether primitives are present**

```bash
for path in \
  Scripts/sync-player-directory-season.ts \
  src/server/playerDirectorySeasonRoster.ts \
  src/server/playerDirectorySeasonRosterSync.ts \
  src/server/playerDataConvergenceRun.ts \
  Scripts/run-player-data-convergence.ts
do
  if test -f "$path"; then
    echo "present $path"
  else
    echo "missing $path"
  fi
done
```

Expected on the current active branch before this task:
- `missing Scripts/sync-player-directory-season.ts`
- `missing src/server/playerDirectorySeasonRoster.ts`
- `missing src/server/playerDirectorySeasonRosterSync.ts`
- `missing src/server/playerDataConvergenceRun.ts`
- `missing Scripts/run-player-data-convergence.ts`

- [ ] **Step 2: Integrate known convergence primitives if source branch is available**

Run:

```bash
git show codex/player-directory-convergence:src/server/playerDirectorySeasonRoster.ts >/tmp/playerDirectorySeasonRoster.ts
git show codex/player-directory-convergence:src/server/playerDirectorySeasonRosterSync.ts >/tmp/playerDirectorySeasonRosterSync.ts
git show codex/full-data-convergence-plan:src/server/playerDataConvergenceRun.ts >/tmp/playerDataConvergenceRun.ts
```

Expected:
- All three `git show` commands exit `0` if the source branches are present.

If a command exits non-zero, stop this task and create the missing primitive from the code in the earlier reviewed plan `docs/superpowers/plans/2026-05-05-round-0-player-directory-convergence.md` before continuing. Do not proceed with multi-season behavior until these base primitives exist and have tests.

- [ ] **Step 3: Restore primitive files from reviewed branch content**

Run:

```bash
git checkout codex/player-directory-convergence -- \
  src/server/playerDirectorySeasonRoster.ts \
  src/server/playerDirectorySeasonRoster.test.ts \
  src/server/playerDirectorySeasonRosterSync.ts \
  src/server/playerDirectorySeasonRosterSync.test.ts \
  Scripts/sync-player-directory-season.ts

git checkout codex/full-data-convergence-plan -- \
  src/server/playerDataConvergenceRun.ts \
  src/server/playerDataConvergenceRun.test.ts \
  Scripts/run-player-data-convergence.ts
```

Expected:
- The listed files now exist in the clean implementation worktree.

- [ ] **Step 4: Add package scripts**

In `package.json`, add these scripts if absent:

```json
"sync:player-directory-season": "tsx Scripts/sync-player-directory-season.ts",
"converge:player-data": "tsx Scripts/run-player-data-convergence.ts"
```

- [ ] **Step 5: Run foundation tests**

```bash
npx vitest run \
  src/server/playerDirectorySeasonRoster.test.ts \
  src/server/playerDirectorySeasonRosterSync.test.ts \
  src/server/playerDataConvergenceRun.test.ts
```

Expected:
- Tests pass before multi-season changes are applied.

- [ ] **Step 6: Commit foundation primitives**

```bash
git add \
  src/server/playerDirectorySeasonRoster.ts \
  src/server/playerDirectorySeasonRoster.test.ts \
  src/server/playerDirectorySeasonRosterSync.ts \
  src/server/playerDirectorySeasonRosterSync.test.ts \
  Scripts/sync-player-directory-season.ts \
  src/server/playerDataConvergenceRun.ts \
  src/server/playerDataConvergenceRun.test.ts \
  Scripts/run-player-data-convergence.ts \
  package.json
git commit -m "feat: integrate player data convergence primitives"
```

## Task 1: Centralize Raw Player Identity Normalization

**Invariant enforced:** Raw provider ids and canonical Statly player ids are resolved by one shared contract helper.

**Files:**
- Modify: `shared/player-identity/playerMatchStats.ts`
- Modify: `src/lib/__tests__/playerMatchStats.test.ts`

- [ ] **Step 1: Write failing tests for raw identity normalization**

Add tests covering these cases in `src/lib/__tests__/playerMatchStats.test.ts`:

```ts
import {
  resolveRawPlayerIdentity,
  resolveCanonicalPlayerIdFromRecord,
  createPlayerIdentityResolver,
} from '@shared/player-identity/playerMatchStats';

describe('resolveRawPlayerIdentity', () => {
  it('preserves provider id and resolves ply-prefixed ids to the canonical Statly id', () => {
    expect(
      resolveRawPlayerIdentity({
        player_uid: 'ply_aaron_cadman',
        player_name: 'Aaron Cadman',
        team: 'Greater Western Sydney',
      })
    ).toEqual({
      providerPlayerId: 'ply_aaron_cadman',
      canonicalPlayerId: 'aaron_cadman',
      strategy: 'provider_ply_prefix',
    });
  });

  it('keeps non-provider stored ids as canonical when already stable', () => {
    expect(
      resolveRawPlayerIdentity({
        player_id: 'aaron-cadman',
        player_name: 'Aaron Cadman',
        team: 'GWS',
      })
    ).toEqual({
      providerPlayerId: 'aaron-cadman',
      canonicalPlayerId: 'aaron-cadman',
      strategy: 'stored_player_id',
    });
  });

  it('falls back to name slug only when no stored identity exists', () => {
    expect(
      resolveRawPlayerIdentity({
        player_name: 'Aaron Cadman',
        team: 'GWS',
      })
    ).toEqual({
      providerPlayerId: null,
      canonicalPlayerId: 'aaron_cadman',
      strategy: 'name_slug_fallback',
    });
  });

  it('resolves canonical ids from the same helper used by the directory resolver', () => {
    const resolver = createPlayerIdentityResolver([
      { id: 'aaron_cadman', name: 'Aaron Cadman', club: 'Greater Western Sydney' },
    ]);

    expect(
      resolveCanonicalPlayerIdFromRecord(
        {
          player_uid: 'ply_aaron_cadman',
          player_name: 'Aaron Cadman',
          team: 'Greater Western Sydney',
        },
        resolver
      )
    ).toBe('aaron_cadman');
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npx vitest run src/lib/__tests__/playerMatchStats.test.ts -t "resolveRawPlayerIdentity"
```

Expected:
- Fails because `resolveRawPlayerIdentity` is not implemented.

- [ ] **Step 3: Implement shared helper**

In `shared/player-identity/playerMatchStats.ts`, add:

```ts
export type RawPlayerIdentityResolution = {
  providerPlayerId: string | null;
  canonicalPlayerId: string | null;
  strategy:
    | 'stored_player_id'
    | 'provider_ply_prefix'
    | 'player_uid'
    | 'name_slug_fallback'
    | 'unresolved';
};

export function resolveRawPlayerIdentity(
  data: Record<string, unknown>
): RawPlayerIdentityResolution {
  const storedPlayerId = readCanonicalPlayerId(data);
  if (storedPlayerId) {
    const providerStyle = readProviderStylePlayerId(storedPlayerId);
    if (providerStyle) {
      return {
        providerPlayerId: storedPlayerId,
        canonicalPlayerId: providerStyle,
        strategy: 'provider_ply_prefix',
      };
    }
    return {
      providerPlayerId: storedPlayerId,
      canonicalPlayerId: storedPlayerId,
      strategy: 'stored_player_id',
    };
  }

  const playerUid =
    readStringCandidate(data.player_uid) ?? readStringCandidate(data.playerUid);
  if (playerUid) {
    const providerStyle = readProviderStylePlayerId(playerUid);
    return {
      providerPlayerId: playerUid,
      canonicalPlayerId: providerStyle ?? playerUid,
      strategy: providerStyle ? 'provider_ply_prefix' : 'player_uid',
    };
  }

  const playerName = readPlayerName(data);
  if (playerName) {
    return {
      providerPlayerId: null,
      canonicalPlayerId: buildCanonicalPlayerId(playerName),
      strategy: 'name_slug_fallback',
    };
  }

  return {
    providerPlayerId: null,
    canonicalPlayerId: null,
    strategy: 'unresolved',
  };
}
```

Update `resolveCanonicalPlayerIdFromRecord` to call `resolveRawPlayerIdentity(data)` first:

```ts
export function resolveCanonicalPlayerIdFromRecord(
  data: Record<string, unknown>,
  resolver: PlayerIdentityResolver
): string | null {
  const rawIdentity = resolveRawPlayerIdentity(data);
  if (rawIdentity.canonicalPlayerId && resolver.canonicalIds.has(rawIdentity.canonicalPlayerId)) {
    return rawIdentity.canonicalPlayerId;
  }

  const playerName = readPlayerName(data);
  if (!playerName) return null;

  const directoryEntry = resolvePlayerDirectoryEntry(
    resolver.directory,
    playerName,
    readPlayerTeam(data)
  );
  if (directoryEntry?.id) {
    return directoryEntry.id;
  }

  const slugFallback = buildCanonicalPlayerId(playerName);
  return resolver.canonicalIds.has(slugFallback) ? slugFallback : null;
}
```

- [ ] **Step 4: Run identity tests**

```bash
npx vitest run src/lib/__tests__/playerMatchStats.test.ts
```

Expected:
- Tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/player-identity/playerMatchStats.ts src/lib/__tests__/playerMatchStats.test.ts
git commit -m "feat: centralize raw player identity resolution"
```

## Task 2: Make Diagnostics Use The Shared Identity Contract

**Invariant enforced:** Diagnostics report stored provider ids and canonical ids consistently for every target season.

**Files:**
- Modify: `src/server/diagnostics/playerIdentityGapDiagnosis.ts`
- Modify: `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`

- [ ] **Step 1: Add diagnostic tests for provider ids**

Add a test in `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`:

```ts
it('reports provider ids and canonical ids separately for historical ply-prefixed rows', async () => {
  const result = await runIdentityGapDiagnosis({
    season: 2023,
    rounds: [1],
    prismaPlayers: [{ id: 'aaron_cadman', name: 'Aaron Cadman', club: 'Greater Western Sydney' }],
    firestoreRows: [
      {
        docId: '2023-R1-GWS-SYD_ply_aaron_cadman',
        data: {
          season: 2023,
          round: 1,
          player_uid: 'ply_aaron_cadman',
          player_name: 'Aaron Cadman',
          team: 'Greater Western Sydney',
          raw_row: { kicks: 8 },
        },
      },
    ],
    unresolvedRows: [],
  });

  expect(result.summary.classificationCounts.canonical_player_id_ok).toBe(1);
  expect(result.rows[0]).toMatchObject({
    stored_player_id: 'ply_aaron_cadman',
    resolved_player_id: 'aaron_cadman',
    identity_resolution_strategy: 'provider_ply_prefix',
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

```bash
npx vitest run src/server/diagnostics/playerIdentityGapDiagnosis.test.ts -t "provider ids and canonical ids"
```

Expected:
- Fails because diagnostic rows do not expose `identity_resolution_strategy` and may not distinguish provider id from canonical id.

- [ ] **Step 3: Update diagnostic row shape**

In `src/server/diagnostics/playerIdentityGapDiagnosis.ts`:

- import `resolveRawPlayerIdentity`
- add `identity_resolution_strategy` to `IdentityGapDiagnosticRow`
- set:

```ts
const rawIdentity = resolveRawPlayerIdentity(data);
const storedPlayerId = rawIdentity.providerPlayerId ?? rawIdentity.canonicalPlayerId;
const resolvedPlayerId = resolveCanonicalPlayerIdFromRecord(data, playerIdentityResolver);
```

Diagnostic semantics:

- `stored_player_id` remains the source/provider id when present.
- `resolved_player_id` is the canonical Prisma id candidate.
- `identity_resolution_strategy` records how the mapping was derived.
- `player_id_not_in_prisma` is based on `resolved_player_id` not existing in Prisma, not on `stored_player_id` string equality.

- [ ] **Step 4: Run diagnostic tests**

```bash
npx vitest run src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
```

Expected:
- Tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/diagnostics/playerIdentityGapDiagnosis.ts src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
git commit -m "feat: align identity diagnostics with canonical contract"
```

## Task 3: Generate Reviewed Evidence Inputs For Historical Seasons

**Invariant enforced:** Historical directory sync is driven by artifacted evidence, not inline DB seeding.

**Files:**
- Create: `src/server/playerDirectoryEvidenceFromRaw.ts`
- Create: `src/server/playerDirectoryEvidenceFromRaw.test.ts`
- Create: `Scripts/generate-player-roster-evidence.ts`
- Modify: `package.json`

- [ ] **Step 1: Write evidence builder tests**

Create `src/server/playerDirectoryEvidenceFromRaw.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildReviewedRosterEvidenceDrafts } from './playerDirectoryEvidenceFromRaw';

describe('buildReviewedRosterEvidenceDrafts', () => {
  it('deduplicates raw rows into canonical season roster evidence drafts', () => {
    const drafts = buildReviewedRosterEvidenceDrafts({
      season: 2023,
      reviewedBy: 'generated-for-review',
      reviewedAt: '2026-05-08',
      rows: [
        {
          docId: '2023-R1-GWS-SYD_ply_aaron_cadman',
          data: {
            season: 2023,
            round: 1,
            player_uid: 'ply_aaron_cadman',
            player_name: 'Aaron Cadman',
            team: 'Greater Western Sydney',
            raw_row: { player_position: 'FPR' },
          },
        },
        {
          docId: '2023-R2-GWS-CAR_ply_aaron_cadman',
          data: {
            season: 2023,
            round: 2,
            player_uid: 'ply_aaron_cadman',
            player_name: 'Aaron Cadman',
            team: 'Greater Western Sydney',
            raw_row: { player_position: 'FPR' },
          },
        },
      ],
    });

    expect(drafts).toEqual([
      expect.objectContaining({
        season: 2023,
        playerId: 'aaron_cadman',
        playerName: 'Aaron Cadman',
        club: 'Greater Western Sydney',
        position: 'FWD',
        aliases: [
          expect.objectContaining({
            aliasName: 'ply_aaron_cadman',
            seasonFrom: 2023,
            seasonTo: 2023,
          }),
        ],
        diagnosticEvidence: {
          sourceDocumentIds: [
            '2023-R1-GWS-SYD_ply_aaron_cadman',
            '2023-R2-GWS-CAR_ply_aaron_cadman',
          ],
          sourcePlayerName: 'Aaron Cadman',
          sourceTeam: 'Greater Western Sydney',
        },
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

```bash
npx vitest run src/server/playerDirectoryEvidenceFromRaw.test.ts
```

Expected:
- Fails because the evidence builder does not exist.

- [ ] **Step 3: Implement evidence builder**

Create `src/server/playerDirectoryEvidenceFromRaw.ts` with:

```ts
import type { ReviewedSeasonRosterEntry } from './playerDirectorySeasonRoster';
import { resolveRawPlayerIdentity } from '@shared/player-identity/playerMatchStats';

type RawEvidenceRow = {
  docId: string;
  data: Record<string, unknown>;
};

type BuildEvidenceInput = {
  season: number;
  rows: RawEvidenceRow[];
  reviewedBy: string;
  reviewedAt: string;
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNestedRawRow(data: Record<string, unknown>): Record<string, unknown> {
  return typeof data.raw_row === 'object' && data.raw_row !== null
    ? (data.raw_row as Record<string, unknown>)
    : {};
}

function mapPosition(raw: unknown): ReviewedSeasonRosterEntry['position'] {
  const value = String(raw ?? '').toUpperCase();
  if (/RUC|RUCK|FOL/.test(value)) return 'RUC';
  if (/DEF|BACK|BPD|BP|FB|CHB|HBD|HB/.test(value)) return 'DEF';
  if (/FWD|FPR|FP|FF|CHF|HFF|HF/.test(value)) return 'FWD';
  return 'MID';
}

export function buildReviewedRosterEvidenceDrafts(
  input: BuildEvidenceInput
): ReviewedSeasonRosterEntry[] {
  const byPlayerId = new Map<string, ReviewedSeasonRosterEntry>();

  for (const row of input.rows) {
    const data = row.data;
    const rawRow = readNestedRawRow(data);
    const identity = resolveRawPlayerIdentity(data);
    const playerId = identity.canonicalPlayerId;
    const playerName = readString(data.player_name) ?? readString(rawRow.player_name);
    const club = readString(data.team) ?? readString(rawRow.team);
    if (!playerId || !playerName || !club) continue;

    const existing = byPlayerId.get(playerId);
    if (existing) {
      existing.diagnosticEvidence?.sourceDocumentIds.push(row.docId);
      continue;
    }

    const providerAlias =
      identity.providerPlayerId && identity.providerPlayerId !== playerId
        ? [
            {
              aliasName: identity.providerPlayerId,
              club,
              seasonFrom: input.season,
              seasonTo: input.season,
              source: 'FOOTYWIRE' as const,
              confidence: 1,
              notes: `Provider player id observed in raw player_match_stats via ${identity.strategy}.`,
            },
          ]
        : [];

    byPlayerId.set(playerId, {
      season: input.season,
      playerId,
      playerName,
      club,
      position: mapPosition(data.position ?? data.player_position ?? rawRow.player_position),
      playerStatus: 'listed',
      listStatus: 'active',
      active: true,
      source: 'manual-roster-review',
      sourceLabel: 'Generated from Firestore raw player_match_stats for manual review',
      sourceUrl: 'firestore://player_match_stats',
      reviewedBy: input.reviewedBy,
      reviewedAt: input.reviewedAt,
      notes:
        'Generated evidence draft. Reviewer must confirm player, club, and position before apply.',
      aliases: providerAlias,
      diagnosticEvidence: {
        sourceDocumentIds: [row.docId],
        sourcePlayerName: playerName,
        sourceTeam: club,
      },
    });
  }

  return [...byPlayerId.values()].sort((left, right) =>
    left.playerId.localeCompare(right.playerId)
  );
}
```

- [ ] **Step 4: Add generator CLI**

Create `Scripts/generate-player-roster-evidence.ts`:

```ts
#!/usr/bin/env tsx

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { buildReviewedRosterEvidenceDrafts } from '../src/server/playerDirectoryEvidenceFromRaw';

function readArg(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parseRounds(value: string | undefined): number[] {
  if (!value) throw new Error('Expected --rounds=1,2,3');
  return [...new Set(value.split(',').map((part) => Number(part.trim())))]
    .filter((round) => Number.isInteger(round) && round >= 0)
    .sort((left, right) => left - right);
}

async function main() {
  dotenvConfig({ path: '.env.local', quiet: true });
  const season = Number(readArg(process.argv.slice(2), '--season'));
  const rounds = parseRounds(readArg(process.argv.slice(2), '--rounds'));
  const output = readArg(process.argv.slice(2), '--output');
  if (!Number.isInteger(season)) throw new Error('Expected --season');
  if (!output) throw new Error('Expected --output');

  const { adminDb } = await import('../src/lib/firebaseAdmin');
  const rows: Array<{ docId: string; data: Record<string, unknown> }> = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = adminDb
      .collection('player_match_stats')
      .where('season', '==', season)
      .orderBy('__name__')
      .limit(1000);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const round = Number(data.round_number ?? data.round);
      if (rounds.includes(round)) rows.push({ docId: doc.id, data });
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 1000) break;
  }

  const entries = buildReviewedRosterEvidenceDrafts({
    season,
    rows,
    reviewedBy: 'generated-for-review',
    reviewedAt: new Date().toISOString().slice(0, 10),
  });

  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify({ season, rounds, generatedAt: new Date().toISOString(), entries }, null, 2)
  );
  console.log(JSON.stringify({ ok: true, season, rounds, rows: rows.length, entries: entries.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 5: Add package script**

In `package.json` scripts:

```json
"generate:player-roster-evidence": "tsx Scripts/generate-player-roster-evidence.ts"
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/server/playerDirectoryEvidenceFromRaw.test.ts
```

Expected:
- Tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/playerDirectoryEvidenceFromRaw.ts src/server/playerDirectoryEvidenceFromRaw.test.ts Scripts/generate-player-roster-evidence.ts package.json
git commit -m "feat: generate season roster evidence from raw player rows"
```

## Task 4: Generalize Reviewed Roster Evidence Loading

**Invariant enforced:** `sync-player-directory-season` works for every supported season and refuses unsupported seasons explicitly.

**Files:**
- Create: `src/data/playerRosterEvidence.ts`
- Create: `src/data/playerRosterEvidence2023.ts`
- Create: `src/data/playerRosterEvidence2024.ts`
- Create: `src/data/playerRosterEvidence2025.ts`
- Modify: `src/data/playerRosterEvidence2026.ts`
- Modify: `Scripts/sync-player-directory-season.ts`
- Modify: `src/server/playerDirectorySeasonRoster.test.ts`

- [ ] **Step 1: Add season evidence registry tests**

Add a test in `src/server/playerDirectorySeasonRoster.test.ts`:

```ts
import { getReviewedRosterEvidenceForSeason } from '@/data/playerRosterEvidence';

it.each([2023, 2024, 2025, 2026])(
  'loads reviewed roster evidence for %s',
  (season) => {
    const evidence = getReviewedRosterEvidenceForSeason(season);
    expect(Array.isArray(evidence)).toBe(true);
    for (const entry of evidence) {
      expect(entry.season).toBe(season);
      expect(entry.playerId).toBeTruthy();
      expect(entry.playerName).toBeTruthy();
      expect(entry.club).toBeTruthy();
    }
  }
);

it('rejects unsupported roster evidence seasons', () => {
  expect(() => getReviewedRosterEvidenceForSeason(2022)).toThrow(
    'No reviewed player roster evidence is registered for season 2022'
  );
});
```

- [ ] **Step 2: Create empty typed historical evidence modules**

Create `src/data/playerRosterEvidence2023.ts`, `src/data/playerRosterEvidence2024.ts`, and `src/data/playerRosterEvidence2025.ts`:

```ts
import type { ReviewedSeasonRosterEntry } from '@/server/playerDirectorySeasonRoster';

export const playerRosterEvidence2023: ReviewedSeasonRosterEntry[] = [];
```

Use matching export names for each season.

- [ ] **Step 3: Create registry**

Create `src/data/playerRosterEvidence.ts`:

```ts
import type { ReviewedSeasonRosterEntry } from '@/server/playerDirectorySeasonRoster';
import { playerRosterEvidence2023 } from './playerRosterEvidence2023';
import { playerRosterEvidence2024 } from './playerRosterEvidence2024';
import { playerRosterEvidence2025 } from './playerRosterEvidence2025';
import { playerRosterEvidence2026 } from './playerRosterEvidence2026';

const evidenceBySeason = new Map<number, ReviewedSeasonRosterEntry[]>([
  [2023, playerRosterEvidence2023],
  [2024, playerRosterEvidence2024],
  [2025, playerRosterEvidence2025],
  [2026, playerRosterEvidence2026],
]);

export function getReviewedRosterEvidenceForSeason(
  season: number
): ReviewedSeasonRosterEntry[] {
  const evidence = evidenceBySeason.get(season);
  if (!evidence) {
    throw new Error(`No reviewed player roster evidence is registered for season ${season}`);
  }
  return evidence;
}
```

- [ ] **Step 4: Update sync CLI**

In `Scripts/sync-player-directory-season.ts`:

- remove the hard-coded `season !== 2026` rejection
- import `getReviewedRosterEvidenceForSeason`
- replace `playerRosterEvidence2026` with `getReviewedRosterEvidenceForSeason(options.season)`

Expected behavior:
- Unsupported seasons fail from registry.
- Supported seasons with empty evidence fail coverage when diagnostic rows require players.

- [ ] **Step 5: Run focused tests and CLI smoke**

```bash
npx vitest run src/server/playerDirectorySeasonRoster.test.ts
npm --silent run sync:player-directory-season -- --season=2022 --json
```

Expected:
- Tests pass.
- CLI exits non-zero with `No reviewed player roster evidence is registered for season 2022`.

- [ ] **Step 6: Commit**

```bash
git add src/data/playerRosterEvidence.ts src/data/playerRosterEvidence2023.ts src/data/playerRosterEvidence2024.ts src/data/playerRosterEvidence2025.ts Scripts/sync-player-directory-season.ts src/server/playerDirectorySeasonRoster.test.ts
git commit -m "feat: register reviewed roster evidence by season"
```

## Task 5: Curate Historical Reviewed Evidence

**Invariant enforced:** Historical Prisma directory rows are created from reviewed evidence, not raw one-off imports.

**Files:**
- Modify: `src/data/playerRosterEvidence2023.ts`
- Modify: `src/data/playerRosterEvidence2024.ts`
- Modify: `src/data/playerRosterEvidence2025.ts`
- Generated local artifacts: `tmp/player-roster-evidence/*.json`

- [ ] **Step 1: Generate evidence drafts**

Run:

```bash
npm --silent run generate:player-roster-evidence -- --season=2023 --rounds=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24 --output=tmp/player-roster-evidence/2023.json
npm --silent run generate:player-roster-evidence -- --season=2024 --rounds=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24 --output=tmp/player-roster-evidence/2024.json
npm --silent run generate:player-roster-evidence -- --season=2025 --rounds=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24 --output=tmp/player-roster-evidence/2025.json
```

Expected:
- Each command prints `{ "ok": true, ... }`.
- Generated entry counts are non-zero.

- [ ] **Step 2: Review evidence for duplicate canonical identities**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
for (const season of [2023, 2024, 2025]) {
  const data = JSON.parse(fs.readFileSync(`tmp/player-roster-evidence/${season}.json`, 'utf8'));
  const ids = new Map();
  const duplicates = [];
  for (const entry of data.entries) {
    const key = `${entry.playerName.toLowerCase()}|${entry.club.toLowerCase()}`;
    const existing = ids.get(key);
    if (existing && existing !== entry.playerId) duplicates.push({ season, key, ids: [existing, entry.playerId] });
    ids.set(key, entry.playerId);
  }
  console.log(JSON.stringify({ season, entries: data.entries.length, duplicates }, null, 2));
}
NODE
```

Expected:
- `duplicates` is empty for each season, or every duplicate is manually resolved before Step 3.

- [ ] **Step 3: Convert reviewed JSON into TypeScript modules**

For each generated file, copy `entries` into the matching module:

```ts
import type { ReviewedSeasonRosterEntry } from '@/server/playerDirectorySeasonRoster';

export const playerRosterEvidence2023: ReviewedSeasonRosterEntry[] = [
  // reviewed entries from tmp/player-roster-evidence/2023.json
];
```

Rules:
- Do not include both `ply_aaron_cadman` and `aaron_cadman` as separate players.
- Keep provider ids as aliases when they differ from canonical ids.
- Ensure every entry has `sourceLabel`, `sourceUrl`, `reviewedBy`, `reviewedAt`, and `notes`.

- [ ] **Step 4: Validate historical evidence**

```bash
npx vitest run src/server/playerDirectorySeasonRoster.test.ts
```

Expected:
- Tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/playerRosterEvidence2023.ts src/data/playerRosterEvidence2024.ts src/data/playerRosterEvidence2025.ts
git commit -m "data: add reviewed historical player roster evidence"
```

## Task 6: Make Directory Sync Multi-Season And Idempotent

**Invariant enforced:** Applying historical evidence creates exactly one canonical player id per player per season.

**Files:**
- Modify: `src/server/playerDirectorySeasonRosterSync.ts`
- Modify: `src/server/playerDirectorySeasonRosterSync.test.ts`
- Modify: `Scripts/sync-player-directory-season.ts`

- [ ] **Step 1: Add tests for provider alias behavior**

In `src/server/playerDirectorySeasonRosterSync.test.ts`, add:

```ts
it('creates canonical player and provider alias without creating a duplicate provider player', async () => {
  const plan = await buildSeasonRosterSyncPlan(prisma, {
    season: 2023,
    entries: [
      {
        season: 2023,
        playerId: 'aaron_cadman',
        playerName: 'Aaron Cadman',
        club: 'Greater Western Sydney',
        position: 'FWD',
        playerStatus: 'listed',
        listStatus: 'active',
        active: true,
        source: 'manual-roster-review',
        sourceLabel: 'Reviewed historical roster',
        sourceUrl: 'firestore://player_match_stats',
        reviewedBy: 'manual-review-2026-05-08',
        reviewedAt: '2026-05-08',
        notes: 'Reviewed provider identity.',
        aliases: [
          {
            aliasName: 'ply_aaron_cadman',
            club: 'Greater Western Sydney',
            seasonFrom: 2023,
            seasonTo: 2023,
            source: 'FOOTYWIRE',
            confidence: 1,
            notes: 'Provider id alias.',
          },
        ],
      },
    ],
  });

  expect(plan.valid).toBe(true);
  expect(plan.playersToCreate).toHaveLength(1);
  expect(plan.playersToCreate[0]?.id).toBe('aaron_cadman');
  expect(plan.aliasesToCreate).toEqual([
    expect.objectContaining({
      playerId: 'aaron_cadman',
      aliasName: 'ply_aaron_cadman',
      seasonFrom: 2023,
      seasonTo: 2023,
    }),
  ]);
});
```

- [ ] **Step 2: Run sync tests**

```bash
npx vitest run src/server/playerDirectorySeasonRosterSync.test.ts
```

Expected:
- Fails if alias handling or duplicate checks do not preserve canonical-only player creation.

- [ ] **Step 3: Fix sync plan if needed**

Ensure `buildSeasonRosterSyncPlan`:

- rejects duplicate player ids with conflicting facts
- rejects aliases assigned to multiple player ids in the same scope
- creates aliases for provider ids instead of creating provider-id `Player` rows
- remains idempotent after `applySeasonRosterSyncPlan`

- [ ] **Step 4: Run sync tests**

```bash
npx vitest run src/server/playerDirectorySeasonRosterSync.test.ts
```

Expected:
- Tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/playerDirectorySeasonRosterSync.ts src/server/playerDirectorySeasonRosterSync.test.ts Scripts/sync-player-directory-season.ts
git commit -m "feat: make player directory sync safe for historical seasons"
```

## Task 7: Update Read Models To Consume Canonical Identity Only

**Invariant enforced:** Read-model rebuilds never require duplicate provider-id players to materialize historical rows.

**Files:**
- Modify: `src/server/readModels/playerReadModels.ts`
- Modify: `src/server/readModels/playerReadModels.test.ts`

- [ ] **Step 1: Add historical raw-row test**

In `src/server/readModels/playerReadModels.test.ts`, add a test:

```ts
it('materializes historical ply-prefixed raw rows through canonical player identity without duplicate players', async () => {
  const result = await buildPlayerSeasonSummaries({
    season: 2023,
    firestore: firestoreWithPlayerMatchStats([
      {
        id: '2023-R1-GWS-SYD_ply_aaron_cadman',
        data: {
          season: 2023,
          round: 1,
          player_uid: 'ply_aaron_cadman',
          player_name: 'Aaron Cadman',
          team: 'Greater Western Sydney',
          match_id: '2023-R1-GWS-SYD',
          raw_row: { kicks: 8, handballs: 4, player_position: 'FPR' },
        },
      },
    ]),
    prismaClient: prismaWithPlayers([
      { id: 'aaron_cadman', name: 'Aaron Cadman', club: 'Greater Western Sydney', position: 'FWD', active: true },
    ]),
  });

  expect(result.skippedWithoutCanonicalId).toBe(0);
  expect(result.summaries).toEqual([
    expect.objectContaining({
      playerId: 'aaron_cadman',
      playerName: 'Aaron Cadman',
      gamesPlayed: 1,
    }),
  ]);
});
```

Use existing test helpers in the file rather than adding new framework dependencies.

- [ ] **Step 2: Run read-model test**

```bash
npx vitest run src/server/readModels/playerReadModels.test.ts -t "historical ply-prefixed"
```

Expected:
- Fails if the read model still depends on provider-id `Player` rows.

- [ ] **Step 3: Update read model identity calls**

Ensure `src/server/readModels/playerReadModels.ts`:

- imports and uses the shared `resolveRawPlayerIdentity` / `resolveCanonicalPlayerIdFromRecord`
- does not use `readCanonicalPlayerId(data)` alone as a permanent semantic gate
- records provider id only for provenance or reconciliation evidence
- increments `fallbackResolvedPlayerProfiles` only when useful, not as a substitute for canonical contract handling

- [ ] **Step 4: Run read-model tests**

```bash
npx vitest run src/server/readModels/playerReadModels.test.ts
```

Expected:
- Tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/readModels/playerReadModels.ts src/server/readModels/playerReadModels.test.ts
git commit -m "feat: resolve historical raw rows through canonical player identity"
```

## Task 8: Make `/players` Strictly Season-Scoped

**Invariant enforced:** `/api/players?season=YYYY` total equals the selected season's projected player pool.

**Files:**
- Modify: `src/server/players/playerPool.ts`
- Create or modify: `src/server/players/playerPool.test.ts`
- Modify: `src/app/api/players/route.test.ts`

- [ ] **Step 1: Write player pool tests**

Create `src/server/players/playerPool.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { listPlayerPool } from './playerPool';

describe('listPlayerPool', () => {
  it('paginates from season summaries instead of the global player table', async () => {
    const prismaClient = {
      playerSeasonSummary: {
        count: vi.fn().mockResolvedValue(230),
        findMany: vi.fn().mockResolvedValue([
          {
            playerId: 'aaron_naughton',
            season: 2026,
            playerName: 'Aaron Naughton',
            club: 'Western Bulldogs',
            position: 'FWD',
            gamesPlayed: 5,
            averageScore: 24.8,
            totalValue: 124,
            statsJson: JSON.stringify({ goals: 3 }),
            totalsJson: JSON.stringify({ goals: 15 }),
          },
        ]),
      },
      waiverClaim: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;

    const result = await listPlayerPool({
      requestedSeason: 2026,
      page: 1,
      limit: 20,
      fallbackSeason: 2026,
      prismaClient,
    });

    expect(result.total).toBe(230);
    expect(result.players).toEqual([
      expect.objectContaining({
        id: 'aaron_naughton',
        name: 'Aaron Naughton',
        gamesPlayed: 5,
      }),
    ]);
    expect(prismaClient.playerSeasonSummary.count).toHaveBeenCalledWith({
      where: { season: 2026 },
    });
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

```bash
npx vitest run src/server/players/playerPool.test.ts
```

Expected:
- Fails if `listPlayerPool` still queries `prisma.player`.

- [ ] **Step 3: Update `listPlayerPool`**

In `src/server/players/playerPool.ts`:

- query `playerSeasonSummary.count` and `playerSeasonSummary.findMany`
- include `season` in every query
- filter `club`, `position`, and `search` against summary fields
- parse `statsJson` and `totalsJson`
- use summary rows as the API player source

The core query should follow this shape:

```ts
const where = {
  ...buildPlayerWhere(input),
  season,
};
const [total, summaries] = await Promise.all([
  prismaClient.playerSeasonSummary.count({ where }),
  prismaClient.playerSeasonSummary.findMany({
    where,
    orderBy: { playerName: 'asc' },
    skip: start,
    take: limit,
  }),
]);
```

- [ ] **Step 4: Update route tests**

In `src/app/api/players/route.test.ts`, mock `playerSeasonSummary.count` and `playerSeasonSummary.findMany`, not `player.count` and `player.findMany`, for the player pool path.

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/server/players/playerPool.test.ts src/app/api/players/route.test.ts
```

Expected:
- Tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/players/playerPool.ts src/server/players/playerPool.test.ts src/app/api/players/route.test.ts
git commit -m "fix: scope players API to selected season projections"
```

## Task 9: Make The Convergence Runner Multi-Season

**Invariant enforced:** One command can converge a bounded season/round slice using the durable path.

**Files:**
- Modify: `src/server/playerDataConvergenceRun.ts`
- Modify: `src/server/playerDataConvergenceRun.test.ts`
- Modify: `Scripts/run-player-data-convergence.ts`
- Modify: `package.json`

- [ ] **Step 1: Add runner tests for historical seasons**

In `src/server/playerDataConvergenceRun.test.ts`, add:

```ts
it('builds a convergence run for historical seasons through reviewed directory sync', () => {
  const run = buildPlayerDataConvergenceRun({
    season: 2025,
    rounds: [1, 2, 3],
    runId: 'test-run',
    applyDirectorySync: true,
    includeMergedLive: false,
    skipBuild: false,
    skipVerify: false,
    json: true,
  });

  expect(run.commands.map((command) => command.phase)).toEqual([
    'diagnose',
    'sync-dry-run',
    'sync-apply',
    'build-read-models',
    'verify-read-models',
  ]);
  expect(run.commands[1]?.args).toContain('--season=2025');
  expect(run.commands[4]?.args).not.toContain('--include-merged-live');
});
```

- [ ] **Step 2: Run runner tests**

```bash
npx vitest run src/server/playerDataConvergenceRun.test.ts
```

Expected:
- Tests pass after runner accepts historical seasons.

- [ ] **Step 3: Add optional all-supported-seasons wrapper**

In `Scripts/run-player-data-convergence.ts`, support either:

```bash
--season=2025 --rounds=1,2,3
```

or:

```bash
--seasons=2023,2024,2025,2026 --rounds=1,2,3
```

Rules:
- `--season` and `--seasons` are mutually exclusive.
- every season must be between `2020` and `2035`
- the command runs seasons sequentially, not in parallel, because they share the same Prisma target

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/server/playerDataConvergenceRun.test.ts
```

Expected:
- Tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/playerDataConvergenceRun.ts src/server/playerDataConvergenceRun.test.ts Scripts/run-player-data-convergence.ts package.json
git commit -m "feat: support multi-season player data convergence runs"
```

## Task 10: Strengthen Verification Gates

**Invariant enforced:** A run cannot be called converged while raw or projection drift remains.

**Files:**
- Modify: `Scripts/verify-player-read-models-core.ts`
- Modify: `tests/verify-player-read-models-core.test.ts`

- [ ] **Step 1: Add failing verifier tests**

In `tests/verify-player-read-models-core.test.ts`, add tests asserting:

```ts
it('fails when raw rows were skipped before projection', async () => {
  const result = await runVerifierWithRows({
    rawRows: [{ playerId: null, reason: 'missing canonical id' }],
    projectionRows: [],
  });

  expect(result.ok).toBe(false);
  expect(result.rawDriftDiagnosticSummary.byLikelyCause.dropped_before_raw).toBeGreaterThan(0);
});

it('fails when raw rows do not appear in projection', async () => {
  const result = await runVerifierWithRows({
    rawRows: [{ playerId: 'aaron_cadman', matchId: '2025-R1-GWS-SYD' }],
    projectionRows: [],
  });

  expect(result.ok).toBe(false);
  expect(result.rawDriftDiagnosticSummary.byLikelyCause.dropped_in_projection).toBeGreaterThan(0);
});
```

Use existing verifier test helpers in the file; if names differ, adapt only to existing helper APIs.

- [ ] **Step 2: Run verifier tests**

```bash
npx vitest run tests/verify-player-read-models-core.test.ts
```

Expected:
- Fails if verifier still reports `ok: true` with those drift classes.

- [ ] **Step 3: Update verifier ok/status logic**

In `Scripts/verify-player-read-models-core.ts`:

- set `ok = false` if `rawDriftDiagnosticSummary.byLikelyCause.dropped_before_raw > 0`
- set `ok = false` if `rawDriftDiagnosticSummary.byLikelyCause.dropped_in_projection > 0`
- include both failure classes in JSON output even when count is zero
- keep external merged-source timeout as `warn` only when local raw/projection stages pass and the user explicitly requested merged-source comparison

- [ ] **Step 4: Run verifier tests**

```bash
npx vitest run tests/verify-player-read-models-core.test.ts
```

Expected:
- Tests pass.

- [ ] **Step 5: Commit**

```bash
git add Scripts/verify-player-read-models-core.ts tests/verify-player-read-models-core.test.ts
git commit -m "fix: fail player read-model verifier on convergence drift"
```

## Task 11: Execute Durable Multi-Season Convergence Locally

**Files:**
- Mutates: local Prisma database selected by `DATABASE_URL`
- Generates: `tmp/player-data-convergence/**`

- [ ] **Step 1: Start from a clean or intentionally selected dev DB**

Run:

```bash
sqlite3 /Users/robert/Developer/Statly/prisma/dev.db \
  "select 'Player', count(*) from Player union all select 'PlayerSeasonRegistration', count(*) from PlayerSeasonRegistration union all select 'PlayerSeasonSummary', count(*) from PlayerSeasonSummary union all select 'PlayerMatchLogProjection', count(*) from PlayerMatchLogProjection;"
```

Expected:
- Counts are recorded before repair.
- If DB is not clean, continue only if this is an intentional rematerialization.

- [ ] **Step 2: Run convergence per historical season**

Run from the clean implementation worktree:

```bash
DATABASE_URL='file:/Users/robert/Developer/Statly/prisma/dev.db' \
  npm --silent run converge:player-data -- \
  --seasons=2023,2024,2025 \
  --rounds=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24 \
  --apply-directory-sync \
  --json
```

Expected:
- `diagnose` completes for every season.
- `sync-dry-run` coverage is `ok: true` for every season.
- `sync-apply` is `applied: true` or idempotently no-op for every season.
- `build-read-models` reports `skippedWithoutCanonicalId: 0` for every season.
- `verify-read-models` reports `ok: true`, `status: pass` for every season.

- [ ] **Step 3: Run 2026 convergence**

Run:

```bash
DATABASE_URL='file:/Users/robert/Developer/Statly/prisma/dev.db' \
  npm --silent run converge:player-data -- \
  --season=2026 \
  --rounds=0 \
  --apply-directory-sync \
  --json
```

Expected:
- Same success criteria as Step 2.
- Any documented ignored non-semantic duplicate remains explicitly listed by the coverage gate.

- [ ] **Step 4: Optional merged-source verification**

Run only when external source scripts are expected to be reachable:

```bash
DATABASE_URL='file:/Users/robert/Developer/Statly/prisma/dev.db' \
  npm --silent run verify:player-read-models -- \
  --season=2025 \
  --rounds=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24 \
  --include-merged-live \
  --json
```

Expected:
- If external fetch times out, record it as an external-source verification gap.
- Do not block local raw/projection convergence on unavailable external fetch unless the task explicitly requires merged-source reconciliation.

## Task 12: Verify API And Duplicate Identity Constraints

**Files:**
- Reads: `/Users/robert/Developer/Statly/prisma/dev.db`
- Reads: `http://localhost:3000/api/players`

- [ ] **Step 1: Verify DB counts by season**

```bash
sqlite3 /Users/robert/Developer/Statly/prisma/dev.db \
  "select season, count(*) from PlayerSeasonRegistration group by season order by season;
   select season, count(*) from PlayerSeasonSummary group by season order by season;
   select season, count(*) from PlayerMatchLogProjection group by season order by season;"
```

Expected:
- `2023`, `2024`, `2025`, and `2026` all have non-zero registration, summary, and projection counts.

- [ ] **Step 2: Verify no provider/canonical duplicate player rows for the same season/name/team**

```bash
sqlite3 /Users/robert/Developer/Statly/prisma/dev.db \
  "select season, lower(playerName), lower(club), count(distinct playerId)
   from PlayerSeasonSummary
   group by season, lower(playerName), lower(club)
   having count(distinct playerId) > 1;"
```

Expected:
- No rows.

- [ ] **Step 3: Verify API totals match season summaries**

```bash
for season in 2023 2024 2025 2026; do
  db_total=$(sqlite3 /Users/robert/Developer/Statly/prisma/dev.db "select count(*) from PlayerSeasonSummary where season=$season;")
  api_total=$(curl -sS --max-time 30 "http://localhost:3000/api/players?limit=1&page=1&season=$season" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).total));')
  echo "$season db=$db_total api=$api_total"
done
```

Expected:
- `db` equals `api` for every season.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npm test -- src/server/players/playerPool.test.ts src/app/api/players/route.test.ts
npm run typecheck
```

Expected:
- Tests pass.
- Typecheck passes.

## Task 13: Document The Durable Runbook

**Files:**
- Modify: `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- Modify: `docs/DATA_RELIABILITY.md`
- Create: `docs/player-data-convergence-runbook.md`

- [ ] **Step 1: Add runbook**

Create `docs/player-data-convergence-runbook.md` with:

```md
# Player Data Convergence Runbook

## Purpose

Use this runbook to converge Firestore raw player-match rows, Prisma player identity, and player read-model projections for a bounded season and round scope.

## Supported Seasons

The reviewed evidence registry supports `2023`, `2024`, `2025`, and `2026`.

## Standard Command

DATABASE_URL='file:/Users/robert/Developer/Statly/prisma/dev.db' \
  npm --silent run converge:player-data -- \
  --seasons=2023,2024,2025,2026 \
  --rounds=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24 \
  --apply-directory-sync \
  --json

Use `--season=2026 --rounds=0` for 2026 opening-round repair.

## Required Gates

- Directory coverage must be `ok: true`.
- Read-model build must report `skippedWithoutCanonicalId: 0`.
- Verifier must report `ok: true`, `status: pass`.
- API season total must match `PlayerSeasonSummary` count.
- Duplicate season/name/team identities must be zero.

## Firestore Boundary

Convergence reads Firestore raw documents and writes Prisma projections. It must not write Firestore unless an explicit import or canonical replay command is being run.
```

- [ ] **Step 2: Update architecture docs**

In `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`, add:

```md
Historical player identity normalization is owned by `shared/player-identity/playerMatchStats.ts`.
Provider ids such as `ply_*` are provenance, not permanent Prisma player ids, unless reviewed evidence explicitly declares them canonical.
```

In `docs/DATA_RELIABILITY.md`, add:

```md
Player read-model convergence is not complete until the season-scoped API total matches the published `PlayerSeasonSummary` count and drift classes `dropped_before_raw` and `dropped_in_projection` are zero.
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/player-data-convergence-runbook.md docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md docs/DATA_RELIABILITY.md
git commit -m "docs: document multi-season player data convergence"
```

## Final Verification

Run:

```bash
npm run typecheck
npx vitest run \
  src/lib/__tests__/playerMatchStats.test.ts \
  src/server/diagnostics/playerIdentityGapDiagnosis.test.ts \
  src/server/playerDirectoryEvidenceFromRaw.test.ts \
  src/server/playerDirectorySeasonRoster.test.ts \
  src/server/playerDirectorySeasonRosterSync.test.ts \
  src/server/playerDataConvergenceRun.test.ts \
  src/server/readModels/playerReadModels.test.ts \
  src/server/players/playerPool.test.ts \
  src/app/api/players/route.test.ts \
  tests/verify-player-read-models-core.test.ts
```

Expected:
- Typecheck passes.
- All focused tests pass.

Run DB/API verification:

```bash
sqlite3 /Users/robert/Developer/Statly/prisma/dev.db \
  "select season, count(*) from PlayerSeasonSummary group by season order by season;
   select season, count(*) from PlayerMatchLogProjection group by season order by season;"

for season in 2023 2024 2025 2026; do
  curl -sS --max-time 30 "http://localhost:3000/api/players?limit=1&page=1&season=$season"
done
```

Expected:
- Every target season returns non-empty players.
- API totals match `PlayerSeasonSummary` counts.
- No target season reports `skippedWithoutCanonicalId > 0`.

## Operational Risks

- Generated historical evidence is not automatically trusted. It must be reviewed before apply.
- Provider ids are preserved as aliases/provenance, not duplicated as canonical `Player.id` rows.
- External merged-source verification can timeout independently of local raw/projection convergence. Treat that as a separate source availability issue.
- This plan intentionally avoids adding Firestore write paths. Any future Firestore canonical replay must have its own authorization and audit plan.

## Self-Review

- **Spec coverage:** The plan now targets `2023`, `2024`, `2025`, and `2026`, not just 2026 round 0. It includes canonical identity normalization, reviewed historical evidence, generalized sync, bounded rebuild, strict verifier gates, API season scoping, and docs.
- **Shortcoming coverage:** The plan explicitly addresses one-off DB seeding, duplicated `ply_*` identities, 2026-only evidence, global-player API leakage, verifier gaps, and canonical contract drift.
- **Placeholder scan:** No `TBD`, `TODO`, or unspecified "handle later" steps remain. Any generated evidence requires explicit review before apply.
- **Type consistency:** The plan consistently uses `ReviewedSeasonRosterEntry`, `resolveRawPlayerIdentity`, `PlayerSeasonSummary`, `PlayerSeasonRegistration`, and `PlayerMatchLogProjection`.
