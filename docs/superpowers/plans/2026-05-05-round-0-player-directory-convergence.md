# 2026 Player Directory Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a durable 2026 player-directory convergence workflow so Firestore canonical `player_match_stats.player_id` values are represented in Prisma before player read models are rebuilt, using 2026 round 0 as the first bounded proof slice.

**Architecture:** Prisma remains the canonical player identity directory (`Player`, `PlayerAlias`, `PlayerSeasonRegistration`) and Firestore remains the canonical resolved event store. A reviewed season roster snapshot is the source for creating or updating Prisma player identity records; the identity-gap diagnostic is a quality gate that proves Firestore ids are covered by that directory, not a source for inventing players. Directory application is dry-run first, idempotent, transactionally applied, and followed by bounded read-model rematerialization and convergence verification.

**Tech Stack:** TypeScript, Prisma Client transactions, Firebase Admin Firestore reads, tsx scripts, Vitest, existing diagnostic JSONL exports, existing player directory repair helpers, official roster evidence captured as reviewed source-controlled data.

---

## Why This Plan Replaces The Previous One

The previous plan moved in the right direction by rejecting Firestore patching and read-model fallbacks, but it still had several long-term weaknesses:

1. It let diagnostic rows drive player creation. The diagnostic is evidence of a directory gap, not authority that a player exists.
2. It overfit to `2026 round 0`. The durable fix is a 2026 season player-directory convergence workflow, then round 0 verification.
3. It risked treating known AFL players as “new” only because local Prisma is incomplete. The better model is an authoritative season roster sync that can create missing players, register existing players, and add aliases deliberately.
4. It cited transactional best practice but did not require atomic application of player, registration, alias, and audit updates.
5. It relied on manual expansion row-by-row from diagnostic output. The better workflow generates a curation gap report, requires reviewed roster evidence, and blocks application until every relevant diagnostic id is covered.
6. It did not add a reusable quality gate to prevent future imports or rebuilds from publishing projections when Firestore `player_id` does not exist in Prisma.

## Best-Practice Basis

Repo-local guidance:

- `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`: Prisma owns canonical player identity; Firestore owns resolved event rows; repair should use identity updates plus replay/rebuild, not direct Firestore patching.
- `docs/DATA_RELIABILITY.md`: Lane A read models require Firestore `player_match_stats`, canonical `player_id`, and matching Prisma `Player.id`.
- `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`: long-term target is one canonical Firestore raw-match contract and no permanent downstream fallback readers.
- `docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md`: observed 2026 round 0 failure is `236` scoped rows, all `player_id_not_in_prisma`.

External sources:

- [Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions): use transactions for write sets that must succeed or fail as a unit; avoid long-running network work inside transactions.
- [Prisma seeding](https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding): reproducible required data belongs in explicit seed/sync workflows, not ad hoc database state.
- [Firestore best practices](https://firebase.google.com/docs/firestore/best-practices): use cursor-based paging and server libraries for backend workflows; avoid broad unnecessary writes.
- [Google Cloud Dataplex data quality](https://cloud.google.com/dataplex/docs/auto-data-quality-overview): model quality checks as explicit row-level and aggregate expectations with analyzed results and monitoring.

## Non-Negotiable Invariants

For the repaired 2026 round 0 scope:

1. Every Firestore `player_match_stats.player_id` must exist in Prisma `Player.id`.
2. Every 2026 player in app-facing projections must have a Prisma `PlayerSeasonRegistration`.
3. A diagnostic row may request coverage, but only reviewed roster evidence may authorize a player or registration.
4. Directory sync must be idempotent: re-running dry-run or apply must not create duplicates or alter reviewed facts unexpectedly.
5. Directory apply must be atomic for the Prisma write set.
6. Firestore canonical rows must not be patched as the primary fix for `player_id_not_in_prisma`.
7. Read models must not add fallback semantics that reinterpret raw player names when canonical `player_id` exists.
8. `player_id_not_in_prisma`, `skippedWithoutCanonicalId`, `dropped_before_raw`, and `dropped_in_projection` must be zero for the claimed repaired slice.

## File Structure

- Create `src/server/playerDirectorySeasonRoster.ts`
  - Owns reviewed season roster types, validation, deterministic ids, coverage checks, and diff types.
  - Pure module. No Prisma or Firestore imports.
- Create `src/server/playerDirectorySeasonRoster.test.ts`
  - Unit tests for roster validation, duplicate detection, official evidence requirements, diagnostic coverage, and existing-player registration behavior.
- Modify `src/data/playerRosterEvidence2026.ts`
  - Continue to be the reviewed 2026 roster evidence source.
  - Expand from partial evidence to the reviewed 2026 roster coverage needed for the round 0 diagnostic gate.
- Create `src/server/playerDirectorySeasonRosterSync.ts`
  - Converts reviewed roster evidence into Prisma directory writes.
  - Computes dry-run diffs and applies writes inside one Prisma transaction.
  - No Firestore imports.
- Create `src/server/playerDirectorySeasonRosterSync.test.ts`
  - Unit tests with mocked Prisma-like client for idempotency, creates, registrations, alias pass-through, and transaction use.
- Create `Scripts/sync-player-directory-season.ts`
  - CLI for dry-run/apply of the season roster sync.
  - Supports `--season=2026`, `--diagnostic-jsonl`, `--json`, and `--apply`.
  - Refuses `--apply` when diagnostic coverage is incomplete.
- Modify `package.json`
  - Add `sync:player-directory-season`.
- Modify `src/server/diagnostics/playerIdentityGapDiagnosis.ts`
  - Add summary fields for `distinctStoredPlayerIds`, `missingPrismaPlayerIds`, and `missingPrismaPlayerIdCount`.
  - Preserve existing row export.
- Modify `Scripts/diagnose-player-identity-gaps.ts`
  - Keep JSON stdout machine-parseable under `npm --silent`.
  - No Firestore or Prisma writes.
- Modify `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
  - Document the season directory sync and diagnostic gate.
- Modify `docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md`
  - Point the observed result to the season directory convergence workflow.

## Task 1: Add Season Roster Validation Contract

**Files:**

- Create: `src/server/playerDirectorySeasonRoster.ts`
- Create: `src/server/playerDirectorySeasonRoster.test.ts`

- [ ] **Step 1: Write failing tests for reviewed roster validation**

Create `src/server/playerDirectorySeasonRoster.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildSeasonRosterCoverage,
  validateReviewedSeasonRoster,
  type ReviewedSeasonRosterEntry,
} from './playerDirectorySeasonRoster';
import type { IdentityGapDiagnosticRow } from './diagnostics/playerIdentityGapDiagnosis';

const rosterEntry = (
  overrides: Partial<ReviewedSeasonRosterEntry> = {}
): ReviewedSeasonRosterEntry => ({
  season: 2026,
  playerId: 'aaron_naughton',
  playerName: 'Aaron Naughton',
  club: 'Western Bulldogs',
  position: 'FWD',
  playerStatus: 'listed',
  listStatus: 'active',
  active: true,
  source: 'club-roster',
  sourceLabel: 'Western Bulldogs AFL player profile',
  sourceUrl: 'https://www.westernbulldogs.com.au/players/1605/aaron-naughton',
  reviewedBy: 'manual-review-2026-05-05',
  reviewedAt: '2026-05-05',
  notes: 'Official player profile identifies Naughton as a Western Bulldogs forward.',
  aliases: [],
  ...overrides,
});

const diagnosticRow = (
  overrides: Partial<IdentityGapDiagnosticRow> = {}
): IdentityGapDiagnosticRow => ({
  doc_id: '2026-R0-BRI-BUL_ply_aaron_naughton',
  season: 2026,
  round: 0,
  match_id: '2026-R0-BRI-BUL',
  storage_match_id: '2026-R0-BRI-BUL',
  player_name: 'Aaron Naughton',
  team: 'Western Bulldogs',
  opponent: null,
  stored_player_id: 'aaron_naughton',
  classification: 'player_id_not_in_prisma',
  secondary_flags: ['has_canonical_stats', 'has_raw_row'],
  resolved_player_id: null,
  resolved_player_name: null,
  candidate_player_ids: [],
  unresolved_queue_statuses: [],
  source: 'footywire',
  has_canonical_stats: true,
  has_raw_row: true,
  updated_at: '2026-04-20T12:53:56.156Z',
  ...overrides,
});

describe('validateReviewedSeasonRoster', () => {
  it('accepts a reviewed roster entry with official evidence', () => {
    const result = validateReviewedSeasonRoster({
      season: 2026,
      entries: [rosterEntry()],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.normalizedEntries).toEqual([
      expect.objectContaining({
        playerId: 'aaron_naughton',
        normalizedPlayerName: 'aaron naughton',
        normalizedClub: 'western bulldogs',
      }),
    ]);
  });

  it('rejects duplicate player ids with conflicting canonical facts', () => {
    const result = validateReviewedSeasonRoster({
      season: 2026,
      entries: [
        rosterEntry(),
        rosterEntry({
          playerName: 'Aaron Naughton Different',
          position: 'DEF',
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Player aaron_naughton appears more than once with conflicting canonical facts'
    );
  });

  it('rejects entries without reviewer and source URL', () => {
    const result = validateReviewedSeasonRoster({
      season: 2026,
      entries: [
        rosterEntry({
          reviewedBy: '',
          sourceUrl: '',
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Player aaron_naughton is missing reviewedBy');
    expect(result.errors).toContain('Player aaron_naughton is missing sourceUrl');
  });
});

describe('buildSeasonRosterCoverage', () => {
  it('reports diagnostic stored player ids missing from reviewed roster evidence', () => {
    const coverage = buildSeasonRosterCoverage({
      season: 2026,
      rosterEntries: [rosterEntry()],
      diagnosticRows: [
        diagnosticRow(),
        diagnosticRow({
          doc_id: '2026-R0-BRI-BUL_ply_bailey_dale',
          stored_player_id: 'bailey_dale',
          player_name: 'Bailey Dale',
        }),
      ],
    });

    expect(coverage.coveredStoredPlayerIds).toEqual(['aaron_naughton']);
    expect(coverage.missingStoredPlayerIds).toEqual(['bailey_dale']);
    expect(coverage.ok).toBe(false);
  });

  it('ignores diagnostic rows outside player_id_not_in_prisma coverage checks', () => {
    const coverage = buildSeasonRosterCoverage({
      season: 2026,
      rosterEntries: [],
      diagnosticRows: [
        diagnosticRow({
          classification: 'canonical_player_id_ok',
        }),
      ],
    });

    expect(coverage.ok).toBe(true);
    expect(coverage.missingStoredPlayerIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/server/playerDirectorySeasonRoster.test.ts
```

Expected: fail because `src/server/playerDirectorySeasonRoster.ts` does not exist.

- [ ] **Step 3: Implement roster validation contract**

Create `src/server/playerDirectorySeasonRoster.ts`:

```ts
import type { IdentityGapDiagnosticRow } from './diagnostics/playerIdentityGapDiagnosis';
import {
  normalizeLookupPart,
  normalizeTeamLookup,
} from '../../shared/player-identity/playerMatchStats';

export const REVIEWED_ROSTER_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'] as const;

export type ReviewedRosterPosition = (typeof REVIEWED_ROSTER_POSITIONS)[number];

export type ReviewedSeasonRosterAlias = {
  aliasName: string;
  club?: string | null;
  seasonFrom?: number | null;
  seasonTo?: number | null;
  source?: 'MANUAL' | 'FOOTYWIRE' | 'AFL_OFFICIAL' | 'CLUB_ROSTER';
  confidence?: number;
  notes: string;
};

export type ReviewedSeasonRosterEntry = {
  season: number;
  playerId: string;
  playerName: string;
  club: string;
  position: ReviewedRosterPosition;
  playerStatus: 'listed' | 'inactive' | 'delisted';
  listStatus: string;
  active: boolean;
  source: 'afl-official-roster' | 'club-roster' | 'manual-roster-review';
  sourceLabel: string;
  sourceUrl: string;
  reviewedBy: string;
  reviewedAt: string;
  notes: string;
  aliases: ReviewedSeasonRosterAlias[];
};

export type NormalizedReviewedSeasonRosterEntry = ReviewedSeasonRosterEntry & {
  normalizedPlayerName: string;
  normalizedClub: string;
};

export type ReviewedSeasonRosterValidation = {
  valid: boolean;
  errors: string[];
  normalizedEntries: NormalizedReviewedSeasonRosterEntry[];
};

export type SeasonRosterCoverage = {
  ok: boolean;
  season: number;
  diagnosticStoredPlayerIds: string[];
  coveredStoredPlayerIds: string[];
  missingStoredPlayerIds: string[];
};

function stablePlayerId(value: string): string {
  return value.trim();
}

function reviewedAtIsValid(value: string): boolean {
  return Boolean(value.trim()) && !Number.isNaN(Date.parse(value));
}

export function validateReviewedSeasonRoster(params: {
  season: number;
  entries: ReviewedSeasonRosterEntry[];
}): ReviewedSeasonRosterValidation {
  const errors: string[] = [];
  const normalizedEntries = params.entries.map((entry) => ({
    ...entry,
    playerId: stablePlayerId(entry.playerId),
    normalizedPlayerName: normalizeLookupPart(entry.playerName),
    normalizedClub: normalizeTeamLookup(entry.club),
  }));

  const byPlayerId = new Map<string, NormalizedReviewedSeasonRosterEntry>();

  for (const entry of normalizedEntries) {
    const label = `Player ${entry.playerId || '<missing id>'}`;

    if (entry.season !== params.season)
      errors.push(`${label} has season ${entry.season}, expected ${params.season}`);
    if (!entry.playerId) errors.push(`${label} is missing playerId`);
    if (!entry.playerName.trim()) errors.push(`${label} is missing playerName`);
    if (!entry.normalizedClub) errors.push(`${label} is missing club`);
    if (!REVIEWED_ROSTER_POSITIONS.includes(entry.position)) {
      errors.push(`${label} has invalid position ${entry.position}`);
    }
    if (!entry.reviewedBy.trim()) errors.push(`${label} is missing reviewedBy`);
    if (!reviewedAtIsValid(entry.reviewedAt)) errors.push(`${label} has invalid reviewedAt`);
    if (!entry.sourceLabel.trim()) errors.push(`${label} is missing sourceLabel`);
    if (!entry.sourceUrl.trim()) errors.push(`${label} is missing sourceUrl`);
    if (!entry.notes.trim()) errors.push(`${label} is missing notes`);

    const existing = byPlayerId.get(entry.playerId);
    if (
      existing &&
      (existing.playerName !== entry.playerName ||
        existing.club !== entry.club ||
        existing.position !== entry.position)
    ) {
      errors.push(`${label} appears more than once with conflicting canonical facts`);
    }
    byPlayerId.set(entry.playerId, entry);
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedEntries,
  };
}

export function buildSeasonRosterCoverage(params: {
  season: number;
  rosterEntries: ReviewedSeasonRosterEntry[];
  diagnosticRows: IdentityGapDiagnosticRow[];
}): SeasonRosterCoverage {
  const reviewedPlayerIds = new Set(
    params.rosterEntries
      .filter((entry) => entry.season === params.season)
      .map((entry) => stablePlayerId(entry.playerId))
      .filter(Boolean)
  );
  const diagnosticStoredPlayerIds = [
    ...new Set(
      params.diagnosticRows
        .filter((row) => row.season === params.season)
        .filter((row) => row.classification === 'player_id_not_in_prisma')
        .map((row) => row.stored_player_id)
        .filter((value): value is string => Boolean(value))
    ),
  ].sort();
  const coveredStoredPlayerIds = diagnosticStoredPlayerIds
    .filter((playerId) => reviewedPlayerIds.has(playerId))
    .sort();
  const missingStoredPlayerIds = diagnosticStoredPlayerIds
    .filter((playerId) => !reviewedPlayerIds.has(playerId))
    .sort();

  return {
    ok: missingStoredPlayerIds.length === 0,
    season: params.season,
    diagnosticStoredPlayerIds,
    coveredStoredPlayerIds,
    missingStoredPlayerIds,
  };
}
```

- [ ] **Step 4: Run roster contract tests**

Run:

```bash
npx vitest run src/server/playerDirectorySeasonRoster.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/playerDirectorySeasonRoster.ts src/server/playerDirectorySeasonRoster.test.ts
git commit -m "Add reviewed season roster contract"
```

## Task 2: Add Atomic Season Roster Sync Service

**Files:**

- Create: `src/server/playerDirectorySeasonRosterSync.ts`
- Create: `src/server/playerDirectorySeasonRosterSync.test.ts`

- [ ] **Step 1: Write failing sync tests**

Create `src/server/playerDirectorySeasonRosterSync.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import type { ReviewedSeasonRosterEntry } from './playerDirectorySeasonRoster';
import {
  buildSeasonRosterSyncPlan,
  applySeasonRosterSyncPlan,
} from './playerDirectorySeasonRosterSync';

const rosterEntry = (
  overrides: Partial<ReviewedSeasonRosterEntry> = {}
): ReviewedSeasonRosterEntry => ({
  season: 2026,
  playerId: 'aaron_naughton',
  playerName: 'Aaron Naughton',
  club: 'Western Bulldogs',
  position: 'FWD',
  playerStatus: 'listed',
  listStatus: 'active',
  active: true,
  source: 'club-roster',
  sourceLabel: 'Western Bulldogs AFL player profile',
  sourceUrl: 'https://www.westernbulldogs.com.au/players/1605/aaron-naughton',
  reviewedBy: 'manual-review-2026-05-05',
  reviewedAt: '2026-05-05',
  notes: 'Official player profile identifies Naughton as a Western Bulldogs forward.',
  aliases: [],
  ...overrides,
});

function prismaMock(
  existing: {
    players?: Array<{ id: string; name: string; club: string; position: string; active: boolean }>;
    registrations?: Array<{ playerId: string; season: number; normalizedClub: string }>;
  } = {}
) {
  return {
    player: {
      findMany: vi.fn().mockResolvedValue(existing.players ?? []),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    playerSeasonRegistration: {
      findMany: vi.fn().mockResolvedValue(existing.registrations ?? []),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    playerAlias: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (fn) =>
      fn({
        player: {
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
        },
        playerSeasonRegistration: {
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
        },
        playerAlias: {
          create: vi.fn().mockResolvedValue({}),
        },
      })
    ),
  };
}

describe('buildSeasonRosterSyncPlan', () => {
  it('plans a missing player and missing season registration', async () => {
    const prisma = prismaMock();

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [rosterEntry()],
    });

    expect(plan.valid).toBe(true);
    expect(plan.playersToCreate).toEqual([
      expect.objectContaining({
        id: 'aaron_naughton',
        name: 'Aaron Naughton',
      }),
    ]);
    expect(plan.registrationsToCreate).toEqual([
      expect.objectContaining({
        playerId: 'aaron_naughton',
        season: 2026,
      }),
    ]);
  });

  it('does not recreate existing player or registration', async () => {
    const prisma = prismaMock({
      players: [
        {
          id: 'aaron_naughton',
          name: 'Aaron Naughton',
          club: 'Western Bulldogs',
          position: 'FWD',
          active: true,
        },
      ],
      registrations: [
        {
          playerId: 'aaron_naughton',
          season: 2026,
          normalizedClub: 'western bulldogs',
        },
      ],
    });

    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [rosterEntry()],
    });

    expect(plan.playersToCreate).toEqual([]);
    expect(plan.registrationsToCreate).toEqual([]);
    expect(plan.existingPlayerIds).toEqual(['aaron_naughton']);
  });
});

describe('applySeasonRosterSyncPlan', () => {
  it('applies all writes inside one transaction', async () => {
    const prisma = prismaMock();
    const plan = await buildSeasonRosterSyncPlan(prisma as never, {
      season: 2026,
      entries: [rosterEntry()],
    });

    const result = await applySeasonRosterSyncPlan(prisma as never, plan);

    expect(result.applied).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/server/playerDirectorySeasonRosterSync.test.ts
```

Expected: fail because `playerDirectorySeasonRosterSync.ts` does not exist.

- [ ] **Step 3: Implement the sync service**

Create `src/server/playerDirectorySeasonRosterSync.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';

import {
  validateReviewedSeasonRoster,
  type ReviewedSeasonRosterEntry,
} from './playerDirectorySeasonRoster';
import {
  normalizeLookupPart,
  normalizeTeamLookup,
} from '../../shared/player-identity/playerMatchStats';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type SeasonRosterSyncPlan = {
  valid: boolean;
  errors: string[];
  season: number;
  playersToCreate: ReviewedSeasonRosterEntry[];
  playersToUpdate: ReviewedSeasonRosterEntry[];
  registrationsToCreate: ReviewedSeasonRosterEntry[];
  registrationsToUpdate: ReviewedSeasonRosterEntry[];
  aliasesToCreate: Array<ReviewedSeasonRosterEntry & { aliasName: string }>;
  existingPlayerIds: string[];
};

export type SeasonRosterSyncApplyResult = SeasonRosterSyncPlan & {
  applied: boolean;
};

function registrationKey(entry: { playerId: string; season: number; club: string }): string {
  return [entry.playerId, entry.season, normalizeTeamLookup(entry.club)].join('|');
}

export async function buildSeasonRosterSyncPlan(
  prisma: PrismaLike,
  params: { season: number; entries: ReviewedSeasonRosterEntry[] }
): Promise<SeasonRosterSyncPlan> {
  const validation = validateReviewedSeasonRoster(params);
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      season: params.season,
      playersToCreate: [],
      playersToUpdate: [],
      registrationsToCreate: [],
      registrationsToUpdate: [],
      aliasesToCreate: [],
      existingPlayerIds: [],
    };
  }

  const [players, registrations, aliases] = await Promise.all([
    prisma.player.findMany({
      select: { id: true, name: true, club: true, position: true, active: true },
    }),
    prisma.playerSeasonRegistration.findMany({
      where: { season: params.season },
      select: { playerId: true, season: true, normalizedClub: true },
    }),
    prisma.playerAlias.findMany({
      select: {
        playerId: true,
        normalizedAliasName: true,
        normalizedClub: true,
        seasonFrom: true,
        seasonTo: true,
      },
    }),
  ]);

  const playersById = new Map(players.map((player) => [player.id, player]));
  const registrationKeys = new Set(
    registrations.map((registration) =>
      [registration.playerId, registration.season, registration.normalizedClub].join('|')
    )
  );
  const aliasKeys = new Set(
    aliases.map((alias) =>
      [
        alias.playerId,
        alias.normalizedAliasName,
        alias.normalizedClub ?? '',
        alias.seasonFrom ?? '',
        alias.seasonTo ?? '',
      ].join('|')
    )
  );

  const playersToCreate: ReviewedSeasonRosterEntry[] = [];
  const playersToUpdate: ReviewedSeasonRosterEntry[] = [];
  const registrationsToCreate: ReviewedSeasonRosterEntry[] = [];
  const registrationsToUpdate: ReviewedSeasonRosterEntry[] = [];
  const aliasesToCreate: Array<ReviewedSeasonRosterEntry & { aliasName: string }> = [];
  const existingPlayerIds: string[] = [];

  for (const entry of params.entries) {
    const existing = playersById.get(entry.playerId);
    if (!existing) {
      playersToCreate.push(entry);
    } else {
      existingPlayerIds.push(entry.playerId);
      if (
        existing.name !== entry.playerName ||
        existing.club !== entry.club ||
        existing.position !== entry.position ||
        existing.active !== entry.active
      ) {
        playersToUpdate.push(entry);
      }
    }

    if (
      !registrationKeys.has(
        registrationKey({ playerId: entry.playerId, season: params.season, club: entry.club })
      )
    ) {
      registrationsToCreate.push(entry);
    }

    for (const alias of entry.aliases) {
      const key = [
        entry.playerId,
        normalizeLookupPart(alias.aliasName),
        alias.club ? normalizeTeamLookup(alias.club) : '',
        alias.seasonFrom ?? '',
        alias.seasonTo ?? '',
      ].join('|');
      if (!aliasKeys.has(key)) aliasesToCreate.push({ ...entry, aliasName: alias.aliasName });
    }
  }

  return {
    valid: true,
    errors: [],
    season: params.season,
    playersToCreate,
    playersToUpdate,
    registrationsToCreate,
    registrationsToUpdate,
    aliasesToCreate,
    existingPlayerIds: existingPlayerIds.sort(),
  };
}

export async function applySeasonRosterSyncPlan(
  prisma: PrismaClient,
  plan: SeasonRosterSyncPlan
): Promise<SeasonRosterSyncApplyResult> {
  if (!plan.valid) return { ...plan, applied: false };

  await prisma.$transaction(async (tx) => {
    for (const player of plan.playersToCreate) {
      await tx.player.create({
        data: {
          id: player.playerId,
          name: player.playerName,
          club: player.club,
          position: player.position,
          active: player.active,
        },
      });
    }

    for (const player of plan.playersToUpdate) {
      await tx.player.update({
        where: { id: player.playerId },
        data: {
          name: player.playerName,
          club: player.club,
          position: player.position,
          active: player.active,
        },
      });
    }

    for (const entry of plan.registrationsToCreate) {
      await tx.playerSeasonRegistration.create({
        data: {
          playerId: entry.playerId,
          season: plan.season,
          club: entry.club,
          normalizedClub: normalizeTeamLookup(entry.club),
          position: entry.position,
          listStatus: entry.listStatus,
          active: entry.active,
          source: 'MANUAL',
          approvedBy: entry.reviewedBy,
          notes: `${entry.notes} Evidence: ${entry.sourceLabel} ${entry.sourceUrl}`,
        },
      });
    }
  });

  return { ...plan, applied: true };
}
```

- [ ] **Step 4: Run sync tests**

Run:

```bash
npx vitest run src/server/playerDirectorySeasonRosterSync.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/playerDirectorySeasonRosterSync.ts src/server/playerDirectorySeasonRosterSync.test.ts
git commit -m "Add atomic season roster sync service"
```

## Task 3: Add Season Directory Sync CLI

**Files:**

- Create: `Scripts/sync-player-directory-season.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the CLI**

Create `Scripts/sync-player-directory-season.ts`:

```ts
#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { readFile } from 'node:fs/promises';

import { playerRosterEvidence2026 } from '../src/data/playerRosterEvidence2026';
import { prisma } from '../src/lib/prisma';
import type { IdentityGapDiagnosticRow } from '../src/server/diagnostics/playerIdentityGapDiagnosis';
import { buildSeasonRosterCoverage } from '../src/server/playerDirectorySeasonRoster';
import {
  applySeasonRosterSyncPlan,
  buildSeasonRosterSyncPlan,
} from '../src/server/playerDirectorySeasonRosterSync';

function readArgValue(argv: string[], name: string): string | undefined {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (equalsValue != null) return equalsValue;
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function parseJsonl(contents: string): IdentityGapDiagnosticRow[] {
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as IdentityGapDiagnosticRow;
      } catch (error) {
        throw new Error(
          `Invalid diagnostic JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const season = Number(readArgValue(argv, '--season'));
  const diagnosticJsonl = readArgValue(argv, '--diagnostic-jsonl');
  const apply = argv.includes('--apply');

  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }
  if (season !== 2026) {
    throw new Error('Only season 2026 is wired to reviewed roster evidence in this script');
  }

  const diagnosticRows = diagnosticJsonl ? parseJsonl(await readFile(diagnosticJsonl, 'utf8')) : [];
  const coverage = buildSeasonRosterCoverage({
    season,
    rosterEntries: playerRosterEvidence2026,
    diagnosticRows,
  });
  const syncPlan = await buildSeasonRosterSyncPlan(prisma, {
    season,
    entries: playerRosterEvidence2026,
  });

  const mayApply = syncPlan.valid && coverage.ok;
  const result =
    apply && mayApply
      ? await applySeasonRosterSyncPlan(prisma, syncPlan)
      : { ...syncPlan, applied: false };

  console.log(
    JSON.stringify(
      {
        ok: mayApply,
        apply,
        coverage,
        sync: {
          valid: syncPlan.valid,
          errors: syncPlan.errors,
          playersToCreate: syncPlan.playersToCreate.length,
          playersToUpdate: syncPlan.playersToUpdate.length,
          registrationsToCreate: syncPlan.registrationsToCreate.length,
          registrationsToUpdate: syncPlan.registrationsToUpdate.length,
          aliasesToCreate: syncPlan.aliasesToCreate.length,
          existingPlayerIds: syncPlan.existingPlayerIds.length,
          applied: result.applied,
        },
      },
      null,
      2
    )
  );

  if (!mayApply) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Add package script**

Add this script to `package.json`:

```json
"sync:player-directory-season": "tsx Scripts/sync-player-directory-season.ts"
```

- [ ] **Step 3: Run dry-run with diagnostic artifact**

Run:

```bash
npm --silent run sync:player-directory-season -- --season=2026 --diagnostic-jsonl tmp/identity-gap-2026-r0.jsonl
```

Expected before curation is complete:

- exits non-zero
- `coverage.ok` is `false`
- `coverage.missingStoredPlayerIds` lists every diagnostic id not yet present in `playerRosterEvidence2026`
- `sync.applied` is `false`

- [ ] **Step 4: Run typecheck for the script path**

Run:

```bash
npm run typecheck:app
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add Scripts/sync-player-directory-season.ts package.json
git commit -m "Add season player directory sync command"
```

## Task 4: Curate Reviewed 2026 Roster Evidence To Satisfy Coverage

**Files:**

- Modify: `src/data/playerRosterEvidence2026.ts`

- [ ] **Step 1: Generate curation gap report**

Run:

```bash
npm --silent run diagnose:player-identity-gaps -- --season=2026 --rounds=0 --json --output-jsonl tmp/identity-gap-2026-r0.jsonl --output-csv tmp/identity-gap-2026-r0.csv
npm --silent run sync:player-directory-season -- --season=2026 --diagnostic-jsonl tmp/identity-gap-2026-r0.jsonl
```

Expected:

- the first command exits `0`
- the second command exits non-zero until curation is complete
- `coverage.missingStoredPlayerIds` is the exact curation queue

- [ ] **Step 2: Add reviewed roster entries**

For each id in `coverage.missingStoredPlayerIds`, add exactly one reviewed roster entry to `src/data/playerRosterEvidence2026.ts`.

Use official club/AFL roster pages for:

- `playerName`
- `club`
- `position`
- `sourceLabel`
- `sourceUrl`

Use the diagnostic row only for:

- confirming that Firestore already uses this `playerId`
- validating that the player appears in the affected source data

Concrete entry shape:

```ts
{
  season: 2026,
  playerName: 'Aaron Naughton',
  club: 'Western Bulldogs',
  position: 'FWD',
  playerStatus: 'listed',
  listStatus: 'active',
  active: true,
  playerId: 'aaron_naughton',
  source: 'club-roster',
  sourceLabel: 'Western Bulldogs AFL player profile',
  sourceUrl: 'https://www.westernbulldogs.com.au/players/1605/aaron-naughton',
  reviewedBy: 'manual-review-2026-05-05',
  reviewedAt: '2026-05-05',
  notes: 'Official player profile identifies Naughton as a Western Bulldogs forward.',
  aliases: [],
}
```

If official evidence contradicts the Firestore id, do not add the entry. Instead add a note to the implementation response identifying the id, player name, and contradiction. That case requires a separate canonical-id correction plan.

- [ ] **Step 3: Re-run coverage until clean**

Run:

```bash
npm --silent run sync:player-directory-season -- --season=2026 --diagnostic-jsonl tmp/identity-gap-2026-r0.jsonl
```

Expected:

- exits `0`
- `coverage.ok` is `true`
- `coverage.missingStoredPlayerIds` is `[]`
- `sync.valid` is `true`
- `sync.applied` is `false`

- [ ] **Step 4: Run roster tests**

Run:

```bash
npx vitest run src/server/playerDirectorySeasonRoster.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/playerRosterEvidence2026.ts
git commit -m "Complete reviewed 2026 roster evidence coverage"
```

## Task 5: Apply Atomic Directory Sync

**Files:**

- No source edits expected unless dry-run reveals validation defects.

- [ ] **Step 1: Run final dry-run**

Run:

```bash
npm --silent run sync:player-directory-season -- --season=2026 --diagnostic-jsonl tmp/identity-gap-2026-r0.jsonl
```

Expected:

- exits `0`
- `coverage.ok` is `true`
- `sync.valid` is `true`
- `sync.applied` is `false`
- `playersToCreate`, `playersToUpdate`, `registrationsToCreate`, and `aliasesToCreate` are reviewed before apply

- [ ] **Step 2: Apply sync**

Run:

```bash
npm --silent run sync:player-directory-season -- --season=2026 --diagnostic-jsonl tmp/identity-gap-2026-r0.jsonl --apply
```

Expected:

- exits `0`
- `sync.applied` is `true`
- no duplicate key error
- no Firestore write logs

- [ ] **Step 3: Prove idempotency**

Run:

```bash
npm --silent run sync:player-directory-season -- --season=2026 --diagnostic-jsonl tmp/identity-gap-2026-r0.jsonl
```

Expected:

- exits `0`
- `playersToCreate` is `0`
- `registrationsToCreate` is `0`
- any remaining `playersToUpdate` is intentional and explained before another apply

## Task 6: Strengthen Diagnostic Summary As A Reusable Quality Gate

**Files:**

- Modify: `src/server/diagnostics/playerIdentityGapDiagnosis.ts`
- Modify: `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`

- [ ] **Step 1: Add failing summary test**

Add this test to `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`:

```ts
it('reports distinct missing Prisma player ids for automation gates', () => {
  const result = classifyIdentityGapRows({
    season: 2026,
    rounds: [0],
    rows: [
      baseRow({
        docId: 'doc-1',
        data: { ...baseRow({}).data, player_id: 'missing_player' },
      }),
      baseRow({
        docId: 'doc-2',
        data: { ...baseRow({}).data, player_id: 'missing_player' },
      }),
    ],
    directory: directory(),
    unresolvedRows: [],
    resolveIdentity: vi.fn(),
    limit: 25,
  });

  expect(result.summary.missingPrismaPlayerIds).toEqual(['missing_player']);
  expect(result.summary.missingPrismaPlayerIdCount).toBe(1);
});
```

- [ ] **Step 2: Run failing diagnostic test**

Run:

```bash
npx vitest run src/server/diagnostics/playerIdentityGapDiagnosis.test.ts -t "distinct missing Prisma player ids"
```

Expected: fail because summary fields do not exist.

- [ ] **Step 3: Add summary fields**

In `IdentityGapDiagnosticSummary`, add:

```ts
distinctStoredPlayerIds: string[];
missingPrismaPlayerIds: string[];
missingPrismaPlayerIdCount: number;
```

In the summary construction, compute:

```ts
const distinctStoredPlayerIds = [
  ...new Set(
    diagnosticRows
      .map((row) => row.stored_player_id)
      .filter((value): value is string => Boolean(value))
  ),
].sort();
const missingPrismaPlayerIds = [
  ...new Set(
    diagnosticRows
      .filter((row) => row.classification === 'player_id_not_in_prisma')
      .map((row) => row.stored_player_id)
      .filter((value): value is string => Boolean(value))
  ),
].sort();
```

Then include:

```ts
distinctStoredPlayerIds,
missingPrismaPlayerIds,
missingPrismaPlayerIdCount: missingPrismaPlayerIds.length,
```

- [ ] **Step 4: Run diagnostic tests**

Run:

```bash
npx vitest run src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/diagnostics/playerIdentityGapDiagnosis.ts src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
git commit -m "Expose missing Prisma player ids in identity diagnostic"
```

## Task 7: Rebuild Bounded Projection Slice

**Files:**

- No source edits expected.

- [ ] **Step 1: Rerun diagnostic after directory sync**

Run:

```bash
npm --silent run diagnose:player-identity-gaps -- --season=2026 --rounds=0 --json --output-jsonl tmp/identity-gap-2026-r0-after-directory.jsonl --output-csv tmp/identity-gap-2026-r0-after-directory.csv
```

Expected:

- `firestoreRowCount` equals `236`
- `classificationCounts.player_id_not_in_prisma` equals `0`
- `classificationCounts.canonical_player_id_ok` equals `236`
- `missingPrismaPlayerIdCount` equals `0`

- [ ] **Step 2: Rebuild only round 0 read models**

Run:

```bash
npm --silent run build:player-read-models -- --season=2026 --rounds=0 --mode=refresh
```

Expected:

- exits `0`
- `skippedWithoutCanonicalId` equals `0`
- output reports non-zero materialized player summaries or match logs

- [ ] **Step 3: Run read-model verifier**

Run:

```bash
npm --silent run verify:player-read-models -- --season=2026 --rounds=0 --include-merged-live --json
```

Expected:

- exits `0`
- `dropped_before_raw` absent
- `dropped_in_projection` absent
- no missing Prisma player directory rows for 2026 round 0

- [ ] **Step 4: Run app-facing smoke check**

Run:

```bash
curl -sS 'http://localhost:3000/api/players?season=2026&limit=5' | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(JSON.stringify({ok:Array.isArray(j.data?.players), count:j.data?.players?.length ?? 0, first:j.data?.players?.[0]?.name ?? null})); if (!Array.isArray(j.data?.players) || j.data.players.length === 0) process.exit(1);})"
```

Expected:

- exits `0`
- output includes `ok: true`
- `count` greater than `0`

## Task 8: Document The Long-Term Runbook

**Files:**

- Modify: `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- Modify: `docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md`

- [ ] **Step 1: Add season directory convergence protocol**

Add this section to `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md` after `Read Model Rebuild Protocol`:

````md
## Season Player Directory Convergence Protocol

When the identity-gap diagnostic reports `player_id_not_in_prisma`, do not patch Firestore and do not add projection fallbacks. The correct repair is to converge the reviewed Prisma player directory with the canonical ids already persisted in Firestore.

Use this workflow:

```bash
npm --silent run diagnose:player-identity-gaps -- --season=YYYY --rounds=R --json --output-jsonl tmp/identity-gap-YYYY-rR.jsonl --output-csv tmp/identity-gap-YYYY-rR.csv
npm --silent run sync:player-directory-season -- --season=YYYY --diagnostic-jsonl tmp/identity-gap-YYYY-rR.jsonl
npm --silent run sync:player-directory-season -- --season=YYYY --diagnostic-jsonl tmp/identity-gap-YYYY-rR.jsonl --apply
npm --silent run diagnose:player-identity-gaps -- --season=YYYY --rounds=R --json
npm --silent run build:player-read-models -- --season=YYYY --rounds=R --mode=refresh
npm --silent run verify:player-read-models -- --season=YYYY --rounds=R --include-merged-live --json
```
````

The sync command must refuse apply until reviewed roster evidence covers every diagnostic `player_id_not_in_prisma` id. Generated `tmp/` artifacts are local evidence and must not be committed unless explicitly promoted to reviewed fixtures.

````

- [ ] **Step 2: Link diagnostic spec to runbook**

Append this sentence to the `Implemented Command` section in `docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md`:

```md
The long-term repair path for this result is the Season Player Directory Convergence Protocol in `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`.
````

- [ ] **Step 3: Commit docs**

```bash
git add docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md
git commit -m "Document season player directory convergence protocol"
```

## Task 9: Final Verification And Review

**Files:**

- No source edits expected unless verification fails.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run src/server/playerDirectorySeasonRoster.test.ts src/server/playerDirectorySeasonRosterSync.test.ts src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck:app
```

Expected: pass.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected:

- exit code `0`, or
- only known unrelated flaky tests fail and each failing file passes when rerun in isolation.

If a failure touches files changed by this plan, stop and fix before final review.

- [ ] **Step 4: Request final code review**

Use this review prompt:

```text
Review the 2026 player directory convergence implementation. Prioritize bugs, accidental Firestore mutation, non-idempotent Prisma writes, weak roster evidence validation, diagnostic gate bypasses, projection fallback drift, and insufficient verification. Return findings first with file/line references or APPROVED.
```

Expected: review returns `APPROVED` or actionable findings are fixed and re-reviewed.

## Done Means

- `sync:player-directory-season` dry-run refuses apply when diagnostic coverage is incomplete.
- Reviewed 2026 roster evidence covers every round 0 diagnostic `player_id_not_in_prisma` id.
- Apply is atomic and idempotent for Prisma writes.
- Post-apply diagnostic has `player_id_not_in_prisma: 0` and `missingPrismaPlayerIdCount: 0`.
- Bounded read-model rebuild reports `skippedWithoutCanonicalId: 0`.
- Verifier reports no `dropped_before_raw` or `dropped_in_projection` for 2026 round 0.
- No Firestore-only repair and no read-model fallback were introduced.
